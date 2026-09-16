<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type { Building, Campus, CampusDailyRow } from "../types";
import { fenToYuan } from "../utils/money";
import { canSee, role, sessionUser } from "../session";

/**
 * 校区经营日报（IKFOPS，2026-09-16 grilling 定版）：
 * - 校区账 = 学生实付销售额 − 行批发成本快照（IKFOPQ），只计 completed 订单
 * - paidAt 支付时间落日（零售营收按支付日），实时聚合 T+1 缺省昨日
 * - hq/admin 跨校区筛选；校区角色本校区 + 楼栋筛选（address.buildingId）
 */
const loading = ref(true);
const error = ref("");
const report = ref<Awaited<ReturnType<typeof api.campusDailyReport>> | null>(null);
const campuses = ref<Campus[]>([]);
const buildings = ref<Building[]>([]);

/* 数据范围与后端 isHqScope 同口径：hq/admin 跨校区，其余锁本校区 */
const isHqScope = computed(() => role.value === "hq" || role.value === "admin");

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// 缺省昨日（T+1）
const yd = new Date(Date.now() - 86400 * 1000);
const startDate = ref(localDate(yd));
const endDate = ref(localDate(yd));
const campusId = ref("");
const buildingId = ref("");

const marginRateText = computed(() =>
  report.value ? (report.value.totals.marginRate / 100).toFixed(2) : "0.00",
);

async function load() {
  if (!startDate.value || !endDate.value) return alert("请选择完整的起止日期");
  if (startDate.value > endDate.value) return alert("开始日期不能晚于结束日期");
  loading.value = true;
  error.value = "";
  try {
    report.value = await api.campusDailyReport(
      startDate.value,
      endDate.value,
      isHqScope.value ? campusId.value || undefined : undefined,
      buildingId.value || undefined,
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
    if (isHqScope.value) {
      // 校区筛选下拉：排除总部仓伪校区（type=hq）与官方库（status=official）
      campuses.value = (await api.campuses()).filter(
        (c) => c.type !== "hq" && c.status !== "official" && c.status !== "hidden",
      );
    } else if (sessionUser.value?.campusId) {
      // 楼栋筛选下拉（校区角色）：数据源=本校区楼栋
      const list = await api.buildings({
        page: 1,
        pageSize: 100,
        campusId: sessionUser.value.campusId,
      });
      buildings.value = (Array.isArray(list) ? list : (list as any).items ?? []).filter(
        (b: Building) => b.status === "active",
      );
    }
  } catch {
    /* 下拉加载失败不阻断日报 */
  }
});

function rateText(row: CampusDailyRow) {
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
          校区账 = 学生实付 − 批发成本快照。按订单支付时间落日、只计已完成订单
          （退款单不计），与订单行内毛利同口径，数字可对账。
        </p>
      </div>
      <div class="head-actions report-filter">
        <input v-model="startDate" type="date" />
        <span class="report-sep">至</span>
        <input v-model="endDate" type="date" />
        <select v-if="isHqScope" v-model="campusId">
          <option value="">全部校区</option>
          <option v-for="c in campuses" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
        <select v-else v-model="buildingId">
          <option value="">全部楼栋</option>
          <option v-for="b in buildings" :key="b.id" :value="b.id">
            {{ b.name }}
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
        <p class="report-label">销售额（实付）</p>
        <strong>¥{{ fenToYuan(report.totals.salesTotal, true) }}</strong>
      </div>
      <div class="report-card">
        <p class="report-label">批发成本</p>
        <strong>¥{{ fenToYuan(report.totals.costTotal, true) }}</strong>
      </div>
      <div class="report-card report-card-gross">
        <p class="report-label">毛利</p>
        <strong>¥{{ fenToYuan(report.totals.gross, true) }}</strong>
      </div>
      <div class="report-card">
        <p class="report-label">毛利率</p>
        <strong>{{ marginRateText }}%</strong>
        <p class="report-sub">共 {{ report.totals.orders }} 个已完成订单</p>
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
              <th v-if="isHqScope">校区</th>
              <th>订单数</th>
              <th>销售额</th>
              <th>批发成本</th>
              <th>毛利</th>
              <th>毛利率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 4" :key="i">
              <td :colspan="isHqScope ? 7 : 6"><div class="row-skeleton"></div></td>
            </tr>
            <template v-else>
              <tr v-if="!report.rows.length">
                <td :colspan="isHqScope ? 7 : 6" class="empty-cell">
                  所选范围内没有已完成的订单（只计 completed，退款/未完成单不计）。
                </td>
              </tr>
              <tr v-for="r in report.rows" :key="`${r.date}-${r.campusId}`">
                <td><strong>{{ r.date }}</strong></td>
                <td v-if="isHqScope">{{ r.campusShortName || r.campusName }}</td>
                <td>{{ r.orders }}</td>
                <td>¥{{ fenToYuan(r.salesTotal) }}</td>
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
/* 页面壳/表格/骨架走全局（与总部日报同源）；scoped 只留日报排版 */
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
