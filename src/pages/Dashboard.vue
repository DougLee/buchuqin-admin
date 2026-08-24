<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import type { DashboardActivity, DashboardData, TrendPoint } from "../types";
import { fenToYuan } from "../utils/money";
const data = ref<DashboardData>(),
  loading = ref(true),
  loadError = ref("");
const router = useRouter();
onMounted(async () => {
  try {
    data.value = await api.dashboard();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
});

/* 近 7 日趋势：曲线、坐标轴、增幅全部来自接口 trend 字段（paidAmount 为分，统一转元后绘图） */
const trend = computed<TrendPoint[]>(() => {
  const list = data.value?.trend;
  return Array.isArray(list) ? list : [];
});
const trendYuan = computed(() =>
  trend.value.map((t) => ({
    ...t,
    paidAmount: Number(fenToYuan(t.paidAmount)) || 0,
  })),
);
const CHART_W = 700,
  CHART_H = 230;
const chartPoints = computed(() => {
  const list = trendYuan.value;
  if (!list.length) return [];
  const max = Math.max(1, ...list.map((t) => Number(t.paidAmount) || 0));
  const step = list.length > 1 ? CHART_W / (list.length - 1) : 0;
  return list.map((t, i) => ({
    x: i * step,
    y: CHART_H - 18 - ((Number(t.paidAmount) || 0) / max) * (CHART_H - 60),
  }));
});
const linePath = computed(() =>
  chartPoints.value
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" "),
);
const areaPath = computed(() =>
  chartPoints.value.length
    ? `${linePath.value} L${CHART_W} ${CHART_H} L0 ${CHART_H}Z`
    : "",
);
const axisLabels = computed(() => {
  const list = trendYuan.value;
  const max = Math.max(1, ...list.map((t) => Number(t.paidAmount) || 0));
  return [1, 0.8, 0.6, 0.4, 0.2, 0].map((f) => {
    const v = max * f;
    return v >= 1000
      ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
      : `${Math.round(v)}`;
  });
});
function pctChange(current?: number, previous?: number) {
  if (!previous) return null;
  return ((Number(current) - Number(previous)) / previous) * 100;
}
const last = computed(() => trendYuan.value[trendYuan.value.length - 1]),
  prev = computed(() => trendYuan.value[trendYuan.value.length - 2]);
const revenueDelta = computed(() =>
    pctChange(last.value?.paidAmount, prev.value?.paidAmount),
  ),
  ordersDelta = computed(() => pctChange(last.value?.orders, prev.value?.orders));
/* 新用户环比（IKAJSU）：昨日基数来自 trend 倒数第二天的 newUsers 分桶 */
const newUsersDelta = computed(() =>
  pctChange(
    trend.value[trend.value.length - 1]?.newUsers,
    trend.value[trend.value.length - 2]?.newUsers,
  ),
);
const miniBars = computed(() => {
  const list = trend.value.map((t) => Number(t.orders) || 0);
  const max = Math.max(1, ...list);
  return list.map((v) => Math.max(4, Math.round((v / max) * 100)));
});
/* 实时动态来自接口 activities 字段（无数据时展示空态） */
const activities = computed<DashboardActivity[]>(() => {
  const list = data.value?.activities;
  return Array.isArray(list) ? list : [];
});
/* IKAJSS：动态流直达路由——按 entityType（订单/促销/商品/员工/群码…）跳对应处理页 */
const ACTIVITY_ROUTES: Record<string, string> = {
  order: "/orders",
  promotion: "/marketing?tab=promotions",
  product: "/products",
  staff: "/staff",
  "wechat-group": "/wechat-groups",
  coupon: "/marketing",
  banner: "/marketing?tab=banners",
  "admin-account": "/accounts",
  campus: "/campuses",
  building: "/campuses",
  "after-sale": "/after-sales",
};
function activityRoute(a: DashboardActivity) {
  return ACTIVITY_ROUTES[a.entityType ?? a.type] ?? null;
}
/* IKAJSS：水位节点下钻——作业人数/平均停留；超时节点列 Top5 单号直达 */
const drillKey = ref<string | null>(null);
function toggleFlowDrill(key: string) {
  drillKey.value = drillKey.value === key ? null : key;
}
function nodeDetail(key: string) {
  return data.value?.fulfillmentDetail?.[key];
}
const timeoutOrders = computed(() => data.value?.timeoutOrders ?? []);
function activityClass(type: string) {
  if (["exception", "warning", "timeout", "alert"].includes(type))
    return "orange";
  if (["order", "success", "delivery", "done"].includes(type)) return "green";
  return "blue";
}
function deltaText(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return `${value >= 0 ? "↑" : "↓"} ${Math.abs(value).toFixed(1)}%`;
}
const FLOW_LABELS: Record<string, string> = {
  waitingPick: "待拣货",
  waitingFirstMile: "骑手待接单",
  firstMile: "一级配送",
  waitingHandover: "楼下待交接",
  lastMile: "二级配送",
  delivered: "已送达待确认",
  timeout: "超时异常",
};
function flowLabel(key: string): string {
  return FLOW_LABELS[key] ?? key;
}
/** KPI 中的金额指标（分），CSV 导出统一转元。 */
const MONEY_KPI_KEYS = new Set(["revenue", "refundedAmount"]);
function exportReport() {
  if (!data.value) return;
  const rows = [
    ["指标", "数值"],
    ...Object.entries(data.value.kpis).map(([key, value]) => [
      key,
      MONEY_KPI_KEYS.has(key) ? `¥${fenToYuan(value)}` : String(value),
    ]),
  ];
  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob(["﻿" + csv], { type: "text/csv" }),
  );
  link.download = `运营日报-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <p class="eyebrow">OPERATIONS PULSE · 实时经营</p>
        <h1>校园运营总览</h1>
        <p>从交易到寝室交付，掌握每一个履约节点。</p>
      </div>
      <div class="head-actions">
        <button class="btn ghost" @click="exportReport">导出日报</button
        ><button class="btn primary" @click="router.push('/orders')">
          <span>→</span> 查看履约任务
        </button>
      </div>
    </div>
    <div v-if="loading" class="skeleton-grid">
      <i v-for="i in 5" :key="i"></i>
    </div>
    <div v-else-if="loadError" class="load-error">
      <span>看板加载失败：{{ loadError }}</span>
      <button class="btn ghost" @click="router.go(0)">刷新重试</button>
    </div>
    <template v-else-if="data"
      ><section class="kpi-grid">
        <!-- IKAJSU：一卡一指标。营业额/订单/履约完成率/新用户/异常各占一卡；
             卡内明细（准时率/待拣货/退款）不堆叠，水位面板与 CSV 日报里有 -->
        <article class="kpi hero-kpi">
          <p :title="data.caliber.revenue">今日营业额</p>
          <strong
            ><small>¥</small>{{ fenToYuan(data.kpis.revenue, true) }}</strong
          >
          <div class="delta" :class="(revenueDelta ?? 0) >= 0 ? 'up' : 'down'">
            <template v-if="deltaText(revenueDelta)"
              >{{ deltaText(revenueDelta) }} <span>较昨日</span></template
            ><span v-else>暂无环比数据</span>
          </div>
          <div class="orb"></div>
        </article>
        <article class="kpi">
          <p :title="data.caliber.orders">今日订单</p>
          <strong>{{ data.kpis.orders }}<small> 单</small></strong>
          <div class="mini-bars">
            <i
              v-for="(v, i) in miniBars"
              :key="i"
              :style="{ height: v + '%' }"
            ></i>
          </div>
          <div class="delta" :class="(ordersDelta ?? 0) >= 0 ? 'up' : 'down'">
            <template v-if="deltaText(ordersDelta)"
              >{{ deltaText(ordersDelta) }}
              <span>较昨日</span></template
            ><span v-else>暂无环比数据</span>
          </div>
        </article>
        <article class="kpi">
          <!-- IK93GP 后端口径：fulfillmentRate=履约完成率（delivered+completed 占比），准时率独立字段 onTimeRate -->
          <p :title="data.caliber.fulfillmentRate">履约完成率</p>
          <div
            class="ring"
            :style="{ '--value': data.kpis.fulfillmentRate + '%' }"
          >
            <strong>{{ data.kpis.fulfillmentRate }}%</strong>
          </div>
        </article>
        <article class="kpi">
          <p :title="data.caliber.newUsers">今日新用户</p>
          <strong>{{ data.kpis.newUsers }}<small> 人</small></strong>
          <div
            class="delta"
            :class="(newUsersDelta ?? 0) >= 0 ? 'up' : 'down'"
          >
            <template v-if="deltaText(newUsersDelta)"
              >{{ deltaText(newUsersDelta) }}
              <span>较昨日</span></template
            ><span v-else>暂无环比数据</span>
          </div>
        </article>
        <article class="kpi alert-kpi">
          <p :title="data.caliber.timeout">待处理异常</p>
          <strong>{{ data.kpis.exceptions }}<small> 项</small></strong>
          <button @click="router.push('/orders')">立即处理 →</button>
        </article>
      </section>
      <section class="dashboard-grid">
        <article class="panel chart-panel">
          <div class="panel-head">
            <div>
              <small>REVENUE TREND</small>
              <h2>近 7 日交易趋势</h2>
            </div>
            <span class="status success">交易金额</span>
          </div>
          <div class="chart">
            <div class="axis">
              <span v-for="label in axisLabels" :key="label">{{ label }}</span>
            </div>
            <div class="plot">
              <div class="grid-lines"><i v-for="i in 6" :key="i"></i></div>
              <svg viewBox="0 0 700 230" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#16a45b" stop-opacity=".32" />
                    <stop offset="1" stop-color="#16a45b" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path v-if="areaPath" :d="areaPath" fill="url(#area)" />
                <path
                  v-if="linePath"
                  :d="linePath"
                  fill="none"
                  stroke="#13a15b"
                  stroke-width="4"
                />
                <g
                  v-if="chartPoints.length"
                  fill="#b9f227"
                  stroke="#075337"
                  stroke-width="3"
                >
                  <circle
                    v-for="(p, i) in chartPoints"
                    :key="i"
                    :cx="p.x"
                    :cy="p.y"
                    :r="i === chartPoints.length - 1 ? 7 : 6"
                  />
                </g>
              </svg>
              <div class="x-labels">
                <span v-for="t in trend" :key="t.date">{{ t.date }}</span>
              </div>
              <p v-if="!trend.length" class="chart-empty">
                近 7 日暂无交易数据
              </p>
            </div>
          </div>
        </article>
        <article class="panel flow-panel">
          <div class="panel-head">
            <div>
              <small>FULFILLMENT FLOW</small>
              <h2>实时履约水位</h2>
            </div>
            <button class="text-btn" @click="router.push('/orders')">
              查看看板 →
            </button>
          </div>
          <div class="flow-list">
            <template v-for="(value, key, index) in data.fulfillment" :key="key">
              <!-- IKAJSS：行可点下钻（作业人数/平均停留；超时节点列单号直达） -->
              <div class="flow-row" role="button" @click="toggleFlowDrill(String(key))">
                <div class="flow-index">0{{ index + 1 }}</div>
                <div class="flow-info">
                  <span>{{ flowLabel(String(key)) }}</span>
                  <div>
                    <i
                      :style="{ width: Math.max(16, value * 9) + '%' }"
                      :class="{ danger: String(key) === 'timeout' }"
                    ></i>
                  </div>
                </div>
                <strong>{{ value }}</strong>
                <i class="drill-arrow" :class="{ open: drillKey === key }">⌄</i>
              </div>
              <div v-if="drillKey === key" class="flow-drill">
                <p>
                  作业人数
                  <b>{{ nodeDetail(String(key))?.staff || "—" }}</b>
                  · 平均停留
                  <b>{{
                    nodeDetail(String(key))?.avgMinutes == null
                      ? "—"
                      : `${nodeDetail(String(key))!.avgMinutes} 分钟`
                  }}</b>
                </p>
                <p class="drill-note">平均停留自支付起算（当日达口径）</p>
                <template v-if="String(key) === 'timeout'">
                  <p v-if="!timeoutOrders.length" class="drill-note">
                    暂无超时订单
                  </p>
                  <div
                    v-for="o in timeoutOrders"
                    :key="o.id"
                    class="timeout-order"
                  >
                    <span
                      >{{ o.orderNo }} · 超时
                      {{ o.overtimeMinutes }} 分钟</span
                    >
                    <button
                      class="text-btn"
                      @click.stop="router.push(`/orders?q=${o.orderNo}`)"
                    >
                      立即处理 →
                    </button>
                  </div>
                </template>
              </div>
            </template>
          </div>
        </article>
      </section>
      <section class="bottom-grid">
        <article class="panel">
          <div class="panel-head">
            <div>
              <small>BUILDING RANK</small>
              <h2>楼栋经营排行</h2>
            </div>
            <button class="text-btn" @click="router.push('/orders')">
              完整数据 →
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>楼栋</th>
                <th>订单量</th>
                <th>成交金额</th>
                <th>完成率</th>
                <th>准时率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, i) in data.hotBuildings || []" :key="item.name">
                <td>
                  <b class="rank">{{ i + 1 }}</b>
                </td>
                <td>
                  <strong>{{ item.name }}</strong>
                </td>
                <td>{{ item.orders }}</td>
                <td>¥{{ fenToYuan(item.revenue, true) }}</td>
                <td>{{ item.completionRate }}%</td>
                <td>
                  <span class="status success">{{ item.onTimeRate }}%</span>
                </td>
              </tr>
              <tr v-if="!(data.hotBuildings || []).length">
                <td colspan="6" class="empty-cell">暂无楼栋排行数据</td>
              </tr>
            </tbody>
          </table>
        </article>
        <article class="panel activity">
          <div class="panel-head">
            <div>
              <small>LIVE SIGNAL</small>
              <h2>实时动态</h2>
            </div>
            <span class="live"><i></i> LIVE</span>
          </div>
          <div class="activity-list">
            <!-- IKAJSS：每条带直达按钮，按事件类型跳对应处理页 -->
            <div v-for="(a, i) in activities" :key="i">
              <i :class="activityClass(a.type)"></i>
              <p>
                <b>{{ a.text }}</b><span>{{ a.time }}</span>
              </p>
              <button
                v-if="activityRoute(a)"
                class="text-btn act-btn"
                @click="router.push(activityRoute(a)!)"
              >
                处理 →
              </button>
            </div>
            <p v-if="!activities.length" class="empty-cell">
              暂无实时动态
            </p>
          </div>
        </article>
      </section></template
    >
  </div>
</template>
