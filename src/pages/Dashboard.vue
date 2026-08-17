<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import type { DashboardActivity, DashboardData, TrendPoint } from "../types";
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

/* 近 7 日趋势：曲线、坐标轴、增幅全部来自接口 trend 字段 */
const trend = computed<TrendPoint[]>(() => {
  const list = data.value?.trend;
  return Array.isArray(list) ? list : [];
});
const CHART_W = 700,
  CHART_H = 230;
const chartPoints = computed(() => {
  const list = trend.value;
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
  const list = trend.value;
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
const last = computed(() => trend.value[trend.value.length - 1]),
  prev = computed(() => trend.value[trend.value.length - 2]);
const revenueDelta = computed(() =>
    pctChange(last.value?.paidAmount, prev.value?.paidAmount),
  ),
  ordersDelta = computed(() => pctChange(last.value?.orders, prev.value?.orders));
const miniBars = computed(() => {
  const list = trend.value.map((t) => Number(t.orders) || 0);
  const max = Math.max(1, ...list);
  return list.map((v) => Math.max(4, Math.round((v / max) * 100)));
});
const rateGap = computed(() =>
  data.value ? Number(data.value.kpis.fulfillmentRate) - 95 : 0,
);
/* 实时动态来自接口 activities 字段（无数据时展示空态） */
const activities = computed<DashboardActivity[]>(() => {
  const list = data.value?.activities;
  return Array.isArray(list) ? list : [];
});
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
function exportReport() {
  if (!data.value) return;
  const rows = [["指标", "数值"], ...Object.entries(data.value.kpis)];
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
      <i v-for="i in 4" :key="i"></i>
    </div>
    <div v-else-if="loadError" class="load-error">
      <span>看板加载失败：{{ loadError }}</span>
      <button class="btn ghost" @click="router.go(0)">刷新重试</button>
    </div>
    <template v-else-if="data"
      ><section class="kpi-grid">
        <article class="kpi hero-kpi">
          <p>今日支付金额</p>
          <strong
            ><small>¥</small>{{ data.kpis.revenue.toLocaleString() }}</strong
          >
          <div class="delta" :class="(revenueDelta ?? 0) >= 0 ? 'up' : 'down'">
            <template v-if="deltaText(revenueDelta)"
              >{{ deltaText(revenueDelta) }} <span>较昨日</span></template
            ><span v-else>暂无环比数据</span>
          </div>
          <div class="orb"></div>
        </article>
        <article class="kpi">
          <p>今日订单</p>
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
          <p>履约准时率</p>
          <div
            class="ring"
            :style="{ '--value': data.kpis.fulfillmentRate + '%' }"
          >
            <strong>{{ data.kpis.fulfillmentRate }}%</strong>
          </div>
          <div class="delta" :class="rateGap >= 0 ? 'up' : 'down'">
            {{ rateGap >= 0 ? "高于" : "低于" }}目标 {{ Math.abs(rateGap).toFixed(1) }}%
          </div>
        </article>
        <article class="kpi alert-kpi">
          <p>待处理异常</p>
          <strong>{{ data.kpis.exceptions }}<small> 项</small></strong>
          <ul>
            <li><span></span>配送异常 {{ data.kpis.exceptions }} 单</li>
            <li><span></span>待拣货 {{ data.fulfillment.waitingPick }} 单</li>
          </ul>
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
                暂无趋势数据，等待接口返回 trend 字段
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
            <div
              v-for="(value, key, index) in data.fulfillment"
              :key="key"
              class="flow-row"
            >
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
            </div>
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
                <td>¥{{ item.revenue.toLocaleString() }}</td>
                <td>
                  <span class="status success">{{ item.onTimeRate }}%</span>
                </td>
              </tr>
              <tr v-if="!(data.hotBuildings || []).length">
                <td colspan="5" class="empty-cell">暂无楼栋排行数据</td>
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
            <div v-for="(a, i) in activities" :key="i">
              <i :class="activityClass(a.type)"></i>
              <p>
                <b>{{ a.text }}</b><span>{{ a.time }}</span>
              </p>
            </div>
            <p v-if="!activities.length" class="empty-cell">
              暂无实时动态，等待接口返回 activities 字段
            </p>
          </div>
        </article>
      </section></template
    >
  </div>
</template>
