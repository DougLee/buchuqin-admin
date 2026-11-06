<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import NightLoadError from '../../NightLoadError.vue';
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import type {
  NightCatalogRow,
  NightOfficialCandidate,
} from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
import { fmtDateTime } from '../../../../utils/datetime';

/**
 * 夜主档商品管理面板（IKSW1F）：Product 夜主档行（nightCatalog=true）的
 * 列表/创建/编辑/上下架。作为「夜宵店铺」页的 Tab 存在——registry 未给
 * 夜主档单列菜单，perms 归 night-stores / night-stores.write。
 * 售价为「统一夜宵售价」（分）：同校区同 SKU 统一执行（PRD B06）。
 */
const rows = ref<NightCatalogRow[]>([]);
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const open = ref(false);
const editing = ref<NightCatalogRow | null>(null);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const keyword = ref("");
const filters = reactive({ status: "", categoryId: "", stock: "", source: "" });
const categories = ref<Array<{ id: string; name: string }>>([]);
function search() {
  if (page.value !== 1) page.value = 1;
  else void load();
}
function resetFilters() {
  keyword.value = "";
  Object.assign(filters, { status: "", categoryId: "", stock: "", source: "" });
  search();
}
const importOpen = ref(false),
  importLoading = ref(false);
const candidates = ref<NightOfficialCandidate[]>([]);
const candidateKeyword = ref(""),
  candidatePage = ref(1),
  candidateTotal = ref(0);
const selectedIds = ref<string[]>([]);
async function loadCandidates() {
  importLoading.value = true;
  try {
    const r = await api.nightCatalogCandidates(
      candidateKeyword.value,
      candidatePage.value,
    );
    candidates.value = r.items;
    candidateTotal.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "官方库加载失败", "error");
  } finally {
    importLoading.value = false;
  }
}
async function startImport() {
  candidatePage.value = 1;
  selectedIds.value = [];
  importOpen.value = true;
  await loadCandidates();
}
function selectCandidate(id: string) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((x) => x !== id)
    : [...selectedIds.value, id];
}
async function importSelected() {
  if (!selectedIds.value.length || saving.value) return;
  saving.value = true;
  try {
    const r = await api.importNightCatalog(selectedIds.value);
    importOpen.value = false;
    notify(
      `已导入 ${r.importedCount} 种，跳过已存在 ${r.skippedCount} 种。请确认售价后上架。`,
    );
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "导入失败", "error");
  } finally {
    saving.value = false;
  }
}

const form = reactive({
  categoryId: '',
  retailUnit: '件',
  name: "",
  price: 0,
  originalPrice: 0,
  subtitle: "",
  image: "",
  barcode: "",
  status: "on-sale" as "on-sale" | "off-sale",
});

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

/** ElTable 作用域槽 row 兜底断言（同 CouponPage asCoupon 模式）。 */
function asCatalog(row: unknown) {
  return row as NightCatalogRow;
}

let loadGeneration = 0;
async function load() {
  const generation = ++loadGeneration;
  loadError.value = '';
  if (!effectiveCampusId.value) {
    rows.value = [];
    total.value = 0;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const r = await api.nightCatalog(
      keyword.value.trim() || undefined,
      page.value,
      pageSize.value,
      filters,
    );
    if (generation === loadGeneration) {
      rows.value = r.items;
      total.value = r.total;
      categories.value = r.categories ?? [];
    }
  } catch (e) {
    if (generation === loadGeneration) loadError.value = e instanceof Error ? e.message : '夜主档加载失败';
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

function edit(row?: NightCatalogRow) {
  editing.value = row ?? null;
  Object.assign(form, {
    categoryId: row?.categoryId ?? '',
    retailUnit: row?.retailUnit || '件',
    name: row?.name ?? "",
    price: Number(fenToYuan(row?.price ?? 0)),
    originalPrice: Number(fenToYuan(row?.originalPrice ?? 0)),
    subtitle: row?.subtitle ?? "",
    image: row?.image ?? "",
    barcode: row?.barcode ?? "",
    status: row?.status === "off-sale" ? "off-sale" : "on-sale",
  });
  open.value = true;
}

async function save() {
  if (!form.name.trim()) return notify("请填写商品名称", "error");
  if (!(form.price > 0)) return notify("夜宵售价必须大于 0", "error");
  if (!form.retailUnit.trim()) return notify('请填写零售单位', 'error');
  saving.value = true;
  try {
    const priceFen = yuanToFen(form.price);
    const originalFen = yuanToFen(form.originalPrice || 0);
    if (editing.value) {
      await api.updateNightCatalog(editing.value.id, {
        categoryId: form.categoryId || undefined,
        retailUnit: form.retailUnit.trim(),
        name: form.name.trim(),
        price: priceFen,
        originalPrice: originalFen,
        image: form.image,
        subtitle: form.subtitle.trim(),
        status: form.status,
      });
    } else {
      await api.createNightCatalog({
        categoryId: form.categoryId || undefined,
        retailUnit: form.retailUnit.trim(),
        name: form.name.trim(),
        price: priceFen,
        originalPrice: originalFen,
        image: form.image,
        subtitle: form.subtitle.trim(),
        barcode: form.barcode.trim() || undefined,
      });
    }
    open.value = false;
    notify(editing.value ? "夜主档已更新" : "夜主档已创建");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(row: NightCatalogRow) {
  try {
    await api.updateNightCatalog(row.id, {
      status: row.status === "on-sale" ? "off-sale" : "on-sale",
    });
    notify(row.status === "on-sale" ? "已下架（楼栋行不可再备货）" : "已上架");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", "error");
  }
}

watch([page, pageSize], load);
watch(effectiveCampusId, () => {
  importOpen.value = false;
  open.value = false;
  selectedIds.value = [];
  categories.value = [];
  resetFilters();
});
onMounted(load);

defineExpose({ reload: load });
</script>
<template>
  <div>
    <div v-if="!effectiveCampusId" class="empty-hint">请先在顶部选择校区。</div>
    <template v-else>
      <NightLoadError :message="loadError" :loading="loading" @retry="load" />
      <section
        class="admin-filter-panel admin-filter-panel--split"
        aria-label="夜主档筛选"
      >
        <div class="catalog-tip">
          从官方库导入夜宵经营资料，确认夜宵售价后上架供楼长备货。
          白天与夜宵共用校区实物仓库，导入不增加库存；各渠道售价、上下架独立。
        </div>
        <div class="catalog-search">
          <ElInput
            v-model="keyword"
            clearable
            placeholder="搜索商品名称 / 条码"
            @keyup.enter="
              page = 1;
              load();
            "
          /><ElButton
            @click="
              page = 1;
              load();
            "
            >查询</ElButton
          >
        </div>
      </section>
      <section
        class="admin-filter-panel catalog-filters"
        aria-label="夜宵商品条件筛选"
      >
        <ElSelect
          v-model="filters.status"
          placeholder="全部上架状态"
          clearable
          @change="search"
          ><ElOption label="在售" value="on-sale" /><ElOption
            label="已下架"
            value="off-sale"
        /></ElSelect>
        <ElSelect
          v-model="filters.categoryId"
          placeholder="全部分类"
          clearable
          filterable
          @change="search"
          ><ElOption
            v-for="c in categories"
            :key="c.id"
            :label="c.name"
            :value="c.id"
        /></ElSelect>
        <ElSelect
          v-model="filters.stock"
          placeholder="全部仓库库存"
          clearable
          @change="search"
          ><ElOption label="仓库有库存" value="available" /><ElOption
            label="仓库缺货"
            value="empty" /><ElOption label="未关联仓库" value="unlinked"
        /></ElSelect>
        <ElSelect
          v-model="filters.source"
          placeholder="全部商品来源"
          clearable
          @change="search"
          ><ElOption label="官方库导入" value="official" /><ElOption
            label="手动创建"
            value="manual"
        /></ElSelect>
        <ElButton @click="resetFilters">重置筛选</ElButton>
      </section>
      <section class="admin-table-panel" aria-label="夜主档列表">
        <div class="catalog-actions">
          <ElButton
            v-if="hasPerm('POST /admin/night/catalog/import')"
            type="primary"
            @click="startImport"
            >从官方商品库导入</ElButton
          >
          <ElButton
            v-if="hasPerm('POST /admin/night/catalog')"
            type="primary"
            @click="edit()"
            >手动补充商品</ElButton
          >
        </div>
        <ElTable
          v-loading="loading"
          :data="rows"
          row-key="id"
          empty-text="暂无夜主档商品——先建主档，再回各店铺配置楼栋商品"
        >
          <ElTableColumn label="商品" min-width="240">
            <template #default="{ row }">
              <div class="catalog-name">
                <ElImage
                  v-if="row.image"
                  class="catalog-thumb"
                  :src="row.image"
                  fit="cover"
                  :preview-src-list="[row.image]"
                  preview-teleported
                  hide-on-click-modal
                />
                <div v-else class="catalog-thumb catalog-thumb--empty">
                  无图
                </div>
                <div class="catalog-name-text">
                  <span>{{ row.name }}</span>
                  <span v-if="row.subtitle" class="muted">{{
                    row.subtitle
                  }}</span>
                </div>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn label="条码" width="140">
            <template #default="{ row }">{{ row.barcode || "—" }}</template>
          </ElTableColumn>
          <ElTableColumn prop="categoryName" label="分类" min-width="110" />
          <ElTableColumn label="来源" width="110"
            ><template #default="{ row }"
              ><ElTag :type="row.sourceProductId ? 'success' : 'info'">{{
                row.sourceProductId ? "官方导入" : "手动创建"
              }}</ElTag></template
            ></ElTableColumn
          >
          <ElTableColumn label="共享仓库可用" width="125"
            ><template #default="{ row }">{{
              row.warehouseProductId ? row.warehouseAvailable : "未关联仓库"
            }}</template></ElTableColumn
          >
          <ElTableColumn label="夜宵预留" width="100"
            ><template #default="{ row }">{{
              row.warehouseReserved
            }}</template></ElTableColumn
          >
          <ElTableColumn label="统一夜宵售价" width="130">
            <template #default="{ row }">¥{{ fenToYuan(row.price) }}</template>
          </ElTableColumn>
          <ElTableColumn label="划线价" width="100">
            <template #default="{ row }">{{
              row.originalPrice ? `¥${fenToYuan(row.originalPrice)}` : "—"
            }}</template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="100">
            <template #default="{ row }">
              <ElTag :type="row.status === 'on-sale' ? 'success' : 'info'">{{
                row.status === "on-sale" ? "在售" : "已下架"
              }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="更新时间" min-width="150">
            <template #default="{ row }">{{
              fmtDateTime(row.updatedAt)
            }}</template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <ElButton
                v-if="hasPerm('PATCH /admin/night/catalog/:id')"
                link
                type="primary"
                @click="edit(asCatalog(row))"
                >编辑</ElButton
              >
              <ElButton
                v-if="hasPerm('PATCH /admin/night/catalog/:id')"
                link
                :type="row.status === 'on-sale' ? 'danger' : 'success'"
                @click="toggleStatus(asCatalog(row))"
                >{{ row.status === "on-sale" ? "下架" : "上架" }}</ElButton
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
    <ElDialog
      v-model="importOpen"
      title="从官方商品库导入夜宵商品"
      width="min(780px, calc(100vw - 32px))"
      :close-on-click-modal="false"
    >
      <ElAlert
        title="仅导入经营资料，不增加库存。导入后默认下架，请确认夜宵售价再上架。"
        type="info"
        :closable="false"
      />
      <div class="catalog-search" style="margin: 18px 0">
        <ElInput
          v-model="candidateKeyword"
          placeholder="搜索官方商品名称"
          @keyup.enter="
            candidatePage = 1;
            loadCandidates();
          "
        /><ElButton
          @click="
            candidatePage = 1;
            loadCandidates();
          "
          >查询</ElButton
        >
      </div>
      <div v-loading="importLoading" style="max-height: 430px; overflow: auto">
        <div
          v-for="c in candidates"
          :key="c.id"
          style="
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 14px 0;
            border-bottom: 1px solid var(--el-border-color-lighter);
          "
        >
          <ElCheckbox
            :model-value="selectedIds.includes(c.id)"
            @change="selectCandidate(c.id)"
          /><span style="flex: 1">{{ c.name }}</span
          ><span>{{ c.barcode || "无条码" }}</span
          ><span>建议零售价 ¥{{ fenToYuan(c.originalPrice) }}</span>
        </div>
        <ElEmpty
          v-if="!candidates.length && !importLoading"
          description="没有匹配的官方商品"
        />
      </div>
      <div
        style="display: flex; gap: 16px; align-items: center; margin-top: 16px"
      >
        <ElButton
          :disabled="candidatePage <= 1"
          @click="
            candidatePage--;
            loadCandidates();
          "
          >上一页</ElButton
        ><span>第 {{ candidatePage }} 页 · 共 {{ candidateTotal }} 种</span
        ><ElButton
          :disabled="candidatePage * 50 >= candidateTotal"
          @click="
            candidatePage++;
            loadCandidates();
          "
          >下一页</ElButton
        >
      </div>
      <template #footer
        ><ElButton @click="importOpen = false">取消</ElButton
        ><ElButton
          type="primary"
          :loading="saving"
          :disabled="!selectedIds.length || selectedIds.length > 100"
          @click="importSelected"
          >导入已选 {{ selectedIds.length }} 种</ElButton
        ></template
      >
    </ElDialog>
    <ElDialog
      v-model="open"
      :title="editing ? '编辑夜主档商品' : '新建夜主档商品'"
      width="min(680px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm label-position="top">
        <ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"><ElFormItem label="商品分类"><ElSelect v-model="form.categoryId" clearable filterable placeholder="留空使用夜宵专供分类" style="width:100%"><ElOption v-for="category in categories" :key="category.id" :value="category.id" :label="category.name" /></ElSelect></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="零售单位"><ElInput v-model="form.retailUnit" maxlength="20" placeholder="如：听、袋、份" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="商品名称">
              <ElInput v-model="form.name" maxlength="60" show-word-limit />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="条码（选填，同校区唯一）">
              <ElInput
                v-model="form.barcode"
                :disabled="!!editing"
                placeholder="扫码枪输入或手填"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="统一夜宵售价（元）">
              <ElInputNumber v-model="form.price" :min="0.01" :precision="2" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="划线价（元，0 = 不显示）">
              <ElInputNumber
                v-model="form.originalPrice"
                :min="0"
                :precision="2"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :span="24">
            <ElFormItem label="副标题（选填）">
              <ElInput v-model="form.subtitle" maxlength="60" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="24">
            <ElFormItem label="商品图">
              <ImageUploadField v-model="form.image" />
            </ElFormItem>
          </ElCol>
          <ElCol v-if="editing" :xs="24" :sm="12">
            <ElFormItem label="上下架状态">
              <ElSelect v-model="form.status">
                <ElOption label="在售" value="on-sale" />
                <ElOption label="已下架" value="off-sale" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>
      <template #footer>
        <ElButton @click="open = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="save">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>
<style scoped>
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.catalog-tip {
  flex: 1 1 320px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  align-self: center;
}
.catalog-search {
  display: flex;
  align-items: center;
  gap: 10px;
}
.catalog-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.catalog-filters .el-select {
  width: 170px;
}
.catalog-search :deep(.el-input) {
  flex: 1 1 220px;
}
.catalog-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.catalog-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.catalog-thumb {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 8px;
  border: 1px solid var(--line);
}
.catalog-thumb--empty {
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--muted);
  border-style: dashed;
}
.catalog-name-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 760px) {
  .catalog-search {
    align-items: stretch;
    flex-direction: column;
  }
  .catalog-search :deep(.el-button) {
    min-height: 44px;
    margin: 0;
  }
}
</style>
