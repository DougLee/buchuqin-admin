<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useRouter } from "vue-router";
import { api } from "../api";
import ProductPickerField from "../components/ProductPickerField.vue";
import { accountOrgLevel, canSee, hasPerm, menuPath } from "../session";
import type {
  Product,
  RestockBatch,
  RestockOrder,
  RestockOrderLine,
  RestockShipmentDetail,
} from "../types";
import { fenToYuan } from "../utils/money";
import { fmtDateTime } from "../utils/datetime";

/**
 * 订货单（IKFOQ0，2026-09-15 grilling 定版）：
 * - 独立一级菜单（道哥拍板不塞仓储中心），交互重于通用表格故独立成页
 * - 总部视角：批次管理（建/改/关窗）+ 全校区订货单审核（确认/驳回/撤销，IKJC1R 不锁库存）
 * - 校区视角：批次列表 + 我的订货单按件编辑（N 件(×N 听) 换算）
 * - 权限两分法与后端一致：isHqScope 管批次审单，operations/warehouse 订货
 * - RBAC V1（2026-09-19）：isHqScope→isPlatform（服务端上下文）；
 *   RBAC 蛋词：canManage/canOrder 直接认 URL 模式串（建批次/保存订货单）
 */
const isHqScope = computed(() => accountOrgLevel.value === "platform");
const canManage = computed(() => hasPerm("POST /admin/restock/batches"));
const canOrder = computed(() =>
  hasPerm("PUT /admin/restock/batches/:batchId/order"),
);

const loading = ref(true);
const error = ref("");
const batches = ref<RestockBatch[]>([]);
const tab = ref<"batches" | "orders">("batches");
const hqOrders = ref<RestockOrder[]>([]);

// 订货批次/订单状态字典见 src/dicts/inventory（RESTOCK_*，IKIYMM 集中化）
import {
  RESTOCK_ORDER_STATUS_CLASS,
  RESTOCK_ORDER_STATUS_TEXT,
  RESTOCK_PHASE_CLASS,
  RESTOCK_PHASE_TEXT,
} from "../dicts";
const router = useRouter();
const notify = (message: string, error = false) =>
  ElMessage({ message, type: error ? "error" : "success", showClose: true });
const asRestockBatch = (row: unknown) => row as RestockBatch;
const asRestockOrder = (row: unknown) => row as RestockOrder;

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
  hqOrders.value = hasPerm("GET /admin/restock/orders")
    ? await api.restockOrders()
    : [];
}
function refresh() {
  loadBatches();
  if (isHqScope.value) loadHqOrders();
}
onMounted(refresh);

/** 折算显示：N 件(×M 听)；无件概念（unitsPerCase≤1）只显示件数。 */
function caseText(cases: number, unitsPerCase: number): string {
  return unitsPerCase > 1
    ? `${cases} 件(×${cases * unitsPerCase} 听)`
    : `${cases} 件`;
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
  if (!name) return notify("请填写批次名称", true);
  const startAt = new Date(batchForm.value.startAt);
  const endAt = new Date(batchForm.value.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()))
    return notify("请填写完整的起止时间", true);
  if (endAt <= startAt) return notify("结束时间必须晚于开始时间", true);
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
    notify(e instanceof Error ? e.message : "保存失败", true);
  } finally {
    batchSaving.value = false;
  }
}
async function closeBatch(batch: RestockBatch) {
  if (batch.closedAt) return;
  try {
    await ElMessageBox.confirm(
      `确认提前关闭「${batch.name}」？关闭后校区不能再订货。`,
      "关闭订货批次",
      { type: "warning", confirmButtonText: "确认关闭", cancelButtonText: "取消" },
    );
  } catch { return; }
  try {
    await api.closeRestockBatch(batch.id);
    refresh();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  }
}

/* ---------- 批次详情（总部：商品范围+各校区订货单） ---------- */
const detailDrawer = ref(false);
const detail = ref<Awaited<ReturnType<typeof api.restockBatchDetail>> | null>(
  null,
);
async function openBatchDetail(batch: RestockBatch) {
  detailDrawer.value = true;
  detail.value = null;
  detail.value = await api.restockBatchDetail(batch.id);
}

/* ---------- 生成采购单（IKFOQ1 grilling #2：批次详情一键聚合） ---------- */
const poDrawer = ref(false);
const poSaving = ref(false);
const poSupplier = ref("");
/** 聚合行：productId → 件数（该批次 confirmed 订货单按商品求和） */
type PoLine = {
  productId: string;
  name: string;
  cases: number;
  unitCost: number;
};
const poLines = ref<PoLine[]>([]);
function openPurchaseForm() {
  const d = detail.value;
  if (!d) return;
  const agg = new Map<string, number>();
  for (const o of d.orders.filter((x) => x.status === "confirmed"))
    for (const l of o.items ?? [])
      agg.set(l.productId, (agg.get(l.productId) ?? 0) + l.cases);
  if (!agg.size) return notify("该批次还没有已确认的订货单，无法生成采购单", true);
  // 名称/进货价从官方全集行取（下架行回退 —）
  const info = new Map(d.items.map((i) => [i.productId, i.product]));
  poLines.value = [...agg.entries()].map(([productId, cases]) => ({
    productId,
    cases,
    name: info.get(productId)?.name ?? "（已下架商品）",
    unitCost: info.get(productId)?.costPrice ?? 0,
  }));
  poSupplier.value = "";
  poDrawer.value = true;
}
async function submitPurchaseOrder() {
  const supplierName = poSupplier.value.trim();
  if (!supplierName) return notify("请填写供应商名称", true);
  poSaving.value = true;
  try {
    await api.createPurchaseOrder(detail.value!.id, {
      supplierName,
      lines: poLines.value.map((l) => ({
        productId: l.productId,
        unitCost: Math.max(0, Math.round(l.unitCost)),
      })),
    });
    poDrawer.value = false;
    notify("采购单已生成，请到「采购管理」菜单验收入库");
    refresh();
    detail.value = await api.restockBatchDetail(detail.value!.id);
  } catch (e) {
    notify(e instanceof Error ? e.message : "生成失败", true);
  } finally {
    poSaving.value = false;
  }
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
    return notify("驳回请填写理由，方便校区修改后重新提交", true);
  auditBusy.value = true;
  try {
    await api.auditRestockOrder(
      auditTarget.value.id,
      action,
      auditNote.value.trim(),
    );
    auditDrawer.value = false;
    refresh();
    if (detail.value)
      detail.value = await api.restockBatchDetail(detail.value.id);
  } catch (e) {
    // 确认时库存不足等后端阻断信息原样透出
    notify(e instanceof Error ? e.message : "操作失败", true);
  } finally {
    auditBusy.value = false;
  }
}

/* ---------- 我的订货单（校区） ---------- */
const orderDrawer = ref(false);
const orderBatch = ref<RestockBatch | null>(null);
const orderDetail = ref<{
  items: {
    productId: string;
    product: {
      id: string;
      name: string;
      image: string;
      price: number;
      retailUnit?: string;
      wholesaleUnit?: string;
      unitsPerCase: number;
      categoryId?: string;
      category?: { name: string };
    };
  }[];
  orders: RestockOrder[];
} | null>(null);
/* ---------- 订货单商品选择（IKGQ6Q 组件化）：筛选/列表内聚进
   ProductPickerField（multiple 模式），页面只留件数账本与合计 ---------- */
/** 批次可订商品集：选择器候选（快照 product，含 category 名供类别聚合） */
const orderProducts = computed(() =>
  (orderDetail.value?.items ?? []).map((i) => i.product as unknown as Product),
);
/** 行编辑态：productId → 件数（空串显示为 0）。 */
const lineCases = ref<Record<string, number>>({});
/** IKJCJF 多单制：有订货权限即可再填一张新单（批次窗口后端校验）。 */
const editable = computed(() => canOrder.value);
const totalCases = computed(() =>
  Object.values(lineCases.value).reduce((s, n) => s + (Number(n) || 0), 0),
);
const totalUnits = computed(() =>
  (orderDetail.value?.items ?? []).reduce(
    (s, i) =>
      s + (Number(lineCases.value[i.productId]) || 0) * i.product.unitsPerCase,
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
    next[item.productId] =
      own?.items?.find((l) => l.productId === item.productId)?.cases ?? 0;
  lineCases.value = next;
}
/** IKJCJF 多单制：填完即提交，每次生成一张新订货单（无草稿）。 */
async function submitMyOrder() {
  if (!orderBatch.value) return;
  const items = (orderDetail.value?.items ?? [])
    .map((i) => ({
      productId: i.productId,
      cases: Number(lineCases.value[i.productId]) || 0,
    }))
    .filter((i) => i.cases > 0);
  if (!items.length) return notify("请至少为一个商品填写件数", true);
  try {
    await api.saveRestockOrder(orderBatch.value.id, items);
    orderDrawer.value = false;
    refresh();
  } catch (e) {
    notify(e instanceof Error ? e.message : "提交失败", true);
  }
}

/* ---------- 分拨发货（IKFOQ2 grilling 定版）：总部发货+发货单查看+校区确认到货 ---------- */
const shipDrawer = ref(false);
const shipSaving = ref(false);
const shipTarget = ref<RestockOrder | null>(null);
/** 发货核对行明细（整单发不拆包；数量不可改） */
const shipLines = ref<RestockOrderLine[]>([]);
async function openShip(order: RestockOrder) {
  shipTarget.value = order;
  shipLines.value = [];
  shipDrawer.value = true;
  try {
    const detail = await api.restockOrderDetail(order.id);
    shipLines.value = detail.items ?? [];
  } catch (e) {
    notify(e instanceof Error ? e.message : "加载订货单明细失败", true);
  }
}
async function submitShip() {
  if (!shipTarget.value) return;
  shipSaving.value = true;
  try {
    await api.shipRestockOrder(shipTarget.value.id);
    shipDrawer.value = false;
    refresh();
    if (detail.value)
      detail.value = await api.restockBatchDetail(detail.value.id);
  } catch (e) {
    // 库存不足拦截（含缺货数量）原样透出
    notify(e instanceof Error ? e.message : "发货失败", true);
  } finally {
    shipSaving.value = false;
  }
}
const shipmentDrawer = ref(false);
const shipment = ref<RestockShipmentDetail | null>(null);
async function openShipment(orderId: string) {
  shipmentDrawer.value = true;
  shipment.value = null;
  try {
    shipment.value = await api.restockShipmentDetail(orderId);
  } catch (e) {
    notify(e instanceof Error ? e.message : "加载发货单失败", true);
  }
}
/** 追溯：发货单 → 本批次详情 */
function gotoBatch() {
  if (!shipment.value) return;
  shipmentDrawer.value = false;
  tab.value = "batches";
  openBatchDetail({ id: shipment.value.batchId } as RestockBatch);
}
/** 追溯：发货单 → 采购管理（批次同源；无采购菜单角色不显示） */
function gotoPurchase() {
  shipmentDrawer.value = false;
  router.push(menuPath("purchase") || "/access-denied");
}
// 到货确认已迁「采购管理」（IKJCJF 收敛：订货管理只保留订货动作）
</script>

<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器（白底 sticky 72px），
         header 标签会误命中变白卡（IKFOQ0 样式不一致根因） -->
    <div class="page-head">
      <div>
        <h1>订货单</h1>
        <p>
          {{
            isHqScope
              ? "开放订货批次，审核校区订货单；按订货量生成采购单补货。"
              : "批次窗口内按件填写订货单，提交总部审核；驳回可改后重提。"
          }}
        </p>
      </div>
      <div class="head-actions">
        <ElButton
          v-if="canManage && tab === 'batches'"
          type="primary"
          @click="openBatchForm()"
        >
          <span>＋</span>新建批次
        </ElButton>
      </div>
    </div>

    <!-- IKFOQ0 样式对齐：板块内子 tab 收进 toolbar -->
    <div v-if="isHqScope" class="toolbar">
      <div class="segmented inv-tabs single-line-tabs">
        <ElButton text :class="{ active: tab === 'batches' }" @click="tab = 'batches'">
          订货批次
        </ElButton>
        <ElButton text :class="{ active: tab === 'orders' }" @click="tab = 'orders'">
          全部订货单
        </ElButton>
      </div>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>

    <!-- 校区视角：批次列表（窗口 + 我的单状态 + 填单入口），表格形态与全站一致 -->
    <div v-if="!isHqScope" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ batches.length }}</strong
          ><span> 个批次</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <ElTable v-loading="loading" :data="batches" row-key="id" empty-text="暂无订货批次，总部开放后这里会出现批次">
        <ElTableColumn prop="name" label="批次名称" min-width="180"><template #default="{ row: b }"><strong>{{ b.name }}</strong></template></ElTableColumn>
        <ElTableColumn label="阶段" width="110"><template #default="{ row: b }"><ElTag :type="b.phase === 'open' ? 'success' : b.phase === 'upcoming' ? 'warning' : 'info'">{{ RESTOCK_PHASE_TEXT[b.phase] }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="订货窗口" min-width="280"><template #default="{ row: b }">{{ fmtDateTime(b.startAt) }} ~ {{ fmtDateTime(b.endAt) }}</template></ElTableColumn>
        <ElTableColumn label="我的订货单" min-width="160"><template #default="{ row: b }"><template v-if="b.orderTotal"><ElTag :type="b.orderShipped ? 'info' : b.orderConfirmed ? 'success' : 'warning'">{{ b.orderTotal }} 张</ElTag><small class="order-progress">{{ b.orderReceived ? `已到货 ${b.orderReceived}` : b.orderShipped ? `已发货 ${b.orderShipped}` : b.orderConfirmed ? `已确认 ${b.orderConfirmed}` : `待审核 ${b.orderTotal}` }}</small></template><ElTag v-else type="info">未填单</ElTag></template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="140"><template #default="{ row: b }"><ElButton v-if="canOrder && b.phase === 'open'" size="small" type="primary" @click="openMyOrder(asRestockBatch(b))">填写订货单</ElButton><small v-else-if="b.orderTotal" class="order-progress">见采购管理</small></template></ElTableColumn>
      </ElTable>
    </div>

    <!-- 总部：批次表 -->
    <div v-if="isHqScope && tab === 'batches'" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ batches.length }}</strong
          ><span> 个批次</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <ElTable v-loading="loading" :data="batches" row-key="id" empty-text="还没有订货批次，点右上角「新建批次」开始">
        <ElTableColumn prop="name" label="批次名称" min-width="180"><template #default="{ row: b }"><strong>{{ b.name }}</strong></template></ElTableColumn>
        <ElTableColumn label="阶段" width="110"><template #default="{ row: b }"><ElTag :type="b.phase === 'open' ? 'success' : b.phase === 'upcoming' ? 'warning' : 'info'">{{ RESTOCK_PHASE_TEXT[b.phase] }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="订货窗口" min-width="280"><template #default="{ row: b }">{{ fmtDateTime(b.startAt) }} ~ {{ fmtDateTime(b.endAt) }}</template></ElTableColumn>
        <ElTableColumn label="订货单" width="160"><template #default="{ row: b }">{{ b.orderTotal ?? 0 }} 单 / {{ b.orderConfirmed ?? 0 }} 已确认</template></ElTableColumn>
        <ElTableColumn prop="createdByName" label="创建人" width="120"><template #default="{ row: b }">{{ b.createdByName || "—" }}</template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="220"><template #default="{ row: b }"><ElButton v-if="hasPerm('GET /admin/restock/batches/:id')" size="small" @click="openBatchDetail(asRestockBatch(b))">详情</ElButton><ElButton v-if="hasPerm('PATCH /admin/restock/batches/:id') && (b.phase === 'upcoming' || b.phase === 'open')" size="small" type="primary" @click="openBatchForm(asRestockBatch(b))">编辑</ElButton><ElButton v-if="hasPerm('POST /admin/restock/batches/:id/close') && !b.closedAt" size="small" type="danger" plain @click="closeBatch(asRestockBatch(b))">关闭</ElButton></template></ElTableColumn>
      </ElTable>
    </div>

    <!-- 总部：全部订货单 -->
    <div v-if="isHqScope && tab === 'orders'" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ hqOrders.length }}</strong
          ><span> 张订货单</span>
        </div>
        <p><span class="live-dot"></span>数据已同步</p>
      </div>
      <ElTable v-loading="loading" :data="hqOrders" row-key="id" empty-text="还没有校区提交订货单">
        <ElTableColumn prop="batchName" label="批次" min-width="160"><template #default="{ row: o }"><strong>{{ o.batchName }}</strong></template></ElTableColumn>
        <ElTableColumn label="校区" min-width="130"><template #default="{ row: o }">{{ o.campusShortName || o.campusName }}</template></ElTableColumn>
        <ElTableColumn label="状态" min-width="150"><template #default="{ row: o }"><ElTag :type="o.status === 'confirmed' || o.status === 'received' ? 'success' : o.status === 'submitted' ? 'warning' : 'info'">{{ RESTOCK_ORDER_STATUS_TEXT[o.status] }}</ElTag><em v-if="o.shippedAt" class="ship-note">发 {{ fmtDateTime(o.shippedAt) }}</em><em v-if="o.receivedAt" class="ship-note">收 {{ fmtDateTime(o.receivedAt) }}</em></template></ElTableColumn>
        <ElTableColumn label="合计" width="130"><template #default="{ row: o }">{{ o.totalCases ?? 0 }} 件<br><span class="cell-sub">折算 {{ o.totalUnits ?? 0 }}</span></template></ElTableColumn>
        <ElTableColumn label="提交人 / 时间" min-width="180"><template #default="{ row: o }">{{ o.submitByName || "—" }}<br><span class="cell-sub">{{ o.submittedAt ? fmtDateTime(o.submittedAt) : "—" }}</span></template></ElTableColumn>
        <ElTableColumn label="审核" min-width="170"><template #default="{ row: o }"><template v-if="o.auditAt">{{ o.auditByName }}<br><span class="cell-sub">{{ fmtDateTime(o.auditAt) }}</span><em v-if="o.auditNote" class="audit-note">「{{ o.auditNote }}」</em></template><span v-else>—</span></template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="210"><template #default="{ row: o }"><ElButton v-if="hasPerm('POST /admin/restock/orders/:id/audit') && o.status === 'submitted'" size="small" type="primary" @click="openAudit(asRestockOrder(o))">审核</ElButton><template v-else-if="o.status === 'confirmed'"><ElButton v-if="hasPerm('POST /admin/restock/orders/:id/ship') && hasPerm('GET /admin/restock/orders/:id')" size="small" type="primary" @click="openShip(asRestockOrder(o))">发货</ElButton><ElButton v-if="hasPerm('POST /admin/restock/orders/:id/audit')" size="small" type="danger" plain @click="openAudit(asRestockOrder(o))">撤销确认</ElButton></template><ElButton v-else-if="hasPerm('GET /admin/restock/orders/:id/shipment') && (o.status === 'shipped' || o.status === 'received')" size="small" @click="openShipment(o.id)">发货单</ElButton><span v-else>—</span></template></ElTableColumn>
      </ElTable>
    </div>

    <!-- 新建/编辑批次 -->
    <ElDialog v-model="batchDrawer" :title="batchEditId ? '编辑批次' : '新建订货批次'" width="min(620px, calc(100vw - 32px))" align-center destroy-on-close :close-on-click-modal="false">
      <ElForm label-position="top">
        <ElRow :gutter="16"><ElCol :span="24"><ElFormItem label="批次名称"><ElInput v-model="batchForm.name" maxlength="60" placeholder="如：9 月第 2 期补货" /></ElFormItem></ElCol>
        <ElCol :xs="24" :sm="12"><ElFormItem label="开始时间"><ElDatePicker v-model="batchForm.startAt" type="datetime" value-format="YYYY-MM-DDTHH:mm" placeholder="选择开始时间" /></ElFormItem></ElCol><ElCol :xs="24" :sm="12"><ElFormItem label="结束时间"><ElDatePicker v-model="batchForm.endAt" type="datetime" value-format="YYYY-MM-DDTHH:mm" placeholder="选择结束时间" /></ElFormItem></ElCol></ElRow>
      </ElForm>
      <template #footer><ElButton @click="batchDrawer = false">取消</ElButton><ElButton type="primary" :loading="batchSaving" @click="submitBatch">{{ batchEditId ? "保存修改" : "创建批次" }}</ElButton></template>
    </ElDialog>

    <!-- 批次详情（总部） -->
    <ElDialog v-model="detailDrawer" :title="detail?.name ?? '批次详情'" width="min(880px, calc(100vw - 24px))" align-center :close-on-click-modal="false">
        <p v-if="detail" class="detail-window">{{ fmtDateTime(detail.startAt) }} ~ {{ fmtDateTime(detail.endAt) }} <ElTag :type="detail.phase === 'open' ? 'success' : detail.phase === 'upcoming' ? 'warning' : 'info'">{{ RESTOCK_PHASE_TEXT[detail.phase] }}</ElTag></p>
        <!-- 骨架屏：批次详情加载中（毛利盒/商品范围/订货单三段占位） -->
        <template v-if="!detail">
          <div class="detail-section skeleton-box">
            <div class="row-skeleton" style="height: 22px; width: 60%"></div>
          </div>
          <div class="detail-section skeleton-box">
            <div class="row-skeleton" style="height: 16px; width: 30%"></div>
            <div class="row-skeleton" style="height: 16px; width: 80%"></div>
            <div class="row-skeleton" style="height: 16px; width: 70%"></div>
          </div>
          <div class="detail-section skeleton-box">
            <div class="row-skeleton" style="height: 16px; width: 25%"></div>
            <div class="row-skeleton" style="height: 120px"></div>
          </div>
        </template>
        <template v-if="detail">
          <!-- IKFOQ1 毛利预估（IQ8）：批发价合计 − 全部采购单已收金额 -->
          <div class="detail-section margin-box">
            <div class="margin-row">
              <span>订货批发价合计</span>
              <strong>¥{{ fenToYuan(detail.wholesaleTotal) }}</strong>
            </div>
            <div v-if="detail.purchaseReceivedTotal != null" class="margin-row">
              <span>采购已收金额</span>
              <strong>¥{{ fenToYuan(detail.purchaseReceivedTotal) }}</strong>
            </div>
            <div v-if="detail.grossEstimate != null" class="margin-row">
              <span>本批毛利预估</span>
              <strong class="margin-value"
                >¥{{ fenToYuan(detail.grossEstimate) }}</strong
              >
            </div>
            <ElButton
              v-if="
                hasPerm('POST /admin/restock/batches/:batchId/purchase-order')
              "
              class="po-btn"
              @click="openPurchaseForm"
            >
              ＋ 生成采购单
            </ElButton>
          </div>
          <div class="detail-section">
            <h4>校区订货单（{{ detail.orders.length }}）</h4>
            <div v-if="!detail.orders.length" class="empty-block">
              暂无校区订货。
            </div>
            <div v-for="o in detail.orders" :key="o.id" class="order-brief">
              <div class="order-brief-head">
                <strong>{{ o.campusShortName || o.campusName }}</strong>
                <span
                  class="status"
                  :class="RESTOCK_ORDER_STATUS_CLASS[o.status]"
                >
                  {{ RESTOCK_ORDER_STATUS_TEXT[o.status] }}
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
                <ElButton
                  v-if="
                    hasPerm('POST /admin/restock/orders/:id/audit') &&
                    o.status === 'submitted'
                  "
                  size="small"
                  @click="openAudit(o)"
                >
                  审核
                </ElButton>
                <template v-else-if="o.status === 'confirmed'">
                  <ElButton
                    v-if="
                      hasPerm('POST /admin/restock/orders/:id/ship') &&
                      hasPerm('GET /admin/restock/orders/:id')
                    "
                    size="small"
                    type="primary"
                    @click="openShip(o)"
                  >
                    发货
                  </ElButton>
                  <ElButton
                    v-if="hasPerm('POST /admin/restock/orders/:id/audit')"
                    size="small"
                    type="danger"
                    plain
                    @click="openAudit(o)"
                  >
                    撤销确认
                  </ElButton>
                </template>
                <ElButton
                  v-else-if="
                    hasPerm('GET /admin/restock/orders/:id/shipment') &&
                    (o.status === 'shipped' || o.status === 'received')
                  "
                  size="small"
                  @click="openShipment(o.id)"
                >
                  发货单
                </ElButton>
              </div>
            </div>
          </div>
        </template>
    </ElDialog>

    <!-- 审核弹框（总部） -->
    <ElDialog v-model="auditDrawer" title="订货单审核" width="min(620px, calc(100vw - 32px))" align-center destroy-on-close :close-on-click-modal="false">
      <p v-if="auditTarget" class="detail-window">{{ auditTarget.campusShortName || auditTarget.campusName }} · {{ auditTarget.batchName }} · 共 {{ auditTarget.totalCases ?? 0 }} 件（折算 {{ auditTarget.totalUnits ?? 0 }}）</p>
      <ElForm label-position="top"><ElRow><ElCol :span="24"><ElFormItem :label="`备注${auditTarget?.status === 'confirmed' ? '（撤销时选填）' : '（驳回必填，确认选填）'}`"><ElInput v-model="auditNote" type="textarea" :rows="4" maxlength="200" show-word-limit placeholder="如：数量超出本月预算，请酌减" /></ElFormItem></ElCol></ElRow></ElForm>
      <template #footer><ElButton @click="auditDrawer = false">取消</ElButton><ElButton v-if="auditTarget?.status === 'submitted'" type="danger" plain :loading="auditBusy" @click="audit('reject')">驳回</ElButton><ElButton v-if="auditTarget?.status === 'submitted'" type="primary" :loading="auditBusy" @click="audit('confirm')">确认审核</ElButton><ElButton v-if="auditTarget?.status === 'confirmed'" type="primary" :loading="auditBusy" @click="audit('revoke')">撤销确认并放锁</ElButton></template>
    </ElDialog>

    <!-- 我的订货单（校区） -->
    <ElDialog v-model="orderDrawer" :title="orderBatch?.name || '填写订货单'" width="min(960px, calc(100vw - 24px))" align-center destroy-on-close :close-on-click-modal="false">
        <p v-if="orderBatch" class="detail-window">{{ fmtDateTime(orderBatch.startAt) }} ~ {{ fmtDateTime(orderBatch.endAt) }}</p>
        <!-- 骨架屏：批次商品清单加载中 -->
        <template v-if="!orderDetail">
          <div class="detail-section skeleton-box">
            <div class="row-skeleton" style="height: 36px; width: 40%"></div>
            <div class="row-skeleton" style="height: 240px"></div>
          </div>
        </template>
        <template v-if="orderDetail">
          <!-- IKGQ6Q 组件化：筛选+列表内聚进 ProductPickerField（多选填件数），
               已填件数账本 lineCases 仍在本页（合计条继续吃它） -->
          <ProductPickerField
            :items="orderProducts"
            :loading="orderDetail === null"
            multiple
            :disabled="!editable"
            :model-value="lineCases"
            @update:model-value="lineCases = $event as Record<string, number>"
          />
          <div class="order-total">
            合计 <strong>{{ totalCases }}</strong> 件
            <template v-if="totalUnits !== totalCases">
              （折算 <strong>{{ totalUnits }}</strong> 个零售单位）
            </template>
          </div>
        </template>
        <template #footer><ElButton @click="orderDrawer = false">取消</ElButton><ElButton v-if="hasPerm('PUT /admin/restock/batches/:batchId/order')" type="primary" @click="submitMyOrder">提交审核</ElButton></template>
    </ElDialog>

    <!-- 生成采购单（IKFOQ1：一键聚合，单价预填 costPrice 可改） -->
    <ElDialog v-model="poDrawer" title="生成采购单" width="min(760px, calc(100vw - 32px))" align-center destroy-on-close :close-on-click-modal="false">
      <p class="detail-window">{{ detail?.name }} · 已确认订货单按商品聚合；单价默认进货价，可逐行修改</p>
      <ElForm label-position="top"><ElRow><ElCol :span="24"><ElFormItem label="供应商名称"><ElInput v-model="poSupplier" maxlength="60" placeholder="如：XX 食品经销部" /></ElFormItem></ElCol></ElRow></ElForm>
      <ElTable :data="poLines" row-key="productId" empty-text="暂无采购行"><ElTableColumn prop="name" label="商品" min-width="220" /><ElTableColumn prop="cases" label="应收（件）" width="120" /><ElTableColumn label="单价（元）" width="180"><template #default="{ row }"><ElInputNumber v-model="row.unitCost" :min="0" :precision="2" /></template></ElTableColumn></ElTable>
      <template #footer><ElButton @click="poDrawer = false">取消</ElButton><ElButton type="primary" :loading="poSaving" @click="submitPurchaseOrder">生成采购单</ElButton></template>
    </ElDialog>

    <!-- 发货核对（IKFOQ2：整单发不拆包，数量不可改；库存不足后端拦截） -->
    <ElDialog v-model="shipDrawer" title="确认发货" width="min(760px, calc(100vw - 32px))" align-center :close-on-click-modal="false">
      <p v-if="shipTarget" class="detail-window">{{ shipTarget.campusShortName || shipTarget.campusName }} · {{ shipTarget.batchName }} · 共 {{ shipTarget.totalCases ?? 0 }} 件（折算 {{ shipTarget.totalUnits ?? 0 }}）</p>
      <ElTable :data="shipLines" row-key="productId" empty-text="暂无发货商品"><ElTableColumn label="商品" min-width="220"><template #default="{ row }">{{ row.product?.name }}</template></ElTableColumn><ElTableColumn label="件数" width="160"><template #default="{ row }">{{ caseText(row.cases, row.unitsPerCase) }}</template></ElTableColumn><ElTableColumn label="折算" width="160"><template #default="{ row }">{{ row.cases * row.unitsPerCase }} {{ row.product?.retailUnit || "个" }}</template></ElTableColumn></ElTable>
      <template #footer><ElButton @click="shipDrawer = false">取消</ElButton><ElButton type="primary" :loading="shipSaving" @click="submitShip">确认发货</ElButton></template>
    </ElDialog>

    <!-- 发货单详情（IKFOQ2：行快照价+发货/收货信息+全链路跳转） -->
    <ElDialog v-model="shipmentDrawer" title="发货单" width="min(760px, calc(100vw - 32px))" align-center :close-on-click-modal="false">
        <p v-if="shipment" class="detail-window">{{ shipment.campusShortName || shipment.campusName }} · {{ shipment.batchName }} <ElTag :type="shipment.receivedAt ? 'success' : 'info'">{{ shipment.receivedAt ? "已到货" : "已发货" }}</ElTag></p>
        <template v-if="shipment">
          <p class="ship-meta">
            发货：{{ shipment.shippedByName || "—" }} ·
            {{ fmtDateTime(shipment.shippedAt) }}<br />
            到货：{{
              shipment.receivedAt
                ? `${shipment.receivedByName || "—"} · ${fmtDateTime(shipment.receivedAt)}`
                : "待校区确认"
            }}
            <template v-if="shipment.note"
              ><br />备注：{{ shipment.note }}</template
            >
          </p>
          <div class="ship-line ship-line-head">
            <span>商品</span><span>件数</span><span>进货价快照</span
            ><span>批发价快照</span>
          </div>
          <div
            v-for="l in shipment.items"
            :key="l.productId"
            class="ship-line ship-line-4col"
          >
            <span class="ship-name">{{ l.name }}</span>
            <span>{{ caseText(l.cases, l.unitsPerCase) }}</span>
            <span>¥{{ fenToYuan(l.costPerCase) }}/件</span>
            <span>¥{{ fenToYuan(l.wholesalePerCase) }}/件</span>
          </div>
          <!-- IKFOPR 单据毛利（总部账）：整单金额差规避尾差 -->
          <div class="margin-box ship-margin">
            <div class="margin-row">
              <span>批发金额</span>
              <strong>¥{{ fenToYuan(shipment.wholesaleTotal) }}</strong>
            </div>
            <div class="margin-row">
              <span>进货成本</span>
              <strong>¥{{ fenToYuan(shipment.costTotal) }}</strong>
            </div>
            <div class="margin-row">
              <span>本单毛利</span>
              <strong class="margin-value">
                ¥{{ fenToYuan(shipment.wholesaleTotal - shipment.costTotal) }}
              </strong>
            </div>
          </div>
        </template>
        <template #footer><ElButton @click="shipmentDrawer = false">关闭</ElButton><ElButton v-if="shipment" @click="gotoBatch">查看本批次</ElButton><ElButton v-if="shipment && canSee('purchase')" type="primary" @click="gotoPurchase">去采购管理</ElButton></template>
    </ElDialog>
  </div>
</template>

<style scoped>
/* 页面壳/表格/统计条/骨架全走全局（style.css + drawer.css），与商品管理同源；
   scoped 只留 drawer 内部排版。IKFOQ0 样式对齐（道哥 2026-09-15） */
.audit-note {
  font-style: normal;
  color: #a95c20;
}
/* IKFOQ2：状态列发货/到货时间小字 */
.ship-note {
  display: block;
  font-style: normal;
  font-size: 11px;
  color: #7b8981;
  margin-top: 2px;
}
/* 发货核对/发货单弹框行表 */
.ship-drawer {
  width: min(620px, 94vw);
}
.ship-tip {
  margin: 12px 0;
  padding: 10px 12px;
  font-size: 11px;
  color: #a95c20;
  background: #fff0dc;
  border-radius: 10px;
}
/* IKFOPR 发货单毛利块：复用 margin-row 排版，收窄上边距 */
.ship-margin {
  margin-top: 14px;
}
.ship-line {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.9fr);
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12px;
  color: #37423c;
}
.ship-line-head {
  border-bottom: 1px solid var(--line);
  color: #7b8981;
  font-weight: 600;
  margin-top: 10px;
  padding-bottom: 8px;
}
.ship-line-4col {
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.1fr) 100px 100px;
}
.ship-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #153628;
  font-weight: 700;
}
.ship-meta {
  margin: 12px 0 0;
  font-size: 12px;
  color: #647169;
  line-height: 1.7;
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
/* 毛利预估区块（IQ8） */
.margin-box {
  background: #f2f8f3;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px;
}
.margin-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #647169;
  padding: 3px 0;
}
.margin-row strong {
  font-size: 13px;
  color: #153628;
}
.margin-row .margin-value {
  color: #0b7a45;
  font-size: 16px;
}
.po-btn {
  margin-top: 8px;
}
/* 生成采购单弹框 */
.po-drawer {
  width: min(560px, 94vw);
}
.po-form-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
}
.po-line {
  display: grid;
  grid-template-columns: 1fr 90px 110px;
  gap: 10px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12px;
  color: #37423c;
}
.po-line-head {
  border-bottom: 1px solid var(--line);
  color: #7b8981;
  font-weight: 600;
  padding-bottom: 8px;
}
.po-line-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #153628;
  font-weight: 700;
}
.po-line-cases {
  text-align: center;
}
.po-line input {
  width: 100%;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 12px;
  text-align: right;
  outline: 0;
}
.po-line input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px #159c5515;
}
/* 审核弹窗表单：独立上下布局（不再蹭 .product-form 两列 grid，
   修复备注 textarea 被挤右列的失衡） */
.audit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 20px 0;
}
.audit-form__label {
  font-size: 12px;
  font-weight: 600;
  color: #4c5c53;
}
.audit-form textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: #153628;
  background: #fff;
  resize: vertical;
  min-height: 76px;
  outline: 0;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.audit-form textarea:focus {
  border-color: var(--brand, #159c55);
  box-shadow: 0 0 0 3px #159c5522;
}
.audit-form textarea::placeholder {
  color: #a9b5ae;
}
.audit-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #159c5510;
  font-size: 12px;
  line-height: 1.6;
  color: #2f6b4c;
}
.audit-tip__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--brand, #159c55);
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}
/* 订货单编辑器 */
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
.order-progress {
  display: block;
  font-size: 11px;
  color: #7b8981;
  margin-top: 2px;
}
.skeleton-box {
  display: grid;
  gap: 10px;
}
</style>
