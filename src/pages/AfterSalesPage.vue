<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { hasPerm } from "../session";
import type { RefundApplication } from "../types";
import { fenToYuan } from "../utils/money";

/**
 * 售后退款工作台（IKHZKA）：
 * - Refund 统一申请主表（送达后售后 + 未发货退款），后台人工审核
 * - 批准 = 微信原路退回（金额=实付−配送费，申请时锁定）
 * - 拒绝 = 订单回滚申请前状态，用户可重新申请
 * - 审核权 after-sales.audit（默认校区运营）；其余角色只读
 */
const TABS = [
  { key: "pending", label: "待审核" },
  { key: "refunding", label: "退款中" },
  { key: "refunded", label: "已退款" },
  { key: "rejected", label: "已拒绝" },
  { key: "failed", label: "退款失败" },
] as const;

const SOURCE_TEXT: Record<string, string> = {
  "after-sale": "送达后售后",
  "pre-delivery": "未发货",
};
const TYPE_TEXT: Record<string, string> = {
  quality: "质量问题",
  missing: "缺件",
  damaged: "破损",
};
/** 订单状态中文（回滚去向展示）。 */
const ORDER_STATUS_TEXT: Record<string, string> = {
  paid: "仓库正在接单",
  delivered: "已送达",
  completed: "已确认收货",
};

const tab = ref<string>("pending");
const source = ref<string>("all");
const keyword = ref("");
const rows = ref<RefundApplication[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const pendingCount = ref(0);
const toast = ref("");

const canAudit = computed(() =>
  hasPerm("POST /admin/refunds/:id/audit"),
);
const hasMore = computed(() => rows.value.length < total.value);

async function load(append = false) {
  loading.value = true;
  try {
    const res = await api.refunds(
      {
        page: page.value,
        pageSize,
        keyword: keyword.value.trim() || undefined,
      },
      tab.value,
      source.value === "all" ? undefined : source.value,
    );
    rows.value = append ? [...rows.value, ...res.items] : res.items;
    total.value = res.total;
  } catch {
    toast.value = "加载失败，请刷新重试";
  } finally {
    loading.value = false;
  }
}
async function loadPendingCount() {
  try {
    const res = await api.refunds({ page: 1, pageSize: 1 }, "pending");
    pendingCount.value = res.total;
  } catch {
    /* 角标失败不影响列表 */
  }
}
function switchTab(key: string) {
  tab.value = key;
  page.value = 1;
  rows.value = [];
  void load();
}
function switchSource() {
  page.value = 1;
  rows.value = [];
  void load();
}
function search() {
  page.value = 1;
  rows.value = [];
  void load();
}
function loadMore() {
  page.value += 1;
  void load(true);
}

/* ---------- 详情弹窗 + 审核 ---------- */
const detail = ref<RefundApplication | null>(null);
const auditMode = ref<"approve" | "reject" | null>(null);
const remark = ref("");
const submitting = ref(false);
/** v2 部分退款：审核核定的各行金额（itemId → 元字符串，提交时转分） */
const itemAmounts = ref<Record<string, string>>({});

function openDetail(row: RefundApplication) {
  detail.value = row;
  auditMode.value = null;
  remark.value = "";
  itemAmounts.value = {};
}
function startAudit(mode: "approve" | "reject") {
  auditMode.value = mode;
  remark.value = "";
  if (mode === "approve" && detail.value?.items.length)
    itemAmounts.value = Object.fromEntries(
      detail.value.items.map((i) => [i.id, (i.amount / 100).toFixed(2)]),
    );
}
async function submitAudit() {
  if (!detail.value || !auditMode.value) return;
  if (auditMode.value === "reject" && !remark.value.trim()) {
    toast.value = "拒绝时请填写原因（用户可见）";
    return;
  }
  submitting.value = true;
  try {
    const amounts = detail.value.items.length
      ? detail.value.items.map((i) => ({
          itemId: i.id,
          amount: Math.round(Number(itemAmounts.value[i.id] ?? i.amount) * 100),
        }))
      : undefined;
    const after = await api.auditRefund(
      detail.value.id,
      auditMode.value,
      remark.value.trim(),
      amounts,
    );
    toast.value =
      auditMode.value === "approve"
        ? after.status === "refunded"
          ? "退款已完成（微信原路退回）"
          : "已批准，退款受理中"
        : "已拒绝，订单已回滚";
    detail.value = null;
    auditMode.value = null;
    await Promise.all([load(), loadPendingCount()]);
  } catch (e) {
    toast.value = e instanceof Error ? e.message : "操作失败，请重试";
  } finally {
    submitting.value = false;
  }
}
async function sync(row: RefundApplication) {
  try {
    const after = await api.syncRefund(row.id);
    toast.value =
      after.status === "refunded"
        ? "退款已完成"
        : after.status === "failed"
          ? "微信侧退款已关闭，可重新批准发起"
          : "微信仍在处理，稍后再试";
    await load();
  } catch (e) {
    toast.value = e instanceof Error ? e.message : "同步失败，请重试";
  }
}

/* ---------- v2 按商品退款（客服主动发起，一次提交即退款） ---------- */
const createOpen = ref(false);
const createOrderNo = ref("");
const createOrder = ref<{
  id: string;
  orderNo: string;
  payableAmount: number;
  deliveryFee?: number;
  items: Array<{ product: { id: string; name: string; price: number }; quantity: number }>;
} | null>(null);
const createSelected = ref<string[]>([]);
const createAmounts = ref<Record<string, string>>({});
const createSearching = ref(false);

function openCreate() {
  createOpen.value = true;
  createOrder.value = null;
  createOrderNo.value = "";
  createSelected.value = [];
  createAmounts.value = {};
}
async function searchOrder() {
  const no = createOrderNo.value.trim();
  if (!no) return;
  createSearching.value = true;
  try {
    const res = await api.orders("all", { page: 1, pageSize: 10, keyword: no });
    const hit =
      res.items.find((o) => String(o.orderNo) === no) ?? res.items[0];
    // Order 行结构宽松断言（模板只用 orderNo/实付/配送费/items 快照）
    createOrder.value = (hit ?? null) as unknown as typeof createOrder.value;
    createSelected.value = [];
    createAmounts.value = {};
    if (!hit) toast.value = "未找到订单，请核对单号";
  } catch (e) {
    toast.value = e instanceof Error ? e.message : "查询失败";
  } finally {
    createSearching.value = false;
  }
}
function toggleCreateLine(pid: string) {
  const i = createSelected.value.indexOf(pid);
  if (i >= 0) createSelected.value.splice(i, 1);
  else createSelected.value.push(pid);
}
async function submitCreate() {
  if (!createOrder.value || submitting.value) return;
  if (!createSelected.value.length) {
    toast.value = "请勾选退款商品";
    return;
  }
  submitting.value = true;
  try {
    const after = await api.createOrderRefund(createOrder.value.id, {
      productIds: createSelected.value,
      amounts: createSelected.value.map((pid) => {
        const line = createOrder.value!.items.find(
          (l) => l.product.id === pid,
        )!;
        const raw = createAmounts.value[pid];
        return {
          productId: pid,
          amount:
            raw != null && raw !== ""
              ? Math.round(Number(raw) * 100)
              : Math.round(line.product.price * line.quantity),
        };
      }),
      remark: remark.value.trim(),
    });
    toast.value =
      after.status === "refunded"
        ? "退款已完成（微信原路退回）"
        : "已批准，退款受理中";
    createOpen.value = false;
    await Promise.all([load(), loadPendingCount()]);
  } catch (e) {
    toast.value = e instanceof Error ? e.message : "操作失败，请重试";
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void load();
  void loadPendingCount();
});
</script>

<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，header 标签会误命中变白卡 -->
    <div class="page-head">
      <div>
        <h1>售后退款</h1>
        <p>
          售后与未发货退款统一审核：批准后微信原路退回（配送费不退）；拒绝后订单回滚、用户可重新申请。
        </p>
      </div>
      <div class="head-actions">
        <button v-if="canAudit" class="btn primary" @click="openCreate">
          按商品退款
        </button>
        <button class="btn" :disabled="loading" @click="load(); loadPendingCount()">
          {{ loading ? "刷新中…" : "刷新" }}
        </button>
      </div>
    </div>

    <p v-if="toast" class="as-toast">{{ toast }}</p>

    <!-- 状态 Tab + 来源筛选 -->
    <div class="as-toolbar panel">
      <div class="as-tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="as-tab"
          :class="{ active: tab === t.key }"
          @click="switchTab(t.key)"
        >
          {{ t.label }}
          <span v-if="t.key === 'pending' && pendingCount" class="as-badge">{{ pendingCount }}</span>
        </button>
      </div>
      <div class="as-filters">
        <select v-model="source" class="as-select" @change="switchSource">
          <option value="all">全部来源</option>
          <option value="pre-delivery">未发货</option>
          <option value="after-sale">送达后售后</option>
        </select>
        <input
          v-model="keyword"
          class="as-input"
          placeholder="搜订单号 / 用户"
          @keyup.enter="search"
        />
        <button class="btn" @click="search">搜索</button>
      </div>
    </div>

    <!-- 列表 -->
    <div class="panel">
      <table class="as-table">
        <thead>
          <tr>
            <th>订单号</th>
            <th>用户</th>
            <th>来源</th>
            <th>原因</th>
            <th class="num">退款金额</th>
            <th>申请时间</th>
            <th>状态</th>
            <th v-if="canAudit">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !rows.length">
            <td colspan="8" class="as-empty">加载中…</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="8" class="as-empty">暂无申请</td>
          </tr>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="as-row"
            @click="openDetail(row)"
          >
            <td class="mono">{{ row.orderNo }}</td>
            <td>{{ row.userName || row.userPhone || "用户" }}</td>
            <td>
              <span class="as-src" :class="row.source">{{ SOURCE_TEXT[row.source] ?? row.source }}</span>
            </td>
            <td class="as-reason">
              {{ row.source === "pre-delivery" ? row.reason || "—" : (TYPE_TEXT[row.type ?? ""] ?? row.type) }}
            </td>
            <td class="num">¥{{ fenToYuan(row.amount) }}</td>
            <td>{{ new Date(row.createdAt).toLocaleString("zh-CN", { hour12: false }) }}</td>
            <td>
              <span class="as-status" :class="row.status">{{ row.statusText }}</span>
              <div v-if="row.status === 'failed' && row.refundError" class="as-err">{{ row.refundError }}</div>
            </td>
            <td v-if="canAudit" class="as-actions" @click.stop>
              <button
                v-if="row.status === 'pending'"
                class="btn small primary"
                @click="openDetail(row); startAudit('approve')"
              >批准</button>
              <button
                v-if="row.status === 'pending'"
                class="btn small danger"
                @click="openDetail(row); startAudit('reject')"
              >拒绝</button>
              <button
                v-if="['refunding', 'approved', 'failed'].includes(row.status)"
                class="btn small"
                @click="sync(row)"
              >同步状态</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="hasMore" class="as-more">
        <button class="btn" :disabled="loading" @click="loadMore">
          {{ loading ? "加载中…" : `加载更多（已载 ${rows.length}/${total}）` }}
        </button>
      </div>
    </div>

    <!-- 详情 + 审核弹窗 -->
    <div v-if="detail" class="as-mask" @click.self="detail = null">
      <div class="as-modal panel">
        <div class="as-modal-head">
          <h3>退款申请详情</h3>
          <button class="btn small" @click="detail = null">关闭</button>
        </div>
        <dl class="as-grid">
          <!-- v2 部分退款：商品行（整单退不显示） -->
          <div v-if="detail.items.length" class="as-imgs-row">
            <dt>退款商品</dt>
            <dd>
              <table class="as-items">
                <thead>
                  <tr><th>商品</th><th>单价</th><th>数量</th><th>金额</th></tr>
                </thead>
                <tbody>
                  <tr v-for="i in detail.items" :key="i.id">
                    <td>{{ i.productName }}</td>
                    <td>¥{{ fenToYuan(i.unitPrice) }}</td>
                    <td>×{{ i.quantity }}</td>
                    <td>¥{{ fenToYuan(i.amount) }}</td>
                  </tr>
                </tbody>
              </table>
            </dd>
          </div>
          <div><dt>订单号</dt><dd class="mono">{{ detail.orderNo }}</dd></div>
          <div><dt>用户</dt><dd>{{ detail.userName || "—" }}{{ detail.userPhone ? `（${detail.userPhone}）` : "" }}</dd></div>
          <div><dt>来源</dt><dd>{{ SOURCE_TEXT[detail.source] ?? detail.source }}</dd></div>
          <div v-if="detail.source === 'after-sale'">
            <dt>售后类型</dt><dd>{{ TYPE_TEXT[detail.type ?? ""] ?? detail.type }}</dd>
          </div>
          <div><dt>申请时间</dt><dd>{{ new Date(detail.createdAt).toLocaleString("zh-CN", { hour12: false }) }}</dd></div>
          <div><dt>订单实付</dt><dd>¥{{ fenToYuan(detail.payableAmount) }}（含配送费 ¥{{ fenToYuan(detail.deliveryFee) }}）</dd></div>
          <div><dt>退款金额</dt><dd class="as-amount">¥{{ fenToYuan(detail.amount) }}</dd></div>
          <div v-if="detail.reason"><dt>退款原因</dt><dd>{{ detail.reason }}</dd></div>
          <div v-if="detail.description"><dt>问题描述</dt><dd>{{ detail.description }}</dd></div>
          <div v-if="detail.images.length" class="as-imgs-row">
            <dt>凭证</dt>
            <dd>
              <a
                v-for="(img, i) in detail.images"
                :key="i"
                :href="img"
                target="_blank"
                rel="noreferrer"
              >
                <img :src="img" class="as-thumb" alt="售后凭证" />
              </a>
            </dd>
          </div>
          <div v-if="detail.auditBy">
            <dt>审核信息</dt>
            <dd>
              {{ detail.auditBy }} · {{ detail.auditAt ? new Date(detail.auditAt).toLocaleString("zh-CN", { hour12: false }) : "" }}
              <span v-if="detail.auditRemark">：{{ detail.auditRemark }}</span>
            </dd>
          </div>
          <div v-if="detail.rejectCount">
            <dt>历史拒绝</dt><dd>{{ detail.rejectCount }} 次（拒绝后可重新申请）</dd>
          </div>
          <div v-if="detail.status === 'failed' && detail.refundError">
            <dt>失败原因</dt><dd class="as-err">{{ detail.refundError }}</dd>
          </div>
        </dl>

        <div v-if="canAudit && detail.status === 'pending'" class="as-audit">
          <template v-if="!auditMode">
            <button class="btn primary" @click="startAudit('approve')">批准退款</button>
            <button class="btn danger" @click="startAudit('reject')">拒绝申请</button>
          </template>
          <template v-else>
            <p class="as-audit-tip">
              {{
                auditMode === "approve"
                  ? `确认向微信发起 ¥${fenToYuan(detail.amount)} 原路退款？批准后不可撤销。`
                  : "拒绝后订单将回滚至申请前状态（" + (ORDER_STATUS_TEXT[detail.beforeStatus] ?? detail.beforeStatus) + "），用户可补充后重新申请。"
              }}
            </p>
            <!-- v2 部分退款：核定各行金额（默认申请值，可改） -->
            <div v-if="detail.items.length" class="as-amounts">
              <div v-for="i in detail.items" :key="i.id" class="as-amounts__row">
                <span class="as-amounts__name">{{ i.productName }}（上限 ¥{{ fenToYuan(i.unitPrice * i.quantity) }}）</span>
                <input
                  v-model="itemAmounts[i.id]"
                  class="as-amounts__input"
                  type="number"
                  min="0"
                  :max="(i.unitPrice * i.quantity / 100).toFixed(2)"
                  step="0.01"
                />
              </div>
              <p class="as-audit-tip">
                金额可调整（单位元）；合计不得超过本单可退余额（实付−配送费−已退）。
              </p>
            </div>
            <textarea
              v-model="remark"
              class="as-textarea"
              rows="2"
              :placeholder="auditMode === 'reject' ? '拒绝原因（必填，随通知发给用户）' : '审核备注（选填）'"
            />
            <div class="as-audit-actions">
              <button class="btn primary" :disabled="submitting" @click="submitAudit">
                {{ submitting ? "提交中…" : auditMode === "approve" ? "确认批准并发起退款" : "确认拒绝" }}
              </button>
              <button class="btn" :disabled="submitting" @click="auditMode = null">取消</button>
            </div>
          </template>
        </div>
        <p v-else-if="canAudit && detail.status === 'failed'" class="as-audit-tip">
          可在列表对该申请「同步状态」；微信侧已关闭时可重新批准发起。
        </p>
      </div>
    </div>
  <!-- v2 按商品退款弹窗：搜订单 → 勾商品 → 核定金额 → 提交即退款 -->
  <div v-if="createOpen" class="as-mask" @click.self="createOpen = false">
    <div class="as-modal panel">
      <div class="as-modal-head">
        <h3>按商品退款</h3>
        <button class="btn small" @click="createOpen = false">关闭</button>
      </div>
      <div class="as-create-search">
        <input
          v-model="createOrderNo"
          class="as-input"
          style="flex: 1"
          placeholder="输入完整订单号"
          @keyup.enter="searchOrder"
        />
        <button class="btn" :disabled="createSearching" @click="searchOrder">
          {{ createSearching ? "查询中…" : "查询订单" }}
        </button>
      </div>
      <template v-if="createOrder">
        <p class="as-audit-tip">
          订单 {{ createOrder.orderNo }} · 实付 ¥{{ fenToYuan(createOrder.payableAmount) }}（含配送费
          ¥{{ fenToYuan(createOrder.deliveryFee ?? 0) }}）· 可退上限 ¥{{ fenToYuan(createOrder.payableAmount - (createOrder.deliveryFee ?? 0)) }}
        </p>
        <div class="as-lines">
          <div
            v-for="line in createOrder.items"
            :key="line.product.id"
            class="as-line"
            :class="{ 'as-line--on': createSelected.includes(line.product.id) }"
            role="button"
            @click="toggleCreateLine(line.product.id)"
          >
            <span>{{ line.product.name }} × {{ line.quantity }}</span>
            <input
              class="as-amounts__input"
              type="number"
              min="0"
              :max="((line.product.price * line.quantity) / 100).toFixed(2)"
              step="0.01"
              :placeholder="`¥${fenToYuan(line.product.price * line.quantity)}`"
              @click.stop
              @change="
                createAmounts[line.product.id] = (
                  $event.target as HTMLInputElement
                ).value
              "
            />
          </div>
        </div>
        <p class="as-audit-tip">
          勾选商品、可改金额（元）；提交即向微信发起原路退款，合计不得超可退上限。
        </p>
        <div class="as-audit-actions">
          <button
            class="btn primary"
            :disabled="submitting || !createSelected.length"
            @click="submitCreate"
          >
            {{ submitting ? "退款中…" : "确认退款" }}
          </button>
          <button class="btn" :disabled="submitting" @click="createOpen = false">取消</button>
        </div>
      </template>
    </div>
  </div>
  </div>
</template>

<style scoped>
.as-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.as-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.as-tab {
  border: none;
  background: transparent;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ink-2, #4b5563);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.as-tab.active { background: var(--brand, #16a34a); color: #fff; }
.as-badge {
  background: #dc2626;
  color: #fff;
  border-radius: 999px;
  font-size: 11px;
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}
.as-filters { display: flex; gap: 8px; align-items: center; }
.as-select,
.as-input {
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  background: #fff;
}
.as-input { width: 200px; }
.as-select:focus,
.as-input:focus,
.as-textarea:focus {
  outline: none;
  border-color: var(--brand, #16a34a);
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12);
}
.as-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.as-table th,
.as-table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line, #e5e7eb);
}
.as-table th { color: var(--ink-2, #6b7280); font-weight: 500; font-size: 12px; }
.as-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.as-row { cursor: pointer; }
.as-row:hover td { background: rgba(22, 163, 74, 0.04); }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
.as-empty { text-align: center; color: var(--ink-3, #9ca3af); padding: 32px 0; }
.as-src {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f3f4f6;
}
.as-src.pre-delivery { background: rgba(22, 163, 74, 0.1); color: #15803d; }
.as-src.after-sale { background: rgba(234, 88, 12, 0.1); color: #c2410c; }
.as-reason { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.as-status { font-weight: 500; }
.as-status.refunded { color: #15803d; }
.as-status.rejected { color: #9ca3af; }
.as-status.failed { color: #dc2626; }
.as-status.pending { color: #b45309; }
.as-err { color: #dc2626; font-size: 12px; margin-top: 2px; }
.as-actions { white-space: nowrap; display: flex; gap: 6px; }
.as-more { text-align: center; padding: 12px; }
.as-toast {
  background: rgba(22, 163, 74, 0.08);
  color: #15803d;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
}
.as-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 24px;
}
.as-modal {
  width: 560px;
  max-width: 100%;
  max-height: 86vh;
  overflow: auto;
  padding: 20px;
}
.as-modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.as-modal-head h3 { margin: 0; font-size: 16px; }
.as-grid { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
.as-grid > div { min-width: 0; }
.as-grid .as-imgs-row { grid-column: 1 / -1; }
.as-grid dt { font-size: 12px; color: var(--ink-3, #9ca3af); margin-bottom: 2px; }
.as-grid dd { margin: 0; font-size: 13px; word-break: break-all; }
.as-amount { color: #dc2626; font-weight: 600; font-size: 15px; }
.as-thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  margin-right: 8px;
  border: 1px solid var(--line, #e5e7eb);
}
.as-audit { margin-top: 18px; padding-top: 14px; border-top: 1px dashed var(--line, #e5e7eb); }
.as-audit-tip { font-size: 13px; color: var(--ink-2, #4b5563); margin: 0 0 8px; }
.as-textarea {
  width: 100%;
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  resize: vertical;
}
.as-audit-actions { display: flex; gap: 8px; margin-top: 10px; }
/* v2 按商品退款弹窗 */
.as-create-search { display: flex; gap: 8px; margin-bottom: 12px; }
.as-items { width: 100%; border-collapse: collapse; font-size: 12px; }
.as-items th, .as-items td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
.as-items th { color: #94a3b8; font-weight: 500; }
.as-lines { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
.as-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.as-line--on { border-color: #16a34a; background: rgba(22, 163, 74, 0.05); }
.as-amounts__input {
  width: 90px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  text-align: right;
}
</style>
