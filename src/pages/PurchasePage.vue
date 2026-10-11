<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
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
const notify = (message: string, error = false) => ElMessage({ message, type: error ? "error" : "success", showClose: true });

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
const asRestockOrder = (row: unknown) => row as RestockOrder;
const asPurchaseOrder = (row: unknown) => row as PurchaseOrderRow;

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
/** 删除待审核订货单（IKJCJF：总部审核前可删）。 */
const deleting = ref("");
async function deleteMyOrder(id: string) {
  try { await ElMessageBox.confirm("确认删除这张待审核订货单？", "删除订货单", { type: "warning", confirmButtonText: "确认删除", cancelButtonText: "取消" }); }
  catch { return; }
  deleting.value = id;
  try {
    await api.deleteRestockOrder(id);
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  } finally {
    deleting.value = "";
  }
}
/** 校区确认到货：按发货数全额入账（grilling #3 不登记差异）。 */
const receiptBusy = ref(false);
async function confirmReceipt() {
  const target = myDetail.value;
  if (!target) return;
  try { await ElMessageBox.confirm("确认到货后库存按发货数全额入账（差异请线下核对登记），订货单随即完结。", "确认到货", { type: "warning", confirmButtonText: "确认入账", cancelButtonText: "取消" }); }
  catch { return; }
  receiptBusy.value = true;
  try {
    await api.confirmRestockReceipt(target.id);
    myDetail.value = await api.restockOrderDetail(target.id);
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  } finally {
    receiptBusy.value = false;
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
  if (!lines.length) return notify("请至少为一行填写本次到货件数", true);
  rxBusy.value = true;
  try {
    await api.receivePurchaseOrder(detail.value.id, lines);
    notify("验收完成，总部仓库存已更新");
    await refreshDetail();
  } catch (e) {
    notify(e instanceof Error ? e.message : "验收失败", true);
  } finally {
    rxBusy.value = false;
  }
}
async function closeOrder() {
  if (!detail.value) return;
  let note = "";
  try {
    const result = await ElMessageBox.prompt("欠收将作废，可留空。", "关闭采购单", { inputPlaceholder: "关闭原因", confirmButtonText: "确认关闭", cancelButtonText: "取消" });
    note = result.value ?? "";
  } catch { return; }
  try {
    await api.closePurchaseOrder(detail.value.id, note);
    await refreshDetail();
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  }
}
async function reopenOrder() {
  if (!detail.value) return;
  try {
    await api.reopenPurchaseOrder(detail.value.id);
    await refreshDetail();
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
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
      <ElTable v-loading="loading" :data="myOrders" row-key="id" empty-text="还没有订货单。到「订货单」选开放批次填写提交。">
        <ElTableColumn label="批次" min-width="160"><template #default="{ row }"><strong>{{ row.batchName || row.batchId }}</strong></template></ElTableColumn>
        <ElTableColumn label="提交时间" min-width="170"><template #default="{ row }">{{ fmtDateTime(row.submittedAt) }}</template></ElTableColumn>
        <ElTableColumn label="提交人" min-width="120"><template #default="{ row }">{{ row.submitByName || "—" }}</template></ElTableColumn>
        <ElTableColumn label="商品" width="90"><template #default="{ row }">{{ row.itemCount ?? row.items?.length ?? "—" }}</template></ElTableColumn>
        <ElTableColumn label="件数" width="90"><template #default="{ row }">{{ row.totalCases ?? "—" }}</template></ElTableColumn>
        <ElTableColumn label="状态" width="120"><template #default="{ row }"><ElTag>{{ RESTOCK_ORDER_STATUS_TEXT[row.status] }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="160"><template #default="{ row }"><ElButton size="small" type="primary" @click="openMyOrder(row.id)">详情</ElButton><ElButton v-if="row.status === 'submitted' && hasPerm('DELETE /admin/restock/orders/:id')" size="small" type="danger" plain :loading="deleting === row.id" @click="deleteMyOrder(row.id)">删除</ElButton></template></ElTableColumn>
      </ElTable>
    </div>

    <div v-else class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ orders.length }}</strong><span> 张采购单</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <ElTable v-loading="loading" :data="orders" row-key="id" empty-text="还没有采购单。到「订货单」打开批次详情，一键聚合生成。">
        <ElTableColumn prop="batchName" label="采购批次" min-width="160" />
        <ElTableColumn prop="supplierName" label="供应商" min-width="140" />
        <ElTableColumn label="状态" width="110"><template #default="{ row }"><ElTag>{{ PURCHASE_PHASE_TEXT[row.phase] }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="应收 / 已收（件）" min-width="150"><template #default="{ row }">{{ row.requiredCases }} / {{ row.receivedCases }}<em v-if="row.phase === 'partial'" class="shortage">（欠 {{ row.requiredCases - row.receivedCases }}）</em></template></ElTableColumn>
        <ElTableColumn label="坏品" width="80"><template #default="{ row }">{{ row.badCases || "—" }}</template></ElTableColumn>
        <ElTableColumn label="采购总额" width="120"><template #default="{ row }">¥{{ fenToYuan(row.totalCost) }}</template></ElTableColumn>
        <ElTableColumn label="已收金额" width="120"><template #default="{ row }">¥{{ fenToYuan(row.receivedCost) }}</template></ElTableColumn>
        <ElTableColumn label="创建人 / 时间" min-width="180"><template #default="{ row }">{{ row.createdByName || "—" }}<br />{{ fmtDateTime(row.createdAt) }}</template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="100"><template #default="{ row }"><ElButton v-if="hasPerm('GET /admin/purchase/orders/:id')" size="small" type="primary" @click="openDetail(asPurchaseOrder(row))">详情</ElButton></template></ElTableColumn>
      </ElTable>
    </div>

    <!-- 详情 + 验收弹框 -->
    <ElDialog v-model="detailDrawer" :title="detail?.supplierName ?? '采购单'" width="min(860px, calc(100vw - 32px))" align-center destroy-on-close :close-on-click-modal="false">
        <div class="purchase-dialog-head">
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
              <ElInputNumber v-model="l.receive" :min="0" :step="1" />
              <ElInputNumber v-model="l.bad" :min="0" :step="1" />
              <ElInput v-model="l.note" maxlength="100" placeholder="备注" />
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
        <template v-if="detail" #footer>
          <ElButton @click="detailDrawer = false; rxLines = []">关闭</ElButton>
          <template v-if="detail.phase !== 'closed'">
            <ElButton
              v-if="hasPerm('POST /admin/purchase/orders/:id/close') && !rxLines.length && detail.phase !== 'completed'"
              @click="closeOrder"
            >
              关闭采购单
            </ElButton>
            <ElButton v-if="hasPerm('POST /admin/purchase/orders/:id/receive') && !rxLines.length" type="primary" @click="openReceive">
              验收入库
            </ElButton>
            <template v-else-if="rxLines.length && hasPerm('POST /admin/purchase/orders/:id/receive')">
              <ElButton @click="rxLines = []">取消验收</ElButton>
              <ElButton type="primary" :loading="rxBusy" @click="submitReceive">
                {{ rxBusy ? "提交中…" : "确认验收" }}
              </ElButton>
            </template>
          </template>
          <ElButton v-else-if="hasPerm('POST /admin/purchase/orders/:id/reopen')" type="primary" @click="reopenOrder">重开采购单</ElButton>
        </template>
    </ElDialog>

    <!-- 校区视角：订货单详情抽屉（IKJCJF） -->
    <ElDialog v-model="myDrawerOpen" title="订货单详情" width="min(760px, calc(100vw - 32px))" align-center destroy-on-close :close-on-click-modal="false">
        <div class="purchase-dialog-head">
          <div>
            <p class="eyebrow">RESTOCK ORDER</p>
            <h2>
              订货单
              <span class="status" :class="RESTOCK_ORDER_STATUS_CLASS[myDetail?.status ?? 'submitted']" style="margin-left: 8px">
                {{ RESTOCK_ORDER_STATUS_TEXT[myDetail?.status ?? 'submitted'] }}
              </span>
            </h2>
          </div>
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
            <div v-if="myDetail.status === 'shipped'" class="drawer-actions">
              <ElButton
                v-if="hasPerm('POST /admin/restock/orders/:id/receipt')"
                type="primary"
                :loading="receiptBusy"
                @click="confirmReceipt"
              >
                {{ receiptBusy ? "入账中…" : "确认到货入账" }}
              </ElButton>
            </div>
            <ElTable :data="myDetail.items" row-key="productId" empty-text="暂无商品">
              <ElTableColumn label="商品" min-width="180"><template #default="{ row }">{{ row.product?.name ?? row.productId }}</template></ElTableColumn>
              <ElTableColumn prop="cases" label="件数" width="100" />
              <ElTableColumn label="零售单位数" width="130"><template #default="{ row }">{{ row.cases * row.unitsPerCase }}</template></ElTableColumn>
            </ElTable>
          </template>
        </div>
    </ElDialog>
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
