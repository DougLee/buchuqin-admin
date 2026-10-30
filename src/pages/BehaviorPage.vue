<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import { fenToYuan } from "../utils/money";
import AdminPageShell from "../shared/ui/AdminPageShell.vue";

/**
 * 行为分析（IKRGLV，道哥定稿仅超管可见）：
 * - 漏斗：埋点事件（页面浏览/看商品/加购/搜索/分享）恒显五步，空数据显示 0；
 *   交易段（下单/支付，Order 表口径）+端到端转化率
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
const EVENT_ORDER = [
  "page_view",
  "product_view",
  "add_cart",
  "search",
  "share",
] as const;

interface FunnelRow {
  event: string;
  label: string;
  hits: number;
  users: number;
}
/** 漏斗五步恒显（道哥 2026-10-30 验收）：无数据显示 0，空态不再残缺 */
const funnelRows = computed<FunnelRow[]>(() => {
  const byEvent = new Map(
    (report.value?.funnel ?? []).map((f) => [f.event, f]),
  );
  return EVENT_ORDER.map((e): FunnelRow => {
    const f = byEvent.get(e);
    return {
      event: e,
      label: EVENT_TEXT[e] ?? e,
      hits: f?.hits ?? 0,
      users: f?.users ?? 0,
    };
  });
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
    report.value = await api.analyticsSummary(startDate.value, endDate.value);
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
        v-for="(r, i) in funnelRows"
        :key="r.event"
        class="funnel-card"
        :class="{ 'funnel-card--muted': !r.users }"
      >
        <span class="funnel-card__step">{{ i + 1 }}</span>
        <span class="funnel-card__label">{{ r.label }}</span>
        <span class="funnel-card__users">
          {{ r.users }}<em>人</em>
        </span>
        <span class="funnel-card__hits">{{ r.hits }} 次</span>
      </div>
      <div class="funnel-card funnel-card--trade">
        <span class="funnel-card__step funnel-card__step--trade">单</span>
        <span class="funnel-card__label">下单（交易口径）</span>
        <span class="funnel-card__users">
          {{ report?.trade.orders ?? 0 }}<em>单</em>
        </span>
        <span class="funnel-card__hits">
          {{ fenToYuan(report?.trade.amount ?? 0) }} 元
        </span>
      </div>
      <div class="funnel-card funnel-card--rate">
        <span class="funnel-card__step funnel-card__step--rate">%</span>
        <span class="funnel-card__label">看商品→加购转化</span>
        <span class="funnel-card__users">{{ cartRateText }}</span>
        <span class="funnel-card__hits">按人数</span>
      </div>
    </section>

    <section class="admin-table-panel" aria-label="商品热度">
      <h3 class="block-title">商品热度 Top 10<em>按加购次数排序</em></h3>
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
      <h3 class="block-title">搜索词 Top 10<em>按搜索次数排序</em></h3>
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
/* 漏斗：五步恒显+步骤徽标；交易/转化卡主题高亮（道哥 2026-10-30 样式验收） */
.funnel-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 22px;
}
.funnel-card {
  position: relative;
  flex: 1 1 0;
  min-width: 148px;
  background: #fff;
  border: 1px solid #e6ebe7;
  border-radius: 14px;
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.funnel-card--muted .funnel-card__users {
  color: #b9c2bc;
}
.funnel-card__step {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #eaf4ee;
  color: var(--brand, #159c55);
  font-size: 12px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.funnel-card__step--trade {
  background: var(--brand, #159c55);
  color: #fff;
}
.funnel-card__step--rate {
  background: #f3ecd8;
  color: #9a7b1e;
}
.funnel-card__label {
  font-size: 13px;
  color: #667069;
}
.funnel-card__users {
  font-size: 28px;
  font-weight: 800;
  line-height: 1.25;
  color: #12241c;
  font-variant-numeric: tabular-nums;
}
.funnel-card__users em {
  font-style: normal;
  font-size: 12px;
  font-weight: 600;
  color: #8a948e;
  margin-left: 3px;
}
.funnel-card__hits {
  font-size: 12px;
  color: #8a948e;
}
.funnel-card--trade {
  border-color: #bfe3cb;
  background: #f2faf5;
}
.funnel-card--trade .funnel-card__users {
  color: #0b4b36;
}
.funnel-card--rate {
  border-color: #e6dcbc;
  background: #fbf8ef;
}
.funnel-card--rate .funnel-card__users {
  color: #9a7b1e;
}
/* 表格区标题：主题色竖条+排序说明 */
.block-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 800;
  color: #12241c;
}
.block-title em {
  font-style: normal;
  font-size: 12px;
  font-weight: 500;
  color: #8a948e;
}
.block-title::before {
  content: "";
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--brand, #159c55);
}
</style>
