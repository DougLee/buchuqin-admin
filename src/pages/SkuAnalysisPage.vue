<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { api } from "../api";
import type { SkuAnalysisReport, SkuAnalysisRow } from "../types";
import { fenToYuan } from "../utils/money";
const date = (offset: number) =>
  new Date(Date.now() + 8 * 3600000 - offset * 86400000)
    .toISOString()
    .slice(0, 10);
const filters = ref({
  start: date(30),
  end: date(1),
  campusId: "",
  categoryId: "",
  keyword: "",
});
const applied = ref({ ...filters.value });
const report = ref<SkuAnalysisReport | null>(null);
const loading = ref(false),
  error = ref("");
const top = ref(10),
  segment = ref("全部"),
  action = ref("全部"),
  page = ref(1),
  size = ref(20);
const sort = ref("sales"),
  descending = ref(true);
const selected = ref<SkuAnalysisRow | null>(null);
const drawer = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;
watch(selected, async (value, previous) => {
  if (value) {
    if (!previous) returnFocus = document.activeElement as HTMLElement | null;
    await nextTick();
    drawer.value?.focus();
  } else returnFocus?.focus();
});
function drawerKeys(event: KeyboardEvent) {
  if (event.key !== "Tab" || !drawer.value) return;
  const controls = Array.from(
    drawer.value.querySelectorAll<HTMLElement>(
      'button, [href], input, select, [tabindex="0"]',
    ),
  );
  const first = controls[0],
    last = controls[controls.length - 1];
  if (!first) return;
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === drawer.value)
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === drawer.value)
  ) {
    event.preventDefault();
    first.focus();
  }
}
let requestId = 0;
const money = (n: number | null) =>
  n === null ? "—" : `¥${fenToYuan(n, true)}`;
const percent = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const stamp = computed(() =>
  report.value
    ? new Date(report.value.generatedAt).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "",
);
async function load() {
  const id = ++requestId;
  const query = { ...filters.value };
  loading.value = true;
  error.value = "";
  selected.value = null;
  try {
    const response = await api.skuAnalysis(query);
    if (id !== requestId) return;
    report.value = response;
    applied.value = query;
    page.value = 1;
    segment.value = "全部";
    action.value = "全部";
  } catch (e) {
    if (id === requestId) {
      report.value = null;
      error.value = e instanceof Error ? e.message : "查询失败";
    }
  } finally {
    if (id === requestId) loading.value = false;
  }
}
function quick(days: number) {
  filters.value.start = date(days);
  filters.value.end = date(1);
}
function reset() {
  filters.value = {
    start: date(30),
    end: date(1),
    campusId: "",
    categoryId: "",
    keyword: "",
  };
  void load();
}
const appliedText = computed(() => {
  const value = applied.value;
  const campus = report.value?.campuses.find(
    (c) => c.id === value.campusId,
  )?.name;
  const category = report.value?.categories.find(
    (c) => c.id === value.categoryId,
  )?.name;
  return [
    campus || "全部授权校区",
    category || "全部类目",
    value.keyword ? `搜索：${value.keyword}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
});
const ranked = computed(() =>
  (report.value?.rows || []).filter((r) => r.sales > 0),
);
const chart = computed(() => ranked.value.slice(0, top.value));
const folded = computed(() =>
  ranked.value.slice(top.value).reduce((sum, r) => sum + r.sales, 0),
);
const points = computed(() =>
  ranked.value.filter((r) => r.marginRate !== null),
);
const minY = computed(() =>
  Math.min(0, ...points.value.map((r) => r.marginRate!)),
);
const maxY = computed(() =>
  Math.max(0.6, ...points.value.map((r) => r.marginRate!)),
);
const x = (v: number) =>
  60 + (v / Math.max(1, ranked.value[0]?.sales || 0)) * 600;
const y = (v: number) =>
  260 - ((v - minY.value) / (maxY.value - minY.value)) * 230;
const quadrants = [
  "高销售·高毛利",
  "低销售·高毛利",
  "高销售·低毛利",
  "低销售·低毛利",
];
const filtered = computed(() => {
  const rows = (report.value?.rows || []).filter(
    (r) =>
      (segment.value === "全部" ||
        (segment.value === "核心SKU"
          ? r.core
          : segment.value === "其他排行"
            ? ranked.value.indexOf(r) >= top.value
            : r.quadrant === segment.value)) &&
      (action.value === "全部" || r.advice === action.value),
  );
  return rows.slice().sort((a, b) => {
    const av = a[sort.value as keyof SkuAnalysisRow],
      bv = b[sort.value as keyof SkuAnalysisRow];
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    const compare =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN");
    return (descending.value ? -compare : compare) || a.id.localeCompare(b.id);
  });
});
const pages = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / size.value)),
);
const visible = computed(() =>
  filtered.value.slice((page.value - 1) * size.value, page.value * size.value),
);
watch([segment, action, size, sort, descending, top], () => {
  page.value = 1;
});
function exportCsv() {
  if (!report.value || loading.value) return;
  // 导出本次已加载结果，不重新查询，确保金额/排序与屏幕同一时点。
  const escape = (value: unknown) => {
    let s = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r\n]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [
    ["SKU经营分析", report.value.basis],
    [
      "销售期间",
      report.value.start,
      report.value.end,
      "查询时间（北京时间）",
      stamp.value,
      "规则",
      report.value.ruleVersion,
    ],
    [
      "全局筛选",
      JSON.stringify(applied.value),
      "图表筛选",
      segment.value,
      "建议筛选",
      action.value,
      "排序",
      sort.value,
      descending.value ? "降序" : "升序",
    ],
    [
      "金额单位",
      "人民币分；贡献及毛利率为小数比例；空值表示缺失；库存估值使用当前批发价，非账面价值",
    ],
    [
      "校区",
      "SKU",
      "条码",
      "商品",
      "类目",
      "商品成交额(分)",
      "销量",
      "成本(分)",
      "商品毛利(分)",
      "毛利率",
      "贡献",
      "核心SKU",
      "库存",
      "锁定量",
      "可售量",
      "库存估值(分)",
      "建议",
      "数据提示",
    ],
    ...filtered.value.map((r) => [
      r.campusName,
      `SKU-${r.id.toUpperCase()}`,
      r.barcode,
      r.name,
      r.categoryName,
      r.sales,
      r.quantity,
      r.cost,
      r.margin,
      r.marginRate,
      r.contribution,
      r.core ? "是" : "否",
      r.stock,
      r.lockedStock,
      r.available,
      r.inventoryValue,
      r.advice,
      r.issues.join("；"),
    ]),
  ];
  const blob = new Blob(
    ["\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8;" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `SKU经营分析_${report.value.start}_${report.value.end}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onMounted(load);
</script>

<template>
  <div class="workspace sku-page">
    <div class="page-head">
      <div>
        <h1>SKU经营分析</h1>
        <p>从销售贡献、商品毛利和当前库存，找到需要关注的商品。</p>
      </div>
      <button
        class="btn primary"
        :disabled="!report || loading"
        @click="exportCsv"
      >
        导出筛选结果 · CSV
      </button>
    </div>
    <div class="notice">
      <strong>统计口径</strong
      >：按支付日期统计当前已完成订单；商品成交额不含配送费、不扣优惠券，毛利采用历史批发成本快照。退款／售后订单不计，结果会随订单状态变化。与校区日报的实付金额存在配送费及优惠差异。
    </div>
    <form class="filters panel" @submit.prevent="load">
      <label
        >开始日期<input
          v-model="filters.start"
          type="date"
          :max="date(1)"
          required
      /></label>
      <label
        >结束日期<input
          v-model="filters.end"
          type="date"
          :max="date(1)"
          required
      /></label>
      <label
        >校区<select v-model="filters.campusId">
          <option value="">全部授权校区</option>
          <option v-for="c in report?.campuses" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select></label
      >
      <label
        >类目<select v-model="filters.categoryId">
          <option value="">全部类目</option>
          <option v-for="c in report?.categories" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select></label
      >
      <label
        >商品搜索<input v-model="filters.keyword" placeholder="品名、SKU或条码"
      /></label>
      <button class="btn primary" :disabled="loading">
        {{ loading ? "查询中…" : "查询" }}</button
      ><button class="btn ghost" type="button" @click="reset">重置</button>
      <div class="quick">
        <button
          v-for="d in [7, 30, 90]"
          :key="d"
          type="button"
          @click="quick(d)"
        >
          近{{ d }}个完整自然日</button
        ><span>北京时间，不含当天；修改后点击查询</span>
      </div>
    </form>
    <p v-if="error" class="error" role="alert">
      {{ error }} <button class="btn ghost" @click="load">重试</button>
    </p>
    <p v-if="loading" role="status">正在计算商品经营数据…</p>
    <template v-if="report && !loading">
      <p class="meta">
        已应用：{{ appliedText }} · {{ report.start }} 至 {{ report.end }} ·
        {{ report.rows.length }} 个SKU · 查询及当前库存时点：{{
          stamp
        }}（北京时间）
      </p>
      <p v-if="report.invalidLines" class="error">
        有
        {{ report.invalidLines }}
        条订单行或订单数据异常，未纳入计算；当前结果不完整，请核验源数据。
      </p>
      <div class="cards">
        <div class="panel">
          <span>商品成交额 · 未扣券</span
          ><strong>{{ money(report.totals.sales) }}</strong
          ><small>有销售SKU {{ report.totals.sellingSkus }} 个</small>
        </div>
        <div class="panel">
          <span>成交数量</span
          ><strong>{{ report.totals.quantity.toLocaleString() }}</strong
          ><small>零售单位数量，不是批发件数</small>
        </div>
        <div class="panel">
          <span>已知成本SKU商品毛利</span
          ><strong>{{ money(report.totals.knownMargin) }}</strong
          ><small
            >成本覆盖 {{ percent(report.totals.costCoverage) }} · 毛利率
            {{ percent(report.totals.knownMarginRate) }}</small
          >
        </div>
        <div class="panel">
          <span>当前库存估算金额</span
          ><strong>{{ money(report.totals.inventoryValue) }}</strong
          ><small
            >当前批发价估值 · 缺失
            {{ report.totals.inventoryMissing }} 个</small
          >
        </div>
      </div>
      <div class="charts">
        <section class="panel">
          <div class="section-title">
            <h2>销售贡献排行</h2>
            <select v-model.number="top" aria-label="排行数量">
              <option :value="10">Top 10</option>
              <option :value="20">Top 20</option>
              <option :value="50">Top 50</option>
            </select>
          </div>
          <p class="meta">
            核心阈值80%，包含跨过阈值的商品；累计贡献按全量计算。
          </p>
          <p v-if="!ranked.length" class="empty">当前范围暂无正销售额</p>
          <div class="rank-list">
            <button
              v-for="r in chart"
              :key="r.campusId + r.id"
              class="rank-row"
              @click="selected = r"
            >
              <span class="rank-name"
                >{{ r.name
                }}<small
                  >{{ r.campusName }} {{ r.core ? " · 核心" : "" }}</small
                ></span
              ><span class="bar-track"
                ><span
                  :style="{ width: `${(r.sales / ranked[0].sales) * 100}%` }"
                ></span></span
              ><span
                >{{ money(r.sales)
                }}<small>累计 {{ percent(r.cumulative) }}</small></span
              >
            </button>
          </div>
          <button v-if="folded" class="btn ghost" @click="segment = '其他排行'">
            其他 {{ ranked.length - chart.length }} 个：{{ money(folded) }} ·
            累计100%
          </button>
          <button
            v-if="ranked.length"
            class="btn ghost"
            @click="segment = '核心SKU'"
          >
            查看核心SKU明细
          </button>
        </section>
        <section class="panel">
          <h2>销售额 × 商品毛利率</h2>
          <p class="meta">
            销售分界 {{ money(report.median) }}（中位数） ·
            毛利分界30%。缺成本不归低毛利。
          </p>
          <p v-if="!points.length" class="empty">
            暂无成本完整且销售额为正的商品
          </p>
          <svg
            v-else
            viewBox="0 0 720 310"
            class="matrix"
            role="img"
            aria-label="销售额与毛利率矩阵，点击商品圆点查看详情"
          >
            <rect x="60" y="30" width="600" height="230" fill="#f2f8f5" />
            <line x1="60" y1="260" x2="660" y2="260" stroke="#809087" />
            <line x1="60" y1="30" x2="60" y2="260" stroke="#809087" />
            <line
              :x1="x(report.median || 0)"
              y1="30"
              :x2="x(report.median || 0)"
              y2="260"
              stroke="#95a89c"
              stroke-dasharray="5"
            />
            <line
              x1="60"
              :y1="y(0.3)"
              x2="660"
              :y2="y(0.3)"
              stroke="#95a89c"
              stroke-dasharray="5"
            />
            <text x="5" y="35">{{ percent(maxY) }}</text>
            <text x="5" y="260">{{ percent(minY) }}</text>
            <text x="5" :y="y(0.3) - 4">30%</text>
            <text x="60" y="285">¥0</text>
            <text x="660" y="285" text-anchor="end">
              {{ money(ranked[0]?.sales || 0) }}
            </text>
            <text x="330" y="305">商品成交额</text>
            <circle
              v-for="r in points"
              :key="r.campusId + r.id"
              :cx="x(r.sales)"
              :cy="y(r.marginRate!)"
              r="5"
              :fill="r.margin! < 0 ? '#c44835' : '#188457'"
              fill-opacity=".65"
              tabindex="0"
              role="button"
              :aria-label="`${r.name} 毛利率${percent(r.marginRate)}`"
              @click="selected = r"
              @keydown.enter="selected = r"
            >
              <title>
                {{ r.campusName }} · {{ r.name }}：{{ money(r.sales) }} /
                {{ percent(r.marginRate) }}
              </title>
            </circle>
          </svg>
          <div class="chips">
            <button v-for="q in quadrants" :key="q" @click="segment = q">
              {{ q }}（{{ points.filter((r) => r.quadrant === q).length }}）
            </button>
          </div>
        </section>
      </div>
      <section class="panel details">
        <div class="section-title">
          <h2>SKU明细与当前库存参考</h2>
          <span>{{ filtered.length }} 条匹配记录</span>
        </div>
        <p class="meta">
          库存余额已在支付时扣减；可售参考=当前库存−锁定量，不再减一次订单数量。库存估值=当前库存×当前每零售单位批发价，不代表历史库存或账面价值。无新品／积压／清仓判断。
        </p>
        <div class="table-filters">
          <label
            >图表筛选<select v-model="segment">
              <option>全部</option>
              <option>核心SKU</option>
              <option>其他排行</option>
              <option v-for="q in quadrants" :key="q">{{ q }}</option>
              <option>不可分类</option>
            </select></label
          ><label
            >建议<select v-model="action">
              <option
                v-for="a in [
                  '全部',
                  '核验数据',
                  '核查定价与成本',
                  '关注商品毛利',
                  '持续观察',
                ]"
                :key="a"
              >
                {{ a }}
              </option>
            </select></label
          ><label
            >排序<select v-model="sort">
              <option value="sales">商品成交额</option>
              <option value="quantity">销量</option>
              <option value="margin">商品毛利</option>
              <option value="inventoryValue">库存估值</option>
              <option value="available">可售量</option>
            </select></label
          ><button class="btn ghost" @click="descending = !descending">
            {{ descending ? "降序 ↓" : "升序 ↑" }}</button
          ><label
            >每页<select v-model.number="size">
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select></label
          >
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU / 校区</th>
                <th>商品成交额</th>
                <th>销量</th>
                <th>贡献</th>
                <th>商品毛利 / 毛利率</th>
                <th>库存 / 锁定 / 可售</th>
                <th>库存估值</th>
                <th>建议</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!visible.length">
                <td colspan="8" class="empty">当前筛选范围暂无数据</td>
              </tr>
              <tr v-for="r in visible" :key="r.campusId + r.id">
                <td>
                  <button class="product-link" @click="selected = r">
                    {{ r.name }}</button
                  ><small
                    >{{ r.campusName }} · {{ r.categoryName }}
                    {{ r.core ? " · 核心" : "" }}</small
                  >
                </td>
                <td>{{ money(r.sales) }}</td>
                <td>{{ r.quantity }}</td>
                <td>{{ percent(r.contribution) }}</td>
                <td>
                  {{ money(r.margin)
                  }}<small>{{ percent(r.marginRate) }}</small>
                </td>
                <td>
                  {{ r.stock ?? "—" }} / {{ r.lockedStock ?? "—" }} /
                  {{ r.available ?? "—" }}
                </td>
                <td>{{ money(r.inventoryValue) }}</td>
                <td>
                  {{ r.advice
                  }}<small class="error">{{ r.issues.join("；") }}</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <button class="btn ghost" :disabled="page <= 1" @click="page--">
            上一页</button
          ><span>{{ page }} / {{ pages }}</span
          ><button class="btn ghost" :disabled="page >= pages" @click="page++">
            下一页
          </button>
        </div>
      </section>
    </template>
    <div
      v-if="selected"
      class="sku-overlay"
      @click.self="selected = null"
      @keydown.esc="selected = null"
    >
      <section
        ref="drawer"
        class="sku-drawer"
        @keydown="drawerKeys"
        role="dialog"
        aria-modal="true"
        aria-label="SKU经营详情"
        tabindex="-1"
      >
        <button class="btn ghost close" autofocus @click="selected = null">
          关闭
        </button>
        <h2>{{ selected.name }}</h2>
        <p>{{ selected.campusName }} · {{ selected.categoryName }}</p>
        <p class="meta">
          SKU-{{ selected.id.toUpperCase() }}<br />条码
          {{ selected.barcode || "—" }}
        </p>
        <dl>
          <dt>商品成交额 / 数量</dt>
          <dd>{{ money(selected.sales) }} / {{ selected.quantity }}</dd>
          <dt>历史批发成本</dt>
          <dd>{{ money(selected.cost) }}</dd>
          <dt>商品毛利 / 毛利率</dt>
          <dd>
            {{ money(selected.margin) }} / {{ percent(selected.marginRate) }}
          </dd>
          <dt>贡献 / 核心</dt>
          <dd>
            {{ percent(selected.contribution) }} /
            {{ selected.core ? "是" : "否" }}
          </dd>
          <dt>当前库存 / 锁定 / 可售</dt>
          <dd>
            {{ selected.stock ?? "—" }} / {{ selected.lockedStock ?? "—" }} /
            {{ selected.available ?? "—" }}
          </dd>
          <dt>当前库存估值</dt>
          <dd>{{ money(selected.inventoryValue) }}</dd>
          <dt>建议与依据</dt>
          <dd>
            {{ selected.advice }}：{{
              selected.issues.length
                ? selected.issues.join("；")
                : selected.margin !== null && selected.margin < 0
                  ? "已知商品毛利小于0，请核对价格与成本。"
                  : selected.marginRate !== null && selected.marginRate < 0.3
                    ? "商品毛利率低于30%参考阈值。"
                    : "未命中本版核验或低毛利规则，不代表库存健康。"
            }}
          </dd>
        </dl>
        <p class="notice">{{ report?.basis }}</p>
        <p class="meta">{{ stamp }} · {{ report?.ruleVersion }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sku-page {
  color: var(--text, #203c30);
}
.panel {
  background: white;
  border: 1px solid var(--line, #e0e8e2);
  border-radius: 16px;
  padding: 20px;
}
.notice {
  padding: 14px 18px;
  background: #fff8e9;
  border: 1px solid #efdfb9;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.8;
  margin-bottom: 18px;
}
.filters,
.table-filters {
  display: flex;
  gap: 12px;
  align-items: end;
  flex-wrap: wrap;
}
.filters {
  margin-bottom: 16px;
}
label {
  display: grid;
  gap: 7px;
  font-size: 12px;
  color: #62766a;
}
input,
select {
  padding: 9px 10px;
  border: 1px solid #d6e2db;
  border-radius: 8px;
  background: white;
  max-width: 100%;
}
.quick {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  width: 100%;
  font-size: 12px;
  color: #687b70;
}
.quick button,
.chips button {
  border: 1px solid #dce7df;
  border-radius: 8px;
  background: #f6faf7;
  padding: 7px 10px;
  cursor: pointer;
}
.cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 16px 0;
}
.cards span {
  font-size: 12px;
  color: #657a6c;
}
.cards strong {
  display: block;
  font-size: 25px;
  margin: 12px 0;
  color: #146f49;
}
small {
  display: block;
  font-size: 11px;
  color: #718276;
  margin-top: 5px;
}
.charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 18px;
  align-items: start;
}
.charts section {
  min-width: 0;
}
h2 {
  font-size: 17px;
  margin: 0 0 12px;
}
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.meta {
  font-size: 12px;
  color: #738279;
  line-height: 1.8;
}
.rank-list {
  max-height: 420px;
  overflow: auto;
}
.rank-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 10px;
  align-items: center;
  border: 0;
  background: white;
  text-align: left;
  padding: 12px 0;
  cursor: pointer;
  font-size: 12px;
}
.rank-row:hover {
  background: #f5faf7;
}
.rank-name {
  overflow-wrap: anywhere;
}
.bar-track {
  background: #eef5f0;
  border-radius: 3px;
  height: 12px;
}
.bar-track > span {
  display: block;
  height: 100%;
  background: #278d65;
  border-radius: 3px;
}
.matrix {
  width: 100%;
  font-size: 11px;
}
.matrix circle {
  cursor: pointer;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.empty {
  padding: 36px;
  text-align: center;
  color: #7b8a81;
}
.error {
  color: #b34a35;
}
.table-filters {
  margin: 18px 0;
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  white-space: nowrap;
}
th,
td {
  padding: 13px 12px;
  text-align: left;
  border-bottom: 1px solid #edf1ee;
  font-size: 12px;
}
.product-link {
  background: none;
  border: 0;
  padding: 0;
  color: #187a50;
  font-weight: 600;
  cursor: pointer;
  max-width: 220px;
  white-space: normal;
  text-align: left;
}
.pagination {
  display: flex;
  gap: 16px;
  justify-content: flex-end;
  align-items: center;
  margin-top: 18px;
}
.sku-overlay {
  position: fixed;
  inset: 0;
  background: #102c2359;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}
.sku-drawer {
  width: min(540px, 100%);
  background: white;
  padding: 28px;
  overflow: auto;
}
.close {
  float: right;
}
dt {
  font-size: 12px;
  color: #708276;
  margin-top: 20px;
}
dd {
  margin: 8px 0;
  line-height: 1.7;
}
.sku-drawer .notice {
  margin-top: 24px;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
circle:focus-visible {
  outline: 2px solid #168153;
  outline-offset: 3px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 1100px) {
  .charts {
    grid-template-columns: 1fr;
  }
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .cards {
    grid-template-columns: 1fr;
  }
  .filters label {
    width: 100%;
  }
  .page-head {
    flex-wrap: wrap;
    gap: 12px;
  }
  .panel {
    padding: 14px;
  }
}
</style>
