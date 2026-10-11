<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import {
  effectiveCampusId,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { AuditLog } from "../../../../types";
import { fmtDateTime } from "../../../../utils/datetime";

type AuditRow = AuditLog & {
  operatorName?: string;
  actionText?: string;
  entityText?: string;
};
const rows = ref<AuditRow[]>([]),
  loading = ref(false),
  keyword = ref("");
const page = ref(1),
  pageSize = ref(20),
  total = ref(0);
let generation = 0,
  keywordTimer: number | undefined;
const campusId = effectiveCampusId;
async function load() {
  const request = ++generation;
  loading.value = true;
  try {
    const result = await api.audits({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      campusId: campusId.value || undefined,
    });
    if (request === generation) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (error) {
    if (request === generation)
      ElMessage.error(
        error instanceof Error ? error.message : "审计日志加载失败",
      );
  } finally {
    if (request === generation) loading.value = false;
  }
}
watch([page, pageSize, campusId], load);
watch(keyword, () => {
  if (keywordTimer) clearTimeout(keywordTimer);
  keywordTimer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 280);
});
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="审计日志"
    eyebrow="AUDIT TRAIL"
    description="追踪关键状态、金额与权限变更。"
  >
    <section class="admin-filter-panel" aria-label="审计日志筛选">
      <ElForm class="admin-filter-form" label-position="top"
        ><ElRow :gutter="12" align="bottom"
          ><ElCol :xs="24" :sm="18"
            ><ElInput
              v-model="keyword"
              clearable
              placeholder="搜索操作人、动作或对象" /></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElFormItem label=" "
              ><ElButton :loading="loading" @click="load"
                >刷新</ElButton
              ></ElFormItem
            ></ElCol
          ></ElRow
        ></ElForm
      >
    </section>
    <section class="admin-table-panel" aria-label="审计日志列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        empty-text="暂无审计记录"
      >
        <ElTableColumn label="时间" width="180"
          ><template #default="{ row }">{{
            fmtDateTime(row.createdAt)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="操作人" min-width="150"
          ><template #default="{ row }">{{
            row.operatorName || row.operator || "—"
          }}</template></ElTableColumn
        >
        <ElTableColumn label="动作" min-width="180"
          ><template #default="{ row }">{{
            row.actionText || row.action || "—"
          }}</template></ElTableColumn
        >
        <ElTableColumn label="对象" min-width="180"
          ><template #default="{ row }">{{
            row.entityText || row.entityType || "—"
          }}</template></ElTableColumn
        >
        <ElTableColumn
          prop="entityId"
          label="对象 ID"
          min-width="240"
          show-overflow-tooltip
        /> </ElTable
      ><AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>
  </AdminPageShell>
</template>
