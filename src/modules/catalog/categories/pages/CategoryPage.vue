<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import { activeCampus, hasPerm } from "../../../../session";
import type { Category } from "../../../../types";
import { resolveImageUrl } from "../../../../utils/image";
import AdminDataView from "../../../../shared/ui/AdminDataView.vue";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import CampusScopeSelect from "../../../../shared/ui/CampusScopeSelect.vue";
import { useAsyncCollection } from "../../../../shared/data/useAsyncCollection";
import { useTransientMessage } from "../../../../shared/feedback/useTransientMessage";
import { categoryApi, type CategoryInput } from "../api";

const { rows, loading, error: loadError, load } = useAsyncCollection(categoryApi.list);
const { message, messageError, notify } = useTransientMessage();
const keyword = ref("");
const page = ref(1), pageSize = ref(20);
const editorOpen = ref(false), saving = ref(false), editingId = ref<string | null>(null);
const confirmDeleteId = ref("");
const form = ref<CategoryInput & { visible: boolean }>({ name: "", sort: 10, image: "", hidden: false, visible: true });
const canCreate = computed(() => hasPerm("POST /admin/categories"));
const canUpdate = computed(() => hasPerm("PATCH /admin/categories/:id"));
const canDelete = computed(() => hasPerm("DELETE /admin/categories/:id"));
const filtered = computed(() => {
  const query = keyword.value.trim();
  return query ? rows.value.filter((row) => row.name.includes(query)) : rows.value;
});
const total = computed(() => filtered.value.length);
const pagedRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch([keyword, pageSize], () => { page.value = 1; });

function changeCampus(campusId: string) {
  activeCampus.value = campusId;
  page.value = 1;
  void load();
}
function createCategory() {
  editingId.value = null;
  form.value = { name: "", sort: (rows.value.length + 1) * 10, image: "", hidden: false, visible: true };
  editorOpen.value = true;
}
function editCategory(row: Category) {
  editingId.value = row.id;
  form.value = { name: row.name, sort: row.sort, image: row.image || "", hidden: !!row.hidden, visible: !row.hidden };
  editorOpen.value = true;
}
async function save() {
  const name = form.value.name.trim();
  if (!name) { notify("请填写类别名称", true); return; }
  saving.value = true;
  const input: CategoryInput = { name, sort: Number(form.value.sort || 0), image: String(form.value.image || ""), hidden: !form.value.visible };
  try {
    if (editingId.value) await categoryApi.update(editingId.value, input);
    else await categoryApi.create(input);
    editorOpen.value = false; notify(editingId.value ? "类别信息已更新" : "类别已创建"); await load();
  } catch (error) { notify(error instanceof Error ? error.message : "保存失败", true); }
  finally { saving.value = false; }
}
async function toggleVisible(row: Category) {
  try { await categoryApi.update(row.id, { hidden: !row.hidden }); notify(row.hidden ? "分类已显示" : "分类已隐藏"); await load(); }
  catch (error) { notify(error instanceof Error ? error.message : "操作失败", true); }
}
async function remove(row: Category) {
  if (confirmDeleteId.value !== row.id) { confirmDeleteId.value = row.id; return; }
  try { await categoryApi.remove(row.id); confirmDeleteId.value = ""; notify("类别已删除"); await load(); }
  catch (error) { confirmDeleteId.value = ""; notify(error instanceof Error ? error.message : "删除失败", true); }
}
onMounted(load);
</script>

<template>
  <AdminPageShell title="商品类别" eyebrow="PRODUCT CATEGORIES" description="维护小程序分类 tab 的类别字典，排序越小越靠前。">
    <template #actions><button v-if="canCreate" class="btn primary" @click="createCategory">＋ 新建类别</button></template>
    <div class="toolbar">
      <div class="filter-search"><span></span><input v-model="keyword" placeholder="搜索类别名称" /></div>
      <CampusScopeSelect :model-value="activeCampus" @change="changeCampus" />
      <div class="toolbar-spacer"></div>
      <button class="btn ghost" :disabled="loading" @click="load">刷新</button>
    </div>
    <div v-if="loadError" class="load-error"><span>{{ loadError }}</span><button class="btn ghost" @click="load">重试</button></div>
    <AdminDataView>
      <template #desktop>
        <div class="table-wrap"><table><thead><tr><th>图片</th><th>类别名称</th><th>排序</th><th>商品数</th><th>小程序显示</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-if="loading" v-for="i in 5" :key="i"><td colspan="6"><div class="row-skeleton"></div></td></tr>
            <tr v-else-if="!pagedRows.length"><td colspan="6" class="empty-cell">暂无数据</td></tr>
            <tr v-for="row in loading ? [] : pagedRows" :key="row.id">
              <td><img v-if="row.image" class="cell-thumb" :src="resolveImageUrl(row.image)" alt="类别图片" /></td>
              <td><strong>{{ row.name }}</strong></td><td>{{ row.sort }}</td><td>{{ row.productCount ?? 0 }}</td>
              <td><span class="status" :class="{ success: !row.hidden, warning: row.hidden }">{{ row.hidden ? "已隐藏" : "显示中" }}</span></td>
              <td class="row-actions"><button v-if="canUpdate" class="btn mini ghost" @click="toggleVisible(row)">{{ row.hidden ? "显示" : "隐藏" }}</button><button v-if="canUpdate" class="btn mini primary" @click="editCategory(row)">编辑</button><button v-if="canDelete" class="btn mini danger-btn" @click="remove(row)">{{ confirmDeleteId === row.id ? "确认删除" : "删除" }}</button></td>
            </tr>
          </tbody></table></div>
      </template>
      <template #mobile>
        <article v-for="row in loading ? [] : pagedRows" :key="row.id" class="category-card" :class="{ 'category-card--no-image': !row.image }">
          <img v-if="row.image" :src="resolveImageUrl(row.image)" alt="类别图片" /><div><header><strong>{{ row.name }}</strong><span class="status" :class="{ success: !row.hidden }">{{ row.hidden ? "已隐藏" : "显示中" }}</span></header><p>排序 {{ row.sort }} · {{ row.productCount ?? 0 }} 个商品</p><footer><button v-if="canUpdate" class="btn mini ghost" @click="toggleVisible(row)">{{ row.hidden ? "显示" : "隐藏" }}</button><button v-if="canUpdate" class="btn mini primary" @click="editCategory(row)">编辑</button><button v-if="canDelete" class="btn mini danger-btn" @click="remove(row)">{{ confirmDeleteId === row.id ? "确认" : "删除" }}</button></footer></div>
        </article>
        <div v-if="loading" v-for="i in 4" :key="i" class="category-card category-card--no-image"><div class="row-skeleton"></div></div>
        <p v-else-if="!pagedRows.length" class="mobile-empty">暂无数据</p>
      </template>
    </AdminDataView>
    <AdminPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />

    <div v-if="editorOpen" class="drawer-mask" @click.self="editorOpen = false"><aside class="drawer product-create"><div class="drawer-head"><div><p class="eyebrow">{{ editingId ? "EDIT CATEGORY" : "NEW CATEGORY" }}</p><h2>{{ editingId ? "编辑商品类别" : "新建商品类别" }}</h2></div><button aria-label="关闭" @click="editorOpen = false">×</button></div><form class="category-form" @submit.prevent="save"><label>类别名称<input v-model="form.name" placeholder="如：饮料" /></label><label>排序（越小越靠前）<input v-model.number="form.sort" type="number" /></label><label class="wide">类别图片<ImageUploadField v-model="form.image!" folder="app/category" /></label><label class="wide checkbox-line"><input v-model="form.visible" type="checkbox" />在小程序显示该分类</label></form><div class="drawer-actions"><button class="btn ghost" @click="editorOpen = false">取消</button><button class="btn primary" :disabled="saving" @click="save">{{ saving ? "保存中..." : "保存" }}</button></div></aside></div>
    <div v-if="message" class="toast" :class="{ error: messageError }">{{ message }}</div>
  </AdminPageShell>
</template>

<style scoped>
.category-card { display: grid; grid-template-columns: 58px 1fr; gap: 12px; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 13px; }
.category-card--no-image { grid-template-columns: 1fr; }
.category-card > img { width: 58px; height: 58px; border-radius: 11px; object-fit: cover; }
.category-card header, .category-card footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.category-card p { color: var(--muted); font-size: 12px; }
.category-card footer { justify-content: flex-end; flex-wrap: wrap; }
.mobile-empty { padding: 30px; text-align: center; color: var(--muted); }
.category-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 22px 26px; }
.category-form label { display: grid; gap: 8px; color: #37423c; font-size: 13px; font-weight: 600; }
.category-form label > input:not([type='checkbox']) { width: 100%; height: 40px; border: 1px solid var(--line); border-radius: 9px; padding: 0 10px; }
.category-form .wide { grid-column: 1 / -1; }
.checkbox-line { display: flex; grid-template-columns: auto 1fr; align-items: center; }
.checkbox-line input { width: 20px; height: 20px; }
@media (max-width: 760px) { .category-form { grid-template-columns: 1fr; margin: 16px; } .category-form .wide { grid-column: auto; } }
</style>
