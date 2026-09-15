<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  api,
} from "../api";
import { canWrite, role } from "../session";
import type {
  RestockBatch,
  RestockBatchProduct,
  RestockOrder,
} from "../types";
import { fenToYuan } from "../utils/money";
import { fmtDateTime } from "../utils/datetime";

/**
 * 订货管理（IKFOQ0，2026-09-15 grilling 定版）：
 * - 独立一级菜单（道哥拍板不塞仓储中心），交互重于通用表格故独立成页
 * - 总部视角：批次管理（建/改/关窗）+ 全校区订货单审核（确认锁库存/驳回/撤销）
 * - 校区视角：批次列表 + 我的订货单按件编辑（N 件(×N 听) 换算）
 * - 权限两分法与后端一致：isHqScope 管批次审单，operations/warehouse 订货
 */
const isHqScope = computed(() => role.value === "hq" || role.value === "admin");
const canManage = computed(() => canWrite("restock") && isHqScope.value);
const canOrder = computed(() => canWrite("restock") && !isHqScope.value);

const loading = ref(true);
const error = ref("");
const batches = ref<RestockBatch[]>([]);
const tab = ref<"batches" | "orders">("batches");
const hqOrders = ref<RestockOrder[]>([]);

const PHASE_TEXT: Record<RestockBatch["phase"], string> = {
  upcoming: "未开始",
  open: "进行中",
  ended: "已结束",
  closed: "已关闭",
};
const PHASE_CLASS: Record<RestockBatch["phase"], string> = {
  upcoming: "info",
  open: "success",
  ended: "",
  closed: "danger",
};
const ORDER_STATUS_TEXT: Record<RestockOrder["status"], string> = {
  draft: "草稿",
  submitted: "待审核",
  confirmed: "已确认",
  rejected: "已驳回",
};
const ORDER_STATUS_CLASS: Record<RestockOrder["status"], string> = {
  draft: "",
  submitted: "warning",
  confirmed: "success",
  rejected: "danger",
};

async function loadBatches() {
  loading.value = true;
  error.value = "";
  try {
    batches.value = await api.restockBatches();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
async function loadHqOrders() {
  hqOrders.value = await api.restockOrders();
}
function refresh() {
  loadBatches();
  if (isHqScope.value) loadHqOrders();
}
onMounted(refresh);

/** 折算显示：N 件(×M 听)；无件概念（unitsPerCase≤1）只显示件数。 */
function caseText(cases: number, unitsPerCase: number): string {
  return unitsPerCase > 1 ? `${cases} 件(×${cases * unitsPerCase} 听)` : `${cases} 件`;
}

/* ---------- 批次新建/编辑（总部） ---------- */
const batchDrawer = ref(false);
const batchSaving = ref(false);
const batchEditId = ref(""); // 空=新建
const batchForm = ref({ name: "", startAt: "", endAt: "" });

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
async function openBatchForm(batch?: RestockBatch) {
  batchDrawer.value = true;
  batchSaving.value = false;
  if (batch) {
    batchEditId.value = batch.id;
    batchForm.value = {
      name: batch.name,
      startAt: toLocalInput(batch.startAt),
      endAt: toLocalInput(batch.endAt),
    };
  } else {
    batchEditId.value = "";
    batchForm.value = { name: "", startAt: "", endAt: "" };
  }
}
async function submitBatch() {
  const name = batchForm.value.name.trim();
  if (!name) return alert("请填写批次名称");
  const startAt = new Date(batchForm.value.startAt);
  const endAt = new Date(batchForm.value.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()))
    return alert("请填写完整的起止时间");
  if (endAt <= startAt) return alert("结束时间必须晚于开始时间");
  batchSaving.value = true;
  try {
    if (batchEditId.value) {
      await api.updateRestockBatch(batchEditId.value, {
        name,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      });
    } else {
      await api.createRestockBatch({
        name,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      });
    }
    batchDrawer.value = false;
    refresh();
  } catch (e) {
    alert(e instanceof Error ? e.message : "保存失败");
  } finally {
    batchSaving.value = false;
  }
}
async function closeBatch(batch: RestockBatch) {
  if (batch.closedAt) return;
  if (!window.confirm(`确认提前关闭「${batch.name}」？关闭后校区不能再订货`)) return;
  try {
    await api.closeRestockBatch(batch.id);
    refresh();
  } catch (e) {
    alert(e instanceof Error ? e.message : "操作失败");
  }
}

/* ---------- 批次详情（总部：商品范围+各校区订货单） ---------- */
const detailDrawer = ref(false);
const detail = ref<(RestockBatch & { items: RestockBatchProduct[]; orders: RestockOrder[] }) | null>(
  null,
);
async function openBatchDetail(batch: RestockBatch) {
  detailDrawer.value = true;
  detail.value = null;
  detail.value = await api.restockBatchDetail(batch.id);
}

/* ---------- 审核（总部）：确认/驳回/撤销统一小弹框 ---------- */
const auditDrawer = ref(false);
const auditTarget = ref<RestockOrder | null>(null);
const auditNote = ref("");
const auditBusy = ref(false);
function openAudit(order: RestockOrder) {
  auditTarget.value = order;
  auditNote.value = "";
  auditDrawer.value = true;
}
async function audit(action: "confirm" | "reject" | "revoke") {
  if (!auditTarget.value) return;
  if (action === "reject" && !auditNote.value.trim())
    return alert("驳回请填写理由，方便校区修改后重新提交");
  auditBusy.value = true;
  try {
    await api.auditRestockOrder(auditTarget.value.id, action, auditNote.value.trim());
    auditDrawer.value = false;
    refresh();
    if (detail.value) detail.value = await api.restockBatchDetail(detail.value.id);
  } catch (e) {
    // 确认时库存不足等后端阻断信息原样透出
    alert(e instanceof Error ? e.message : "操作失败");
  } finally {
    auditBusy.value = false;
  }
}

/* ---------- 我的订货单（校区） ---------- */
const orderDrawer = ref(false);
const orderBatch = ref<RestockBatch | null>(null);
const orderDetail = ref<{
  items: { productId: string; product: { id: string; name: string; image: string; price: number; retailUnit?: string; wholesaleUnit?: string; unitsPerCase: number } }[];
  orders: RestockOrder[];
} | null>(null);
/** 行编辑态：productId → 件数（空串显示为 0）。 */
const lineCases = ref<Record<string, number>>({});
const myOrder = computed<RestockOrder | null>(() => orderDetail.value?.orders[0] ?? null);
const editable = computed(
  () =>
    myOrder.value === null ||
    ["draft", "rejected"].includes(myOrder.value?.status ?? ""),
);
const totalCases = computed(() =>
  Object.values(lineCases.value).reduce((s, n) => s + (Number(n) || 0), 0),
);
const totalUnits = computed(() =>
  (orderDetail.value?.items ?? []).reduce(
    (s, i) => s + (Number(lineCases.value[i.productId]) || 0) * i.product.unitsPerCase,
    0,
  ),
);
async function openMyOrder(batch: RestockBatch) {
  orderBatch.value = batch;
  orderDrawer.value = true;
  orderDetail.value = null;
  const detail = await api.restockBatchDetail(batch.id);
  orderDetail.value = detail as any;
  const own = detail.orders[0];
  const next: Record<string, number> = {};
  for (const item of detail.items)
    next[item.productId] = own?.items?.find((l) => l.productId === item.productId)?.cases ?? 0;
  lineCases.value = next;
}
async function saveMyOrder(submit: boolean) {
  if (!orderBatch.value) return;
  const items = (orderDetail.value?.items ?? [])
    .map((i) => ({ productId: i.productId, cases: Number(lineCases.value[i.productId]) || 0 }))
    .filter((i) => i.cases > 0);
  if (submit && !items.length) return alert("请至少为一个商品填写件数");
  try {
    await api.saveRestockOrder(orderBatch.value.id, items);
    if (submit) await api.submitRestockOrder(orderBatch.value.id);
    orderDrawer.value = false;
    refresh();
  } catch (e) {
    alert(e instanceof Error ? e.message : "保存失败");
  }
}
async function withdrawMyOrder() {
  if (!orderBatch.value) return;
  try {
    await api.withdrawRestockOrder(orderBatch.value.id);
    orderDrawer.value = false;
    refresh();
  } catch (e) {
    alert(e instanceof Error ? e.message : "操作失败");
  }
}
</script>

<template>
  <div class="workspace">
    <header class="page-head">
      <div>
        <h1>订货管理</h1>
        <p>
          {{
            isHqScope
              ? "开放订货批次，审核校区订货单；确认即锁定总部仓库存，发货转扣。"
              : "批次窗口内按件填写订货单，提交总部审核；驳回可改后重提。"
          }}
        </p>
      </div>
      <div class="head-actions">
        <button v-if="canManage && tab === 'batches'" class="btn primary" @click="openBatchForm()">
          <span>＋</span>新建批次
        </button>
      </div>
    </header>

    <!-- IKFOQ0 样式对齐：板块内子 tab 收进 toolbar（DataPage 同款 segmented） -->
    <div v-if="canManage" class="toolbar">
      <div class="segmented inv-tabs">
        <button :class="{ active: tab === 'batches' }" @click="tab = 'batches'">
          订货批次
        </button>
        <button :class="{ active: tab === 'orders' }" @click="tab = 'orders'">
          全部订货单
        </button>
      </div>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>

    <!-- 校区视角：批次列表（窗口 + 我的单状态 + 填单入口），表格形态与全站一致 -->
    <div v-if="!canManage" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ batches.length }}</strong><span> 个批次</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>批次名称</th>
              <th>阶段</th>
              <th>订货窗口</th>
              <th>我的订货单</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 4" :key="i">
              <td :colspan="5"><div class="row-skeleton"></div></td>
            </tr>
            <template v-else>
              <tr v-if="!batches.length">
                <td :colspan="5" class="empty-cell">暂无订货批次，总部开放后这里会出现批次。</td>
              </tr>
              <tr v-for="b in batches" :key="b.id">
                <td><strong>{{ b.name }}</strong></td>
                <td>
                  <span class="status" :class="PHASE_CLASS[b.phase]">{{ PHASE_TEXT[b.phase] }}</span>
                </td>
                <td>{{ fmtDateTime(b.startAt) }} ~ {{ fmtDateTime(b.endAt) }}</td>
                <td>
                  <span
                    v-if="b.orderTotal"
                    class="status"
                    :class="b.orderConfirmed ? 'success' : 'warning'"
                  >
                    {{ b.orderConfirmed ? "已确认" : "已提交" }}
                  </span>
                  <span v-else class="status">未填单</span>
                </td>
                <td class="row-actions">
                  <button
                    class="btn mini primary"
                    :disabled="b.phase !== 'open' && !b.orderTotal"
                    @click="openMyOrder(b)"
                  >
                    {{ b.orderTotal ? "查看订货单" : "填写订货单" }}
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 总部：批次表 -->
    <div v-if="canManage && tab === 'batches'" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ batches.length }}</strong><span> 个批次</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>批次名称</th>
              <th>阶段</th>
              <th>订货窗口</th>
              <th>订货单</th>
              <th>创建人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 4" :key="i">
              <td :colspan="6"><div class="row-skeleton"></div></td>
            </tr>
            <template v-else>
              <tr v-if="!batches.length">
                <td :colspan="6" class="empty-cell">还没有订货批次，点右上角「新建批次」开始。</td>
              </tr>
              <tr v-for="b in batches" :key="b.id">
                <td><strong>{{ b.name }}</strong></td>
                <td>
                  <span class="status" :class="PHASE_CLASS[b.phase]">{{ PHASE_TEXT[b.phase] }}</span>
                </td>
                <td>
                  {{ fmtDateTime(b.startAt) }} ~ {{ fmtDateTime(b.endAt) }}
                </td>
                <td>
                  {{ b.orderTotal ?? 0 }} 单 / {{ b.orderConfirmed ?? 0 }} 已确认
                </td>
                <td>{{ b.createdByName || "—" }}</td>
                <td class="row-actions">
                  <button class="btn mini ghost" @click="openBatchDetail(b)">详情</button>
                  <button
                    v-if="b.phase === 'upcoming' || b.phase === 'open'"
                    class="btn mini ghost"
                    @click="openBatchForm(b)"
                  >
                    编辑
                  </button>
                  <button
                    v-if="!b.closedAt"
                    class="btn mini ghost danger-btn"
                    @click="closeBatch(b)"
                  >
                    关闭
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 总部：全部订货单 -->
    <div v-if="canManage && tab === 'orders'" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ hqOrders.length }}</strong><span> 张订货单</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>批次</th>
              <th>校区</th>
              <th>状态</th>
              <th>合计</th>
              <th>提交人 / 时间</th>
              <th>审核</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 4" :key="i">
              <td :colspan="7"><div class="row-skeleton"></div></td>
            </tr>
            <template v-else>
              <tr v-if="!hqOrders.length">
                <td :colspan="7" class="empty-cell">还没有校区提交订货单。</td>
              </tr>
              <tr v-for="o in hqOrders" :key="o.id">
                <td><strong>{{ o.batchName }}</strong></td>
                <td>{{ o.campusShortName || o.campusName }}</td>
                <td>
                  <span class="status" :class="ORDER_STATUS_CLASS[o.status]">
                    {{ ORDER_STATUS_TEXT[o.status] }}
                  </span>
                </td>
                <td>
                  {{ o.totalCases ?? 0 }} 件<br />折算 {{ o.totalUnits ?? 0 }}
                </td>
                <td>
                  {{ o.submitByName || "—" }}<br />{{ o.submittedAt ? fmtDateTime(o.submittedAt) : "—" }}
                </td>
                <td>
                  <template v-if="o.auditAt">
                    {{ o.auditByName }}<br />{{ fmtDateTime(o.auditAt) }}
                    <em v-if="o.auditNote" class="audit-note">「{{ o.auditNote }}」</em>
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="row-actions">
                  <button
                    v-if="o.status === 'submitted'"
                    class="btn mini primary"
                    @click="openAudit(o)"
                  >
                    审核
                  </button>
                  <button
                    v-else-if="o.status === 'confirmed'"
                    class="btn mini ghost danger-btn"
                    @click="openAudit(o)"
                  >
                    撤销确认
                  </button>
                  <span v-else>—</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新建/编辑批次 -->
    <div v-if="batchDrawer" class="drawer-mask" @click.self="batchDrawer = false">
      <div class="drawer batch-form-drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">RESTOCK BATCH</p>
            <h2>{{ batchEditId ? "编辑批次" : "新建订货批次" }}</h2>
          </div>
          <button @click="batchDrawer = false">✕</button>
        </div>
        <div class="product-form batch-form-body">
          <label class="field-label">批次名称</label>
          <input
            v-model="batchForm.name"
            maxlength="60"
            placeholder="如：9 月第 2 期补货"
          />
          <div class="time-row">
            <div>
              <label class="field-label">开始时间</label>
              <input v-model="batchForm.startAt" type="datetime-local" />
            </div>
            <div>
              <label class="field-label">结束时间</label>
              <input v-model="batchForm.endAt" type="datetime-local" />
            </div>
          </div>
        </div>
        <div class="drawer-actions">
          <button class="btn ghost" @click="batchDrawer = false">取消</button>
          <button class="btn primary" :disabled="batchSaving" @click="submitBatch">
            {{ batchSaving ? "保存中…" : batchEditId ? "保存修改" : "创建批次" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 批次详情（总部） -->
    <div v-if="detailDrawer" class="drawer-mask" @click.self="detailDrawer = false">
      <div class="drawer detail-drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">BATCH DETAIL</p>
            <h2>{{ detail?.name ?? "批次详情" }}</h2>
            <p v-if="detail" class="detail-window">
              {{ fmtDateTime(detail.startAt) }} ~ {{ fmtDateTime(detail.endAt) }}
              <span class="status" :class="PHASE_CLASS[detail.phase]" style="margin-left: 8px">
                {{ PHASE_TEXT[detail.phase] }}
              </span>
            </p>
          </div>
          <button @click="detailDrawer = false">✕</button>
        </div>
        <template v-if="detail">
          <div class="detail-section">
            <h4>校区订货单（{{ detail.orders.length }}）</h4>
            <div v-if="!detail.orders.length" class="empty-block">暂无校区订货。</div>
            <div v-for="o in detail.orders" :key="o.id" class="order-brief">
              <div class="order-brief-head">
                <strong>{{ o.campusShortName || o.campusName }}</strong>
                <span class="status" :class="ORDER_STATUS_CLASS[o.status]">
                  {{ ORDER_STATUS_TEXT[o.status] }}
                </span>
                <span class="order-brief-total">
                  {{ o.totalCases ?? 0 }} 件(×{{ o.totalUnits ?? 0 }})
                </span>
              </div>
              <p class="order-brief-items">
                {{
                  (o.items ?? [])
                    .map(
                      (l) =>
                        `${l.product?.name ?? ""} ${caseText(l.cases, l.unitsPerCase)}`,
                    )
                    .join("；")
                }}
              </p>
              <p v-if="o.auditNote" class="order-brief-note">
                审核备注（{{ o.auditByName }}）：{{ o.auditNote }}
              </p>
              <div class="order-brief-ops">
                <button
                  v-if="o.status === 'submitted'"
                  class="btn mini ghost"
                  @click="openAudit(o)"
                >
                  审核
                </button>
                <button
                  v-else-if="o.status === 'confirmed'"
                  class="btn mini ghost danger-btn"
                  @click="openAudit(o)"
                >
                  撤销确认
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 审核弹框（总部） -->
    <div v-if="auditDrawer" class="drawer-mask" @click.self="auditDrawer = false">
      <div class="drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">AUDIT</p>
            <h2>订货单审核</h2>
            <p v-if="auditTarget" class="detail-window">
              {{ auditTarget.campusShortName || auditTarget.campusName }} ·
              {{ auditTarget.batchName }} · 共 {{ auditTarget.totalCases ?? 0 }} 件
              (折算 {{ auditTarget.totalUnits ?? 0 }})
            </p>
          </div>
          <button @click="auditDrawer = false">✕</button>
        </div>
        <div class="product-form">
          <label class="field-label">
            备注{{ auditTarget?.status === "confirmed" ? "（撤销时选填）" : "（驳回必填，确认选填）" }}
          </label>
          <textarea
            v-model="auditNote"
            rows="3"
            maxlength="200"
            placeholder="如：数量超出本月预算，请酌减"
          ></textarea>
          <p class="audit-tip">确认后即锁定总部仓库存（发货时转扣，IKFOQ2）；撤销确认会释放锁定。</p>
        </div>
        <div class="drawer-actions">
          <button class="btn ghost" @click="auditDrawer = false">取消</button>
          <button
            v-if="auditTarget?.status === 'submitted'"
            class="btn ghost danger-btn"
            :disabled="auditBusy"
            @click="audit('reject')"
          >
            驳回
          </button>
          <button
            v-if="auditTarget?.status === 'submitted'"
            class="btn primary"
            :disabled="auditBusy"
            @click="audit('confirm')"
          >
            确认并锁库存
          </button>
          <button
            v-if="auditTarget?.status === 'confirmed'"
            class="btn primary"
            :disabled="auditBusy"
            @click="audit('revoke')"
          >
            撤销确认并放锁
          </button>
        </div>
      </div>
    </div>

    <!-- 我的订货单（校区） -->
    <div v-if="orderDrawer" class="drawer-mask" @click.self="orderDrawer = false">
      <div class="drawer order-editor-drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">MY ORDER</p>
            <h2>{{ orderBatch?.name }}</h2>
            <p v-if="orderBatch" class="detail-window">
              {{ fmtDateTime(orderBatch.startAt) }} ~ {{ fmtDateTime(orderBatch.endAt) }}
              <span
                v-if="myOrder"
                class="status"
                :class="ORDER_STATUS_CLASS[myOrder.status]"
                style="margin-left: 8px"
              >
                {{ ORDER_STATUS_TEXT[myOrder.status] }}
              </span>
            </p>
          </div>
          <button @click="orderDrawer = false">✕</button>
        </div>
        <template v-if="orderDetail">
          <p v-if="myOrder?.status === 'rejected' && myOrder?.auditNote" class="reject-banner">
            总部驳回：{{ myOrder?.auditNote }}（可修改后重新提交）
          </p>
          <p v-if="myOrder?.status === 'confirmed'" class="confirm-banner">
            订货单已确认，等待总部发货（IKFOQ2 发货验收将在此页进行）。
          </p>
          <div class="order-lines">
            <div v-for="i in orderDetail.items" :key="i.productId" class="order-line">
              <img v-if="i.product.image" :src="i.product.image" alt="" />
              <div class="order-line-main">
                <p class="order-line-name">{{ i.product.name }}</p>
                <p class="order-line-meta">
                  批发价 {{ fenToYuan(i.product.price) }}/{{ i.product.wholesaleUnit || "件" }}
                  <template v-if="i.product.unitsPerCase > 1">
                    · 1 件={{ i.product.unitsPerCase }}{{ i.product.retailUnit || "个" }}
                  </template>
                </p>
              </div>
              <div class="order-line-input">
                <input
                  v-model.number="lineCases[i.productId]"
                  type="number"
                  min="0"
                  step="1"
                  :disabled="!editable"
                />
                <span>件</span>
              </div>
            </div>
          </div>
          <div class="order-total">
            合计 <strong>{{ totalCases }}</strong> 件
            <template v-if="totalUnits !== totalCases">
              （折算 <strong>{{ totalUnits }}</strong> 个零售单位）
            </template>
          </div>
        </template>
        <div v-if="editable" class="drawer-actions">
          <button class="btn ghost" @click="orderDrawer = false">取消</button>
          <button class="btn ghost" @click="saveMyOrder(false)">保存草稿</button>
          <button class="btn primary" @click="saveMyOrder(true)">提交审核</button>
        </div>
        <div v-else-if="myOrder?.status === 'submitted'" class="drawer-actions">
          <button class="btn ghost" @click="orderDrawer = false">关闭</button>
          <button class="btn danger-btn" @click="withdrawMyOrder">撤回订货单</button>
        </div>
        <div v-else class="drawer-actions">
          <button class="btn ghost" @click="orderDrawer = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 页面壳/表格/统计条/骨架全走全局（style.css + drawer.css），与商品管理同源；
   scoped 只留 drawer 内部排版。IKFOQ0 样式对齐（道哥 2026-09-15） */
.audit-note {
  font-style: normal;
  color: #a95c20;
}
.empty-block {
  padding: 28px 0;
  font-size: 13px;
  color: #647169;
}
/* 弹框内容 */
.batch-form-drawer,
.order-editor-drawer {
  width: min(560px, 94vw);
}
.detail-drawer {
  width: min(640px, 94vw);
}
.batch-form-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
}
.time-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
/* 详情 */
.detail-window {
  margin-top: 4px;
  font-size: 12px;
  color: #647169;
  display: flex;
  align-items: center;
}
.detail-section {
  margin-top: 16px;
}
.detail-section h4 {
  font-size: 13px;
  color: #153628;
  margin-bottom: 8px;
}
.order-brief {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.order-brief-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.order-brief-total {
  margin-left: auto;
  font-size: 12px;
  color: #37423c;
  font-weight: 700;
}
.order-brief-items {
  font-size: 12px;
  color: #647169;
  line-height: 1.6;
}
.order-brief-note {
  font-size: 11px;
  color: #a95c20;
  background: #fff0dc;
  border-radius: 8px;
  padding: 6px 8px;
}
.order-brief-ops {
  display: flex;
  justify-content: flex-end;
}
.audit-tip {
  margin-top: 8px;
  font-size: 11px;
  color: #647169;
}
/* 订货单编辑器 */
.reject-banner {
  margin-top: 14px;
  font-size: 12px;
  color: #b33a3a;
  background: #fdeeee;
  border-radius: 10px;
  padding: 10px 12px;
}
.confirm-banner {
  margin-top: 14px;
  font-size: 12px;
  color: #087641;
  background: #e5f6eb;
  border-radius: 10px;
  padding: 10px 12px;
}
.order-lines {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
}
.order-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--line);
}
.order-line img {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  background: #eef1ef;
}
.order-line-main {
  flex: 1;
  min-width: 0;
}
.order-line-name {
  font-size: 13px;
  font-weight: 700;
  color: #153628;
}
.order-line-meta {
  font-size: 11px;
  color: #647169;
  margin-top: 2px;
}
.order-line-input {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #37423c;
}
.order-line-input input {
  width: 72px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 8px;
  text-align: center;
  font-weight: 700;
  outline: 0;
}
.order-line-input input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px #159c5515;
}
.order-total {
  margin-top: 12px;
  font-size: 13px;
  color: #37423c;
  text-align: right;
}
.order-total strong {
  color: #0b7a45;
  font-size: 16px;
}
textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  outline: 0;
  resize: vertical;
}
textarea:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px #159c5515;
}
</style>
