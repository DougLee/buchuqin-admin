<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { BILL_STATUS_TABS, STATUS_TEXT } from "../../../../dicts";
import { effectiveCampusId, hasPerm } from "../../../../session";
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
        campusId: effectiveCampusId.value || undefined,
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
watch([month, status, page, pageSize, effectiveCampusId], load);
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
    ><div class="finance-summary" aria-label="结算汇总">
      <article>
        <span>当前页应结</span>
        <strong>¥{{ fenToYuan(summary.payable, true) }}</strong>
      </article>
      <article>
        <span>已打款</span>
        <strong>¥{{ fenToYuan(summary.paid, true) }}</strong>
      </article>
    </div>
    <section
      class="admin-filter-panel admin-filter-panel--split"
      aria-label="结算筛选"
    >
      <div class="tabs single-line-tabs finance-tabs">
        <ElButton
          v-for="item in BILL_STATUS_TABS"
          :key="item.key"
          :type="status === item.key ? 'primary' : 'default'"
          @click="status = item.key"
          >{{ item.label }}</ElButton
        >
      </div>
      <ElForm class="admin-filter-form settlement-filters" label-position="top"
        ><ElRow :gutter="12" align="bottom"
          ><ElCol :xs="24" :sm="8"
            ><ElSelect v-model="month"
              ><ElOption
                v-for="item in months"
                :key="item"
                :label="item"
                :value="item" /></ElSelect></ElCol
          ><ElCol :xs="24" :sm="10"
            ><ElInput
              v-model="keyword"
              clearable
              placeholder="搜索人员" /></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElButton :loading="loading" @click="load">刷新</ElButton></ElCol
          ></ElRow
        ></ElForm
      >
    </section>
    <section class="admin-table-panel" aria-label="结算列表">
      <ElTable v-loading="loading" :data="rows" row-key="id"
        ><ElTableColumn
          prop="staffName"
          label="人员"
          min-width="140"
        /><ElTableColumn
          prop="roleText"
          label="角色"
          width="120"
        /><ElTableColumn prop="period" label="账期" width="110" /><ElTableColumn
          label="底薪"
          width="110"
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
            ><ElTag>{{
              STATUS_TEXT[row.status] || row.status
            }}</ElTag></template
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
      />
    </section>
  </AdminPageShell>
</template>
<style scoped>
.finance-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 240px));
  gap: 14px;
  margin-bottom: 18px;
}
.finance-summary article {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 8px 24px #163f2b08;
}
.finance-summary span {
  color: var(--muted);
}
.finance-summary strong {
  font-size: 24px;
  color: var(--ink);
}
.finance-tabs {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
.settlement-filters {
  flex-basis: 680px !important;
}
@media (max-width: 1280px) {
  .settlement-filters {
    flex-basis: auto !important;
  }
}
@media (max-width: 760px) {
  .finance-summary {
    grid-template-columns: 1fr;
  }
}
</style>
