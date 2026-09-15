<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type { Campus, HqDailyRow } from "../types";
import { fenToYuan } from "../utils/money";

/**
 * 总部经营日报（IKFOPR，2026-09-15 grilling 定版）：
 * - 数据源=发货单按到货确认时点（receivedAt）实时聚合，只计闭环单，与单据毛利同源
 * - 行=日期×校区：发货单数/批发销售额/进货成本/毛利/毛利率（万分比）
 * - T+1 语义：缺省查昨日（已落定不再变）；不建跑批表，聚合即对账
 */
const loading = ref(true);
const error = ref("");
const report = ref<Awaited<ReturnType<typeof api.hqDailyReport>> | null>(null);
const campuses = ref<Campus[]>([]);

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// 缺省昨日（T+1）
const yd = new Date(Date.now() - 86400 * 1000);
const startDate = ref(localDate(yd));
const endDate = ref(localDate(yd));
const campusId = ref("");

const marginRateText = computed(() =>
  report.value ? (report.value.totals.marginRate / 100).toFixed(2) : "0.00",
);

async function load() {
  if (!startDate.value || !endDate.value) return alert("请选择完整的起止日期");
  if (startDate.value > endDate.value) return alert("开始日期不能晚于结束日期");
  loading.value = true;
  error.value = "";
  try {
    report.value = await api.hqDailyReport(
      startDate.value,
      endDate.value,
      campusId.value || undefined,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  load();
  try {
    // 校区筛选下拉：排除总部仓伪校区（type=hq）与官方库（status=official）
    campuses.value = (await api.campuses()).filter(
      (c) => c.type !== "hq" && c.status !== "official" && c.status !== "hidden",
    );
  } catch {
    /* 下拉加载失败不阻断日报 */
  }
});

function rateText(row: HqDailyRow) {
  return `${(row.marginRate / 100).toFixed(2)}%`;
}
</script>

<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，header 标签会误命中变白卡 -->
    <div class="page-head">
      <div>
        <h1>经营日报</h1>
        <p>
          总部账 = 批发收入 − 进货成本。按校区确认到货时点计收（只计闭环单），
          与发货单快照同源，数字可与单据毛利对账。
        </p>
      </div>
      <div class="head-actions report-filter">
        <input v-model="startDate" type="date" />
        <span class="report-sep">至</span>
        <input v-model="endDate" type="date" />
        <select v-model="campusId">
          <option value="">全部校区</option>
          <option v-for="c in campuses" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
        <button class="btn primary" :disabled="loading" @click="load">
          {{ loading ? "查询中…" : "查询" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>

    <!-- 四大数字（范围合计） -->
    <div v-if="report" class="report-cards">
      <div class="report-card">
        <p class="report-label">批发销售额</p>
        <strong>¥{{ fenToYuan(report.totals.wholesaleTotal, true) }}</strong>
      </div>
      <div class="report-card">
        <p class="report-label">进货成本</p>
        <strong>¥{{ fenToYuan(report.totals.costTotal, true) }}</strong>
      </div>
      <div class="report-card report-card-gross">
        <p class="report-label">毛利</p>
        <strong>¥{{ fenToYuan(report.totals.gross, true) }}</strong>
      </div>
      <div class="report-card">
        <p class="report-label">毛利率</p>
        <strong>{{ marginRateText }}%</strong>
        <p class="report-sub">共 {{ report.totals.shipments }} 张发货单</p>
      </div>
    </div>

    <div v-if="report" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ report.rows.length }}</strong><span> 行明细</span>
        </div>
        <p><span class="live-dot"></span>数据已同步 · {{ startDate }} ~ {{ endDate }}</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>校区</th>
              <th>发货单数</th>
              <th>批发销售额</th>
              <th>进货成本</th>
              <th>毛利</th>
              <th>毛利率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 4" :key="i">
              <td :colspan="7"><div class="row-skeleton"></div></td>
            </tr>
            <template v-else>
              <tr v-if="!report.rows.length">
                <td :colspan="7" class="empty-cell">
                  所选范围内没有已确认到货的发货单（只计闭环单）。
                </td>
              </tr>
              <tr v-for="r in report.rows" :key="`${r.date}-${r.campusId}`">
                <td><strong>{{ r.date }}</strong></td>
                <td>{{ r.campusShortName || r.campusName }}</td>
                <td>{{ r.shipments }}</td>
                <td>¥{{ fenToYuan(r.wholesaleTotal) }}</td>
                <td>¥{{ fenToYuan(r.costTotal) }}</td>
                <td class="report-gross">¥{{ fenToYuan(r.gross) }}</td>
                <td>{{ rateText(r) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 页面壳/表格/骨架走全局（与商品管理同源）；scoped 只留日报排版 */
.load-error {
  padding: 0 0 14px;
  font-size: 13px;
  color: #b33a3a;
}
.report-filter {
  gap: 8px;
  align-items: center;
}
.report-filter input,
.report-filter select {
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 0 10px;
  font-size: 13px;
  background: #fff;
  outline: 0;
}
.report-filter input:focus,
.report-filter select:focus {
  border-color: var(--brand);
}
.report-sep {
  font-size: 12px;
  color: #7b8981;
}
.report-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}
.report-card {
  background: #fff;
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: 0 1px 3px #10241b0a;
}
.report-card-gross strong {
  color: var(--brand, #159c55);
}
.report-label {
  font-size: 12px;
  color: #647169;
  margin-bottom: 6px;
}
.report-card strong {
  font-size: 24px;
  color: #153628;
  letter-spacing: -0.5px;
}
.report-sub {
  margin-top: 6px;
  font-size: 11px;
  color: #7b8981;
}
.report-gross {
  color: var(--brand, #159c55);
  font-weight: 700;
}
@media (max-width: 900px) {
  .report-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
