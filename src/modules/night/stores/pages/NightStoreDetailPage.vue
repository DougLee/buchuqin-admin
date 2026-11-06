<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { api, fetchAllPages } from "../../../../api";
import { hasPerm } from "../../../../session";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import {
  NIGHT_STOCK_TXN_TYPE,
  depositTxnView,
  nightOrderStatus,
  nightStoreStatus,
  rateText,
} from "../../night-shared";
import type {
  NightCatalogRow,
  NightLiquidation,
  NightStockTxnRow,
  NightStoreDetail,
  NightStoreProductRow,
  Staff,
} from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";

/**
 * 夜宵店详情（IKSW1F，路由 /night-stores/:id）：区块化 Tab——
 * 基础信息（佣金/换楼长/停业）/ 商品与库存 / 押金 / 佣金 / 备货与流水 / 退出清算。
 * 退出清算为人工流程支撑：页面提供清单视图与操作入口，不做自动清算。
 */
const route = useRoute();
const router = useRouter();
const storeId = String(route.params.id ?? "");
const detail = ref<NightStoreDetail | null>(null);
const loading = ref(false);
const activeTab = ref(route.query.tab === "products" ? "products" : "basic");
const canWrite = computed(() => hasPerm("PATCH /admin/night/stores/:id"));

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

/** ElTable 作用域槽 row 兜底断言（同 CouponPage asCoupon 模式）。 */
function asStoreProduct(row: unknown) {
  return row as NightStoreProductRow;
}

async function load() {
  if (!storeId) return;
  loading.value = true;
  try {
    detail.value = await api.nightStoreDetail(storeId);
    // 基础信息 Tab 的换楼长下拉（懒加载一次；loadManagers 自带 detail 判空与去重）
    void loadManagers();
  } catch (e) {
    notify(e instanceof Error ? e.message : "店铺详情加载失败", "error");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function goBack() {
  void router.push("/night-stores");
}

/* ---------- 基础信息：佣金比例 / 换楼长 / 停业 ---------- */
const basicForm = reactive({ commissionPercent: 0, managerStaffId: "" });
watch(detail, (d) => {
  if (!d) return;
  basicForm.commissionPercent = d.commissionRate / 100;
  basicForm.managerStaffId = d.manager?.id ?? "";
});
const managers = ref<Staff[]>([]);
const managersLoading = ref(false);
async function loadManagers() {
  if (managers.value.length || !detail.value) return;
  managersLoading.value = true;
  try {
    // 后端 assertManager：本校区在职 building-manager / intern-building-manager
    const [m1, m2] = await Promise.all([
      fetchAllPages(
        (q) =>
          api.staff({
            ...q,
            role: "building-manager",
            campusId: detail.value!.campusId,
          }),
        100,
      ),
      fetchAllPages(
        (q) =>
          api.staff({
            ...q,
            role: "intern-building-manager",
            campusId: detail.value!.campusId,
          }),
        100,
      ),
    ]);
    managers.value = [...m1, ...m2];
  } catch (e) {
    notify(e instanceof Error ? e.message : "楼长列表加载失败", "error");
  } finally {
    managersLoading.value = false;
  }
}
const managerChanged = computed(
  () => (basicForm.managerStaffId || "") !== (detail.value?.manager?.id ?? ""),
);
async function saveBasic() {
  if (!detail.value) return;
  const rate = Math.round(basicForm.commissionPercent * 100);
  if (!(rate >= 0 && rate <= 10000))
    return notify("佣金比例须在 0~100 之间", "error");
  saving.value = true;
  try {
    const body: { commissionRate?: number; managerStaffId?: string | null } =
      {};
    if (rate !== detail.value.commissionRate) body.commissionRate = rate;
    if (managerChanged.value)
      body.managerStaffId = basicForm.managerStaffId || null;
    if (!Object.keys(body).length) {
      notify("没有需要保存的变更");
      return;
    }
    if (body.managerStaffId === null) {
      try {
        await ElMessageBox.confirm(
          "解绑后店铺进入「招募中」，学生端不可下单。确认解绑楼长？",
          "解绑楼长",
          {
            type: "warning",
            confirmButtonText: "确认解绑",
            cancelButtonText: "取消",
          },
        );
      } catch {
        return;
      }
    } else if (body.managerStaffId) {
      try {
        await ElMessageBox.confirm(
          "换绑将斩断原楼长与店铺的关联（交接语义：换人前应先完成清算）。确认换绑？",
          "换绑楼长",
          {
            type: "warning",
            confirmButtonText: "确认换绑",
            cancelButtonText: "取消",
          },
        );
      } catch {
        return;
      }
    }
    await api.updateNightStore(storeId, body);
    notify("基础信息已更新");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function setStatus(status: "closed" | "suspended") {
  if (!detail.value) return;
  const label =
    status === "suspended"
      ? "停业（学生端不可见）"
      : "恢复为打烊（楼长可自行开店）";
  try {
    await ElMessageBox.confirm(`确认将店铺置为「${label}」？`, "营业状态变更", {
      type: "warning",
      confirmButtonText: "确认",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  saving.value = true;
  try {
    await api.updateNightStore(storeId, { status });
    notify("营业状态已更新");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", "error");
  } finally {
    saving.value = false;
  }
}

/* ---------- 商品与库存 ---------- */
const products = computed(() => detail.value?.products ?? []);
const productKeyword = ref(""),
  productFilter = ref("");
const visibleProducts = computed(() =>
  products.value.filter(
    (p) =>
      p.catalogProduct.name
        .toLowerCase()
        .includes(productKeyword.value.trim().toLowerCase()) &&
      (!productFilter.value ||
        (productFilter.value === "available"
          ? p.stock > 0
          : productFilter.value === "empty"
            ? p.stock === 0
            : productFilter.value === "frozen"
              ? p.frozenStock > 0
              : productFilter.value === "stopped"
                ? !p.saleAllowed
                : !p.onShelf)),
  ),
);
const attachOpen = ref(false);
const catalogRows = ref<NightCatalogRow[]>([]);
const catalogLoading = ref(false);
const attachChecked = ref<Record<string, boolean>>({});
async function openAttach() {
  attachOpen.value = true;
  attachChecked.value = {};
  catalogLoading.value = true;
  try {
    catalogRows.value = await fetchAllPages(
      (q) => api.nightCatalog(undefined, q.page, q.pageSize),
      100,
    );
  } catch (e) {
    notify(e instanceof Error ? e.message : "夜主档加载失败", "error");
  } finally {
    catalogLoading.value = false;
  }
}
const attachedCatalogIds = computed(
  () => new Set(products.value.map((p) => p.catalogProductId)),
);
const attachSelected = computed(() =>
  Object.keys(attachChecked.value).filter((k) => attachChecked.value[k]),
);
const attachSaving = ref(false);
async function submitAttach() {
  const ids = attachSelected.value;
  if (!ids.length) return notify("请至少勾选一个夜主档商品", "error");
  attachSaving.value = true;
  try {
    const r = await api.attachNightStoreProducts(storeId, ids);
    notify(
      `已配置 ${r.attached} 个商品${r.skipped ? `（跳过已有 ${r.skipped} 个）` : ""}`,
    );
    attachOpen.value = false;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "配置失败", "error");
  } finally {
    attachSaving.value = false;
  }
}

/** 库存调整弹窗（delta 带方向 + 类型 + 原因）。 */
const adjustOpen = ref(false);
const adjustTarget = ref<{ id: string; name: string; stock: number } | null>(
  null,
);
const adjustForm = reactive({
  delta: 0,
  type: "adjust",
  reason: "",
});
const ADJUST_TYPES = [
  { value: "adjust", label: "后台调整（修正差异）" },
  { value: "returnOut", label: "退货出库（退供应商）" },
  { value: "loss", label: "报损（损耗核销）" },
  { value: "stocktake", label: "盘点（按差异±）" },
];
function openAdjust(id: string, name: string, stock: number) {
  adjustTarget.value = { id, name, stock };
  adjustForm.delta = 0;
  adjustForm.type = "adjust";
  adjustForm.reason = "";
  adjustOpen.value = true;
}
async function submitAdjust() {
  if (!adjustTarget.value) return;
  if (!adjustForm.delta) return notify("调整数量不能为 0", "error");
  if (!adjustForm.reason.trim()) return notify("请填写调整原因", "error");
  if (adjustTarget.value.stock + adjustForm.delta < 0)
    return notify("调整后库存不能为负数", "error");
  adjustSaving.value = true;
  try {
    await api.adjustNightStock(storeId, adjustTarget.value.id, {
      delta: Math.round(adjustForm.delta),
      type: adjustForm.type,
      reason: adjustForm.reason.trim(),
    });
    notify("库存已调整");
    adjustOpen.value = false;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "调整失败", "error");
  } finally {
    adjustSaving.value = false;
  }
}
const adjustSaving = ref(false);

async function toggleSaleAllowed(row: NightStoreProductRow) {
  try {
    await api.updateNightStoreProduct(storeId, row.id, !row.saleAllowed);
    notify(
      row.saleAllowed ? "已强制停售（优先于楼长上架选择）" : "已恢复售卖许可",
    );
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", "error");
  }
}

/* ---------- 备货与流水（stock-txns 近 200 条，前端过滤+分页） ---------- */
const txnsAll = ref<NightStockTxnRow[]>([]);
const txnsLoading = ref(false);
const txnTypeFilter = ref("");
const txnPage = ref(1);
const txnPageSize = ref(20);
const txnTypeName = (t: string) => NIGHT_STOCK_TXN_TYPE[t] ?? t;
async function loadTxns() {
  txnsLoading.value = true;
  try {
    txnsAll.value = await fetchAllPages(
      (q) => api.nightStockTxns(storeId, q.page, q.pageSize),
      100,
    );
  } catch (e) {
    notify(e instanceof Error ? e.message : "库存流水加载失败", "error");
  } finally {
    txnsLoading.value = false;
  }
}
const txnsFiltered = computed(() =>
  txnTypeFilter.value
    ? txnsAll.value.filter((t) => t.type === txnTypeFilter.value)
    : txnsAll.value,
);
const txnsPaged = computed(() => {
  const start = (txnPage.value - 1) * txnPageSize.value;
  return txnsFiltered.value.slice(start, start + txnPageSize.value);
});
watch(txnTypeFilter, () => {
  txnPage.value = 1;
});

/* ---------- 押金 ---------- */
const depositBalance = computed(() => detail.value?.deposit ?? 0);
const depositTxns = computed(() => detail.value?.depositTxns ?? []);
const deductOpen = ref(false);
const deductForm = reactive({ amount: 0, reason: "" });
const deductSaving = ref(false);
function openDeduct() {
  deductForm.amount = 0;
  deductForm.reason = "";
  deductOpen.value = true;
}
async function submitDeduct() {
  const amount = yuanToFen(deductForm.amount);
  if (!(amount >= 1)) return notify("扣除金额必须大于 0", "error");
  if (amount > depositBalance.value)
    return notify("扣除金额超过押金余额（不得扣到负数）", "error");
  if (!deductForm.reason.trim()) return notify("请填写判责事由", "error");
  try {
    await ElMessageBox.confirm(
      `判责扣除 ¥${fenToYuan(amount)} 将即时减少押金余额（押金=进货额度），并写入流水留痕。确认扣除？`,
      "押金判责扣除",
      {
        type: "warning",
        confirmButtonText: "确认扣除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }
  deductSaving.value = true;
  try {
    await api.nightDeductDeposit(storeId, amount, deductForm.reason.trim());
    notify("押金已扣除");
    deductOpen.value = false;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "扣除失败", "error");
  } finally {
    deductSaving.value = false;
  }
}
/** 押金退还（退出清算原路退；押金/清算两处共用）。 */
const refundOpen = ref(false);
const refundForm = reactive({
  mode: "full" as "full" | "partial",
  amount: 0,
  reason: "",
});
const refundSaving = ref(false);
function openRefund() {
  refundForm.mode = "full";
  refundForm.amount = 0;
  refundForm.reason = "";
  refundOpen.value = true;
}
async function submitRefund() {
  const amount =
    refundForm.mode === "full" ? undefined : yuanToFen(refundForm.amount);
  if (refundForm.mode === "partial" && !(amount && amount >= 1))
    return notify("退还金额必须大于 0", "error");
  if (refundForm.mode === "partial" && (amount ?? 0) > depositBalance.value)
    return notify("退还金额超过押金余额", "error");
  try {
    await ElMessageBox.confirm(
      `将按原路分配退还 ${refundForm.mode === "full" ? "全额" : `¥${fenToYuan(amount ?? 0)}`} 押金（微信原路退回，逐笔原子落账，中断可续）。确认退还？`,
      "押金退还（退出清算）",
      {
        type: "warning",
        confirmButtonText: "确认退还",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }
  refundSaving.value = true;
  try {
    const r = await api.nightRefundDeposit(
      storeId,
      amount,
      refundForm.reason.trim() || undefined,
    );
    notify(
      `已发起退还 ¥${fenToYuan(r.refunded)}，剩余押金 ¥${fenToYuan(r.deposit)}`,
    );
    refundOpen.value = false;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "退还失败", "error");
  } finally {
    refundSaving.value = false;
  }
}

/* ---------- 佣金 ---------- */
const COMMISSION_STATUS = [
  { key: "estimated", label: "预计（订单未完结）" },
  { key: "pending", label: "待结算（可出账）" },
  { key: "settled", label: "已结算（进批次）" },
];
const commissionRows = computed(() => {
  const summary = detail.value?.commissionSummary ?? {};
  return COMMISSION_STATUS.map((s) => ({
    label: s.label,
    status: s.key,
    commission: summary.commission?.[s.key] ?? 0,
    deliveryFee: summary.deliveryFee?.[s.key] ?? 0,
    total:
      (summary.commission?.[s.key] ?? 0) + (summary.deliveryFee?.[s.key] ?? 0),
  }));
});

/* ---------- 退出清算 ---------- */
const liq = ref<NightLiquidation | null>(null);
const liqLoading = ref(false);
async function loadLiq() {
  liqLoading.value = true;
  try {
    liq.value = await api.nightLiquidation(storeId);
  } catch (e) {
    notify(e instanceof Error ? e.message : "清算清单加载失败", "error");
  } finally {
    liqLoading.value = false;
  }
}
watch(activeTab, (tab) => {
  if (tab === "stock" && !txnsAll.value.length) void loadTxns();
  if (tab === "liquidation" && !liq.value) void loadLiq();
  if (tab === "basic") void loadManagers();
});
const liqCommissionRows = computed(() =>
  Object.entries(liq.value?.commission ?? {}).map(([key, amount]) => {
    const [type, status] = key.split(":");
    return {
      key,
      label: `${type === "commission" ? "商品佣金" : "配送费"}（${
        status === "estimated"
          ? "预计"
          : status === "pending"
            ? "待结算"
            : "已结算"
      }）`,
      amount,
    };
  }),
);
const saving = ref(false);
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <ElButton text @click="goBack">← 返回店铺列表</ElButton>
        <h1 class="detail-title">
          夜宵店·{{ detail?.buildingName || "加载中…" }}
          <ElTag
            v-if="detail"
            class="detail-tag"
            :type="nightStoreStatus(detail.status).tag"
            >{{ nightStoreStatus(detail.status).text }}</ElTag
          >
        </h1>
        <p v-if="detail" class="detail-sub">
          押金余额 ¥{{ fenToYuan(detail.deposit) }} · 佣金比例
          {{ rateText(detail.commissionRate) }}
          <template v-if="detail.manager">
            · 楼长 {{ detail.manager.name }}（{{
              detail.manager.staffNo
            }}）</template
          >
          <template v-else>· 楼长招募中</template>
        </p>
      </div>
    </div>
    <p v-if="loading && !detail" class="form-hint">加载中…</p>
    <p v-else-if="!detail" class="form-hint">店铺不存在或无权访问。</p>
    <template v-else>
      <nav class="detail-tabs single-line-tabs" aria-label="店铺详情分区">
        <ElButton
          v-for="t in [
            { key: 'basic', label: '基础信息' },
            { key: 'products', label: '商品与库存' },
            { key: 'deposit', label: '押金' },
            { key: 'commission', label: '佣金' },
            { key: 'stock', label: '备货与流水' },
            { key: 'liquidation', label: '退出清算' },
          ]"
          :key="t.key"
          text
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
          >{{ t.label }}</ElButton
        >
      </nav>

      <!-- 基础信息 -->
      <section v-if="activeTab === 'basic'" class="detail-panel">
        <ElForm label-position="top">
          <ElRow :gutter="16">
            <ElCol :xs="24" :sm="12" :lg="8">
              <ElFormItem label="佣金比例（%，按券后商品净实收计）">
                <ElInputNumber
                  v-model="basicForm.commissionPercent"
                  :min="0"
                  :max="100"
                  :step="0.5"
                  :precision="1"
                  :disabled="!canWrite"
                />
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :sm="12" :lg="8">
              <ElFormItem
                label="楼长（换绑=解绑重绑，交接前应先清算；清空=解绑转招募中）"
              >
                <ElSelect
                  v-model="basicForm.managerStaffId"
                  filterable
                  clearable
                  :loading="managersLoading"
                  :disabled="!canWrite"
                  placeholder="选择本校区在职楼长"
                >
                  <ElOption
                    v-for="s in managers"
                    :key="s.id"
                    :label="`${s.name}（${s.staffNo}）`"
                    :value="s.id"
                  />
                </ElSelect>
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :sm="12" :lg="8">
              <ElFormItem label="营业状态（营业恢复走楼长开店）">
                <div class="status-ops">
                  <ElTag :type="nightStoreStatus(detail.status).tag">{{
                    nightStoreStatus(detail.status).text
                  }}</ElTag>
                  <ElButton
                    v-if="canWrite && detail.status !== 'suspended'"
                    size="small"
                    type="danger"
                    plain
                    @click="setStatus('suspended')"
                    >停业</ElButton
                  >
                  <ElButton
                    v-else-if="canWrite"
                    size="small"
                    @click="setStatus('closed')"
                    >恢复打烊</ElButton
                  >
                </div>
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :sm="12" :lg="8">
              <ElFormItem label="楼长电话">
                <ElInput :model-value="detail.manager?.phone || '—'" disabled />
              </ElFormItem>
            </ElCol>
            <ElCol :xs="24" :sm="12" :lg="8">
              <ElFormItem label="距下一押金档差额">
                <ElInput
                  :model-value="`¥${fenToYuan(detail.depositGapToNextTier)}`"
                  disabled
                />
              </ElFormItem>
            </ElCol>
          </ElRow>
        </ElForm>
        <ElButton
          v-if="canWrite"
          type="primary"
          :loading="saving"
          @click="saveBasic"
          >保存基础信息</ElButton
        >
        <p v-else class="form-hint">当前账号没有夜宵店铺管理权限</p>
      </section>

      <!-- 商品与库存 -->
      <section v-else-if="activeTab === 'products'" class="detail-panel">
        <div class="panel-toolbar">
          <span class="muted">
            库存按历史入库货值占用额度；备货待收、待配送和损耗冻结另行占用，调价不重估旧库存。
          </span>
          <ElButton
            v-if="hasPerm('POST /admin/night/stores/:id/products')"
            type="primary"
            @click="openAttach"
            >配商品（从夜主档勾选）</ElButton
          >
        </div>
        <div style="display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0">
          <ElInput
            v-model="productKeyword"
            placeholder="搜索本楼商品名称"
            clearable
            style="width: 240px"
          /><ElSelect
            v-model="productFilter"
            placeholder="全部库存 / 售卖状态"
            clearable
            style="width: 220px"
            ><ElOption label="有可售库存" value="available" /><ElOption
              label="可售库存为0"
              value="empty" /><ElOption
              label="有冻结库存"
              value="frozen" /><ElOption
              label="校区已停售"
              value="stopped" /><ElOption
              label="楼长已下架"
              value="off" /></ElSelect
          ><ElButton
            @click="
              productKeyword = '';
              productFilter = '';
            "
            >重置筛选</ElButton
          >
        </div>
        <ElTable
          :data="visibleProducts"
          row-key="id"
          empty-text="没有符合筛选条件的商品，可调整条件或配置商品"
        >
          <ElTableColumn
            label="商品"
            min-width="200"
            prop="catalogProduct.name"
          />
          <ElTableColumn label="夜宵售价" width="110">
            <template #default="{ row }"
              >¥{{ fenToYuan(row.catalogProduct.price) }}</template
            >
          </ElTableColumn>
          <ElTableColumn label="可售" width="80" prop="stock" />
          <ElTableColumn label="冻结" width="80" prop="frozenStock" />
          <ElTableColumn label="历史货值" width="110"
            ><template #default="{ row }"
              >¥{{ fenToYuan(row.inventoryValue) }}</template
            ></ElTableColumn
          >
          <ElTableColumn label="楼长上架" width="100">
            <template #default="{ row }">
              <ElTag :type="row.onShelf ? 'success' : 'info'" size="small">{{
                row.onShelf ? "已上架" : "已下架"
              }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="售卖许可" width="110">
            <template #default="{ row }">
              <ElTag
                :type="row.saleAllowed ? 'success' : 'danger'"
                size="small"
                >{{ row.saleAllowed ? "允许" : "强制停售" }}</ElTag
              >
            </template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <ElButton
                v-if="
                  hasPerm(
                    'POST /admin/night/stores/:id/products/:productId/stock',
                  )
                "
                link
                type="primary"
                @click="
                  openAdjust(
                    asStoreProduct(row).id,
                    asStoreProduct(row).catalogProduct.name,
                    asStoreProduct(row).stock,
                  )
                "
                >调整库存</ElButton
              >
              <ElButton
                v-if="
                  hasPerm('PATCH /admin/night/stores/:id/products/:productId')
                "
                link
                :type="row.saleAllowed ? 'danger' : 'success'"
                @click="toggleSaleAllowed(asStoreProduct(row))"
                >{{ row.saleAllowed ? "强制停售" : "恢复售卖" }}</ElButton
              >
            </template>
          </ElTableColumn>
        </ElTable>
      </section>

      <!-- 押金 -->
      <section v-else-if="activeTab === 'deposit'" class="detail-panel">
        <div class="deposit-head">
          <div class="deposit-balance">
            <span class="deposit-label">押金余额</span>
            <span class="deposit-amount">¥{{ fenToYuan(depositBalance) }}</span>
            <span class="muted">押金=进货额度：库存×售价 ≤ 押金</span>
          </div>
          <div class="deposit-ops">
            <ElButton
              v-if="hasPerm('POST /admin/night/stores/:id/deposit/deduct')"
              type="danger"
              plain
              @click="openDeduct"
              >判责扣除</ElButton
            >
            <ElButton
              v-if="hasPerm('POST /admin/night/stores/:id/deposit/refund')"
              type="warning"
              plain
              @click="openRefund"
              >押金退还</ElButton
            >
          </div>
        </div>
        <ElTable
          :data="depositTxns"
          row-key="id"
          empty-text="暂无押金流水（楼长在小程序端按 500 元档缴纳）"
        >
          <ElTableColumn label="类型" width="120">
            <template #default="{ row }">
              <ElTag
                :type="depositTxnView(row.type).minus ? 'danger' : 'success'"
                size="small"
                >{{ depositTxnView(row.type).text }}</ElTag
              >
            </template>
          </ElTableColumn>
          <ElTableColumn label="金额" width="120">
            <template #default="{ row }">
              <span
                :class="
                  depositTxnView(row.type).minus
                    ? 'amount-minus'
                    : 'amount-plus'
                "
              >
                {{ depositTxnView(row.type).minus ? "−" : "+" }}¥{{
                  fenToYuan(row.amount)
                }}
              </span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="支付/退款单号" min-width="200">
            <template #default="{ row }">{{ row.payOrderNo || "—" }}</template>
          </ElTableColumn>
          <ElTableColumn label="事由/备注" min-width="200" prop="remark" />
          <ElTableColumn label="时间" min-width="150">
            <template #default="{ row }">{{
              row.createdAt ? row.createdAt.replace("T", " ").slice(0, 16) : "—"
            }}</template>
          </ElTableColumn>
        </ElTable>
        <p class="form-hint">
          余额恒等式：押金 ≈ Σ缴纳 − Σ判责扣除 − Σ退还；仅展示最近 50
          条，全量以流水账为准。
        </p>
      </section>

      <!-- 佣金 -->
      <section v-else-if="activeTab === 'commission'" class="detail-panel">
        <ElTable
          :data="commissionRows"
          row-key="status"
          empty-text="暂无佣金流水"
        >
          <ElTableColumn label="状态" min-width="200" prop="label" />
          <ElTableColumn label="商品佣金" width="130">
            <template #default="{ row }"
              >¥{{ fenToYuan(row.commission) }}</template
            >
          </ElTableColumn>
          <ElTableColumn label="配送费收入" width="130">
            <template #default="{ row }"
              >¥{{ fenToYuan(row.deliveryFee) }}</template
            >
          </ElTableColumn>
          <ElTableColumn label="小计" width="130">
            <template #default="{ row }">
              <b>¥{{ fenToYuan(row.total) }}</b>
            </template>
          </ElTableColumn>
        </ElTable>
        <p class="form-hint">
          佣金=券后商品净实收×店铺佣金比例；退款按比例冲减（adjust），退配送费触发冲回（clawback）。
          周账单出账与标记打款在「夜宵经营 → 夜宵结算」页操作。
        </p>
      </section>

      <!-- 备货与流水 -->
      <section v-else-if="activeTab === 'stock'" class="detail-panel">
        <div class="panel-toolbar">
          <span class="muted">
            备货记录=楼长端下单入库（stockIn，一步制：下单即入账）；全部库存变动以流水留痕（近
            200 条）。
          </span>
          <ElSegmented
            v-model="txnTypeFilter"
            :options="[
              { label: '全部流水', value: '' },
              { label: '备货入库', value: 'stockIn' },
              { label: '销售出库', value: 'saleOut' },
              { label: '退款回库', value: 'refundBack' },
              { label: '后台调整', value: 'adjust' },
            ]"
          />
        </div>
        <ElTable
          v-loading="txnsLoading"
          :data="txnsPaged"
          row-key="id"
          empty-text="暂无流水"
        >
          <ElTableColumn label="类型" width="110">
            <template #default="{ row }">{{ txnTypeName(row.type) }}</template>
          </ElTableColumn>
          <ElTableColumn label="变动" width="90">
            <template #default="{ row }">
              <span :class="row.delta >= 0 ? 'amount-plus' : 'amount-minus'">{{
                row.delta >= 0 ? `+${row.delta}` : row.delta
              }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="变动后库存" width="110" prop="afterStock" />
          <ElTableColumn label="原因/备注" min-width="200" prop="remark" />
          <ElTableColumn label="时间" min-width="150">
            <template #default="{ row }">{{
              row.createdAt ? row.createdAt.replace("T", " ").slice(0, 16) : "—"
            }}</template>
          </ElTableColumn>
        </ElTable>
        <AdminPagination
          v-model:page="txnPage"
          v-model:page-size="txnPageSize"
          :total="txnsFiltered.length"
        />
      </section>

      <!-- 退出清算 -->
      <section v-else-if="activeTab === 'liquidation'" class="detail-panel">
        <div class="panel-toolbar">
          <span class="muted">
            退出清算是人工流程：先清库存（退货/报损）、处理未完订单、佣金出账打款，最后退押金、解绑楼长。
          </span>
          <ElButton :loading="liqLoading" @click="loadLiq">刷新清单</ElButton>
        </div>
        <template v-if="liq">
          <ElRow :gutter="16" class="liq-stats">
            <ElCol :xs="12" :sm="6">
              <div class="liq-stat">
                <span class="liq-stat-label">押金余额</span>
                <b>¥{{ fenToYuan(liq.deposit) }}</b>
              </div>
            </ElCol>
            <ElCol :xs="12" :sm="6">
              <div class="liq-stat">
                <span class="liq-stat-label">剩余库存货值</span>
                <b>¥{{ fenToYuan(liq.stock.totalValue) }}</b>
              </div>
            </ElCol>
            <ElCol :xs="12" :sm="6">
              <div class="liq-stat">
                <span class="liq-stat-label">未完订单</span>
                <b>{{ liq.openOrders.reduce((s, o) => s + o.count, 0) }} 单</b>
              </div>
            </ElCol>
            <ElCol :xs="12" :sm="6">
              <div class="liq-stat">
                <span class="liq-stat-label">佣金余额（合计）</span>
                <b
                  >¥{{
                    fenToYuan(
                      Object.values(liq.commission).reduce((s, v) => s + v, 0),
                    )
                  }}</b
                >
              </div>
            </ElCol>
          </ElRow>
          <div class="liq-block">
            <h3>剩余库存（含货值）</h3>
            <ElTable
              :data="liq.stock.items"
              row-key="id"
              empty-text="无剩余库存"
            >
              <ElTableColumn label="商品" min-width="180" prop="name" />
              <ElTableColumn label="库存" width="90" prop="stock" />
              <ElTableColumn label="夜宵售价" width="110">
                <template #default="{ row }"
                  >¥{{ fenToYuan(row.price) }}</template
                >
              </ElTableColumn>
              <ElTableColumn label="货值" width="110">
                <template #default="{ row }"
                  >¥{{ fenToYuan(row.value) }}</template
                >
              </ElTableColumn>
            </ElTable>
            <p class="form-hint">
              清库存走「商品与库存」Tab 的库存调整（退货出库 / 报损）。
            </p>
          </div>
          <div class="liq-block">
            <h3>未完订单</h3>
            <ElTable
              :data="liq.openOrders"
              row-key="status"
              empty-text="无未完订单——可进入押金退还"
            >
              <ElTableColumn label="状态" min-width="140">
                <template #default="{ row }">{{
                  nightOrderStatus(row.status).text
                }}</template>
              </ElTableColumn>
              <ElTableColumn label="单数" width="100" prop="count" />
            </ElTable>
            <p class="form-hint">
              未完订单处理完（配送完成或后台退款）才可退押金。
            </p>
          </div>
          <div class="liq-block">
            <h3>佣金余额</h3>
            <ElTable
              :data="liqCommissionRows"
              row-key="key"
              empty-text="无佣金余额"
            >
              <ElTableColumn label="类别" min-width="200" prop="label" />
              <ElTableColumn label="金额" width="130">
                <template #default="{ row }"
                  >¥{{ fenToYuan(row.amount) }}</template
                >
              </ElTableColumn>
            </ElTable>
            <p class="form-hint">
              待结算佣金先在「夜宵结算」页出账、打款，再退押金。
            </p>
          </div>
          <div class="liq-block">
            <h3>清算操作</h3>
            <div class="deposit-ops">
              <ElButton
                v-if="hasPerm('POST /admin/night/stores/:id/deposit/refund')"
                type="warning"
                plain
                @click="openRefund"
                >押金退还（原路退）</ElButton
              >
              <ElButton
                v-if="canWrite && detail.manager"
                type="danger"
                plain
                @click="
                  basicForm.managerStaffId = '';
                  saveBasic();
                "
                >解绑楼长</ElButton
              >
            </div>
            <ul class="liq-hints">
              <li v-for="h in liq.hints" :key="h">{{ h }}</li>
            </ul>
          </div>
        </template>
        <p v-else class="form-hint">点「刷新清单」拉取退出清算视图。</p>
      </section>
    </template>

    <!-- 配商品 -->
    <ElDialog
      v-model="attachOpen"
      title="配商品（从夜主档勾选生成楼栋行）"
      width="min(640px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <p v-if="catalogLoading" class="form-hint">夜主档加载中…</p>
      <p v-else-if="!catalogRows.length" class="form-hint">
        夜主档池为空——先回「夜宵店铺 → 夜主档商品」建主档。
      </p>
      <template v-else>
        <div class="attach-list">
          <ElCheckbox
            v-for="c in catalogRows"
            :key="c.id"
            v-model="attachChecked[c.id]"
            :disabled="attachedCatalogIds.has(c.id) || c.status !== 'on-sale'"
          >
            <span class="attach-name">{{ c.name }}</span>
            <span class="muted">
              ¥{{ fenToYuan(c.price) }}
              {{
                attachedCatalogIds.has(c.id)
                  ? "· 已配置"
                  : c.status === "off-sale"
                    ? "· 主档已下架"
                    : ""
              }}
            </span>
          </ElCheckbox>
        </div>
        <p class="form-hint">
          新配楼栋行库存为 0，由楼长备货入库；初始上架状态由楼长控制。
        </p>
      </template>
      <template #footer>
        <ElButton @click="attachOpen = false">取消</ElButton>
        <ElButton
          v-if="hasPerm('POST /admin/night/stores/:id/products')"
          type="primary"
          :loading="attachSaving"
          :disabled="!attachSelected.length"
          @click="submitAttach"
          >确认配置（{{ attachSelected.length }}）</ElButton
        >
      </template>
    </ElDialog>

    <!-- 库存调整 -->
    <ElDialog
      v-model="adjustOpen"
      :title="`调整库存${adjustTarget ? `· ${adjustTarget.name}` : ''}`"
      width="min(520px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <p v-if="adjustTarget" class="form-hint">
        当前库存 {{ adjustTarget.stock }}
      </p>
      <ElForm label-position="top">
        <ElRow :gutter="16">
          <ElCol :span="12">
            <ElFormItem label="调整数量（正=入，负=出）">
              <ElInputNumber v-model="adjustForm.delta" :precision="0" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="12">
            <ElFormItem label="调整类型">
              <ElSelect v-model="adjustForm.type">
                <ElOption
                  v-for="t in ADJUST_TYPES"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="24">
            <ElFormItem label="原因（留痕）">
              <ElInput
                v-model="adjustForm.reason"
                maxlength="200"
                show-word-limit
                placeholder="如：盘点差异修正 / 供应商退货 / 运输破损"
              />
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>
      <template #footer>
        <ElButton @click="adjustOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="adjustSaving" @click="submitAdjust"
          >确认调整</ElButton
        >
      </template>
    </ElDialog>

    <!-- 判责扣除 -->
    <ElDialog
      v-model="deductOpen"
      title="押金判责扣除"
      width="min(480px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <p class="form-hint">
        当前押金余额 ¥{{ fenToYuan(depositBalance) }}（不得扣到负数）
      </p>
      <ElForm label-position="top">
        <ElFormItem label="扣除金额（元）">
          <ElInputNumber
            v-model="deductForm.amount"
            :min="0.01"
            :precision="2"
          />
        </ElFormItem>
        <ElFormItem label="判责事由（留痕）">
          <ElInput
            v-model="deductForm.reason"
            maxlength="200"
            show-word-limit
            placeholder="如：缺货判责 / 客诉赔付分摊"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="deductOpen = false">取消</ElButton>
        <ElButton type="danger" :loading="deductSaving" @click="submitDeduct"
          >确认扣除</ElButton
        >
      </template>
    </ElDialog>

    <!-- 押金退还 -->
    <ElDialog
      v-model="refundOpen"
      title="押金退还（退出清算）"
      width="min(520px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <p class="form-hint">
        当前押金余额 ¥{{ fenToYuan(depositBalance) }}。按原路分配退还：FIFO
        遍历缴纳流水逐笔微信原路退款，
        累计不超过各笔实缴；逐笔原子落账，中断可续。
      </p>
      <ElForm label-position="top">
        <ElFormItem label="退还金额">
          <ElRadioGroup v-model="refundForm.mode">
            <ElRadio value="full"
              >全额退（{{ fenToYuan(depositBalance) }} 元）</ElRadio
            >
            <ElRadio value="partial">部分退</ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem v-if="refundForm.mode === 'partial'" label="退还金额（元）">
          <ElInputNumber
            v-model="refundForm.amount"
            :min="0.01"
            :precision="2"
          />
        </ElFormItem>
        <ElFormItem label="事由（选填，留痕）">
          <ElInput
            v-model="refundForm.reason"
            maxlength="200"
            placeholder="如：楼长退出清算"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="refundOpen = false">取消</ElButton>
        <ElButton type="warning" :loading="refundSaving" @click="submitRefund"
          >确认退还</ElButton
        >
      </template>
    </ElDialog>
  </div>
</template>
<style scoped>
.detail-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.detail-tag {
  transform: translateY(-2px);
}
.detail-sub {
  color: var(--muted);
  font-size: 13px;
}
.detail-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  margin-bottom: 18px;
  padding: 10px;
  overflow-x: auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 8px 24px #163f2b08;
}
.detail-tabs button {
  flex: 0 0 auto;
  border-radius: 10px;
  min-height: 40px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
}
.detail-tabs button.active {
  background: #07883b;
  border-color: #07883b;
  color: #fff;
}
.detail-panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 8px 24px #163f2b08;
  overflow: hidden;
}
.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.status-ops {
  display: flex;
  align-items: center;
  gap: 10px;
}
.attach-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 6px;
  background: #fbfdfb;
}
.attach-list :deep(.el-checkbox) {
  display: flex;
  align-items: center;
  height: auto;
  margin-right: 0;
  padding: 7px 10px;
  border-radius: 8px;
}
.attach-list :deep(.el-checkbox__label) {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex: 1;
}
.attach-name {
  font-weight: 600;
}
.deposit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.deposit-balance {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.deposit-label {
  color: var(--muted);
  font-size: 13px;
}
.deposit-amount {
  font-size: 26px;
  font-weight: 700;
  color: #07883b;
}
.deposit-ops {
  display: flex;
  gap: 10px;
}
.amount-plus {
  color: #07883b;
  font-variant-numeric: tabular-nums;
}
.amount-minus {
  color: #d03050;
  font-variant-numeric: tabular-nums;
}
.liq-stats {
  margin-bottom: 6px;
}
.liq-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fbfdfb;
}
.liq-stat b {
  font-size: 18px;
}
.liq-stat-label {
  color: var(--muted);
  font-size: 12px;
}
.liq-block {
  margin-top: 18px;
}
.liq-block h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
.liq-hints {
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.9;
}
.form-hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0;
}
@media (max-width: 760px) {
  .detail-tabs,
  .detail-panel {
    border-radius: 14px;
  }
  .detail-panel {
    padding: 14px;
  }
}
</style>
