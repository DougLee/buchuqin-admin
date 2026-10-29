<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import { fenToYuan } from "../utils/money";
import AdminPageShell from "../shared/ui/AdminPageShell.vue";

/**
 * 行为分析（IKRGLV，道哥定稿仅超管可见）：
 * - 漏斗：埋点事件（页面浏览/商品详情/加购）+ 交易段（下单/支付，Order 表口径）
 * - 商品热度 Top10 / 搜索词 Top10
 * 日期缺省=近 7 天；数据源 C 端埋点（3.0.6 起积累）。
 */
const loading = ref(false);
const report = ref<Awaited<ReturnType<typeof api.analyticsSummary>> | null>(
  null,
);

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const weekAgo = new Date(Date.now() - 6 * 86400 * 1000);
const startDate = ref(localDate(weekAgo));
const endDate = ref(localDate(new Date()));

const EVENT_TEXT: Record<string, string> = {
  page_view: "页面浏览",
  product_view: "看商品详情",
  search: "搜索",
  add_cart: "加购",
  share: "分享",
};
/** 漏斗行序：核心转化链在前，长尾（搜索/分享）其后 */
interface FunnelRow {
  event: string;
  label: string;
  hits: number;
  users: number;
}
const funnelRows = computed<FunnelRow[]>(() => {
  const list = report.value?.funnel ?? [];
  const byEvent = new Map(list.map((f) => [f.event, f]));
  const order = ["page_view", "product_view", "add_cart", "search", "share"];
  const main = order
    .filter((e) => byEvent.has(e))
    .map((e): FunnelRow => {
      const f = byEvent.get(e)!;
      return { event: e, label: EVENT_TEXT[e] ?? e, hits: f.hits, users: f.users };
    });
  const extra = list
    .filter((f) => !order.includes(f.event))
    .map((f): FunnelRow => ({ event: f.event, label: f.event, hits: f.hits, users: f.users }));
  return [...main, ...extra];
});
/** 端到端转化率：加购人数 ÷ 看商品人数 */
const cartRateText = computed(() => {
  const rows = new Map(funnelRows.value.map((r) => [r.event, r.users]));
  const pv = rows.get("product_view") ?? 0;
  const cart = rows.get("add_cart") ?? 0;
  return pv ? `${((cart / pv) * 100).toFixed(1)}%` : "—";
});

async function load() {
  if (!startDate.value || !endDate.value)
    return ElMessage.warning("请选择完整的起止日期");
  if (startDate.value > endDate.value)
    return ElMessage.warning("开始日期不能晚于结束日期");
  loading.value = true;
  try {
    report.value = await api.analyticsSummary(
      startDate.value,
      endDate.value,
    );
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "加载失败");
  } finally {
    loading.value = false;
  }
}
watch([startDate, endDate], () => void load());
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="行为分析"
    eyebrow="USER ANALYTICS"
    description="用户端行为漏斗与商品/搜索热度（数据自 3.0.6 版本起积累）。"
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

    <section class="funnel-row" aria-label="转化漏斗">
      <div
        v-for="r in funnelRows"
        :key="r.event"
        class="funnel-card"
      >
        <span class="funnel-card__label">{{ r.label }}</span>
        <span class="funnel-card__users">{{ r.users }}</span>
        <span class="funnel-card__hits">{{ r.hits }} 次</span>
      </div>
      <div class="funnel-card funnel-card--trade">
        <span class="funnel-card__label">下单（交易口径）</span>
        <span class="funnel-card__users">{{ report?.trade.orders ?? 0 }}</span>
        <span class="funnel-card__hits">
          {{ fenToYuan(report?.trade.amount ?? 0) }} 元
        </span>
      </div>
      <div class="funnel-card funnel-card--rate">
        <span class="funnel-card__label">看商品→加购转化</span>
        <span class="funnel-card__users">{{ cartRateText }}</span>
        <span class="funnel-card__hits">按人数</span>
      </div>
    </section>

    <section class="admin-table-panel" aria-label="商品热度">
      <h3 class="block-title">商品热度 Top 10</h3>
      <ElTable
        v-loading="loading"
        :data="report?.topProducts ?? []"
        empty-text="所选范围暂无数据"
      >
        <ElTableColumn type="index" label="#" width="56" />
        <ElTableColumn prop="name" label="商品" min-width="220" />
        <ElTableColumn prop="views" label="浏览次数" width="120" />
        <ElTableColumn prop="carts" label="加购次数" width="120" />
      </ElTable>
    </section>

    <section class="admin-table-panel" aria-label="搜索词热度">
      <h3 class="block-title">搜索词 Top 10</h3>
      <ElTable
        v-loading="loading"
        :data="report?.topKeywords ?? []"
        empty-text="所选范围暂无数据"
      >
        <ElTableColumn type="index" label="#" width="56" />
        <ElTableColumn prop="keyword" label="搜索词" min-width="220" />
        <ElTableColumn prop="hits" label="次数" width="120" />
      </ElTable>
    </section>
  </AdminPageShell>
</template>
<style scoped>
.funnel-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 20px;
}
.funnel-card {
  flex: 1 1 150px;
  min-width: 150px;
  background: #fff;
  border: 1px solid #e8ece9;
  border-radius: 12px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.funnel-card--trade {
  border-color: #bfe3cb;
  background: #f2faf5;
}
.funnel-card--rate {
  border-color: #e3d9bf;
  background: #fbf8ef;
}
.funnel-card__label {
  font-size: 13px;
  color: #667069;
}
.funnel-card__users {
  font-size: 26px;
  font-weight: 800;
  color: #0f172a;
}
.funnel-card__hits {
  font-size: 12px;
  color: #8a948e;
}
.block-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
</style>
