<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import {
  effectiveCampusId,
  hasPerm,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type {
  Category,
  Product,
  StocktakeReason,
  StocktakeStatGroup,
} from "../../../../types";
import { resolveImageUrl } from "../../../../utils/image";
import { fenToYuan } from "../../../../utils/money";

type StockAction = "stock-in" | "stocktake";
const rows = ref<Product[]>([]),
  categories = ref<Category[]>([]);
const loading = ref(false),
  saving = ref(false),
  dialogOpen = ref(false);
const page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref(""),
  categoryId = ref("");
const action = ref<StockAction>("stock-in");
/** #85：盘点原因收敛四选一枚举（后端 400 门控非法值），入库仍走自由文本备注。 */
const STOCKTAKE_REASONS: StocktakeReason[] = [
  "线下销售",
  "赠送",
  "货损",
  "丢损",
];
const form = reactive({
  productId: "",
  quantity: 1,
  /** 核减数量（正整数）：提交时换算 countedQty = 账面库存 − 核减数量。 */
  reduceQty: 1,
  reason: "",
  stocktakeReason: "" as StocktakeReason | "",
});
let generation = 0;
let keywordTimer: number | undefined;
const operationalCampusId = effectiveCampusId;
const canStockIn = computed(() => hasPerm("POST /admin/inventory/stock-in"));
const canStocktake = computed(() => hasPerm("POST /admin/inventory/stocktake"));
const title = computed(() =>
  action.value === "stock-in" ? "采购入库" : "库存盘点",
);

function asProduct(row: unknown) {
  return row as Product;
}
function stockOf(
  row: Product,
  key: "actualStock" | "lockedStock" | "availableStock",
) {
  return row[key] == null ? "—" : row[key];
}
function locationText(row: Product) {
  const code = (row as Product & { locationCode?: string }).locationCode;
  return [row.location, code].filter(Boolean).join("-") || "—";
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
async function load() {
  if (!operationalCampusId.value) {
    generation += 1;
    rows.value = [];
    total.value = 0;
    loading.value = false;
    return;
  }
  const request = ++generation;
  loading.value = true;
  try {
    const result = await api.inventory({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      categoryId: categoryId.value || undefined,
      campusId: operationalCampusId.value,
    });
    if (request === generation) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (error) {
    if (request === generation) {
      rows.value = [];
      total.value = 0;
      notify(error instanceof Error ? error.message : "库存加载失败", "error");
    }
  } finally {
    if (request === generation) loading.value = false;
  }
}
function openAction(next: StockAction, product?: Product) {
  action.value = next;
  Object.assign(form, {
    productId: product?.id ?? "",
    quantity: 1,
    reduceQty: 1,
    reason: "",
    stocktakeReason: "",
  });
  dialogOpen.value = true;
}
/** 当前行账面库存（优先实际库存，回退旧字段 stock）。 */
function bookQtyOf(productId: string) {
  const row = rows.value.find((item) => item.id === productId);
  return row?.actualStock ?? row?.stock ?? 0;
}
/** #85 只减不加：展示「账面 → 核减后」预览，核减超账面在提交前拦截。 */
const stocktakePreview = computed(() => {
  if (action.value !== "stocktake" || !form.productId) return null;
  const book = bookQtyOf(form.productId);
  return { book, after: book - (Number(form.reduceQty) || 0) };
});
async function submit() {
  if (!form.productId) {
    notify("请选择商品", "error");
    return;
  }
  const reason = form.reason.trim();
  if (action.value === "stock-in" && !reason) {
    notify("请填写原因备注", "error");
    return;
  }
  saving.value = true;
  try {
    if (action.value === "stock-in") {
      if (!Number.isFinite(form.quantity) || form.quantity <= 0)
        throw new Error("入库数量必须大于 0");
      await api.stockIn(
        { productId: form.productId, quantity: form.quantity, reason },
        operationalCampusId.value,
      );
      notify("入库成功，库存已更新");
    } else {
      // #85 只减不加：录入核减数量，前端换算绝对清点值传后端（契约不变）
      if (!form.stocktakeReason) throw new Error("请选择盘点原因");
      if (!Number.isInteger(form.reduceQty) || form.reduceQty <= 0)
        throw new Error("核减数量必须为正整数");
      const countedQty = bookQtyOf(form.productId) - form.reduceQty;
      if (countedQty < 0) throw new Error("核减数量超过账面库存");
      const result = await api.stocktake(
        {
          productId: form.productId,
          countedQty,
          reason: form.stocktakeReason,
        },
        operationalCampusId.value,
      );
      notify(
        `账面 ${result.before} → 实际 ${result.countedQty}（差 ${result.delta > 0 ? "+" : ""}${result.delta}）${result.applied ? "" : "，账实相符未落流水"}`,
      );
    }
    dialogOpen.value = false;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", "error");
  } finally {
    saving.value = false;
  }
}
/* ---------- 盘点统计（#85）：按原因聚合卡片 + 该原因商品明细 ---------- */
const statsOpen = ref(false);
const statsLoading = ref(false);
const statsError = ref("");
const statsGroups = ref<StocktakeStatGroup[]>([]);
const statsActiveReason = ref<StocktakeReason>("线下销售");
/** 本地日期 → YYYY-MM-DD（统计/台账的缺省月份范围用）。 */
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const statsRange = ref<[string, string] | null>([
  isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  isoDate(new Date()),
]);
const statsGroupOf = (reason: StocktakeReason) =>
  statsGroups.value.find((group) => group.reason === reason);
const statsActiveGroup = computed(() => statsGroupOf(statsActiveReason.value));
async function loadStats() {
  if (!operationalCampusId.value) return;
  statsLoading.value = true;
  statsError.value = "";
  try {
    statsGroups.value = await api.stocktakeStats(
      statsRange.value?.[0],
      statsRange.value?.[1],
      operationalCampusId.value,
    );
    // 选中原因无数据时回落到首个有数据的分组
    if (!statsGroups.value.some((group) => group.reason === statsActiveReason.value))
      statsActiveReason.value = statsGroups.value[0]?.reason ?? "线下销售";
  } catch (error) {
    statsGroups.value = [];
    statsError.value =
      error instanceof Error ? error.message : "盘点统计加载失败";
  } finally {
    statsLoading.value = false;
  }
}
function openStats() {
  statsOpen.value = true;
  void loadStats();
}
async function bootstrap() {
  try {
    categories.value = await api.adminCategories();
  } catch {
    categories.value = [];
  }
  await load();
}
watch([page, pageSize, categoryId, operationalCampusId], () => void load());
watch(keyword, () => {
  if (keywordTimer) clearTimeout(keywordTimer);
  keywordTimer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 280);
});
onMounted(bootstrap);
</script>

<template>
  <AdminPageShell
    title="库存盘点"
    eyebrow="WAREHOUSE INVENTORY"
    description="掌握实际、锁定和可售库存，提前处理库存异常。"
  >
    <template #actions
      ><ElButton
        v-if="canStockIn"
        type="primary"
        :disabled="!operationalCampusId"
        @click="openAction('stock-in')"
        >采购入库</ElButton
      ><ElButton
        v-if="canStocktake"
        :disabled="!operationalCampusId"
        @click="openAction('stocktake')"
        >盘点</ElButton
      ><ElButton
        v-if="canStocktake"
        :disabled="!operationalCampusId"
        @click="openStats"
        >盘点统计</ElButton
      ></template
    >
    <section class="admin-filter-panel" aria-label="库存筛选">
      <ElForm class="admin-filter-form" label-position="top"
        ><ElRow :gutter="12" align="bottom"
          ><ElCol :xs="24" :sm="12"
            ><ElInput
              v-model="keyword"
              clearable
              placeholder="搜索商品" /></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElSelect
              v-model="categoryId"
              clearable
              filterable
              placeholder="全部分类"
              ><ElOption
                v-for="item in categories"
                :key="item.id"
                :label="item.name"
                :value="item.id" /></ElSelect></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElFormItem label=" "
              ><ElButton :loading="loading" @click="load"
                >刷新</ElButton
              ></ElFormItem
            ></ElCol
          ></ElRow
        ></ElForm
      >
    </section>
    <section class="admin-table-panel" aria-label="库存列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        :empty-text="
          operationalCampusId ? '暂无库存记录' : '请先在顶部选择校区'
        "
      >
        <ElTableColumn label="商品图" width="88"
          ><template #default="{ row }"
            ><ElImage
              v-if="row.image"
              :src="resolveImageUrl(row.image)"
              fit="cover"
              class="thumb"
              :preview-src-list="[resolveImageUrl(row.image)]"
              preview-teleported
              hide-on-click-modal
              ><template #error
                ><span class="image-fallback">—</span></template
              ></ElImage
            ><span v-else>—</span></template
          ></ElTableColumn
        >
        <ElTableColumn prop="name" label="商品" min-width="220" /><ElTableColumn
          label="库位"
          min-width="140"
          ><template #default="{ row }">{{
            locationText(asProduct(row))
          }}</template></ElTableColumn
        >
        <ElTableColumn label="实际" width="100"
          ><template #default="{ row }">{{
            stockOf(asProduct(row), "actualStock")
          }}</template></ElTableColumn
        ><ElTableColumn label="锁定" width="100"
          ><template #default="{ row }">{{
            stockOf(asProduct(row), "lockedStock")
          }}</template></ElTableColumn
        ><ElTableColumn label="可售" width="100"
          ><template #default="{ row }"
            ><strong>{{
              stockOf(asProduct(row), "availableStock")
            }}</strong></template
          ></ElTableColumn
        >
        <ElTableColumn label="操作" fixed="right" width="170"
          ><template #default="{ row }"
            ><ElButton
              v-if="canStockIn"
              size="small"
              type="primary"
              @click="openAction('stock-in', asProduct(row))"
              >入库</ElButton
            ><ElButton
              v-if="canStocktake"
              size="small"
              @click="openAction('stocktake', asProduct(row))"
              >盘点</ElButton
            ></template
          ></ElTableColumn
        > </ElTable
      ><AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>
    <ElDialog
      v-model="dialogOpen"
      :title="title"
      width="min(560px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol :span="24"
            ><ElFormItem label="商品"
              ><ElSelect
                v-model="form.productId"
                filterable
                placeholder="选择当前库存中的商品"
                ><ElOption
                  v-for="item in rows"
                  :key="item.id"
                  :label="`${item.name}（可售 ${item.availableStock ?? item.stock ?? 0}）`"
                  :value="item.id" /></ElSelect></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem v-if="action === 'stock-in'" label="入库数量"
              ><ElInputNumber
                v-model="form.quantity"
                :min="1"
                :step="1" /></ElFormItem
            ><ElFormItem v-else label="核减数量"
              ><ElInputNumber
                v-model="form.reduceQty"
                :min="1"
                :step="1" /><div
                v-if="stocktakePreview"
                class="stocktake-hint"
                :class="{ danger: stocktakePreview.after < 0 }"
              >
                账面 {{ stocktakePreview.book }} → 核减后
                {{ stocktakePreview.after }}
              </div></ElFormItem
            ></ElCol
          ><ElCol :span="24"
            ><ElFormItem
              v-if="action === 'stocktake'"
              label="盘点原因"
              required
              ><ElSelect
                v-model="form.stocktakeReason"
                placeholder="选择盘点原因"
                ><ElOption
                  v-for="item in STOCKTAKE_REASONS"
                  :key="item"
                  :label="item"
                  :value="item" /></ElSelect></ElFormItem
            ><ElFormItem v-else label="原因备注"
              ><ElInput
                v-model="form.reason"
                type="textarea"
                :rows="3"
                placeholder="例如：本周采购入库" /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="dialogOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="submit">{{
          action === "stock-in" ? "确认入库" : "提交盘点"
        }}</ElButton></template
      ></ElDialog
    >
    <!-- 盘点统计（#85）：四原因汇总卡（点选切换）+ 该原因商品明细 -->
    <ElDrawer
      v-model="statsOpen"
      title="盘点统计"
      size="min(680px, 94vw)"
      destroy-on-close
    >
      <div class="stats-filter">
        <ElDatePicker
          v-model="statsRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        /><ElButton :loading="statsLoading" @click="loadStats"
          >查询</ElButton
        >
      </div>
      <p v-if="statsError" class="stats-error">{{ statsError }}</p>
      <div v-loading="statsLoading" class="stats-body">
        <div class="stats-cards">
          <button
            v-for="reason in STOCKTAKE_REASONS"
            :key="reason"
            type="button"
            class="stats-card"
            :class="{ active: reason === statsActiveReason }"
            @click="statsActiveReason = reason"
          >
            <span class="stats-reason">{{ reason }}</span>
            <strong>{{ statsGroupOf(reason)?.totalQty ?? 0 }}</strong>
            <span class="stats-sub"
              >{{ statsGroupOf(reason)?.count ?? 0 }} 条流水 ·
              {{ fenToYuan(statsGroupOf(reason)?.totalCost ?? 0) }} 元</span
            >
          </button>
        </div>
        <p class="stats-table-title">
          「{{ statsActiveReason }}」商品明细（{{
            statsActiveGroup?.products.length ?? 0
          }}）
        </p>
        <ElTable
          :data="statsActiveGroup?.products ?? []"
          empty-text="该原因下暂无盘点记录"
        >
          <ElTableColumn prop="productName" label="商品" min-width="180" />
          <ElTableColumn prop="qty" label="核减数量" width="110" />
          <ElTableColumn label="成本" width="130"
            ><template #default="{ row }"
              >¥{{ fenToYuan(row.cost) }}</template
            ></ElTableColumn
          >
        </ElTable>
      </div>
    </ElDrawer>
  </AdminPageShell>
</template>

<style scoped>
.thumb {
  width: 48px;
  height: 48px;
  border-radius: 8px;
}
.image-fallback {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 8px;
}
.el-select,
.el-input-number {
  width: 100%;
}
.stocktake-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.stocktake-hint.danger {
  color: var(--el-color-danger);
}
.stats-filter {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.stats-error {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--el-color-danger);
}
.stats-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
@media (min-width: 560px) {
  .stats-cards {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.stats-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  text-align: left;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
  cursor: pointer;
}
.stats-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.stats-reason {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.stats-card strong {
  font-size: 22px;
  color: var(--el-text-color-primary);
}
.stats-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.stats-table-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
