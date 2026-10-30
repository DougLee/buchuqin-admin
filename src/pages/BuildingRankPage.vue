<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import * as XLSX from "xlsx";
import { api } from "../api";
import type { BuildingRankItem } from "../types";
import { fenToYuan } from "../utils/money";
import { accountOrgLevel, effectiveCampusId } from "../session";
import { fetchOperationalCampuses, type CampusOption } from "../dicts";
import AdminPageShell from "../shared/ui/AdminPageShell.vue";

/**
 * 楼栋经营榜（IKRSJ0 #116/#81b）：楼栋粒度订单数/销售额排行（salesTotal 降序，
 * 端点一次回全部楼栋）。Dashboard「楼栋经营排行」的完整数据入口，默认本月 1 日至今。
 */
const loading = ref(false);
const error = ref("");
const items = ref<BuildingRankItem[]>([]);
const startDate = ref("");
const endDate = ref("");
const campusId = ref("");
const campuses = ref<CampusOption[]>([]);

/* 校区上下文：平台/组织角色可下拉聚焦校区（运营校区口径，排除总部仓）；
   校区角色锁本校区（同 CampusReportPage 的 effectiveCampusId 口径） */
const isHqScope = computed(() => accountOrgLevel.value !== "campus");
const queryCampusId = computed(() =>
  isHqScope.value
    ? campusId.value || undefined
    : effectiveCampusId.value || undefined,
);

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// 默认本月 1 日至今
const now = new Date();
startDate.value = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
endDate.value = localDate(now);

async function load() {
  if (!startDate.value || !endDate.value)
    return ElMessage.warning("请选择完整的起止日期");
  if (startDate.value > endDate.value)
    return ElMessage.warning("开始日期不能晚于结束日期");
  loading.value = true;
  error.value = "";
  try {
    const res = await api.buildingRank(
      startDate.value,
      endDate.value,
      queryCampusId.value,
    );
    items.value = Array.isArray(res?.items) ? res.items : [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
    ElMessage.error(error.value);
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void load();
  if (isHqScope.value) {
    fetchOperationalCampuses()
      .then((list) => (campuses.value = list))
      .catch(() => {
        /* 校区下拉加载失败不阻断榜单（平台可清空聚焦看全量） */
      });
  }
});

/* 导出 xlsx：端点一次回全量楼栋，直接导当前查询结果（SheetJS aoa，列宽自适应） */
function exportRank() {
  if (!items.value.length) return ElMessage.warning("暂无数据可导出");
  const header = ["排名", "楼栋", "订单数", "销售额（元）"];
  const rows = items.value.map((b, i) => [
    i + 1,
    b.buildingName,
    b.orders,
    Number(fenToYuan(b.salesTotal)) || 0,
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = header.map(() => ({ wch: 16 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "楼栋经营榜");
  XLSX.writeFile(book, `楼栋经营榜-${startDate.value}_${endDate.value}.xlsx`);
}
</script>
<template>
  <AdminPageShell
    title="楼栋经营榜"
    eyebrow="BUILDING RANK"
    description="楼栋粒度订单数与销售额排行（按销售额降序，含全部楼栋）——楼栋经营复盘的完整数据入口。"
    ><template #actions
      ><ElButton :disabled="!items.length" @click="exportRank"
        >导出</ElButton
      ></template
    >
    <section class="admin-filter-panel" aria-label="榜单筛选">
      <ElForm class="admin-filter-form" label-position="top">
        <ElRow :gutter="12" align="bottom">
          <ElCol :xs="24" :sm="8" :lg="6">
            <ElFormItem label="开始日期">
              <ElDatePicker
                v-model="startDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="8" :lg="6">
            <ElFormItem label="结束日期">
              <ElDatePicker
                v-model="endDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </ElFormItem>
          </ElCol>
          <ElCol v-if="isHqScope" :xs="24" :sm="8" :lg="6">
            <ElFormItem label="校区">
              <ElSelect
                v-model="campusId"
                clearable
                placeholder="全部校区"
                style="width: 100%"
                ><ElOption
                  v-for="c in campuses"
                  :key="c.id"
                  :label="c.name"
                  :value="c.id"
              /></ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="8" :lg="6">
            <ElFormItem label=" ">
              <ElButton type="primary" :loading="loading" @click="load"
                >查询</ElButton
              >
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>
    </section>

    <p v-if="error" class="rank-error">{{ error }}</p>

    <section class="admin-table-panel" aria-label="楼栋排行">
      <ElTable
        v-loading="loading"
        :data="items"
        row-key="buildingId"
        empty-text="所选范围内暂无楼栋经营数据"
      >
        <ElTableColumn label="排名" width="80">
          <template #default="{ $index }"
            ><b class="rank-badge" :class="{ top: $index < 3 }">{{
              $index + 1
            }}</b></template
          >
        </ElTableColumn>
        <ElTableColumn prop="buildingName" label="楼栋" min-width="200" />
        <ElTableColumn prop="orders" label="订单数" min-width="120" />
        <ElTableColumn label="销售额" min-width="160"
          ><template #default="{ row }"
            >¥{{ fenToYuan(row.salesTotal, true) }}</template
          ></ElTableColumn
        >
      </ElTable>
    </section>
  </AdminPageShell>
</template>
<style scoped>
.rank-error {
  margin: 0 0 12px;
  font-size: 13px;
  color: #b33a3a;
}
/* 前三名徽标：品牌绿底突出 */
.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  border-radius: 8px;
  background: #eef2f0;
  color: #55645b;
  font-size: 13px;
}
.rank-badge.top {
  background: rgba(21, 156, 85, 0.12);
  color: var(--brand, #159c55);
  font-weight: 700;
}
</style>
