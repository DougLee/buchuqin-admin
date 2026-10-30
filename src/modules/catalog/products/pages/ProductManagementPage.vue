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
      ><ElButton :loading="exporting" @click="exportProducts">导出</ElButton
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
        <ElTable
          v-loading="loading"
          :data="rows"
          row-key="id"
          @sort-change="onSortChange"
          ><ElTableColumn label="图片" width="76"
            ><template #default="{ row }"
              ><ElImage
                :src="row.image"
                fit="cover"
                class="thumb"
                :preview-src-list="[row.image]"
                preview-teleported
                hide-on-click-modal
              /></template></ElTableColumn
          ><ElTableColumn label="库位" width="100"
            ><template #default="{ row }"
              >{{ [product(row).location, product(row).locationCode].filter(Boolean).join("-") || "—" }}</template
            ></ElTableColumn
          ><ElTableColumn prop="name" label="商品" min-width="190"
            ><template #default="{ row }"
              ><strong>{{ row.name }}</strong>
              <div class="cell-sub">
                {{ row.barcode || row.subtitle || "—" }}
              </div></template
            ></ElTableColumn
          ><ElTableColumn label="分类" width="110"
            ><template #default="{ row }">{{
              categories.find((c) => c.id === row.categoryId)?.name ??
                row.categoryId ??
                "—"
            }}</template></ElTableColumn
          ><ElTableColumn label="售价" width="100" prop="price" sortable="custom"
            ><template #default="{ row }"
              >¥{{ fenToYuan(row.price) }}</template
            ></ElTableColumn
          ><ElTableColumn v-if="official" label="进货价" width="110"
            ><template #default="{ row }">{{
              row.costPrice == null ? "—" : `¥${fenToYuan(row.costPrice)}`
            }}</template></ElTableColumn
          ><ElTableColumn
            v-if="official"
            label="批发价"
            width="110"
            prop="wholesalePrice"
            sortable="custom"
            ><template #default="{ row }">{{
              row.wholesalePrice == null
                ? "—"
                : `¥${fenToYuan(row.wholesalePrice)}`
            }}</template></ElTableColumn
          ><!-- 校区可见批发价快照（IKC1AC/IKFOPQ）：订单行毛利=售价−批发价基准 -->
          <ElTableColumn
            v-if="!official"
            label="批发价"
            width="110"
            prop="wholesalePrice"
            sortable="custom"
            ><template #default="{ row }">{{
              row.wholesalePrice == null
                ? "—"
                : `¥${fenToYuan(row.wholesalePrice)}`
            }}</template></ElTableColumn
          ><ElTableColumn label="建议零售价" width="110"
            ><template #default="{ row }"
              >¥{{ fenToYuan(row.originalPrice ?? 0) }}</template
            ></ElTableColumn
          ><ElTableColumn v-if="!official" label="采购来源" width="110"
            ><template #default="{ row }"
              ><ElTag>{{
                row.procurementMode === "LOCAL" ? "自主采购" : "总部供货"
              }}</ElTag></template
            ></ElTableColumn
          ><!-- 本地进货价（道哥 2026-10-19）：LOCAL 显示自报价，总部直供一律
              ¥0.00；无成本权限（RBAC 裁剪）显示 — -->
          <ElTableColumn v-if="!official" label="本地进货价" width="110"
            ><template #default="{ row }"
              >{{
                row.localPurchasePrice == null
                  ? "—"
                  : `¥${fenToYuan(
                      row.procurementMode === "LOCAL"
                        ? row.localPurchasePrice
                        : 0,
                    )}`
              }}</template
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
                v-if="hasPerm('POST /admin/products/batch-status')"
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
              ><ElInput
                v-model="form.barcode"
                :disabled="!!editing"
                placeholder="8-14 位数字，选填；创建后不可修改" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="标签"
              ><ElInput v-model="form.tag" /></ElFormItem></ElCol
          ><!-- 状态仅编辑可改：官方库建档恒下架待总部放行、校区自建恒在售，
               create 端点不收 status，新建态选了也不生效 -->
          <ElCol v-if="editing" :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="状态"
              ><!-- 校区视角改状态需批量上下架权限（与行内上下架同判权） -->
              <ElSelect
                v-model="form.status"
                :disabled="
                  !official && !hasPerm('POST /admin/products/batch-status')
                "
                ><ElOption label="在售" value="on-sale" /><ElOption
                  label="下架"
                  value="off-sale" /></ElSelect></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="商品主图"
              ><ImageUploadField
                v-model="form.image"
                folder="app/product" /></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="详情多图（用户端详情页轮播，可排序，选填）"
              ><ProductImagesField
                v-model="form.images"
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
                ><!-- 新建态禁选：后端校区建档恒落「自主采购」（总部供货必须经
                     官方库导入/到货），仅编辑态可切换 -->
                <ElSelect v-model="form.procurementMode" :disabled="!editing"
                  ><ElOption label="待确认" value="UNSET" disabled /><ElOption
                    label="总部供货"
                    value="HQ" /><ElOption
                    label="自主采购"
                    value="LOCAL" /></ElSelect></ElFormItem></ElCol
            ><!-- IKQZY7 周期限购：每人每周期 1 件（once 终身/weekly 周一/月 1 号），
                 按已付订单计数（不分价格身份），退款释放 -->
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="限购周期"
                ><ElSelect v-model="form.purchaseLimit"
                  ><ElOption label="不限购" value="none" /><ElOption
                    label="限购一次（终身）"
                    value="once" /><ElOption label="每周一次" value="weekly" /><ElOption
                    label="每月一次"
                    value="monthly" /></ElSelect></ElFormItem></ElCol
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
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="库位区域"
              ><!-- IKRRSC 库位改下拉：选项联动库位管理字典（可搜索），选中即回填
                   库位名称；字典为空/加载失败时回退手填输入框，不阻塞编辑 -->
              <ElSelect
                v-if="locationOptions.length"
                v-model="form.location"
                filterable
                clearable
                placeholder="选择库位区域"
                ><ElOption
                  v-for="opt in mergedLocationOptions"
                  :key="opt.id"
                  :label="opt.name"
                  :value="opt.name"
              /></ElSelect>
              <ElInput v-else v-model="form.location" placeholder="如：A 区" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="库位编号"
              ><ElInput
                v-model="form.locationCode"
                placeholder="如：01-3" /></ElFormItem></ElCol
          ><ElCol v-if="!official" :xs="24" :sm="12" :lg="8"
            ><ElFormItem :label="editing ? '可售库存' : '初始库存'"
              ><ElInputNumber
                v-model="form.stock"
                :min="0"
                :precision="0"
                :disabled="!canEditStock" /></ElFormItem></ElCol
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
import * as XLSX from "xlsx";
import { api } from "../../../../api";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import ProductImagesField from "../../../../components/ProductImagesField.vue";
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
/** 库存直改门控（旧版口径）：盘点权限者才可在商品表单改库存
 *  （c68a210 重构丢失字段回迁，道哥 2026-10-15 确认补回） */
const canEditStock = computed(
  () => !official.value && hasPerm("POST /admin/inventory/stocktake"),
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
  // 详情多图（IK9SNS）：COS URL 数组，顺序即详情页轮播顺序，空回退头图
  images: [] as string[],
  description: "",
  price: 0,
  originalPrice: 0,
  costPrice: 0,
  wholesalePrice: 0,
  procurementMode: "HQ" as "HQ" | "LOCAL" | "UNSET",
  purchaseLimit: "none" as "none" | "once" | "weekly" | "monthly",
  localPurchasePrice: 0,
  weight: 0,
  retailUnit: "",
  wholesaleUnit: "",
  unitsPerCase: 1,
  location: "",
  locationCode: "",
  stock: 0,
  status: "off-sale" as "on-sale" | "off-sale",
});
// 库位字典（IKRRSC）：选项联动「库位管理」（IKA0VG，GET /admin/locations），
// 条目只有 name 没有编号字段，故下拉只回填 location（库位区域名），
// locationCode（库位编号）仍保持手填。
const locationOptions = ref<Array<{ id: string; name: string }>>([]);
async function loadLocationOptions() {
  try {
    locationOptions.value = await api.adminLocations();
  } catch {
    // 字典拉取失败静默降级为手填（locationOptions 为空 → 模板回退 ElInput）
    locationOptions.value = [];
  }
}
// 下拉选项 = 字典 + 存量兜底（IKRRSC）：历史手填值不在字典里时追加为额外
// 选项，避免打开编辑即丢值；改选字典项保存后自然归一。
const mergedLocationOptions = computed(() => {
  const extra =
    form.location && !locationOptions.value.some((l) => l.name === form.location)
      ? [{ id: `legacy:${form.location}`, name: form.location }]
      : [];
  return [...locationOptions.value, ...extra];
});
const title = computed(() => (official.value ? "官方商品库" : "商品管理")),
  tabs = computed(() =>
    official.value ? HQ_PRODUCT_STATUS_TABS : PRODUCT_STATUS_TABS,
  );
/** 商品导出 Excel（道哥 2026-10-21）：按当前筛选（页签/关键字/分类）分页拉全
 *  （后端 pageSize 封顶 100，循环翻页），SheetJS 生成 .xlsx（列宽自适应）。
 *  列对齐列表可见维度；成本字段（批发价/本地进货价/进货价）为服务端 RBAC
 *  裁剪后口径——无成本权限者自然为空。 */
const exporting = ref(false);
async function exportProducts() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const all: Product[] = [];
    const pageSize = 100;
    for (let p = 1; ; p++) {
      const r = await api.products(
        {
          page: p,
          pageSize,
          keyword: keyword.value.trim() || undefined,
          status: status.value === "all" ? undefined : status.value,
          categoryId: categoryId.value || undefined,
          campusId: campus.value,
        },
        props.mode,
        campus.value,
      );
      all.push(...r.items);
      if (all.length >= r.total || !r.items.length) break;
    }
    const money = (v?: number | null) => (v == null ? "" : `¥${fenToYuan(v)}`);
    const modeText = (m?: string | null) =>
      m === "LOCAL" ? "自主采购" : m === "HQ" ? "总部供货" : "待确认";
    const statusText = (s: string) =>
      s === "on-sale" ? "在售" : s === "off-sale" ? "已下架" : "售罄";
    const catName = (id: string) =>
      categories.value.find((c) => c.id === id)?.name ?? id ?? "";
    const header = official.value
      ? ["商品名", "条码", "分类", "售价", "建议零售价", "进货价", "批发价", "可售库存", "状态"]
      : ["库位", "商品名", "条码", "分类", "售价", "建议零售价", "批发价", "本地进货价", "采购来源", "可售库存", "状态"];
    const rows = all.map((p) =>
      official.value
        ? [
            p.name,
            p.barcode ?? "",
            catName(p.categoryId),
            money(p.price),
            money(p.originalPrice),
            money(p.costPrice),
            money(p.wholesalePrice),
            String(p.availableStock ?? p.stock ?? 0),
            statusText(p.status),
          ]
        : [
            [p.location, p.locationCode].filter(Boolean).join("-"),
            p.name,
            p.barcode ?? "",
            catName(p.categoryId),
            money(p.price),
            money(p.originalPrice),
            money(p.wholesalePrice),
            money(p.localPurchasePrice),
            modeText(p.procurementMode),
            String(p.availableStock ?? p.stock ?? 0),
            statusText(p.status),
          ],
    );
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet["!cols"] = header.map((h) => ({
      wch: Math.max(10, h.length * 2 + 2),
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, official.value ? "官方商品库" : "商品列表");
    XLSX.writeFile(
      book,
      `${official.value ? "官方商品库" : "商品列表"}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    notify(`已导出 ${all.length} 个商品`);
  } catch (e) {
    notify(e instanceof Error ? e.message : "导出失败", "error");
  } finally {
    exporting.value = false;
  }
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function product(row: unknown) {
  return row as Product;
}
/* IKRSJ1 #93：售价/批发价列排序（后端 orderBy，缺省维持销量序） */
const sortBy = ref<string>();
const sortDir = ref<string>();
function onSortChange({
  prop,
  order,
}: {
  prop: string | null;
  order: "ascending" | "descending" | null;
}) {
  sortBy.value = order && prop ? prop : undefined;
  sortDir.value = order === "ascending" ? "asc" : "desc";
  page.value = 1;
  void load();
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
        sortBy: sortBy.value || undefined,
        sortDir: sortDir.value || undefined,
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
    images: row && Array.isArray(row.images) ? [...row.images] : [],
    description: row?.description ?? "",
    price: Number(fenToYuan(row?.price ?? 0)),
    originalPrice: Number(fenToYuan(row?.originalPrice ?? 0)),
    costPrice: Number(fenToYuan(row?.costPrice ?? 0)),
    wholesalePrice: Number(fenToYuan(row?.wholesalePrice ?? 0)),
    // 采购来源回填：历史行 null = 待确认（UNSET，存盘点清零前不强行认领）；
    // 新建默认对齐后端建档规则：官方库=总部供货、校区自建=本地采购
    //（create 端点不接受 procurementMode，校区建库恒落 LOCAL）
    procurementMode: row
      ? (row.procurementMode ?? "UNSET")
      : official.value
        ? "HQ"
        : "LOCAL",
    localPurchasePrice: Number(fenToYuan(row?.localPurchasePrice ?? 0)),
    weight: row?.weight ?? 0,
    retailUnit: row?.retailUnit ?? "",
    wholesaleUnit: row?.wholesaleUnit ?? "",
    unitsPerCase: row?.unitsPerCase ?? 1,
    location: row?.location ?? "",
    locationCode: row?.locationCode ?? "",
    stock: row?.stock ?? 0,
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
      // 条码仅建档可写：后端 UpdateProductDto 无 barcode（whitelist 剥离），
      // 编辑态携带只会被静默丢弃——编辑框禁用，请求体也不再携带
      ...(editing.value ? {} : { barcode: form.barcode.trim() || undefined }),
      categoryId: form.categoryId,
      tag: form.tag.trim(),
      // 头图空串不提交：UpdateProductDto 的 image 校验 http(s) URL，空串会
      // 400（留空 = 保持原图，与旧版同口径；CreateProductDto 空串无害）
      ...(form.image.trim() ? { image: form.image.trim() } : {}),
      // 详情多图（IK9SNS）：整组提交覆盖，空数组清空回退头图
      images: form.images.filter(Boolean),
      description: form.description.trim(),
      weight: Number(form.weight),
      retailUnit: form.retailUnit.trim(),
      // 批发单位空值兜底「件」、含量空值兜底 1（与后端建档默认同口径；
      // ElInputNumber 清空会吐 null，裸传会被后端「含量不能小于 1」打回）
      wholesaleUnit: form.wholesaleUnit.trim() || "件",
      unitsPerCase: Number(form.unitsPerCase) || 1,
      location: form.location.trim(),
      locationCode: form.locationCode.trim(),
      // 状态仅编辑态提交：create 端点无 status（官方库建档恒下架待放行、
      // 校区自建恒在售，弹窗里选了也不生效）；校区视角 PATCH 带 status
      // 需要 batch-status 权限（controller 校验），无权限且未改状态时
      // 省略该键，避免无谓 403 挡掉整次保存
      ...(editing.value &&
      (official.value ||
        (hasPerm("POST /admin/products/batch-status") &&
          form.status !== editing.value.status))
        ? { status: form.status }
        : {}),
      // 采购来源编辑保存（道哥 2026-10-15 反馈）：此前仅创建分支携带，
      // 编辑改「总部供货/自主采购」保存请求体不含该字段 → 静默不生效；
      // 历史行「待确认」（UNSET）不提交，避免随手保存就把 null 认领成 LOCAL。
      // 进货价同步进主请求（同日二修）：后端切 LOCAL 时校验 lpp 需随请求携带，
      // 只靠 price 端点补会导致「待确认→自主采购」认领场景主请求先被 400 拦截
      //（「本地采购商品必须填写进货价」，尽管表单已填值）
      ...(!official.value && form.procurementMode !== "UNSET"
        ? {
            procurementMode: form.procurementMode,
            ...(form.procurementMode === "LOCAL"
              ? { localPurchasePrice: yuanToFen(form.localPurchasePrice) }
              : {}),
          }
        : {}),
      // 库存直改（旧版口径回迁）：编辑态+有权+值变化才提交，无权限用户保存不被 403
      ...(editing.value &&
      canEditStock.value &&
      form.stock !== editing.value.stock
        ? { stock: form.stock }
        : {}),
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
        // main 已含校区 procurementMode（后端建档校区恒落 LOCAL，携带仅为
        // 请求体语义完整）；stock 固定 0，库存调整走库存总览入库/盘点
        { ...main, ...prices, stock: form.stock },
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
/** 行内上下架：走批量端点单发（IKCKX4）——校区视角 PATCH /admin/products/:id
 *  带 status 需 batch-status 权限，旧版即走此端点；官方库视角同口径免分权。 */
async function toggle(row: Product) {
  try {
    await api.batchUpdateProductStatus(
      [row.id],
      row.status === "on-sale" ? "off-sale" : "on-sale",
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
  // 库位字典独立拉取（IKRRSC）：失败只降级手填，不影响商品列表加载
  void loadLocationOptions();
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
