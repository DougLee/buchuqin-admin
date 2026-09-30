<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type { Building, Campus, CampusDailyRow } from "../types";
import { fenToYuan } from "../utils/money";
import { canSee, isPlatform, sessionUser } from "../session";

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

/* 数据范围与后端 isHqScope 同口径：平台上下文跨校区，其余锁本校区
   （RBAC V1：role 判断换服务端 platform 上下文） */
const isHqScope = computed(() => isPlatform.value);

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

/** 综合毛利率（综合毛利/实付） */
const marginRateText = computed(() =>
  report.value ? (report.value.totals.marginRate / 100).toFixed(2) : "0.00",
);
/** 毛利率（毛利/商品金额，未扣券，IKISZ2+） */
const marginRawRateText = computed(() =>
  report.value ? (report.value.totals.marginRawRate / 100).toFixed(2) : "0.00",
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
/** 毛利率（未扣券基数=商品金额，IKISZ2+） */
function rawRateText(row: CampusDailyRow) {
  return `${((row.marginRawRate ?? 0) / 100).toFixed(2)}%`;
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

    <!-- 五卡（范围合计，IKISZ2+ 双口径对称） -->
    <div v-if="report" class="report-cards">
      <div class="report-card">
        <p class="report-label">销售额（实付）</p>
        <strong>¥{{ fenToYuan(report.totals.salesTotal, true) }}</strong>
      </div>
      <div class="report-card">
        <p class="report-label">批发成本</p>
        <strong>¥{{ fenToYuan(report.totals.costTotal, true) }}</strong>
      </div>
      <div class="report-card">
        <p class="report-label" title="商品金额 − 批发成本（未扣券）">
          毛利<span class="label-tag">未扣券</span>
        </p>
        <strong>¥{{ fenToYuan(report.totals.marginTotal, true) }}</strong>
        <p class="report-sub">
          毛利率 <em class="sub-num">{{ marginRawRateText }}%</em>
        </p>
      </div>
      <div class="report-card report-card-gross">
        <p class="report-label" title="实付 − 配送费 − 批发成本（扣券；配送费交付配送员不进毛利）">
          综合毛利<span class="label-tag dark">扣券</span>
        </p>
        <strong>¥{{ fenToYuan(report.totals.gross, true) }}</strong>
        <p class="report-sub">
          综合毛利率 <em class="sub-num">{{ marginRateText }}%</em>
        </p>
      </div>
      <div class="report-card">
        <p class="report-label">已完成订单</p>
        <strong>{{ report.totals.orders }}</strong>
        <p class="report-sub">只计 completed，退款单不计</p>
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
              <th title="商品金额 − 批发成本（未扣券）">毛利</th>
              <th title="实付 − 配送费 − 批发成本（扣券）">综合毛利</th>
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
                <td>
                  ¥{{ fenToYuan(r.marginTotal) }}
                  <small class="cell-sub">{{ rawRateText(r) }}</small>
                </td>
                <td class="report-gross">
                  ¥{{ fenToYuan(r.gross) }}
                  <small class="cell-sub">{{ rateText(r) }}</small>
                </td>
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
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}
.report-card {
  background: #fff;
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: 0 1px 3px #10241b0a;
  display: flex;
  flex-direction: column;
}
.report-card-gross {
  background: linear-gradient(145deg, #f2faf5, #fff);
  border: 1px solid #d9ede1;
}
.report-card-gross strong {
  color: var(--brand, #159c55);
}
.report-label {
  font-size: 12px;
  color: #55645b;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 口径徽标：未扣券/扣券一眼可辨 */
.label-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #eef2f0;
  color: #55645b;
  font-weight: 600;
}
.label-tag.dark {
  background: #159c5520;
  color: var(--brand, #159c55);
}
.report-card strong {
  font-size: 24px;
  color: #153628;
  letter-spacing: -0.5px;
}
.report-sub {
  margin-top: auto;
  padding-top: 8px;
  font-size: 11px;
  color: #55645b;
}
.report-sub .sub-num {
  font-style: normal;
  font-weight: 700;
  color: #153628;
}
/* 表格毛利/综合毛利副行（毛利率小字） */
.cell-sub {
  display: block;
  font-size: 11px;
  color: #7b8981;
  font-weight: 400;
  margin-top: 1px;
}
.report-gross .cell-sub {
  color: var(--brand, #159c55);
  opacity: 0.75;
}
.report-gross {
  color: var(--brand, #159c55);
  font-weight: 700;
}
@media (max-width: 1200px) {
  .report-cards {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 900px) {
  .report-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
