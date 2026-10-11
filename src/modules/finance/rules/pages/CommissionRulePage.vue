<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import { activeCampus, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Building, CommissionRule } from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
import { fmtDateTime } from "../../../../utils/datetime";
const rows = ref<CommissionRule[]>([]),
  buildings = ref<Building[]>([]),
  loading = ref(false),
  saving = ref(false),
  open = ref(false),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0);
const form = reactive({
  buildingId: "",
  floor: undefined as number | undefined,
  weightFrom: undefined as number | undefined,
  weightTo: undefined as number | undefined,
  mode: "" as "" | "instant" | "scheduled",
  price: 3,
});
function asRule(row: unknown) {
  return row as CommissionRule;
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function buildingName(id: string | null) {
  return buildings.value.find((b) => b.id === id)?.name || "*";
}
async function load() {
  loading.value = true;
  try {
    const [result, b] = await Promise.all([
      api.commissionRules({
        page: page.value,
        pageSize: pageSize.value,
        campusId: activeCampus.value || undefined,
      }),
      api.buildings({ page: 1, pageSize: 1000 }),
    ]);
    rows.value = result.items;
    total.value = result.total;
    buildings.value = b.items;
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "提成规则加载失败",
      "error",
    );
  } finally {
    loading.value = false;
  }
}
function create() {
  Object.assign(form, {
    buildingId: "",
    floor: undefined,
    weightFrom: undefined,
    weightTo: undefined,
    mode: "",
    price: 3,
  });
  open.value = true;
}
async function save() {
  if (
    form.weightFrom != null &&
    form.weightTo != null &&
    form.weightTo < form.weightFrom
  ) {
    notify("重量上限不能小于下限", "error");
    return;
  }
  if (form.price <= 0) {
    notify("单价必须大于 0", "error");
    return;
  }
  saving.value = true;
  try {
    await api.createCommissionRule({
      buildingId: form.buildingId || undefined,
      floor: form.floor,
      weightFrom: form.weightFrom,
      weightTo: form.weightTo,
      mode: form.mode || undefined,
      price: yuanToFen(form.price),
    });
    open.value = false;
    notify("提成规则已创建");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function toggle(row: CommissionRule) {
  try {
    await api.updateCommissionRule(row.id, {
      status: row.status === "active" ? "disabled" : "active",
    });
    notify(row.status === "active" ? "规则已停用" : "规则已启用");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", "error");
  }
}
watch([page, pageSize, activeCampus], load);
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="提成规则"
    eyebrow="COMMISSION RULES"
    description="按楼栋、楼层、重量和配送模式配置提成单价。"
    ><template #actions
      ><ElButton
        v-if="hasPerm('POST /admin/commission-rules')"
        type="primary"
        @click="create"
        >新建规则</ElButton
      ></template
    >
    <section class="admin-table-panel" aria-label="提成规则列表">
      <ElTable v-loading="loading" :data="rows" row-key="id"
        ><ElTableColumn label="楼栋" width="130"
          ><template #default="{ row }">{{
            buildingName(row.buildingId)
          }}</template></ElTableColumn
        ><ElTableColumn label="楼层" width="90"
          ><template #default="{ row }">{{
            row.floor ?? "*"
          }}</template></ElTableColumn
        ><ElTableColumn label="重量区间" min-width="150"
          ><template #default="{ row }"
            >{{ row.weightFrom ?? "*" }} ~
            {{ row.weightTo ?? "*" }} kg</template
          ></ElTableColumn
        ><ElTableColumn label="配送模式" width="120"
          ><template #default="{ row }">{{
            row.mode === "instant"
              ? "即时达"
              : row.mode === "scheduled"
                ? "预约达"
                : "全部"
          }}</template></ElTableColumn
        ><ElTableColumn label="单价" width="110"
          ><template #default="{ row }"
            >¥{{ fenToYuan(row.price) }}</template
          ></ElTableColumn
        ><ElTableColumn prop="version" label="版本" width="80" /><ElTableColumn
          label="生效时间"
          min-width="170"
          ><template #default="{ row }">{{
            fmtDateTime(row.effectiveAt)
          }}</template></ElTableColumn
        ><ElTableColumn label="状态" width="100"
          ><template #default="{ row }"
            ><ElTag :type="row.status === 'active' ? 'success' : 'info'">{{
              row.status === "active" ? "启用" : "停用"
            }}</ElTag></template
          ></ElTableColumn
        ><ElTableColumn label="操作" width="100"
          ><template #default="{ row }"
            ><ElButton
              v-if="hasPerm('PATCH /admin/commission-rules/:id')"
              size="small"
              @click="toggle(asRule(row))"
              >{{ row.status === "active" ? "停用" : "启用" }}</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      ><AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>
    <ElDialog
      v-model="open"
      title="新建提成规则"
      width="min(640px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="楼栋"
              ><ElSelect
                v-model="form.buildingId"
                clearable
                placeholder="全部楼栋"
                ><ElOption
                  v-for="item in buildings"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="楼层"
              ><ElInputNumber
                v-model="form.floor"
                :min="1" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="重量下限 kg"
              ><ElInputNumber
                v-model="form.weightFrom"
                :min="0"
                :precision="2" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="重量上限 kg"
              ><ElInputNumber
                v-model="form.weightTo"
                :min="0"
                :precision="2" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="配送模式"
              ><ElSelect v-model="form.mode" clearable
                ><ElOption label="即时达" value="instant" /><ElOption
                  label="预约达"
                  value="scheduled" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="提成单价（元/单）"
              ><ElInputNumber
                v-model="form.price"
                :min="0.01"
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
