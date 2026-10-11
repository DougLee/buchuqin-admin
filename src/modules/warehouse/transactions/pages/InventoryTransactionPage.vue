<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import { TXN_TYPE_TEXT } from "../../../../dicts";
import {
  effectiveCampusId,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { InventoryTxn } from "../../../../types";
import { fmtDateTime } from "../../../../utils/datetime";

const rows = ref<InventoryTxn[]>([]);
const loading = ref(false);
const keyword = ref("");
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
let generation = 0;
let keywordTimer: number | undefined;
const operationalCampusId = effectiveCampusId;

function quantityText(row: InventoryTxn) {
  const value = row.quantity ?? row.delta;
  if (value === undefined || value === null) return "—";
  return row.type === "adjust" && value > 0 ? `+${value}` : String(value);
}
function asTxn(row: unknown): InventoryTxn {
  return row as InventoryTxn;
}

async function load() {
  if (!operationalCampusId.value) {
    generation += 1;
    rows.value = [];
    total.value = 0;
    loading.value = false;
    return;
  }
  const request = ++generation;
  loading.value = true;
  try {
    const result = await api.inventoryTxns(undefined, {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      campusId: operationalCampusId.value,
    });
    if (request === generation) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (error) {
    if (request === generation)
      ElMessage.error(error instanceof Error ? error.message : "流水加载失败");
  } finally {
    if (request === generation) loading.value = false;
  }
}

watch([page, pageSize, operationalCampusId], () => void load());
watch(keyword, () => {
  if (keywordTimer) window.clearTimeout(keywordTimer);
  keywordTimer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 280);
});
onMounted(load);
</script>

<template>
  <AdminPageShell
    title="出入库流水"
    eyebrow="INVENTORY LEDGER"
    description="采购入库、盘点调整与订单出库的全部流水记录。"
  >
    <section class="admin-filter-panel" aria-label="流水筛选">
      <ElForm class="admin-filter-form" label-position="top"
        ><ElRow
          ><ElCol :xs="24" :sm="12"
            ><ElInput
              v-model="keyword"
              clearable
              placeholder="搜索商品、原因或操作人" /></ElCol></ElRow
      ></ElForm>
    </section>
    <section class="admin-table-panel" aria-label="出入库流水列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        :empty-text="operationalCampusId ? '暂无流水' : '请先在顶部选择校区'"
      >
        <ElTableColumn label="时间" min-width="170"
          ><template #default="{ row }">{{
            fmtDateTime(row.createdAt)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="类型" min-width="120"
          ><template #default="{ row }"
            ><ElTag
              :type="
                row.type === 'stock-in'
                  ? 'success'
                  : row.type === 'stock-out'
                    ? 'warning'
                    : 'info'
              "
              >{{ TXN_TYPE_TEXT[row.type] ?? row.type }}</ElTag
            ></template
          ></ElTableColumn
        >
        <ElTableColumn label="商品" min-width="220"
          ><template #default="{ row }">{{
            row.product?.name || row.productId
          }}</template></ElTableColumn
        >
        <ElTableColumn label="数量" width="110"
          ><template #default="{ row }"
            ><strong>{{ quantityText(asTxn(row)) }}</strong></template
          ></ElTableColumn
        >
        <ElTableColumn
          prop="reason"
          label="原因"
          min-width="220"
          show-overflow-tooltip
        />
        <ElTableColumn label="操作人" min-width="150"
          ><template #default="{ row }">{{
            row.operatorName || row.operator || "—"
          }}</template></ElTableColumn
        >
      </ElTable>
      <AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>
  </AdminPageShell>
</template>
