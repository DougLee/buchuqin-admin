<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { activeCampus, canWrite, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import { fmtDateTime } from "../../../../utils/datetime";

interface LocationItem { id: string; name: string; note: string; sort: number; createdAt: string }
const rows = ref<LocationItem[]>([]);
const loading = ref(false);
const dialogOpen = ref(false);
const saving = ref(false);
const editingId = ref("");
const form = reactive({ name: "", note: "", sort: 0 });
const writable = computed(() => canWrite("locations"));
function asLocation(row: unknown): LocationItem { return row as LocationItem; }

async function load() {
  loading.value = true;
  try { rows.value = await api.adminLocations(); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "库位加载失败"); }
  finally { loading.value = false; }
}
function openCreate() {
  editingId.value = "";
  Object.assign(form, { name: "", note: "", sort: 0 });
  dialogOpen.value = true;
}
function openEdit(row: LocationItem) {
  editingId.value = row.id;
  Object.assign(form, { name: row.name, note: row.note ?? "", sort: Number(row.sort ?? 0) });
  dialogOpen.value = true;
}
async function save() {
  if (!form.name.trim()) return ElMessage.error("请填写库位名称");
  saving.value = true;
  try {
    const payload = { name: form.name.trim(), note: form.note.trim(), sort: Number(form.sort || 0) };
    if (editingId.value) await api.updateLocation(editingId.value, payload);
    else await api.createLocation(payload);
    ElMessage.success(editingId.value ? "库位已更新" : "库位已创建");
    dialogOpen.value = false;
    await load();
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "保存失败"); }
  finally { saving.value = false; }
}
async function remove(row: LocationItem) {
  try { await ElMessageBox.confirm(`确认删除库位「${row.name}」？`, "删除库位", { type: "warning", confirmButtonText: "确认删除", cancelButtonText: "取消" }); }
  catch { return; }
  try { await api.deleteLocation(row.id); ElMessage.success("库位已删除"); await load(); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "删除失败"); }
}
onMounted(load);
watch(activeCampus, () => void load());
</script>

<template>
  <AdminPageShell title="库位管理" eyebrow="STORAGE LOCATIONS" description="维护仓库库位区域字典，商品编辑时下拉选择，拣货按库位找货。">
    <template #actions><ElButton v-if="writable && hasPerm('POST /admin/locations')" type="primary" @click="openCreate">＋ 新建库位</ElButton></template>
    <div class="data-panel">
      <ElTable v-loading="loading" :data="rows" row-key="id" empty-text="暂无库位">
        <ElTableColumn prop="name" label="库位名称" min-width="180" />
        <ElTableColumn prop="note" label="备注" min-width="240"><template #default="{ row }">{{ row.note || '—' }}</template></ElTableColumn>
        <ElTableColumn prop="sort" label="排序" width="100" />
        <ElTableColumn label="创建时间" min-width="180"><template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template></ElTableColumn>
        <ElTableColumn v-if="writable" label="操作" fixed="right" width="170"><template #default="{ row }"><ElButton v-if="hasPerm('PATCH /admin/locations/:id')" size="small" @click="openEdit(asLocation(row))">编辑</ElButton><ElButton v-if="hasPerm('DELETE /admin/locations/:id')" size="small" type="danger" plain @click="remove(asLocation(row))">删除</ElButton></template></ElTableColumn>
      </ElTable>
    </div>
    <ElDialog v-model="dialogOpen" :title="editingId ? '编辑库位' : '新建库位'" width="min(520px, calc(100vw - 32px))" align-center :close-on-click-modal="false">
      <ElForm label-position="top" @submit.prevent="save">
        <ElFormItem label="库位名称" required><ElInput v-model.trim="form.name" placeholder="如：冷藏A / 常温B" /></ElFormItem>
        <ElFormItem label="排序（越小越靠前）"><ElInputNumber v-model="form.sort" :min="0" /></ElFormItem>
        <ElFormItem label="备注（选填）"><ElInput v-model.trim="form.note" placeholder="如：靠门冰柜第2层" /></ElFormItem>
      </ElForm>
      <template #footer><ElButton @click="dialogOpen = false">取消</ElButton><ElButton type="primary" :loading="saving" @click="save">保存</ElButton></template>
    </ElDialog>
  </AdminPageShell>
</template>
