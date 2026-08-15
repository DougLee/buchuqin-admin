<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, ensureLogin } from "../api";
const data = ref<any>(),
  loading = ref(true);
const router = useRouter();
onMounted(async () => {
  await ensureLogin();
  data.value = await api.dashboard();
  loading.value = false;
});
const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "今天"];
function exportReport() {
  const rows = [["指标", "数值"], ...Object.entries(data.value.kpis)];
  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv" }),
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
    <template v-else
      ><section class="kpi-grid">
        <article class="kpi hero-kpi">
          <p>今日支付金额</p>
          <strong
            ><small>¥</small>{{ data.kpis.revenue.toLocaleString() }}</strong
          >
          <div class="delta up">↑ 18.6% <span>较昨日</span></div>
          <div class="orb"></div>
        </article>
        <article class="kpi">
          <p>今日订单</p>
          <strong>{{ data.kpis.orders }}<small> 单</small></strong>
          <div class="mini-bars">
            <i
              v-for="(v, i) in [32, 48, 40, 62, 56, 78, 86]"
              :key="i"
              :style="{ height: v + '%' }"
            ></i>
          </div>
          <div class="delta up">↑ 12.3% <span>持续增长</span></div>
        </article>
        <article class="kpi">
          <p>履约准时率</p>
          <div
            class="ring"
            :style="{ '--value': data.kpis.fulfillmentRate + '%' }"
          >
            <strong>{{ data.kpis.fulfillmentRate }}%</strong>
          </div>
          <div class="delta up">高于目标 1.8%</div>
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
              <span>5k</span><span>4k</span><span>3k</span><span>2k</span
              ><span>1k</span><span>0</span>
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
                <path
                  d="M0 180 L116 140 L232 158 L348 92 L464 112 L580 55 L700 24 L700 230 L0 230Z"
                  fill="url(#area)"
                />
                <path
                  d="M0 180 L116 140 L232 158 L348 92 L464 112 L580 55 L700 24"
                  fill="none"
                  stroke="#13a15b"
                  stroke-width="4"
                />
                <g fill="#b9f227" stroke="#075337" stroke-width="3">
                  <circle cx="0" cy="180" r="6" />
                  <circle cx="116" cy="140" r="6" />
                  <circle cx="232" cy="158" r="6" />
                  <circle cx="348" cy="92" r="6" />
                  <circle cx="464" cy="112" r="6" />
                  <circle cx="580" cy="55" r="6" />
                  <circle cx="700" cy="24" r="7" />
                </g>
              </svg>
              <div class="x-labels">
                <span v-for="label in labels" :key="label">{{ label }}</span>
              </div>
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
                <span>{{
                  (
                    {
                      waitingPick: "待拣货",
                      firstMile: "一级配送",
                      waitingHandover: "楼下待交接",
                      lastMile: "二级配送",
                      timeout: "超时异常",
                    } as any
                  )[key]
                }}</span>
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
              <tr v-for="(item, i) in data.hotBuildings" :key="item.name">
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
            <div>
              <i class="green"></i>
              <p>
                <b>订单 BCQ...DED 已送达</b><span>西区 5 栋 612 · 刚刚</span>
              </p>
            </div>
            <div>
              <i class="orange"></i>
              <p><b>2 个包裹即将超时</b><span>一级配送 · 3 分钟前</span></p>
            </div>
            <div>
              <i class="blue"></i>
              <p>
                <b>西区 7 栋完成楼下交接</b><span>楼长 陈晨 · 8 分钟前</span>
              </p>
            </div>
          </div>
        </article>
      </section></template
    >
  </div>
</template>
