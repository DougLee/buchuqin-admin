<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import {
  accountOrgLevel,
  activeCampus,
  hasPerm,
  sessionUser,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Category, Product } from "../../../../types";
import { resolveImageUrl } from "../../../../utils/image";

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
const form = reactive({
  productId: "",
  quantity: 1,
  countedQty: 0,
  reason: "",
});
let generation = 0;
let keywordTimer: number | undefined;
const operationalCampusId = computed(() =>
  accountOrgLevel.value === "platform" || accountOrgLevel.value === "org"
    ? activeCampus.value
    : (sessionUser.value?.campusId ?? ""),
);
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
    countedQty: product?.actualStock ?? product?.stock ?? 0,
    reason: "",
  });
  dialogOpen.value = true;
}
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
      if (!Number.isFinite(form.countedQty) || form.countedQty < 0)
        throw new Error("清点数量不能为负数");
      const result = await api.stocktake(
        {
          productId: form.productId,
          countedQty: form.countedQty,
          ...(reason ? { reason } : {}),
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
    title="库存总览"
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
            ><ElFormItem v-else label="实际清点数量"
              ><ElInputNumber
                v-model="form.countedQty"
                :min="0"
                :step="1" /></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="原因备注"
              ><ElInput
                v-model="form.reason"
                type="textarea"
                :rows="3"
                :placeholder="
                  action === 'stock-in'
                    ? '例如：本周采购入库'
                    : '例如：月底盘点'
                " /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="dialogOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="submit">{{
          action === "stock-in" ? "确认入库" : "提交盘点"
        }}</ElButton></template
      ></ElDialog
    >
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
</style>
