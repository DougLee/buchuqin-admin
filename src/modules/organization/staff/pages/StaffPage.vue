<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { ROLE_OPTIONS, STAFF_STATUS_LABEL } from "../../../../dicts/staff";
import { STAFF_STATUS_TABS } from "../../../../dicts/status-tab";
import { activeCampus, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Building, Campus, Staff } from "../../../../types";

const rows = ref<Staff[]>([]), campuses = ref<Campus[]>([]), buildings = ref<Building[]>([]);
const loading = ref(false), saving = ref(false), open = ref(false), editing = ref<Staff | null>(null);
const page = ref(1), pageSize = ref(20), total = ref(0), keyword = ref(""), status = ref("all"), role = ref("");
const form = reactive({ campusId: "", name: "", staffNo: "", role: "building-manager", status: "online", buildingId: "" });
const isManager = computed(() => ["building-manager", "intern-building-manager"].includes(form.role));
function notify(message: string, type: "success" | "error" = "success") { ElMessage({ message, type, showClose: true }); }
function asStaff(row: unknown) { return row as Staff; }
async function load() {
  loading.value = true;
  try {
    const result = await api.staff({ page: page.value, pageSize: pageSize.value, keyword: keyword.value.trim() || undefined, role: role.value || undefined }, status.value === "all" ? undefined : status.value);
    rows.value = result.items; total.value = result.total;
  } catch (error) { notify(error instanceof Error ? error.message : "员工加载失败", "error"); }
  finally { loading.value = false; }
}
async function loadCampuses() { campuses.value = await api.campuses({ page: 1, pageSize: 1000 }); }
async function loadBuildings() {
  buildings.value = form.campusId ? (await api.buildings({ page: 1, pageSize: 1000, campusId: form.campusId })).items : [];
}
async function showForm(row?: Staff) {
  editing.value = row ?? null;
  Object.assign(form, { campusId: row?.campusId ?? activeCampus.value ?? "", name: row?.name ?? "", staffNo: row?.staffNo ?? "", role: row?.role ?? "building-manager", status: row?.status ?? "online", buildingId: row?.buildingId ?? "" });
  await loadBuildings(); open.value = true;
}
async function save() {
  if (!form.campusId || !form.name.trim() || !form.staffNo.trim()) return notify("请完整填写所属校区、姓名和工号", "error");
  saving.value = true;
  try {
    const body: Record<string, unknown> = { campusId: form.campusId, name: form.name.trim(), staffNo: form.staffNo.trim(), role: form.role, status: form.status };
    if (isManager.value) body.buildingId = form.buildingId || null;
    editing.value ? await api.updateStaff(editing.value.id, body) : await api.createStaff(body);
    open.value = false; notify(editing.value ? "员工账号已更新" : "员工账号已创建"); await load();
  } catch (error) { notify(error instanceof Error ? error.message : "保存失败", "error"); }
  finally { saving.value = false; }
}
async function remove(row: Staff) {
  try { await ElMessageBox.confirm(`确认删除员工「${row.name}」？`, "删除员工", { type: "warning" }); await api.deleteStaff(row.id); notify("员工账号已删除"); await load(); }
  catch (error) { if (error !== "cancel" && error !== "close") notify(error instanceof Error ? error.message : "删除失败", "error"); }
}
watch([page, pageSize, status, role], load);
watch(() => form.campusId, () => { form.buildingId = ""; void loadBuildings(); });
onMounted(async () => { await Promise.all([load(), loadCampuses()]); });
</script>
<template>
  <AdminPageShell title="履约人员" eyebrow="TEAM PERFORMANCE" description="楼长与配送员账号状态、绩效和服务范围。">
    <template #actions><ElButton v-if="hasPerm('POST /admin/staff')" type="primary" @click="showForm()">新增员工</ElButton></template>
    <ElTabs v-model="status"><ElTabPane v-for="tab in STAFF_STATUS_TABS" :key="tab.key" :label="tab.label" :name="tab.key" /></ElTabs>
    <div class="toolbar"><ElInput v-model="keyword" clearable placeholder="搜索姓名或工号" class="search" @keyup.enter="page = 1; load()"/><ElSelect v-model="role" clearable placeholder="全部角色" class="filter"><ElOption v-for="item in ROLE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" /></ElSelect><ElButton @click="page = 1; load()">查询</ElButton></div>
    <ElTable v-loading="loading" :data="rows" row-key="id"><ElTableColumn prop="staffNo" label="工号" width="130"/><ElTableColumn prop="name" label="姓名" min-width="120"/><ElTableColumn prop="roleText" label="角色" min-width="130"/><ElTableColumn prop="building" label="服务范围" min-width="150"/><ElTableColumn prop="completedToday" label="今日完成" width="100"/><ElTableColumn prop="onTimeRate" label="准时率" width="100"/><ElTableColumn label="状态" width="110"><template #default="{ row }"><ElTag>{{ STAFF_STATUS_LABEL[row.status] ?? row.status }}</ElTag></template></ElTableColumn><ElTableColumn label="操作" width="160" fixed="right"><template #default="{ row }"><ElButton v-if="hasPerm('PATCH /admin/staff/:id')" link type="primary" @click="showForm(asStaff(row))">编辑</ElButton><ElButton v-if="hasPerm('DELETE /admin/staff/:id')" link type="danger" @click="remove(asStaff(row))">删除</ElButton></template></ElTableColumn></ElTable>
    <AdminPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    <ElDialog v-model="open" :title="editing ? '编辑员工账号' : '新增员工账号'" width="min(680px, calc(100vw - 32px))" align-center :close-on-click-modal="false"><ElForm label-position="top" class="grid"><ElFormItem label="所属校区"><ElSelect v-model="form.campusId" filterable><ElOption v-for="item in campuses" :key="item.id" :label="item.name" :value="item.id" /></ElSelect></ElFormItem><ElFormItem label="姓名"><ElInput v-model="form.name" /></ElFormItem><ElFormItem label="工号"><ElInput v-model="form.staffNo" /></ElFormItem><ElFormItem label="角色"><ElSelect v-model="form.role"><ElOption v-for="item in ROLE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" /></ElSelect></ElFormItem><ElFormItem label="状态"><ElSelect v-model="form.status"><ElOption label="在线" value="online"/><ElOption label="暂停" value="paused"/><ElOption label="离线" value="offline"/></ElSelect></ElFormItem><ElFormItem v-if="isManager" label="绑定楼栋（可留空）"><ElSelect v-model="form.buildingId" clearable><ElOption v-for="item in buildings" :key="item.id" :label="item.name" :value="item.id" /></ElSelect></ElFormItem></ElForm><template #footer><ElButton @click="open = false">取消</ElButton><ElButton type="primary" :loading="saving" @click="save">保存</ElButton></template></ElDialog>
  </AdminPageShell>
</template>
<style scoped>.search{width:min(320px,100%)}.filter{width:180px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.grid :deep(.el-select){width:100%}@media(max-width:640px){.grid{grid-template-columns:1fr}}</style>
