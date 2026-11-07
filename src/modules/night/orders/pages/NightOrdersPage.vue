<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import NightLoadError from '../../NightLoadError.vue';
import { ElMessage, ElMessageBox } from "element-plus";
import { api, fetchAllPages } from "../../../../api";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import { nightOrderStatus } from "../../night-shared";
import type { NightOrderDetail, NightOrderRow, NightStoreRow } from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
import { fmtDateTime } from '../../../../utils/datetime';

/**
 * 夜宵订单列表（IKSW1F，菜单 night-orders）：全局筛选（店铺/状态/营业日）
 * + 详情抽屉（items 快照/金额四件套/券/时间线）+ 退款操作（整单/部分/
 * 配送费 + 是否回库）。金额一律整数分。
 */
const STATUS_TABS = [
  { key: "", label: "全部" },
  { key: "pending-payment", label: "待支付" },
  { key: "pending-accept", label: "待接单" },
  { key: "delivering", label: "配送中" },
  { key: "delivered", label: "已送达" },
  { key: "completed", label: "已完成" },
  { key: "cancelled", label: "已取消" },
  { key: "cancelling", label: "取消退款中" },
  { key: "refunded", label: "已退款" },
  { key: "exception", label: "支付异常" },
];

const rows = ref<NightOrderRow[]>([]);
const loading = ref(false);
const loadError = ref('');
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const storeId = ref("");
const status = ref("");
const date = ref("");
const keyword = ref('');
const afterSaleStatus = ref('');
const stores = ref<NightStoreRow[]>([]);
let listGeneration = 0;
let storesGeneration = 0;
let detailGeneration = 0;

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

/** ElTable 作用域槽 row 兜底断言（同 CouponPage asCoupon 模式）。 */
function asOrder(row: unknown) {
  return row as NightOrderRow;
}

async function loadStores() {
  const generation = ++storesGeneration;
  if (!effectiveCampusId.value) return;
  try {
    const result = await fetchAllPages(
      (q) => api.nightStores(undefined, q.page, q.pageSize),
      100,
    );
    if (generation === storesGeneration) stores.value = result;
  } catch {
    /* 店铺下拉加载失败不阻断列表 */
  }
}

async function load() {
  const generation = ++listGeneration;
  loadError.value = '';
  if (!effectiveCampusId.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const r = await api.nightOrders({
      storeId: storeId.value || undefined,
      status: status.value || undefined,
      date: date.value || undefined,
      keyword: keyword.value.trim() || undefined,
      afterSaleStatus: afterSaleStatus.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    if (generation !== listGeneration) return;
    rows.value = r.items;
    total.value = r.total;
  } catch (e) {
    if (generation === listGeneration) loadError.value = e instanceof Error ? e.message : '夜宵订单加载失败';
  } finally {
    if (generation === listGeneration) loading.value = false;
  }
}

/* ---------- 详情抽屉 ---------- */
const drawerOpen = ref(false);
const detail = ref<NightOrderDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const detailTarget = ref<NightOrderRow | null>(null);
async function openDetail(row: NightOrderRow) {
  const generation = ++detailGeneration;
  detailTarget.value = row;
  detailError.value = '';
  drawerOpen.value = true;
  detail.value = null;
  detailLoading.value = true;
  try {
    const result = await api.nightOrderDetail(row.id);
    if (generation === detailGeneration) detail.value = result;
  } catch (e) {
    if (generation === detailGeneration) detailError.value = e instanceof Error ? e.message : '订单详情加载失败';
  } finally {
    if (generation === detailGeneration) detailLoading.value = false;
  }
}
const items = computed(() => detail.value?.items ?? []);
const timeline = computed(() => detail.value?.timeline ?? []);
const rejecting = ref(false);
async function rejectAfterSale() {
  if (!detail.value || rejecting.value) return;
  let reason: string;
  try { reason = (await ElMessageBox.prompt('填写核实结果，用户将收到审核说明。此操作不退款，已完成订单恢复结算资格。', '驳回售后申请', { inputType: 'textarea', inputValidator: value => value?.trim().length >= 5 && value.trim().length <= 200 ? true : '请填写5至200字审核说明', confirmButtonText: '确认驳回' })).value.trim(); }
  catch { return; }
  rejecting.value = true;
  try { detail.value = await api.nightRejectAfterSale(detail.value.id, reason); notify('审核结果已通知用户'); await load(); }
  catch (e) { notify(e instanceof Error ? e.message : '审核失败', 'error'); }
  finally { rejecting.value = false; }
}

/* ---------- 退款 ---------- */
const refundOpen = ref(false);
const refundForm = reactive({
  productRefund: 0,
  mode: "full" as "full" | "partial" | "fee",
  refundDeliveryFee: false,
  restock: true,
  reason: "",
});
function openRefund(row: NightOrderRow) {
  detail.value = null;
  void openDetailKeep(row);
  refundForm.mode = "full";
  refundForm.productRefund = 0;
  refundForm.refundDeliveryFee = row.status === 'exception';
  refundForm.restock = row.status !== 'exception';
  refundForm.reason = "";
  refundOpen.value = true;
}
/** 打开详情（静默：退款弹窗打开时同步拉详情做金额上下文，失败不弹错）。 */
async function openDetailKeep(row: NightOrderRow) {
  const generation = ++detailGeneration;
  detailLoading.value = true;
  try {
    const result = await api.nightOrderDetail(row.id);
    if (generation !== detailGeneration) return;
    detail.value = result;
    if (detail.value.refund?.status === "failed") {
      const prior = detail.value.refund;
      refundForm.mode = prior.fullProductRefund ? "full" : prior.productAmount === 0 ? "fee" : "partial";
      refundForm.productRefund = prior.productAmount / 100;
      refundForm.refundDeliveryFee = prior.deliveryFeeAmount > 0;
      refundForm.restock = prior.restock;
      refundForm.reason = prior.reason;
    }
  } catch {
    /* 详情失败不阻断退款弹窗 */
  } finally {
    if (generation === detailGeneration) detailLoading.value = false;
  }
}
/** 商品部分缺省上限 = 商品总额 − 券优惠（整单商品部分全额口径）。 */
const productRefundCap = computed(() =>
  detail.value ? detail.value.productAmount - detail.value.couponDiscount : 0,
);
const refundSaving = ref(false);
watch(() => refundForm.mode, mode => { if (mode !== "full") refundForm.restock = false; if (mode === 'fee') refundForm.refundDeliveryFee = true; });
const refundStateText = (state: string) => ({ requested: "等待提交", submitting: "渠道受理中", processing: "退款处理中", unknown: "结果待核对", succeeded: "退款已到账", failed: "退款未完成" }[state] || state);
const syncing = ref(false);
async function syncRefund() {
  if (!detail.value || syncing.value) return;
  syncing.value = true;
  try { detail.value = await api.nightRefundSync(detail.value.id); await load(); }
  catch (e) { notify(e instanceof Error ? e.message : "核对失败，请稍后重试", "error"); }
  finally { syncing.value = false; }
}
async function submitRefund() {
  if (refundSaving.value) return;
  if (!detail.value) {
    notify("订单详情尚未加载完成", "error");
    return;
  }
  const body: {
    productRefund?: number;
    refundDeliveryFee?: boolean;
    restock?: boolean;
    reason: string;
  } = {
    refundDeliveryFee: refundForm.refundDeliveryFee,
    restock: refundForm.restock,
    reason: refundForm.reason.trim(),
  };
  if (!body.reason) return notify("请填写退款原因", "error");
  if (refundForm.mode === 'fee') {
    if (!detail.value.deliveryFee) return notify('该订单没有配送费可退', 'error');
    body.productRefund = 0; body.refundDeliveryFee = true; body.restock = false;
  }
  if (refundForm.mode === "partial") {
    const amount = yuanToFen(refundForm.productRefund);
    if (!(amount >= 1)) return notify("退款金额必须大于 0", "error");
    if (amount > productRefundCap.value)
      return notify(`退款金额不可超过商品净实收 ¥${fenToYuan(productRefundCap.value)}`, "error");
    body.productRefund = amount;
  }
  try {
    await ElMessageBox.confirm(
      `将发起${refundForm.mode === 'fee' ? '仅配送费退款' : refundForm.mode === "partial" ? "部分退款" : "整单商品退款"}${
        refundForm.refundDeliveryFee ? "（含配送费）" : ""
      }，退款商品${refundForm.restock ? "回库" : "不回库"}。佣金按比例联动冲减。确认退款？`,
      "夜宵订单退款",
      { type: "warning", confirmButtonText: "确认退款", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  refundSaving.value = true;
  try {
    const result = await api.nightOrderRefund(detail.value.id, body);
    notify(result.refundStatus === "succeeded" ? "退款已到账，库存与佣金已同步" : result.refundStatus === "failed" ? result.message || "退款未完成，订单和库存保持原状态" : "退款正在核对，请在详情查看进度", result.refundStatus === "failed" ? "error" : "success");
    refundOpen.value = false;
    drawerOpen.value = false;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "退款失败", "error");
  } finally {
    refundSaving.value = false;
  }
}

function itemSummary(row: NightOrderRow) {
  return (row.items ?? [])
    .map((i) => `${i.name}×${i.quantity}`)
    .join("、");
}
function fmtTime(value?: string | null) {
  return fmtDateTime(value);
}

watch([page, pageSize], load);
watch([storeId, status, date, afterSaleStatus], () => {
  page.value = 1;
  void load();
});
watch(effectiveCampusId, () => { storeId.value = ''; stores.value = []; page.value = 1; drawerOpen.value = false; detail.value = null; detailGeneration++; void load(); void loadStores(); });
onMounted(() => {
  void load();
  void loadStores();
});
</script>
<template>
  <AdminPageShell
    title="夜宵订单"
    eyebrow="NIGHT ORDERS"
    description="楼栋夜宵店订单（YX 单号），与白天订单完全独立。"
  >
    <div v-if="!effectiveCampusId" class="empty-hint">请先在顶部选择校区。</div>
    <template v-else>
      <NightLoadError :message="loadError" :loading="loading" @retry="load" />
      <section class="admin-filter-panel" aria-label="夜宵订单筛选">
        <ElSegmented
          v-model="status"
          :options="STATUS_TABS.map((t) => ({ label: t.label, value: t.key }))"
          class="order-tabs"
        />
        <div class="order-filters">
          <ElInput v-model="keyword" clearable placeholder="单号 / 用户 / 手机 / 楼栋 / 寝室" style="max-width: 290px" @keyup.enter="page = 1; load()" @clear="page = 1; load()" />
          <ElButton @click="page = 1; load()">搜索</ElButton>
          <ElSelect
            v-model="storeId"
            clearable
            filterable
            placeholder="全部店铺"
            class="order-store"
          >
            <ElOption
              v-for="s in stores"
              :key="s.id"
              :label="s.buildingName"
              :value="s.id"
            />
          </ElSelect>
          <ElDatePicker
            v-model="date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="营业日（跨零点属前一晚）"
            clearable
          />
          <ElSelect v-model="afterSaleStatus" clearable placeholder="全部售后状态" style="width: 170px">
            <ElOption label="用户待处理售后" value="requested" /><ElOption label="退款处理中" value="refund-processing" /><ElOption label="售后已处理" value="resolved" /><ElOption label="售后已驳回" value="rejected" /><ElOption label="用户已撤销" value="withdrawn" />
          </ElSelect>
        </div>
      </section>
      <section class="admin-table-panel" aria-label="夜宵订单列表">
        <ElTable
          v-loading="loading"
          :data="rows"
          row-key="id"
          empty-text="暂无夜宵订单"
        >
          <ElTableColumn label="单号" min-width="170">
            <template #default="{ row }">
              <span class="mono">{{ row.orderNo }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="楼栋" min-width="110">
            <template #default="{ row }">{{ row.store?.buildingName || "—" }}</template>
          </ElTableColumn>
          <ElTableColumn label="用户" min-width="130">
            <template #default="{ row }">
              <template v-if="row.user">{{ row.user.nickname || row.user.id }}</template>
              <template v-else>—</template>
            </template>
          </ElTableColumn>
          <ElTableColumn label="商品" min-width="200">
            <template #default="{ row }">
              <span class="item-summary">{{ itemSummary(asOrder(row)) }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="商品额" width="90">
            <template #default="{ row }">¥{{ fenToYuan(row.productAmount) }}</template>
          </ElTableColumn>
          <ElTableColumn label="券优惠" width="90">
            <template #default="{ row }">{{
              row.couponDiscount ? `−¥${fenToYuan(row.couponDiscount)}` : "—"
            }}</template>
          </ElTableColumn>
          <ElTableColumn label="配送费" width="90">
            <template #default="{ row }">¥{{ fenToYuan(row.deliveryFee) }}</template>
          </ElTableColumn>
          <ElTableColumn label="实付" width="100">
            <template #default="{ row }"><b>¥{{ fenToYuan(row.payableAmount) }}</b></template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="100">
            <template #default="{ row }">
              <ElTag :type="nightOrderStatus(row.status).tag">{{
                row.statusText || nightOrderStatus(row.status).text
              }}</ElTag>
              <ElTag v-if="row.afterSaleStatus === 'requested'" size="small" type="warning">待处理售后</ElTag>
              <ElTag v-else-if="row.afterSaleStatus === 'refund-processing'" size="small" type="warning">退款核对中</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="营业日" width="100" prop="businessDate" />
          <ElTableColumn label="下单时间" min-width="150">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <ElButton link type="primary" @click="openDetail(asOrder(row))">详情</ElButton>
              <ElButton
                v-if="
                  hasPerm('POST /admin/night/orders/:id/refund') &&
                  (!row.refund || (row.refund.status === 'failed' && row.refund.kind === 'admin')) &&
                  ['pending-accept', 'delivering', 'delivered', 'completed', 'exception'].includes(row.status)
                "
                link
                type="danger"
                @click="openRefund(asOrder(row))"
                >退款</ElButton
              >
            </template>
          </ElTableColumn>
        </ElTable>
        <AdminPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="total"
        />
      </section>
    </template>

    <!-- 详情抽屉 -->
    <ElDrawer v-model="drawerOpen" title="夜宵订单详情" size="min(680px, 92vw)">
      <NightLoadError :message="detailError" :loading="detailLoading" @retry="detailTarget && openDetail(detailTarget)" />
      <p v-if="detailLoading && !detail" class="form-hint">加载中…</p>
      <template v-else-if="detail">
        <div class="detail-head">
          <div>
            <div class="detail-order-no mono">{{ detail.orderNo }}</div>
            <div class="muted">营业日 {{ detail.businessDate }} · 佣金比例 {{ detail.commissionRate / 100 }}%</div>
          </div>
          <ElTag :type="nightOrderStatus(detail.status).tag">{{
            detail.statusText || nightOrderStatus(detail.status).text
          }}</ElTag>
        </div>
        <div class="detail-grid">
          <div class="detail-cell">
            <span class="detail-cell-label">下单</span>
            <span>{{ fmtTime(detail.createdAt) }}</span>
          </div>
          <div class="detail-cell">
            <span class="detail-cell-label">支付</span>
            <span>{{ fmtTime(detail.paidAt) }}</span>
          </div>
          <div class="detail-cell">
            <span class="detail-cell-label">完成</span>
            <span>{{ fmtTime(detail.completedAt) }}</span>
          </div>
          <div class="detail-cell">
            <span class="detail-cell-label">楼长</span>
            <span>{{ detail.manager ? `${detail.manager.name}（${detail.manager.staffNo}）` : "—" }}</span>
          </div>
          <div class="detail-cell">
            <span class="detail-cell-label">收货</span>
            <span>{{
              detail.address
                ? `${detail.address.buildingName || ""} ${detail.address.room || ""} ${detail.address.contactName || ""}${detail.address.phone ? ` ${detail.address.phone}` : ""}`
                : "—"
            }}</span>
          </div>
          <div v-if="detail.remark" class="detail-cell">
            <span class="detail-cell-label">备注</span>
            <span>{{ detail.remark }}</span>
          </div>
          <div v-if="detail.cancelReason" class="detail-cell">
            <span class="detail-cell-label">取消原因</span>
            <span>{{ detail.cancelReason }}</span>
          </div>
          <div v-if="detail.afterSaleStatus" class="detail-cell">
            <span class="detail-cell-label">售后</span>
            <span>{{
              detail.afterSaleStatus === "requested"
                ? "用户已申请售后"
                : detail.afterSaleStatus === 'refund-processing' ? '退款处理中' : detail.afterSaleStatus === 'resolved' ? '已处理' : detail.afterSaleStatus === 'rejected' ? '已驳回' : detail.afterSaleStatus === 'withdrawn' ? '用户已撤销' : detail.afterSaleStatus
            }}</span>
          </div>
        </div>

        <div v-if="detail.afterSaleStatus === 'requested'" style="display: flex; gap: 12px; margin-bottom: 16px">
          <ElButton v-if="hasPerm('POST /admin/night/orders/:id/refund')" type="danger" @click="openRefund(detail)">核实后退款</ElButton>
          <ElButton v-if="hasPerm('POST /admin/night/orders/:id/after-sale/reject')" :loading="rejecting" @click="rejectAfterSale">驳回并说明原因</ElButton>
        </div>

        <ElAlert v-if="detail.refund" :title="`${refundStateText(detail.refund.status)} · ¥${fenToYuan(detail.refund.amount)}`" :type="detail.refund.status === 'succeeded' ? 'success' : detail.refund.status === 'failed' ? 'error' : 'warning'" :closable="false" show-icon>
          <p>{{ detail.refund.message || (detail.refund.status === 'succeeded' ? '退款已确认，相关库存、券和佣金已同步。' : '资金尚未确认到账，库存和佣金不会提前结算。') }}</p>
          <ElButton v-if="!['succeeded', 'failed'].includes(detail.refund.status) && hasPerm('POST /admin/night/orders/:id/refund/sync')" :loading="syncing" @click="syncRefund">核对退款进度</ElButton>
        </ElAlert>

        <h4 class="detail-section">商品快照</h4>
        <ElTable :data="items" row-key="nightProductId" size="small">
          <ElTableColumn label="商品" min-width="160" prop="name" />
          <ElTableColumn label="夜宵售价" width="100">
            <template #default="{ row }">¥{{ fenToYuan(row.price) }}</template>
          </ElTableColumn>
          <ElTableColumn label="数量" width="70" prop="quantity" />
          <ElTableColumn label="小计" width="100">
            <template #default="{ row }">¥{{ fenToYuan(row.price * row.quantity) }}</template>
          </ElTableColumn>
        </ElTable>

        <h4 class="detail-section">金额</h4>
        <div class="amount-grid">
          <div class="amount-cell">
            <span>商品总额</span><b>¥{{ fenToYuan(detail.productAmount) }}</b>
          </div>
          <div class="amount-cell">
            <span>券优惠</span><b>−¥{{ fenToYuan(detail.couponDiscount) }}</b>
          </div>
          <div class="amount-cell">
            <span>配送费</span><b>¥{{ fenToYuan(detail.deliveryFee) }}</b>
          </div>
          <div class="amount-cell amount-cell--main">
            <span>实付</span><b>¥{{ fenToYuan(detail.payableAmount) }}</b>
          </div>
        </div>
        <p v-if="detail.couponSnapshot" class="form-hint">
          券：{{ detail.couponSnapshot.name }}
          <template v-if="detail.couponSnapshot.amount">
            （面额 ¥{{ fenToYuan(detail.couponSnapshot.amount) }}<template v-if="detail.couponSnapshot.threshold"
              >，门槛 ¥{{ fenToYuan(detail.couponSnapshot.threshold) }}</template
            >）
          </template>
        </p>

        <h4 class="detail-section">佣金流水</h4>
        <ElTable :data="detail.commissionTxns" row-key="id" size="small" empty-text="暂无佣金流水">
          <ElTableColumn label="类别" width="100">
            <template #default="{ row }">{{
              row.type === "commission" ? "商品佣金" : "配送费"
            }}</template>
          </ElTableColumn>
          <ElTableColumn label="基数/比例" min-width="120">
            <template #default="{ row }">
              {{
                row.type === "commission" && row.base != null
                  ? `¥${fenToYuan(row.base)}×${(row.rate ?? 0) / 100}%`
                  : "—"
              }}
            </template>
          </ElTableColumn>
          <ElTableColumn label="金额" width="100">
            <template #default="{ row }">¥{{ fenToYuan(row.amount) }}</template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="90">
            <template #default="{ row }">
              <ElTag size="small" :type="row.status === 'settled' ? 'success' : row.status === 'pending' ? 'warning' : 'info'">{{
                row.status === "estimated" ? "预计" : row.status === "pending" ? "待结算" : "已结算"
              }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="批次" min-width="140">
            <template #default="{ row }">{{ row.settleBatch || "—" }}</template>
          </ElTableColumn>
        </ElTable>

        <h4 class="detail-section">时间线</h4>
        <ol class="timeline">
          <li v-for="(step, i) in timeline" :key="`${step.key}-${i}`">
            <span class="timeline-dot" />
            <span class="timeline-title">{{ step.title }}</span>
            <span v-if="step.time || step.key === 'submit'" class="muted">{{ fmtTime(step.time || detail.createdAt) }}</span>
            <p v-if="step.description" style="white-space: pre-wrap; word-break: break-word; width: 100%">{{ step.description }}</p>
            <p v-if="step.requestedAmount != null" class="muted">申请商品退款 ¥{{ (step.requestedAmount / 100).toFixed(2) }}（实际以审核核定为准）</p>
            <p v-if="step.requestedItems?.length" class="muted">{{ step.requestedItems.map(item => `${item.name} × ${item.quantity}`).join('、') }}</p>
            <div v-if="step.images?.length || step.proof?.images?.length" style="display: flex; flex-wrap: wrap; gap: 8px; width: 100%">
              <ElImage v-for="url in step.images || step.proof?.images" :key="url" :src="url" :preview-src-list="step.images || step.proof?.images" preview-teleported fit="cover" style="width: 88px; height: 88px; border-radius: 12px" />
            </div>
          </li>
        </ol>
      </template>
      <p v-else class="form-hint">详情加载失败。</p>
    </ElDrawer>

    <!-- 退款弹窗 -->
    <ElDialog
      v-model="refundOpen"
      title="夜宵订单退款"
      width="min(560px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <template v-if="detail">
        <p class="form-hint">
          {{ detail.orderNo }} · 商品净实收 ¥{{ fenToYuan(productRefundCap) }} · 配送费 ¥{{ fenToYuan(detail.deliveryFee) }}
        </p>
        <ElForm label-position="top">
          <ElFormItem label="商品退款">
            <ElRadioGroup v-model="refundForm.mode">
              <ElRadio value="full">整单（¥{{ fenToYuan(productRefundCap) }}）</ElRadio>
              <ElRadio value="partial">部分（自定金额）</ElRadio>
              <ElRadio value="fee" :disabled="!detail.deliveryFee">仅退配送费</ElRadio>
            </ElRadioGroup>
          </ElFormItem>
          <ElFormItem v-if="refundForm.mode === 'partial'" label="退款金额（元）">
            <ElInputNumber
              v-model="refundForm.productRefund"
              :min="0.01"
              :max="productRefundCap / 100"
              :precision="2"
            />
          </ElFormItem>
          <ElFormItem label="配送费">
            <ElCheckbox v-model="refundForm.refundDeliveryFee"
              :disabled="refundForm.mode === 'fee'"
              >同时退配送费（触发楼长侧佣金冲回）</ElCheckbox
            >
          </ElFormItem>
          <ElFormItem label="回库">
            <ElCheckbox v-model="refundForm.restock"
              :disabled="refundForm.mode !== 'full' || detail.status === 'exception'"
              >退款商品回库（已送出/损耗场景取消勾选，只退钱不回库）</ElCheckbox
            >
          </ElFormItem>
          <p class="form-hint">一期每单支持一次退款；部分退款不自动回库。渠道确认成功后才同步库存、优惠券与佣金。</p>
          <ElFormItem label="退款原因（留痕）">
            <ElInput
              v-model="refundForm.reason"
              maxlength="200"
              show-word-limit
              placeholder="如：商品缺失 / 用户取消 / 未履约"
            />
          </ElFormItem>
        </ElForm>
      </template>
      <p v-else class="form-hint">订单详情加载中…</p>
      <template #footer>
        <ElButton @click="refundOpen = false">取消</ElButton>
        <ElButton type="danger" :loading="refundSaving" @click="submitRefund"
          >确认退款</ElButton
        >
      </template>
    </ElDialog>
  </AdminPageShell>
</template>
<style scoped>
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.order-tabs {
  flex: 1 1 100%;
}
.order-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
}
.order-store {
  width: 220px;
}
.order-filters :deep(.el-date-editor) {
  width: 220px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.item-summary {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.form-hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0;
}
.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.detail-order-no {
  font-size: 15px;
  font-weight: 700;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin-bottom: 14px;
}
.detail-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.detail-cell-label {
  color: var(--muted);
  font-size: 12px;
}
.detail-section {
  margin: 18px 0 8px;
  font-size: 14px;
}
.amount-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.amount-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fbfdfb;
  font-size: 12px;
  color: var(--muted);
}
.amount-cell b {
  font-size: 15px;
  color: var(--text, #1f2937);
}
.amount-cell--main b {
  color: #07883b;
  font-size: 17px;
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.timeline li {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 6px 0 6px 18px;
  font-size: 13px;
}
.timeline li::before {
  content: "";
  position: absolute;
  left: 5px;
  top: 14px;
  bottom: -6px;
  width: 1px;
  background: var(--line);
}
.timeline li:last-child::before {
  display: none;
}
.timeline-dot {
  position: absolute;
  left: 2px;
  top: 11px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #07883b;
}
@media (max-width: 760px) {
  .order-filters {
    align-items: stretch;
    flex-direction: column;
  }
  .order-store,
  .order-filters :deep(.el-date-editor) {
    width: 100%;
  }
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .amount-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
