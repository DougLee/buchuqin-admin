<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import NightLoadError from '../../NightLoadError.vue';
import { ElMessage, ElMessageBox } from "element-plus";
import { useRouter } from "vue-router";
import { api, fetchAllPages } from "../../../../api";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import { fenToYuan } from "../../../../utils/money";
import type {
  NightBuildingProductRow,
  NightCatalogRow,
  NightStoreRow,
} from "../../../../types";
const router = useRouter();
const rows = ref<NightBuildingProductRow[]>([]);
const stores = ref<NightStoreRow[]>([]);
const categories = ref<Array<{ id: string; name: string }>>([]);
const filters = reactive({
  keyword: "",
  storeId: "",
  stock: "",
  saleAllowed: "",
  onShelf: "",
  categoryId: "",
});
const loading = ref(false),
  busy = ref(false);
const loadError = ref('');
const page = ref(1),
  pageSize = ref(20),
  total = ref(0);
let generation = 0;
async function load() {
  const current = ++generation;
  loadError.value = '';
  if (!effectiveCampusId.value) {
    rows.value = [];
    total.value = 0;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const r = await api.nightBuildingProducts(
      { ...filters, keyword: filters.keyword.trim() },
      page.value,
      pageSize.value,
    );
    if (generation === current) {
      rows.value = r.items;
      total.value = r.total;
    }
  } catch (e) {
    if (current === generation) loadError.value = e instanceof Error ? e.message : '楼栋商品加载失败';
  } finally {
    if (generation === current) loading.value = false;
  }
}
async function loadOptions() {
  const campus = effectiveCampusId.value;
  if (!campus) return;
  try {
    const [s, catalog] = await Promise.all([
      fetchAllPages((q) => api.nightStores(undefined, q.page, q.pageSize), 100),
      api.nightCatalog(undefined, 1, 1),
    ]);
    if (campus === effectiveCampusId.value) {
      stores.value = s;
      categories.value = catalog.categories ?? [];
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "筛选选项加载失败");
  }
}
function search() {
  if (page.value !== 1) page.value = 1;
  else void load();
}
function reset() {
  Object.assign(filters, {
    keyword: "",
    storeId: "",
    stock: "",
    saleAllowed: "",
    onShelf: "",
    categoryId: "",
  });
  search();
}
watch([page, pageSize], load);
watch(effectiveCampusId, () => {
  attachOpen.value = false;
  stores.value = [];
  categories.value = [];
  reset();
  void loadOptions();
});
onMounted(() => {
  void load();
  void loadOptions();
});
function detail(row: NightBuildingProductRow) {
  router.push({
    path: `/night-stores/${row.storeId}`,
    query: { tab: "products" },
  });
}
async function toggle(row: NightBuildingProductRow) {
  if (busy.value) return;
  const campus = effectiveCampusId.value;
  try {
    await ElMessageBox.confirm(
      row.saleAllowed
        ? `停售后，${row.buildingName}的「${row.name}」将不能销售或继续备货，已有库存仍保留。`
        : "恢复校区售卖许可后，仍需商品库在售、楼长上架且有库存才能销售。",
      row.saleAllowed ? "确认校区停售" : "恢复售卖许可",
    );
  } catch {
    return;
  }
  if (campus !== effectiveCampusId.value) return;
  busy.value = true;
  try {
    await api.updateNightStoreProduct(row.storeId, row.id, !row.saleAllowed);
    ElMessage.success("售卖许可已更新");
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "操作失败");
  } finally {
    busy.value = false;
  }
}
const attachOpen = ref(false),
  attachLoading = ref(false),
  attachStoreId = ref(""),
  attachKeyword = ref("");
const catalog = ref<NightCatalogRow[]>([]),
  selected = ref<string[]>([]),
  attached = ref(new Set<string>());
const candidates = computed(() =>
  catalog.value.filter((p) =>
    `${p.name} ${p.barcode || ""}`
      .toLowerCase()
      .includes(attachKeyword.value.trim().toLowerCase()),
  ),
);
async function startAttach() {
  const campus = effectiveCampusId.value;
  attachStoreId.value = filters.storeId;
  attachKeyword.value = "";
  selected.value = [];
  attached.value = new Set();
  attachOpen.value = true;
  catalog.value = [];
  attachLoading.value = true;
  try {
    const rows = await fetchAllPages(
      (q) =>
        api.nightCatalog(undefined, q.page, q.pageSize, { status: "on-sale" }),
      100,
    );
    if (campus !== effectiveCampusId.value || !attachOpen.value) return;
    catalog.value = rows;
    await loadAttached();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "商品库加载失败");
  } finally {
    attachLoading.value = false;
  }
}
let attachGeneration = 0;
async function loadAttached() {
  const current = ++attachGeneration;
  const campus = effectiveCampusId.value;
  selected.value = [];
  attached.value = new Set();
  if (!attachStoreId.value) return;
  attachLoading.value = true;
  try {
    const products = await fetchAllPages(
      (q) =>
        api.nightBuildingProducts(
          { storeId: attachStoreId.value },
          q.page,
          q.pageSize,
        ),
      100,
    );
    if (current === attachGeneration && campus === effectiveCampusId.value)
      attached.value = new Set(products.map((p) => p.catalogProductId));
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "已配商品加载失败");
  } finally {
    if (current === attachGeneration) attachLoading.value = false;
  }
}
function choose(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}
async function attach() {
  if (
    !attachStoreId.value ||
    !selected.value.length ||
    busy.value ||
    attachLoading.value
  )
    return;
  busy.value = true;
  try {
    const r = await api.attachNightStoreProducts(
      attachStoreId.value,
      selected.value,
    );
    attachOpen.value = false;
    ElMessage.success(
      `已配置 ${r.attached} 种商品，未增加库存；楼长可申请备货。`,
    );
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "配商品失败");
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <NightLoadError :message="loadError" :loading="loading" @retry="load" />
    <section
      class="admin-filter-panel product-filters"
      aria-label="楼栋商品筛选"
    >
      <ElInput
        v-model="filters.keyword"
        placeholder="商品 / 条码 / 楼栋 / 楼长"
        clearable
        @keyup.enter="search"
      />
      <ElSelect
        v-model="filters.storeId"
        placeholder="全部楼栋 / 楼长"
        clearable
        filterable
        @change="search"
        ><ElOption
          v-for="s in stores"
          :key="s.id"
          :label="`${s.buildingName} · ${s.manager?.name || '未绑定楼长'}`"
          :value="s.id"
      /></ElSelect>
      <ElSelect
        v-model="filters.categoryId"
        placeholder="全部商品分类"
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
        placeholder="全部库存状态"
        clearable
        @change="search"
        ><ElOption label="有可售库存" value="available" /><ElOption
          label="可售库存为0"
          value="empty" /><ElOption label="有冻结库存" value="frozen"
      /></ElSelect>
      <ElSelect
        v-model="filters.saleAllowed"
        placeholder="全部校区许可"
        clearable
        @change="search"
        ><ElOption label="允许售卖" value="true" /><ElOption
          label="校区停售"
          value="false"
      /></ElSelect>
      <ElSelect
        v-model="filters.onShelf"
        placeholder="全部楼长上架状态"
        clearable
        @change="search"
        ><ElOption label="楼长已上架" value="true" /><ElOption
          label="楼长已下架"
          value="false"
      /></ElSelect>
      <ElButton type="primary" :loading="loading" @click="search">查询</ElButton
      ><ElButton @click="reset">重置</ElButton>
    </section>
    <section v-loading="loading" class="admin-table-panel">
      <div class="toolbar">
        <span class="muted"
          >校区许可、楼长上下架与商品库状态共同决定是否可售；配置商品不增加库存。</span
        ><ElButton
          v-if="hasPerm('POST /admin/night/stores/:id/products')"
          type="primary"
          @click="startAttach"
          >配置楼栋商品</ElButton
        >
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>楼栋 / 楼长</th>
              <th>商品 / 分类</th>
              <th>夜宵售价</th>
              <th>可售 / 冻结</th>
              <th>历史货值</th>
              <th>校区许可</th>
              <th>楼长选择</th>
              <th>当前可售</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id">
              <td>
                {{ p.buildingName
                }}<small>{{ p.managerName || "未绑定楼长" }}</small>
              </td>
              <td>
                <div class="product">
                  <ElImage v-if="p.image" :src="p.image" fit="cover" /><span
                    >{{ p.name
                    }}<small
                      >{{ p.categoryName }} · {{ p.barcode || "无条码" }}</small
                    ></span
                  >
                </div>
              </td>
              <td>¥{{ fenToYuan(p.price) }}</td>
              <td>{{ p.stock }} / {{ p.frozenStock }}</td>
              <td>¥{{ fenToYuan(p.inventoryValue) }}</td>
              <td>
                <ElTag :type="p.saleAllowed ? 'success' : 'danger'">{{
                  p.saleAllowed ? "允许" : "停售"
                }}</ElTag>
              </td>
              <td>{{ p.onShelf ? "已上架" : "已下架" }}</td>
              <td>
                <ElTag :type="p.purchasable ? 'success' : 'info'">{{
                  p.purchasable
                    ? "可售"
                    : p.catalogStatus !== "on-sale"
                      ? "商品库已下架"
                      : "不可售"
                }}</ElTag>
              </td>
              <td>
                <ElButton
                  v-if="
                    hasPerm('PATCH /admin/night/stores/:id/products/:productId')
                  "
                  link
                  :type="p.saleAllowed ? 'danger' : 'success'"
                  :disabled="busy"
                  @click="toggle(p)"
                  >{{ p.saleAllowed ? "校区停售" : "恢复许可" }}</ElButton
                ><ElButton link type="primary" @click="detail(p)"
                  >商品与库存</ElButton
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ElEmpty
        v-if="!rows.length && !loading"
        description="没有匹配的楼栋商品，可调整筛选或配置商品"
      />
      <AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>
    <ElDialog
      v-model="attachOpen"
      title="配置楼栋商品"
      width="min(760px, calc(100vw - 32px))"
      :close-on-click-modal="false"
    >
      <ElAlert
        title="从本校区已上架夜宵商品中配置到指定楼栋，不会增加库存或占用额度。"
        type="info"
        :closable="false"
      />
      <ElSelect
        v-model="attachStoreId"
        placeholder="请选择目标楼栋"
        filterable
        style="width: 100%; margin: 18px 0"
        @change="loadAttached"
        ><ElOption
          v-for="s in stores"
          :key="s.id"
          :label="`${s.buildingName} · ${s.manager?.name || '未绑定楼长'}`"
          :value="s.id"
      /></ElSelect>
      <ElInput
        v-model="attachKeyword"
        placeholder="搜索商品名称 / 条码"
        clearable
      />
      <div v-loading="attachLoading" class="attach-list">
        <div v-for="p in candidates" :key="p.id" class="attach-row">
          <ElCheckbox
            :model-value="selected.includes(p.id)"
            :disabled="!attachStoreId || attached.has(p.id)"
            @change="choose(p.id)"
            >{{ p.name }}</ElCheckbox
          ><span class="muted">{{
            attached.has(p.id) ? "已配置" : "¥" + fenToYuan(p.price)
          }}</span>
        </div>
        <ElEmpty
          v-if="!candidates.length && !attachLoading"
          description="暂无匹配的在售夜宵商品"
        />
      </div>
      <template #footer
        ><ElButton @click="attachOpen = false">取消</ElButton
        ><ElButton
          type="primary"
          :disabled="
            !attachStoreId ||
            !selected.length ||
            selected.length > 100 ||
            attachLoading
          "
          :loading="busy"
          @click="attach"
          >配置已选 {{ selected.length }} 种</ElButton
        ></template
      >
    </ElDialog>
  </div>
</template>
<style scoped>
.product-filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.product-filters .el-input {
  width: 240px;
}
.product-filters .el-select {
  width: 185px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.table-scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th {
  font-weight: 500;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}
th,
td {
  padding: 15px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  white-space: nowrap;
}
.muted,
small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
small {
  display: block;
  margin-top: 6px;
}
.product {
  display: flex;
  gap: 12px;
  align-items: center;
}
.product .el-image {
  width: 42px;
  height: 42px;
  border-radius: 8px;
}
.attach-list {
  max-height: 380px;
  overflow: auto;
  margin-top: 18px;
}
.attach-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.attach-row .el-checkbox {
  max-width: 85%;
  height: auto;
  white-space: normal;
}
</style>
