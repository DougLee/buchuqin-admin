<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import {
  effectiveCampusId,
  hasPerm,
} from "../../../../session";
import type { Category } from "../../../../types";
import { resolveImageUrl } from "../../../../utils/image";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import { useAsyncCollection } from "../../../../shared/data/useAsyncCollection";
import { categoryApi, type CategoryInput } from "../api";

const {
  rows,
  loading,
  error: loadError,
  load,
} = useAsyncCollection(categoryApi.list);
const notify = (message: string, error = false) =>
  ElMessage({ message, type: error ? "error" : "success", showClose: true });
const keyword = ref("");
const page = ref(1),
  pageSize = ref(20);
const editorOpen = ref(false),
  saving = ref(false),
  editingId = ref<string | null>(null);
const confirmDeleteId = ref("");
const form = ref<CategoryInput & { visible: boolean }>({
  name: "",
  sort: 10,
  image: "",
  hidden: false,
  visible: true,
});
const canCreate = computed(() => hasPerm("POST /admin/categories"));
const canUpdate = computed(() => hasPerm("PATCH /admin/categories/:id"));
const canDelete = computed(() => hasPerm("DELETE /admin/categories/:id"));
const asCategory = (row: unknown) => row as Category;
const operationalCampusId = effectiveCampusId;
const filtered = computed(() => {
  const query = keyword.value.trim();
  return query
    ? rows.value.filter((row) => row.name.includes(query))
    : rows.value;
});
const total = computed(() => filtered.value.length);
const pagedRows = computed(() =>
  filtered.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
watch([keyword, pageSize], () => {
  page.value = 1;
});

function createCategory() {
  editingId.value = null;
  form.value = {
    name: "",
    sort: (rows.value.length + 1) * 10,
    image: "",
    hidden: false,
    visible: true,
  };
  editorOpen.value = true;
}
function editCategory(row: Category) {
  editingId.value = row.id;
  form.value = {
    name: row.name,
    sort: row.sort,
    image: row.image || "",
    hidden: !!row.hidden,
    visible: !row.hidden,
  };
  editorOpen.value = true;
}
async function save() {
  const name = form.value.name.trim();
  if (!name) {
    notify("请填写类别名称", true);
    return;
  }
  saving.value = true;
  const input: CategoryInput = {
    name,
    sort: Number(form.value.sort || 0),
    image: String(form.value.image || ""),
    hidden: !form.value.visible,
  };
  try {
    if (editingId.value) await categoryApi.update(editingId.value, input);
    else await categoryApi.create(input);
    editorOpen.value = false;
    notify(editingId.value ? "类别信息已更新" : "类别已创建");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  } finally {
    saving.value = false;
  }
}
async function toggleVisible(row: Category) {
  try {
    await categoryApi.update(row.id, { hidden: !row.hidden });
    notify(row.hidden ? "分类已显示" : "分类已隐藏");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
async function remove(row: Category) {
  if (confirmDeleteId.value !== row.id) {
    confirmDeleteId.value = row.id;
    return;
  }
  try {
    await categoryApi.remove(row.id);
    confirmDeleteId.value = "";
    notify("类别已删除");
    await load();
  } catch (error) {
    confirmDeleteId.value = "";
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
function loadForCampus() {
  if (!operationalCampusId.value) {
    rows.value = [];
    return;
  }
  void load();
}
onMounted(loadForCampus);
watch(operationalCampusId, () => {
  page.value = 1;
  editorOpen.value = false;
  loadForCampus();
});
</script>

<template>
  <AdminPageShell
    title="商品类别"
    eyebrow="PRODUCT CATEGORIES"
    description="维护小程序分类 tab 的类别字典，排序越小越靠前。"
  >
    <template #actions
      ><ElButton
        v-if="canCreate"
        type="primary"
        :disabled="!operationalCampusId"
        @click="createCategory"
        >＋ 新建类别</ElButton
      ></template
    >
    <section class="admin-filter-panel" aria-label="类别筛选">
      <ElForm class="admin-filter-form" label-position="top"
        ><ElRow :gutter="12" align="bottom"
          ><ElCol :xs="24" :sm="18"
            ><ElInput
              v-model="keyword"
              clearable
              placeholder="搜索类别名称" /></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElFormItem label=" "
              ><ElButton
                :loading="loading"
                :disabled="!operationalCampusId"
                @click="loadForCampus"
                >刷新</ElButton
              ></ElFormItem
            ></ElCol
          ></ElRow
        ></ElForm
      >
    </section>
    <div v-if="loadError" class="load-error">
      <span>{{ loadError }}</span
      ><ElButton @click="loadForCampus">重试</ElButton>
    </div>
    <section class="admin-table-panel" aria-label="类别列表">
      <ElTable
        v-loading="loading"
        :data="pagedRows"
        row-key="id"
        :empty-text="operationalCampusId ? '暂无数据' : '请先在顶部选择校区'"
      >
        <ElTableColumn label="图片" width="88"
          ><template #default="{ row }"
            ><ElImage
              v-if="row.image"
              class="cell-thumb"
              :src="resolveImageUrl(row.image)"
              :preview-src-list="[resolveImageUrl(row.image)]"
              preview-teleported
              hide-on-click-modal
              fit="cover"
              alt="类别图片" /></template
        ></ElTableColumn>
        <ElTableColumn prop="name" label="类别名称" min-width="160"
          ><template #default="{ row }"
            ><strong>{{ row.name }}</strong></template
          ></ElTableColumn
        >
        <ElTableColumn prop="sort" label="排序" width="90" />
        <ElTableColumn prop="productCount" label="商品数" width="100" />
        <ElTableColumn label="小程序显示" width="120"
          ><template #default="{ row }"
            ><ElTag :type="row.hidden ? 'warning' : 'success'">{{
              row.hidden ? "已隐藏" : "显示中"
            }}</ElTag></template
          ></ElTableColumn
        >
        <ElTableColumn label="操作" fixed="right" width="230"
          ><template #default="{ row }"
            ><ElButton
              v-if="canUpdate"
              size="small"
              @click="toggleVisible(asCategory(row))"
              >{{ row.hidden ? "显示" : "隐藏" }}</ElButton
            ><ElButton
              v-if="canUpdate"
              size="small"
              type="primary"
              @click="editCategory(asCategory(row))"
              >编辑</ElButton
            ><ElButton
              v-if="canDelete"
              size="small"
              type="danger"
              plain
              @click="remove(asCategory(row))"
              >{{ confirmDeleteId === row.id ? "确认删除" : "删除" }}</ElButton
            ></template
          ></ElTableColumn
        >
      </ElTable>
      <AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>

    <ElDialog
      v-model="editorOpen"
      :title="editingId ? '编辑商品类别' : '新建商品类别'"
      width="min(620px, calc(100vw - 32px))"
      align-center
      destroy-on-close
      :close-on-click-modal="false"
    >
      <ElForm label-position="top">
        <ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="类别名称"
              ><ElInput
                v-model="form.name"
                placeholder="如：饮料" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="排序（越小越靠前）"
              ><ElInputNumber v-model="form.sort" :min="0" /></ElFormItem
          ></ElCol>
          <ElCol :span="24"
            ><ElFormItem label="类别图片"
              ><ImageUploadField
                v-model="form.image!"
                folder="app/category" /></ElFormItem
          ></ElCol>
          <ElCol :span="24"
            ><ElFormItem
              ><ElCheckbox v-model="form.visible"
                >在小程序显示该分类</ElCheckbox
              ></ElFormItem
            ></ElCol
          >
        </ElRow>
      </ElForm>
      <template #footer
        ><ElButton @click="editorOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      >
    </ElDialog>
  </AdminPageShell>
</template>

<style scoped>
.el-input-number {
  width: 100%;
}
</style>
