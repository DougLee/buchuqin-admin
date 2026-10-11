<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import type { Building, CampusDailyRow } from "../types";
import { fenToYuan } from "../utils/money";
import { accountOrgLevel, activeCampus, sessionUser } from "../session";

/**
 * 校区经营日报（IKFOPS，2026-09-16 grilling 定版）：
 * - 校区账 = 学生实付销售额 − 行批发成本快照（IKFOPQ），只计 completed 订单
 * - paidAt 支付时间落日（零售营收按支付日），实时聚合 T+1 缺省昨日
 * - 顶部校区是唯一校区上下文；楼栋筛选只加载该校区楼栋
 */
const loading = ref(true);
const error = ref("");
const report = ref<Awaited<ReturnType<typeof api.campusDailyReport>> | null>(null);
const buildings = ref<Building[]>([]);

/* 数据范围与后端 isHqScope 同口径：平台上下文跨校区，其余锁本校区
   （RBAC V1：role 判断换服务端 platform 上下文） */
const isHqScope = computed(() => accountOrgLevel.value !== "campus");
const operationalCampusId = computed(() =>
  accountOrgLevel.value === "platform" || accountOrgLevel.value === "org"
    ? activeCampus.value
    : sessionUser.value?.campusId ?? "",
);

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// 缺省昨日（T+1）
const yd = new Date(Date.now() - 86400 * 1000);
const startDate = ref(localDate(yd));
const endDate = ref(localDate(yd));
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
  if (!startDate.value || !endDate.value) return ElMessage.warning("请选择完整的起止日期");
  if (startDate.value > endDate.value) return ElMessage.warning("开始日期不能晚于结束日期");
  if (!operationalCampusId.value) {
    report.value = null;
    loading.value = false;
    error.value = "";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    report.value = await api.campusDailyReport(
      startDate.value,
      endDate.value,
      operationalCampusId.value,
      buildingId.value || undefined,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
    ElMessage.error(error.value);
  } finally {
    loading.value = false;
  }
}
async function loadBuildings() {
  buildings.value = [];
  buildingId.value = "";
  if (!operationalCampusId.value) return;
  try {
    const list = await api.buildings({
      page: 1,
      pageSize: 100,
      campusId: operationalCampusId.value,
    });
    buildings.value = (Array.isArray(list) ? list : (list as any).items ?? []).filter(
      (b: Building) => b.status === "active",
    );
  } catch {
    /* 楼栋筛选加载失败不阻断日报 */
  }
}
async function reloadCampusReport() {
  report.value = null;
  await loadBuildings();
  await load();
}
onMounted(() => void reloadCampusReport());
watch(operationalCampusId, () => void reloadCampusReport());

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
        <ElDatePicker v-model="startDate" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="开始日期" />
        <span class="report-sep">至</span>
        <ElDatePicker v-model="endDate" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="结束日期" />
        <ElSelect v-model="buildingId" clearable placeholder="全部楼栋" :disabled="!operationalCampusId || !buildings.length">
          <ElOption v-for="b in buildings" :key="b.id" :label="b.name" :value="b.id" />
        </ElSelect>
        <ElButton type="primary" :loading="loading" :disabled="!operationalCampusId" @click="load">查询</ElButton>
      </div>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>
    <div v-if="!operationalCampusId && !loading" class="data-panel">
      <p class="empty-cell">请先在顶部选择校区。</p>
    </div>

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
      <ElTable v-loading="loading" :data="report.rows" row-key="date" empty-text="所选范围内没有已完成的订单">
        <ElTableColumn prop="date" label="日期" min-width="120"><template #default="{ row }"><strong>{{ row.date }}</strong></template></ElTableColumn>
        <ElTableColumn v-if="isHqScope" label="校区" min-width="150"><template #default="{ row }">{{ row.campusShortName || row.campusName }}</template></ElTableColumn>
        <ElTableColumn prop="orders" label="订单数" min-width="90" />
        <ElTableColumn label="销售额" min-width="120"><template #default="{ row }">¥{{ fenToYuan(row.salesTotal) }}</template></ElTableColumn>
        <ElTableColumn label="批发成本" min-width="120"><template #default="{ row }">¥{{ fenToYuan(row.costTotal) }}</template></ElTableColumn>
        <ElTableColumn label="毛利" min-width="140"><template #default="{ row }">¥{{ fenToYuan(row.marginTotal) }} <small class="cell-sub">{{ rawRateText(row as CampusDailyRow) }}</small></template></ElTableColumn>
        <ElTableColumn label="综合毛利" min-width="150"><template #default="{ row }"><span class="report-gross">¥{{ fenToYuan(row.gross) }} <small class="cell-sub">{{ rateText(row as CampusDailyRow) }}</small></span></template></ElTableColumn>
      </ElTable>
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
