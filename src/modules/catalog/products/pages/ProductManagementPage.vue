<template>
  <AdminPageShell
    :title="title"
    eyebrow="PRODUCT CATALOG"
    :description="
      official
        ? '维护平台官方商品资料与供货价格，不受顶部校区影响。'
        : '维护顶部当前校区的售价、采购来源和商品资料。'
    "
    ><template #actions
      ><ElButton
        v-if="!official && campus && hasPerm('POST /admin/products/import')"
        @click="showImport"
        >从官方库导入</ElButton
      ><ElButton
        v-if="hasPerm('POST /admin/products')"
        type="primary"
        :disabled="!official && !campus"
        @click="edit()"
        >新建商品</ElButton
      ></template
    >
    <div v-if="!official && !campus" class="empty">请先在顶部选择校区。</div>
    <template v-else>
      <section class="product-filter-panel" aria-label="商品筛选">
        <div
          class="product-status-tabs single-line-tabs"
          role="tablist"
          aria-label="商品状态"
        >
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            class="product-status-tab"
            :class="{ active: status === tab.key }"
            :aria-selected="status === tab.key"
            @click="status = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
        <ElForm class="product-filters" label-position="top"
          ><ElRow :gutter="12" align="bottom">
            <ElCol :xs="24" :sm="12"
              ><ElInput
                v-model="keyword"
                class="search"
                clearable
                placeholder="搜索商品名称或条码"
                @keyup.enter="
                  page = 1;
                  load();
                " /></ElCol
            ><ElCol :xs="24" :sm="8"
              ><ElSelect
                v-model="categoryId"
                class="filter"
                clearable
                filterable
                placeholder="全部分类"
                ><ElOption
                  v-for="item in categories"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></ElSelect></ElCol
            ><ElCol :xs="24" :sm="4"
              ><ElFormItem label=" "
                ><ElButton
                  @click="
                    page = 1;
                    load();
                  "
                  >查询</ElButton
                ></ElFormItem
              ></ElCol
            ></ElRow
          ></ElForm
        >
      </section>
      <section class="product-table-panel" aria-label="商品列表">
        <ElTable v-loading="loading" :data="rows" row-key="id"
          ><ElTableColumn label="图片" width="76"
            ><template #default="{ row }"
              ><ElImage
                :src="row.image"
                fit="cover"
                class="thumb" /></template></ElTableColumn
          ><ElTableColumn prop="name" label="商品" min-width="190"
            ><template #default="{ row }"
              ><strong>{{ row.name }}</strong>
              <div class="cell-sub">
                {{ row.barcode || row.subtitle || "—" }}
              </div></template
            ></ElTableColumn
          ><ElTableColumn label="售价" width="100"
            ><template #default="{ row }"
              >¥{{ fenToYuan(row.price) }}</template
            ></ElTableColumn
          ><ElTableColumn v-if="official" label="进货价" width="110"
            ><template #default="{ row }">{{
              row.costPrice == null ? "—" : `¥${fenToYuan(row.costPrice)}`
            }}</template></ElTableColumn
          ><ElTableColumn v-if="official" label="批发价" width="110"
            ><template #default="{ row }">{{
              row.wholesalePrice == null
                ? "—"
                : `¥${fenToYuan(row.wholesalePrice)}`
            }}</template></ElTableColumn
          ><ElTableColumn v-if="!official" label="采购来源" width="110"
            ><template #default="{ row }"
              ><ElTag>{{
                row.procurementMode === "LOCAL" ? "自主采购" : "总部供货"
              }}</ElTag></template
            ></ElTableColumn
          ><ElTableColumn
            v-if="!official"
            prop="availableStock"
            label="可售库存"
          /><ElTableColumn label="状态"
            ><template #default="{ row }"
              ><ElTag :type="row.status === 'on-sale' ? 'success' : 'info'">{{
                row.status === "on-sale" ? "在售" : "已下架"
              }}</ElTag></template
            ></ElTableColumn
          ><ElTableColumn label="操作" width="150" fixed="right"
            ><template #default="{ row }"
              ><ElButton
                v-if="
                  hasPerm('PATCH /admin/products/:id') ||
                  hasPerm('PATCH /admin/products/:id/price')
                "
                link
                type="primary"
                @click="edit(product(row))"
                >编辑</ElButton
              ><ElButton
                v-if="hasPerm('PATCH /admin/products/:id')"
                link
                @click="toggle(product(row))"
                >{{ row.status === "on-sale" ? "下架" : "上架" }}</ElButton
              ></template
            ></ElTableColumn
          ></ElTable
        ><AdminPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="total"
        />
      </section>
    </template>
    <ElDialog
      v-model="open"
      :title="editing ? '编辑商品' : '新建商品'"
      width="min(900px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="商品名称"
              ><ElInput v-model="form.name" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="副标题"
              ><ElInput v-model="form.subtitle" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="分类"
              ><ElSelect v-model="form.categoryId" filterable
                ><ElOption
                  v-for="item in categories"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="条码"
              ><ElInput v-model="form.barcode" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="标签"
              ><ElInput v-model="form.tag" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="状态"
              ><ElSelect v-model="form.status"
                ><ElOption label="在售" value="on-sale" /><ElOption
                  label="下架"
                  value="off-sale" /></ElSelect></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="商品主图"
              ><ImageUploadField
                v-model="form.image"
                folder="app/product" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="售价（元）"
              ><ElInputNumber
                v-model="form.price"
                :min="0"
                :precision="2" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="建议零售价（元）"
              ><ElInputNumber
                v-model="form.originalPrice"
                :min="0"
                :precision="2" /></ElFormItem></ElCol
          ><template v-if="official"
            ><ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="进货价（元，仅总部可见）"
                ><ElInputNumber
                  v-model="form.costPrice"
                  :min="0"
                  :precision="2" /></ElFormItem></ElCol
            ><ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="批发价格（元）"
                ><ElInputNumber
                  v-model="form.wholesalePrice"
                  :min="0"
                  :precision="2" /></ElFormItem></ElCol></template
          ><template v-else
            ><ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="采购来源"
                ><ElSelect v-model="form.procurementMode"
                  ><ElOption label="总部供货" value="HQ" /><ElOption
                    label="自主采购"
                    value="LOCAL" /></ElSelect></ElFormItem></ElCol
            ><ElCol
              v-if="form.procurementMode === 'LOCAL'"
              :xs="24"
              :sm="12"
              :lg="8"
              ><ElFormItem label="本地进货价（元）"
                ><ElInputNumber
                  v-model="form.localPurchasePrice"
                  :min="0"
                  :precision="2" /></ElFormItem></ElCol></template
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="重量（kg）"
              ><ElInputNumber
                v-model="form.weight"
                :min="0"
                :precision="3" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="每件含量"
              ><ElInputNumber
                v-model="form.unitsPerCase"
                :min="1" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="零售单位"
              ><ElInput v-model="form.retailUnit" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="批发单位"
              ><ElInput v-model="form.wholesaleUnit" /></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="商品介绍"
              ><ElInput
                v-model="form.description"
                type="textarea"
                :rows="4" /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="open = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      ></ElDialog
    ><ElDialog
      v-model="importOpen"
      title="从官方商品库导入"
      width="min(880px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElTable
        :data="library"
        row-key="id"
        max-height="520"
        @selection-change="select"
        ><ElTableColumn type="selection" width="48" /><ElTableColumn
          prop="name"
          label="商品"
        /><ElTableColumn prop="barcode" label="条码" /><ElTableColumn
          label="批发价"
          ><template #default="{ row }"
            >¥{{ fenToYuan(row.price) }}</template
          ></ElTableColumn
        ></ElTable
      ><template #footer
        ><ElButton @click="importOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="submitImport"
          >导入所选商品</ElButton
        ></template
      ></ElDialog
    ></AdminPageShell
  >
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import {
  HQ_PRODUCT_STATUS_TABS,
  PRODUCT_STATUS_TABS,
} from "../../../../dicts/status-tab";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Category, Product } from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
const props = defineProps<{ mode: "official" | "campus" }>(),
  official = computed(() => props.mode === "official"),
  campus = computed(() =>
    official.value ? undefined : effectiveCampusId.value || undefined,
  );
const rows = ref<Product[]>([]),
  categories = ref<Category[]>([]),
  library = ref<Product[]>([]),
  chosen = ref<string[]>([]),
  loading = ref(false),
  saving = ref(false),
  open = ref(false),
  importOpen = ref(false),
  editing = ref<Product | null>(null),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref(""),
  status = ref("all"),
  categoryId = ref("");
const form = reactive({
  name: "",
  subtitle: "",
  barcode: "",
  categoryId: "",
  tag: "",
  image: "",
  description: "",
  price: 0,
  originalPrice: 0,
  costPrice: 0,
  wholesalePrice: 0,
  procurementMode: "HQ" as "HQ" | "LOCAL",
  localPurchasePrice: 0,
  weight: 0,
  retailUnit: "",
  wholesaleUnit: "",
  unitsPerCase: 1,
  status: "off-sale" as "on-sale" | "off-sale",
});
const title = computed(() => (official.value ? "官方商品库" : "商品管理")),
  tabs = computed(() =>
    official.value ? HQ_PRODUCT_STATUS_TABS : PRODUCT_STATUS_TABS,
  );
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function product(row: unknown) {
  return row as Product;
}
async function load() {
  if (!official.value && !campus.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const r = await api.products(
      {
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
        status: status.value === "all" ? undefined : status.value,
        categoryId: categoryId.value || undefined,
        campusId: campus.value,
      },
      props.mode,
      campus.value,
    );
    rows.value = r.items;
    total.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "商品加载失败", "error");
  } finally {
    loading.value = false;
  }
}
function edit(row?: Product) {
  editing.value = row ?? null;
  Object.assign(form, {
    name: row?.name ?? "",
    subtitle: row?.subtitle ?? "",
    barcode: row?.barcode ?? "",
    categoryId: row?.categoryId ?? "",
    tag: row?.tag ?? "",
    image: row?.image ?? "",
    description: row?.description ?? "",
    price: Number(fenToYuan(row?.price ?? 0)),
    originalPrice: Number(fenToYuan(row?.originalPrice ?? 0)),
    costPrice: Number(fenToYuan(row?.costPrice ?? 0)),
    wholesalePrice: Number(fenToYuan(row?.wholesalePrice ?? 0)),
    procurementMode: row?.procurementMode ?? "HQ",
    localPurchasePrice: Number(fenToYuan(row?.localPurchasePrice ?? 0)),
    weight: row?.weight ?? 0,
    retailUnit: row?.retailUnit ?? "",
    wholesaleUnit: row?.wholesaleUnit ?? "",
    unitsPerCase: row?.unitsPerCase ?? 1,
    status: (row?.status as "on-sale" | "off-sale") ?? "off-sale",
  });
  open.value = true;
}
async function save() {
  if (!form.name.trim() || !form.categoryId)
    return notify("请填写商品名称并选择分类", "error");
  saving.value = true;
  try {
    const main = {
      name: form.name.trim(),
      subtitle: form.subtitle.trim(),
      barcode: form.barcode.trim() || undefined,
      categoryId: form.categoryId,
      tag: form.tag.trim(),
      image: form.image,
      description: form.description.trim(),
      weight: Number(form.weight),
      retailUnit: form.retailUnit.trim(),
      wholesaleUnit: form.wholesaleUnit.trim(),
      unitsPerCase: Number(form.unitsPerCase),
      status: form.status,
    };
    const prices = {
      price: yuanToFen(form.price),
      originalPrice: yuanToFen(form.originalPrice),
      ...(official.value
        ? {
            costPrice: yuanToFen(form.costPrice),
            wholesalePrice: yuanToFen(form.wholesalePrice),
          }
        : {
            localPurchasePrice:
              form.procurementMode === "LOCAL"
                ? yuanToFen(form.localPurchasePrice)
                : 0,
          }),
    };
    if (editing.value) {
      if (hasPerm("PATCH /admin/products/:id"))
        await api.updateProduct(
          editing.value.id,
          main,
          props.mode,
          campus.value,
        );
      if (hasPerm("PATCH /admin/products/:id/price") || official.value)
        await api.updateProductPrice(
          editing.value.id,
          prices,
          props.mode,
          campus.value,
        );
    } else
      await api.createProduct(
        {
          ...main,
          ...prices,
          ...(!official.value ? { procurementMode: form.procurementMode } : {}),
          stock: 0,
        },
        props.mode,
        campus.value,
      );
    open.value = false;
    notify(editing.value ? "商品已更新" : "商品已创建");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function toggle(row: Product) {
  try {
    await api.updateProduct(
      row.id,
      { status: row.status === "on-sale" ? "off-sale" : "on-sale" },
      props.mode,
      campus.value,
    );
    notify(row.status === "on-sale" ? "商品已下架" : "商品已上架");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", "error");
  }
}
async function showImport() {
  try {
    library.value = (
      await api.officialProducts({ page: 1, pageSize: 1000 })
    ).items;
    chosen.value = [];
    importOpen.value = true;
  } catch (e) {
    notify(e instanceof Error ? e.message : "官方商品加载失败", "error");
  }
}
function select(items: Product[]) {
  chosen.value = items.map((x) => x.id);
}
async function submitImport() {
  if (!chosen.value.length) return notify("请选择要导入的商品", "error");
  saving.value = true;
  try {
    const r = await api.importProducts(chosen.value);
    importOpen.value = false;
    notify(`已导入 ${r.importedCount} 个商品`);
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "导入失败", "error");
  } finally {
    saving.value = false;
  }
}
watch([page, pageSize, status, categoryId, campus], load);
onMounted(async () => {
  try {
    categories.value = await api.adminCategories();
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "页面加载失败", "error");
  }
});
</script>

<style scoped>
.product-filter-panel,
.product-table-panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 8px 24px #163f2b08;
}
.product-filter-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  margin-bottom: 18px;
}
.product-status-tabs {
  flex: 1 1 auto;
  gap: 6px;
  padding-bottom: 4px;
}
.product-status-tab {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition:
    color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}
.product-status-tab:hover {
  color: var(--green);
  background: #f0f7f3;
}
.product-status-tab:focus-visible {
  outline: 3px solid rgb(22 163 74 / 18%);
  outline-offset: 2px;
}
.product-status-tab.active {
  color: #fff;
  background: var(--green);
  box-shadow: 0 5px 14px rgb(17 91 61 / 18%);
}
.product-filters {
  flex: 0 1 720px;
  min-width: 520px;
}
.product-filters :deep(.el-form-item) {
  margin-bottom: 0;
}
.product-filters :deep(.el-input),
.product-filters :deep(.el-select) {
  width: 100%;
}
.product-table-panel {
  overflow: hidden;
}
.search,
.filter {
  width: 100%;
}
.empty {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
}
.el-select,
.el-input-number {
  width: 100%;
}
@media (max-width: 1280px) {
  .product-filter-panel {
    align-items: stretch;
    flex-direction: column;
  }
  .product-status-tabs,
  .product-filters {
    width: 100%;
  }
  .product-filters {
    min-width: 0;
  }
}
@media (max-width: 760px) {
  .product-filter-panel {
    padding: 12px;
    border-radius: 14px;
  }
  .product-status-tabs {
    margin: 0 -12px;
    padding: 0 12px 4px;
  }
  .product-status-tab {
    min-width: max-content;
    min-height: 44px;
  }
  .product-filters :deep(.el-form-item) {
    margin-bottom: 10px;
  }
  .product-filters :deep(.el-col:last-child .el-form-item) {
    margin-bottom: 0;
  }
  .product-table-panel {
    border-radius: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .product-status-tab {
    transition: none;
  }
}
</style>
