<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import {
  accountOrganizationId,
  accountOrgLevel,
  hasPerm,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import type { AdminOrganization, Campus } from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
type CampusRow = Campus & {
  deliveryFeeInstant?: number;
  deliveryFeeScheduled?: number;
  deliveryThreshold?: number;
  buildingManagerBaseSalary?: number;
};
const rows = ref<CampusRow[]>([]),
  organizations = ref<AdminOrganization[]>([]),
  loading = ref(false),
  saving = ref(false),
  open = ref(false),
  keyword = ref(""),
  editing = ref<CampusRow | null>(null);
const form = reactive({
  organizationId: "",
  name: "",
  shortName: "",
  warehouseName: "",
  address: "",
  status: "active" as "active" | "inactive",
  instant: 4,
  scheduled: 2,
  threshold: 10,
  baseSalary: 0,
});
const isPlatformAccount = computed(() => accountOrgLevel.value === "platform");
function asCampus(row: unknown) {
  return row as CampusRow;
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function orgName(id: string | null | undefined) {
  return organizations.value.find((o) => o.id === id)?.name || "—";
}
async function load() {
  loading.value = true;
  try {
    const [campuses, orgs] = await Promise.all([
      api.campuses({
        page: 1,
        pageSize: 1000,
        keyword: keyword.value.trim() || undefined,
      }),
      api.organizations().catch(() => []),
    ]);
    rows.value = campuses;
    organizations.value = orgs;
  } catch (error) {
    notify(error instanceof Error ? error.message : "校区加载失败", "error");
  } finally {
    loading.value = false;
  }
}
function edit(row?: CampusRow) {
  editing.value = row ?? null;
  Object.assign(form, {
    organizationId:
      row?.organizationId ?? accountOrganizationId.value ?? "",
    name: row?.name ?? "",
    shortName: row?.shortName ?? "",
    warehouseName: row?.warehouseName ?? "",
    address: row?.address ?? "",
    status: (row?.status as "active" | "inactive") ?? "active",
    instant: Number(fenToYuan(row?.deliveryFeeInstant ?? 400)),
    scheduled: Number(fenToYuan(row?.deliveryFeeScheduled ?? 200)),
    threshold: Number(fenToYuan(row?.deliveryThreshold ?? 1000)),
    baseSalary: Number(fenToYuan(row?.buildingManagerBaseSalary ?? 0)),
  });
  open.value = true;
}
async function save() {
  if (!form.name.trim() || !form.shortName.trim()) {
    notify("请填写校区全称与简称", "error");
    return;
  }
  if (!form.organizationId) {
    notify("请选择校区所属组织", "error");
    return;
  }
  saving.value = true;
  try {
    const base = {
      organizationId: form.organizationId,
      name: form.name.trim(),
      shortName: form.shortName.trim(),
      warehouseName:
        form.warehouseName.trim() || `${form.shortName.trim()}校园仓`,
      address: form.address.trim(),
      deliveryFeeInstant: yuanToFen(form.instant),
      deliveryFeeScheduled: yuanToFen(form.scheduled),
      deliveryThreshold: yuanToFen(form.threshold),
      buildingManagerBaseSalary: yuanToFen(form.baseSalary),
    };
    editing.value
      ? await api.updateCampus(editing.value.id, {
          ...base,
          status: form.status,
        })
      : await api.createCampus(base);
    open.value = false;
    notify(editing.value ? "校区已更新" : "校区已创建");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="校区管理"
    eyebrow="CAMPUS DIRECTORY"
    description="平台查看授权范围内全部校区；组织管理员管理本组织全部校区，不受顶部校区切换影响。"
    ><template #actions
      ><ElButton
        v-if="hasPerm('POST /admin/campuses')"
        type="primary"
        @click="edit()"
        >新建校区</ElButton
      ></template
    >
    <section class="admin-filter-panel" aria-label="校区筛选">
      <ElForm
        class="admin-filter-form"
        label-position="top"
        @submit.prevent="load"
        ><ElRow :gutter="12" align="bottom"
          ><ElCol :xs="24" :sm="18"
            ><ElFormItem label="搜索校区"
              ><ElInput
                v-model="keyword"
                clearable
                placeholder="搜索校区名称"
                @keyup.enter="load" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElFormItem label=" "
              ><ElButton native-type="submit" type="primary" :loading="loading"
                >查询</ElButton
              ></ElFormItem
            ></ElCol
          ></ElRow
        ></ElForm
      >
    </section>
    <section class="admin-table-panel" aria-label="校区列表">
      <ElTable v-loading="loading" :data="rows" row-key="id"
        ><ElTableColumn
          prop="name"
          label="校区"
          min-width="180"
        /><ElTableColumn
          prop="shortName"
          label="简称"
          width="120"
        /><ElTableColumn label="类型" width="110"
          ><template #default="{ row }">{{
            row.type === "hq" ? "总部仓" : "运营校区"
          }}</template></ElTableColumn
        ><ElTableColumn label="所属组织" min-width="160"
          ><template #default="{ row }">{{
            orgName(row.organizationId)
          }}</template></ElTableColumn
        ><ElTableColumn
          prop="warehouseName"
          label="仓库"
          min-width="180"
        /><ElTableColumn label="状态" width="100"
          ><template #default="{ row }"
            ><ElTag :type="row.status === 'active' ? 'success' : 'info'">{{
              row.status === "active" ? "在营" : "停用"
            }}</ElTag></template
          ></ElTableColumn
        ><ElTableColumn
          prop="buildings"
          label="楼栋"
          width="90"
        /><ElTableColumn prop="users" label="用户" width="90" /><ElTableColumn
          label="操作"
          width="100"
          ><template #default="{ row }"
            ><ElButton
              v-if="hasPerm('PATCH /admin/campuses/:id')"
              size="small"
              type="primary"
              @click="edit(asCampus(row))"
              >编辑</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      >
    </section>
    <ElDialog
      v-model="open"
      :title="editing ? '编辑校区' : '新建校区'"
      width="min(720px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="所属组织" required
              ><ElSelect
                v-model="form.organizationId"
                :disabled="!isPlatformAccount"
                placeholder="请选择所属组织"
                filterable
                ><ElOption
                  v-for="organization in organizations"
                  :key="organization.id"
                  :label="organization.name"
                  :value="organization.id"
                  :disabled="organization.status !== 'active'" /></ElSelect
              ></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="校区全称"
              ><ElInput v-model="form.name" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="简称"
              ><ElInput v-model="form.shortName" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="仓库名"
              ><ElInput v-model="form.warehouseName" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="仓库地址"
              ><ElInput v-model="form.address" /></ElFormItem></ElCol
          ><ElCol v-if="editing" :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="状态"
              ><ElSelect v-model="form.status"
                ><ElOption label="在营" value="active" /><ElOption
                  label="停用"
                  value="inactive" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="即时达配送费（元）"
              ><ElInputNumber
                v-model="form.instant"
                :min="0"
                :precision="2" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="预约达配送费（元）"
              ><ElInputNumber
                v-model="form.scheduled"
                :min="0"
                :precision="2" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="起送门槛（元）"
              ><ElInputNumber
                v-model="form.threshold"
                :min="0"
                :precision="2" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12" :lg="8"
            ><ElFormItem label="楼长月度底薪（元）"
              ><ElInputNumber
                v-model="form.baseSalary"
                :min="0"
                :precision="2" /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="open = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      ></ElDialog
    ></AdminPageShell
  >
</template>
<style scoped>
:deep(.el-select),
:deep(.el-input-number) {
  width: 100%;
}
</style>
