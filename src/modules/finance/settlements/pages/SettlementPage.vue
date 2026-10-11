<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { BILL_STATUS_TABS, STATUS_TEXT } from "../../../../dicts";
import { activeCampus, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Settlement } from "../../../../types";
import { fenToYuan } from "../../../../utils/money";
const rows = ref<Settlement[]>([]),
  loading = ref(false),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref(""),
  status = ref("all");
const months = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});
const month = ref(months[0]);
let timer: number | undefined;
const summary = computed(() => ({
  payable: rows.value.reduce((s, r) => s + r.payable, 0),
  paid: rows.value
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + r.payable, 0),
}));
function asSettlement(row: unknown) {
  return row as Settlement;
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
async function load() {
  loading.value = true;
  try {
    const result = await api.settlements(
      month.value,
      {
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
        campusId: activeCampus.value || undefined,
      },
      status.value === "all" ? undefined : status.value,
    );
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "结算账单加载失败",
      "error",
    );
  } finally {
    loading.value = false;
  }
}
async function act(row: Settlement, type: "confirm" | "pay") {
  try {
    await ElMessageBox.confirm(
      type === "confirm" ? "确认该账单数据无误？" : "确认已完成打款？",
      type === "confirm" ? "确认账单" : "确认打款",
      { type: "warning" },
    );
  } catch {
    return;
  }
  try {
    type === "confirm"
      ? await api.confirmSettlement(row.id)
      : await api.paySettlement(row.id);
    notify(type === "confirm" ? "账单已确认" : "账单已标记打款");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", "error");
  }
}
watch([month, status, page, pageSize, activeCampus], load);
watch(keyword, () => {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 280);
});
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="结算中心"
    eyebrow="FINANCE SETTLEMENT"
    description="月度账单确认、打款与跨期调整。"
    ><div class="summary">
      <span
        >当前页应结 <b>¥{{ fenToYuan(summary.payable, true) }}</b></span
      ><span
        >已打款 <b>¥{{ fenToYuan(summary.paid, true) }}</b></span
      >
    </div>
    <div class="tabs">
      <ElButton
        v-for="item in BILL_STATUS_TABS"
        :key="item.key"
        :type="status === item.key ? 'primary' : 'default'"
        @click="status = item.key"
        >{{ item.label }}</ElButton
      >
    </div>
    <div class="toolbar">
      <ElSelect v-model="month"
        ><ElOption
          v-for="item in months"
          :key="item"
          :label="item"
          :value="item" /></ElSelect
      ><ElInput
        v-model="keyword"
        clearable
        placeholder="搜索人员"
        class="search"
      />
      <div class="toolbar-spacer" />
      <ElButton :loading="loading" @click="load">刷新</ElButton>
    </div>
    <ElTable v-loading="loading" :data="rows" row-key="id"
      ><ElTableColumn
        prop="staffName"
        label="人员"
        min-width="140"
      /><ElTableColumn prop="roleText" label="角色" width="120" /><ElTableColumn
        prop="period"
        label="账期"
        width="110"
      /><ElTableColumn label="底薪" width="110"
        ><template #default="{ row }"
          >¥{{ fenToYuan(row.baseSalary) }}</template
        ></ElTableColumn
      ><ElTableColumn label="提成" width="110"
        ><template #default="{ row }"
          >¥{{ fenToYuan(row.commissionTotal) }}</template
        ></ElTableColumn
      ><ElTableColumn label="调整" width="110"
        ><template #default="{ row }"
          >¥{{ fenToYuan(row.adjustment) }}</template
        ></ElTableColumn
      ><ElTableColumn label="应结" width="120"
        ><template #default="{ row }"
          ><b>¥{{ fenToYuan(row.payable) }}</b></template
        ></ElTableColumn
      ><ElTableColumn label="状态" width="110"
        ><template #default="{ row }"
          ><ElTag>{{ STATUS_TEXT[row.status] || row.status }}</ElTag></template
        ></ElTableColumn
      ><ElTableColumn label="操作" fixed="right" width="180"
        ><template #default="{ row }"
          ><ElButton
            v-if="
              row.status === 'pending-review' &&
              hasPerm('POST /admin/settlements/:id/confirm')
            "
            size="small"
            type="primary"
            @click="act(asSettlement(row), 'confirm')"
            >确认</ElButton
          ><ElButton
            v-if="
              row.status === 'confirmed' &&
              hasPerm('POST /admin/settlements/:id/pay')
            "
            size="small"
            type="success"
            @click="act(asSettlement(row), 'pay')"
            >登记打款</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    ><AdminPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
  /></AdminPageShell>
</template>
<style scoped>
.summary,
.tabs {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.summary span {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.toolbar {
  flex-wrap: wrap;
}
.toolbar .el-select {
  width: 150px;
}
.search {
  width: min(320px, 100%);
}
</style>
