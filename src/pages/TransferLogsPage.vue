<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import { fenToYuan } from "../utils/money";
import AdminPageShell from "../shared/ui/AdminPageShell.vue";

/**
 * 转单管理（IKRQR7，道哥定稿仅超管）：骑手转单留痕报表。
 * 转单即释放回抢单池——本表是唯一痕迹（谁、何时、从何状态转出）。
 */
const loading = ref(false);
const startDate = ref("");
const endDate = ref("");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const rows = ref<
  Awaited<ReturnType<typeof api.transferLogs>>["items"] | null
>(null);

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const weekAgo = new Date(Date.now() - 29 * 86400 * 1000);
startDate.value = localDate(weekAgo);
endDate.value = localDate(new Date());

async function load() {
  loading.value = true;
  try {
    const res = await api.transferLogs({
      start: startDate.value || undefined,
      end: endDate.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    rows.value = res.items;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "加载失败");
  } finally {
    loading.value = false;
  }
}
watch([startDate, endDate], () => {
  page.value = 1;
  void load();
});
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="转单管理"
    eyebrow="TRANSFER LOGS"
    description="骑手转单留痕报表：谁在何时从何状态转出（转单即释放回抢单池，本表是唯一痕迹）。"
  >
    <section class="admin-filter-panel" aria-label="日期筛选">
      <ElForm class="admin-filter-form" label-position="top">
        <ElRow :gutter="12" align="bottom">
          <ElCol :xs="24" :sm="8">
            <ElFormItem label="开始日期">
              <ElDatePicker
                v-model="startDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="8">
            <ElFormItem label="结束日期">
              <ElDatePicker
                v-model="endDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="8">
            <ElFormItem label=" ">
              <ElButton :loading="loading" @click="load">刷新</ElButton>
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>
    </section>

    <section class="admin-table-panel" aria-label="转单记录">
      <ElTable
        v-loading="loading"
        :data="rows ?? []"
        row-key="id"
        empty-text="所选范围暂无转单记录"
      >
        <ElTableColumn prop="orderNo" label="订单号" min-width="180" />
        <ElTableColumn label="转单骑手" min-width="120">
          <template #default="{ row }"
            >{{ row.staffName }}（{{ row.staffNo }}）</template
          >
        </ElTableColumn>
        <ElTableColumn prop="fromStatus" label="转出时状态" min-width="180" />
        <ElTableColumn label="订单实付" width="110">
          <template #default="{ row }">¥{{ fenToYuan(row.amount) }}</template>
        </ElTableColumn>
        <ElTableColumn label="转单时间" min-width="160">
          <template #default="{ row }">{{
            row.createdAt.replace("T", " ").slice(0, 16)
          }}</template>
        </ElTableColumn>
      </ElTable>
      <ElPagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="load"
        @size-change="((page = 1), load())"
      />
    </section>
  </AdminPageShell>
</template>
