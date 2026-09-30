<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { hasPerm } from "../session";
import type { RestockOrder } from "../types";
import { RESTOCK_ORDER_STATUS_CLASS, RESTOCK_ORDER_STATUS_TEXT } from "../dicts";
import type {
  PurchaseOrderDetail,
  PurchaseOrderRow,
} from "../types";
import { fenToYuan } from "../utils/money";
import { fmtDateTime } from "../utils/datetime";

/**
 * 采购管理（IKFOQ1，2026-09-15 grilling 定版）：
 * - 独立一级菜单（道哥拍板与订货管理平级），全链总部动作 hq/admin
 * - 生成入口在订货管理批次详情（一键聚合），本页专注验收闭环：
 *   快捷全收（预填欠收可改小）→ 部分到货/收齐推导；坏品入库再出库
 * - 关闭使欠收作废禁验收、可重开；金额=行单价×数量（IQ7）
 */


const loading = ref(true);
const error = ref("");
const orders = ref<PurchaseOrderRow[]>([]);
/** IKJCJF：校区级账号进本页=看自己校区的订货单进度（采购单是总部动作） */
const isCampusView = computed(() => !hasPerm("GET /admin/purchase/orders"));
const myOrders = ref<RestockOrder[]>([]);
const myDetail = ref<RestockOrder | null>(null);
const myDrawerOpen = ref(false);

// 采购阶段字典见 src/dicts/inventory（PURCHASE_PHASE_TEXT/CLASS，IKIYMM 集中化）
import { PURCHASE_PHASE_CLASS, PURCHASE_PHASE_TEXT } from "../dicts";

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (isCampusView.value) {
      // 校区视角：本校区全部订货单（跨批次，含待审/通过/发货/到货）
      myOrders.value = await api.restockOrders();
    } else {
      orders.value = await api.purchaseOrders();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
async function openMyOrder(id: string) {
  myDrawerOpen.value = true;
  myDetail.value = null;
  try {
    myDetail.value = await api.restockOrderDetail(id);
  } catch (e) {
    myDrawerOpen.value = false;
    error.value = e instanceof Error ? e.message : "加载失败";
  }
}
onMounted(load);

/* ---------- 详情 + 验收 ---------- */
const detailDrawer = ref(false);
const detail = ref<PurchaseOrderDetail | null>(null);
/** 本次验收行编辑态：productId → { receive, bad, note }，预填欠收（快捷全收） */
type RxLine = { productId: string; receive: number; bad: number; note: string };
const rxLines = ref<RxLine[]>([]);
const rxBusy = ref(false);
async function openDetail(row: PurchaseOrderRow) {
  detailDrawer.value = true;
  detail.value = null;
  detail.value = await api.purchaseOrderDetail(row.id);
}
/** 打开验收弹框：逐行预填欠收（IQ3 快捷全收），收齐行预填 0 */
function openReceive() {
  const d = detail.value;
  if (!d) return;
  rxLines.value = d.items.map((i) => ({
    productId: i.productId,
    receive: Math.max(0, i.requiredCases - i.receivedCases),
    bad: 0,
    note: "",
  }));
}
async function submitReceive() {
  if (!detail.value) return;
  const lines = rxLines.value
    .map((l) => ({
      productId: l.productId,
      receiveCases: Math.max(0, Math.round(l.receive) || 0),
      badCases: Math.max(0, Math.round(l.bad) || 0),
      note: l.note.trim(),
    }))
    .filter((l) => l.receiveCases > 0 || l.badCases > 0);
  if (!lines.length) return alert("请至少为一行填写本次到货件数");
  rxBusy.value = true;
  try {
    await api.receivePurchaseOrder(detail.value.id, lines);
    alert("验收完成，总部仓库存已更新");
    await refreshDetail();
  } catch (e) {
    alert(e instanceof Error ? e.message : "验收失败");
  } finally {
    rxBusy.value = false;
  }
}
async function closeOrder() {
  if (!detail.value) return;
  const note = window.prompt("关闭原因（欠收将作废，可留空）") ?? "";
  if (note === null) return;
  try {
    await api.closePurchaseOrder(detail.value.id, note);
    await refreshDetail();
    await load();
  } catch (e) {
    alert(e instanceof Error ? e.message : "操作失败");
  }
}
async function reopenOrder() {
  if (!detail.value) return;
  try {
    await api.reopenPurchaseOrder(detail.value.id);
    await refreshDetail();
    await load();
  } catch (e) {
    alert(e instanceof Error ? e.message : "操作失败");
  }
}
async function refreshDetail() {
  const fresh = await api.purchaseOrderDetail(detail.value!.id);
  detail.value = fresh;
  await load();
}
</script>

<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，header 标签会误命中变白卡 -->
    <div class="page-head">
      <div>
        <h1>采购管理</h1>
        <p v-if="isCampusView">本校区全部订货单的进度跟踪：提交 → 总部确认 → 发货 → 到货确认。</p>
        <p v-else>批次订货汇总生成供应商采购单，验收入总部仓；坏品登记自动出库，支持部分到货。</p>
      </div>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>

    <!-- IKJCJF：校区视角=我的订货单（跨批次进度跟踪） -->
    <div v-if="isCampusView" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ myOrders.length }}</strong><span> 张订货单</span>
        </div>
        <p><span class="live-dot"></span>数据已同步 · 全部批次</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>批次</th>
              <th>提交时间</th>
              <th>提交人</th>
              <th>商品</th>
              <th>件数</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 4" :key="i">
              <td :colspan="7"><div class="row-skeleton"></div></td>
            </tr>
            <template v-else>
              <tr v-if="!myOrders.length">
                <td :colspan="7" class="empty-cell">
                  还没有订货单。到「订货管理」选开放批次填写提交。
                </td>
              </tr>
              <tr v-for="o in myOrders" :key="o.id">
                <td><strong>{{ o.batchName || o.batchId }}</strong></td>
                <td>{{ fmtDateTime(o.submittedAt) }}</td>
                <td>{{ o.submitByName || "—" }}</td>
                <td>{{ o.itemCount ?? o.items?.length ?? "—" }}</td>
                <td>{{ o.totalCases ?? "—" }}</td>
                <td>
                  <span class="status" :class="RESTOCK_ORDER_STATUS_CLASS[o.status]">
                    {{ RESTOCK_ORDER_STATUS_TEXT[o.status] }}
                  </span>
                </td>
                <td class="row-actions">
                  <button class="btn mini primary" @click="openMyOrder(o.id)">详情</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ orders.length }}</strong><span> 张采购单</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>采购批次</th>
              <th>供应商</th>
              <th>状态</th>
              <th>应收 / 已收（件）</th>
              <th>坏品</th>
              <th>采购总额</th>
              <th>已收金额</th>
              <th>创建人 / 时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 4" :key="i">
              <td :colspan="9"><div class="row-skeleton"></div></td>
            </tr>
            <template v-else>
              <tr v-if="!orders.length">
                <td :colspan="9" class="empty-cell">
                  还没有采购单。到「订货管理」打开批次详情，一键聚合生成。
                </td>
              </tr>
              <tr v-for="row in orders" :key="row.id">
                <td><strong>{{ row.batchName }}</strong></td>
                <td>{{ row.supplierName }}</td>
                <td>
                  <span class="status" :class="PURCHASE_PHASE_CLASS[row.phase]">
                    {{ PURCHASE_PHASE_TEXT[row.phase] }}
                  </span>
                </td>
                <td>
                  {{ row.requiredCases }} / {{ row.receivedCases }}
                  <template v-if="row.phase === 'partial'">
                    <em class="shortage">（欠 {{ row.requiredCases - row.receivedCases }}）</em>
                  </template>
                </td>
                <td>{{ row.badCases || "—" }}</td>
                <td>¥{{ fenToYuan(row.totalCost) }}</td>
                <td>¥{{ fenToYuan(row.receivedCost) }}</td>
                <td>
                  {{ row.createdByName || "—" }}<br />{{ fmtDateTime(row.createdAt) }}
                </td>
                <td class="row-actions">
                  <button v-if="hasPerm('GET /admin/purchase/orders/:id')" class="btn mini primary" @click="openDetail(row)">详情</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 详情 + 验收弹框 -->
    <div v-if="detailDrawer" class="drawer-mask" @click.self="detailDrawer = false">
      <div class="drawer po-detail-drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">PURCHASE ORDER</p>
            <h2>{{ detail?.supplierName ?? "采购单" }}</h2>
            <p v-if="detail" class="detail-window">
              {{ detail.batchName }}
              <span class="status" :class="PURCHASE_PHASE_CLASS[detail.phase]" style="margin-left: 8px">
                {{ PURCHASE_PHASE_TEXT[detail.phase] }}
              </span>
              <template v-if="detail.closedAt">
                · 关闭（{{ detail.closedByName || "—" }}）{{ detail.closedNote }}
              </template>
            </p>
          </div>
          <button @click="detailDrawer = false">✕</button>
        </div>
        <template v-if="detail">
          <!-- 验收编辑态（IQ3 快捷全收：预填欠收，可改小可 0） -->
          <template v-if="rxLines.length">
            <div class="rx-tip">
              本次到货默认按欠收数预填（快捷全收），没到的行改成 0；坏品在到货行内登记，
              系统自动入库存再出库扣回。
            </div>
            <div class="rx-line rx-line-head">
              <span>商品</span><span>应收/已收</span><span>本次到货</span><span>坏品</span><span>备注</span>
            </div>
            <div v-for="l in rxLines" :key="l.productId" class="rx-line">
              <span class="rx-name">
                {{ detail.items.find((i) => i.productId === l.productId)?.name }}
              </span>
              <span class="rx-req">
                {{ detail.items.find((i) => i.productId === l.productId)?.requiredCases }} /
                {{ detail.items.find((i) => i.productId === l.productId)?.receivedCases }}
              </span>
              <input v-model.number="l.receive" type="number" min="0" step="1" />
              <input v-model.number="l.bad" type="number" min="0" step="1" />
              <input v-model="l.note" type="text" maxlength="100" placeholder="备注" />
            </div>
          </template>
          <!-- 只读行表 -->
          <template v-else>
            <div class="rx-line rx-line-head">
              <span>商品</span><span>应收</span><span>已收</span><span>欠收</span><span>坏品</span><span>单价</span>
            </div>
            <div v-for="i in detail.items" :key="i.id" class="rx-line rx-readonly">
              <span class="rx-name">{{ i.name }}</span>
              <span>{{ i.requiredCases }}</span>
              <span>{{ i.receivedCases }}</span>
              <span>{{ Math.max(0, i.requiredCases - i.receivedCases) }}</span>
              <span>{{ i.badCases || "—" }}</span>
              <span>¥{{ fenToYuan(i.unitCost) }}</span>
            </div>
            <p v-if="detail.items.some((i) => i.lastNote)" class="rx-note">
              最近验收备注：{{ detail.items.filter((i) => i.lastNote).map((i) => `${i.name}「${i.lastNote}」`).join("；") }}
            </p>
          </template>
        </template>
        <div v-if="detail" class="drawer-actions">
          <button class="btn ghost" @click="detailDrawer = false; rxLines = []">关闭</button>
          <template v-if="detail.phase !== 'closed'">
            <button
              v-if="hasPerm('POST /admin/purchase/orders/:id/close') && !rxLines.length && detail.phase !== 'completed'"
              class="btn ghost"
              @click="closeOrder"
            >
              关闭采购单
            </button>
            <button v-if="hasPerm('POST /admin/purchase/orders/:id/receive') && !rxLines.length" class="btn primary" @click="openReceive">
              验收入库
            </button>
            <template v-else-if="rxLines.length && hasPerm('POST /admin/purchase/orders/:id/receive')">
              <button class="btn ghost" @click="rxLines = []">取消验收</button>
              <button class="btn primary" :disabled="rxBusy" @click="submitReceive">
                {{ rxBusy ? "提交中…" : "确认验收" }}
              </button>
            </template>
          </template>
          <button v-else-if="hasPerm('POST /admin/purchase/orders/:id/reopen')" class="btn primary" @click="reopenOrder">重开采购单</button>
        </div>
      </div>
    </div>

    <!-- 校区视角：订货单详情抽屉（IKJCJF） -->
    <div v-if="myDrawerOpen" class="drawer-mask" @click.self="myDrawerOpen = false">
      <div class="drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">RESTOCK ORDER</p>
            <h2>
              订货单
              <span class="status" :class="RESTOCK_ORDER_STATUS_CLASS[myDetail?.status ?? 'submitted']" style="margin-left: 8px">
                {{ RESTOCK_ORDER_STATUS_TEXT[myDetail?.status ?? 'submitted'] }}
              </span>
            </h2>
          </div>
          <button @click="myDrawerOpen = false">✕</button>
        </div>
        <div class="drawer-body">
          <p v-if="!myDetail" class="empty-cell">加载中…</p>
          <template v-else>
            <dl class="my-meta">
              <dt>提交时间</dt><dd>{{ fmtDateTime(myDetail.submittedAt) }}</dd>
              <dt>提交人</dt><dd>{{ myDetail.submitByName || "—" }}</dd>
              <dt v-if="myDetail.auditNote">审核意见</dt>
              <dd v-if="myDetail.auditNote">{{ myDetail.auditNote }}</dd>
              <dt v-if="myDetail.shipment?.shippedAt">发货时间</dt>
              <dd v-if="myDetail.shipment?.shippedAt">{{ fmtDateTime(myDetail.shipment.shippedAt) }}</dd>
              <dt v-if="myDetail.shipment?.receivedAt">到货时间</dt>
              <dd v-if="myDetail.shipment?.receivedAt">{{ fmtDateTime(myDetail.shipment.receivedAt) }}</dd>
            </dl>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>商品</th><th>件数</th><th>听数</th></tr>
                </thead>
                <tbody>
                  <tr v-for="l in myDetail.items" :key="l.productId">
                    <td>{{ l.product?.name ?? l.productId }}</td>
                    <td>{{ l.cases }}</td>
                    <td>{{ l.cases * l.unitsPerCase }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 页面壳/表格/统计条/骨架全走全局，与商品管理同源；scoped 只留弹框排版 */
.load-error {
  padding: 0 0 14px;
  font-size: 13px;
  color: #b33a3a;
}
.po-detail-drawer {
  width: min(760px, 94vw);
}
.detail-window {
  margin-top: 4px;
  font-size: 12px;
  color: #647169;
  display: flex;
  align-items: center;
}
.shortage {
  font-style: normal;
  color: #a95c20;
}
.rx-tip {
  margin-top: 14px;
  font-size: 11px;
  color: #a95c20;
  background: #fff0dc;
  border-radius: 10px;
  padding: 10px 12px;
}
.rx-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 90px 70px minmax(0, 1.2fr);
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12px;
  color: #37423c;
}
.rx-line-head {
  border-bottom: 1px solid var(--line);
  color: #7b8981;
  font-weight: 600;
  margin-top: 10px;
  padding-bottom: 8px;
}
/* 只读行表 6 列 */
.rx-readonly {
  grid-template-columns: minmax(0, 1.4fr) 70px 70px 70px 70px 90px;
}
.rx-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #153628;
  font-weight: 700;
}
.rx-req {
  text-align: center;
}
.rx-line input {
  width: 100%;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 12px;
  outline: 0;
}
.rx-line input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px #159c5515;
}
.rx-note {
  margin-top: 10px;
  font-size: 11px;
  color: #647169;
}
</style>
