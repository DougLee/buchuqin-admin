<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import { PROMOTION_STATE_TABS } from "../../../../dicts/status-tab";
import { effectiveCampusId, hasPerm } from "../../../../session";
import ProductPickerField from "../../../../components/ProductPickerField.vue";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Product, Promotion } from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
const rows = ref<Promotion[]>([]),
  products = ref<Product[]>([]),
  productsLoading = ref(false),
  loading = ref(false),
  saving = ref(false),
  open = ref(false),
  editing = ref<Promotion | null>(null),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref(""),
  state = ref("all");
const form = reactive({
  productId: "",
  type: "seckill" as "seckill" | "clearance",
  price: 0,
  startsAt: "",
  endsAt: "",
});
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function asPromotion(row: unknown) {
  return row as Promotion;
}
function stateText(p: Promotion) {
  if (p.status === "disabled") return "已停用";
  const now = Date.now();
  if (new Date(p.startsAt).getTime() > now) return "未开始";
  if (new Date(p.endsAt).getTime() <= now) return "已结束";
  return "进行中";
}
async function load() {
  if (!effectiveCampusId.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const r = await api.promotions(
      {
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
        campusId: effectiveCampusId.value,
      },
      state.value === "all" ? undefined : state.value,
    );
    rows.value = r.items;
    total.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "活动加载失败", "error");
  } finally {
    loading.value = false;
  }
}
/** 商品候选集（道哥 2026-10-20 秒杀选不到新商品）：后端 pageSize 封顶 100，
 *  一次性拉 1000 只拿到首页——新商品若排序靠后即「找不到」。改 remote 模式
 *  （照 FeaturedPage 先例）：搜索/类别上抛服务端 + 加载更多翻页搜全。 */
let lastFilter: { categoryId: string; keyword: string } = {
  categoryId: "all",
  keyword: "",
};
const candPage = ref(1);
const candTotal = ref(0);
const loadingMore = ref(false);
const hasMore = computed(() => products.value.length < candTotal.value);
async function loadCandidates(append = false) {
  if (!effectiveCampusId.value) {
    products.value = [];
    candTotal.value = 0;
    productsLoading.value = false;
    return;
  }
  if (!append) productsLoading.value = true;
  else loadingMore.value = true;
  try {
    const f = lastFilter;
    const r = await api.products(
      {
        page: candPage.value,
        pageSize: 100,
        status: "on-sale",
        categoryId: f.categoryId !== "all" ? f.categoryId : undefined,
        keyword: f.keyword || undefined,
        campusId: effectiveCampusId.value,
      },
      "campus",
    );
    products.value = append ? [...products.value, ...r.items] : r.items;
    candTotal.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "在售商品加载失败", "error");
  } finally {
    productsLoading.value = false;
    loadingMore.value = false;
  }
}
function onFilterChange(f: { categoryId: string; keyword: string }) {
  lastFilter = f;
  candPage.value = 1;
  void loadCandidates();
}
function loadMoreCandidates() {
  if (loadingMore.value || !hasMore.value) return;
  candPage.value += 1;
  void loadCandidates(true);
}
async function edit(row?: Promotion) {
  editing.value = row ?? null;
  if (!row) {
    // 商品候选集弹窗打开后异步拉取，选择器内置骨架占位（IKGNQ 仅本校区在售）
    products.value = [];
    lastFilter = { categoryId: "all", keyword: "" };
    candPage.value = 1;
    void loadCandidates();
  }
  Object.assign(form, {
    productId: row?.productId ?? "",
    type: row?.type ?? "seckill",
    price: Number(fenToYuan(row?.price ?? 0)),
    startsAt: row?.startsAt?.slice(0, 16) ?? "",
    endsAt: row?.endsAt?.slice(0, 16) ?? "",
  });
  open.value = true;
}
/** ProductPickerField 单选回填（组件 v-model 为联合类型，收窄为 string）。 */
function pickProduct(value: string | Record<string, number>) {
  form.productId = typeof value === "string" ? value : "";
}
async function save() {
  if (!editing.value && !form.productId) return notify("请选择商品", "error");
  if (form.price <= 0) return notify("请填写促销价", "error");
  if (
    !form.startsAt ||
    !form.endsAt ||
    new Date(form.endsAt) <= new Date(form.startsAt)
  )
    return notify("结束时间必须晚于开始时间", "error");
  saving.value = true;
  try {
    editing.value
      ? await api.updatePromotion(editing.value.id, {
          price: yuanToFen(form.price),
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        })
      : await api.createPromotion({
          productId: form.productId,
          type: form.type,
          price: yuanToFen(form.price),
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        });
    open.value = false;
    notify(editing.value ? "活动已更新" : "活动已创建");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function toggle(row: Promotion) {
  try {
    const next = row.status === "active" ? "disabled" : "active";
    await api.updatePromotion(row.id, { status: next });
    notify(next === "disabled" ? "活动已停用" : "活动已启用");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", "error");
  }
}
watch([page, pageSize, state, effectiveCampusId], load);
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="限时秒杀"
    eyebrow="PROMOTIONS"
    description="管理当前顶部校区的限时秒杀和临期特惠。"
    ><template #actions
      ><ElButton
        v-if="effectiveCampusId && hasPerm('POST /admin/promotions')"
        type="primary"
        @click="edit()"
        >新建活动</ElButton
      ></template
    >
    <div v-if="!effectiveCampusId" class="empty-hint">请先在顶部选择校区。</div>
    <template v-else>
      <section
        class="admin-filter-panel admin-filter-panel--split"
        aria-label="活动筛选"
      >
        <ElTabs v-model="state" class="marketing-tabs"
          ><ElTabPane
            v-for="tab in PROMOTION_STATE_TABS"
            :key="tab.key"
            :label="tab.label"
            :name="tab.key"
        /></ElTabs>
        <div class="admin-filter-form marketing-search">
          <ElInput
            v-model="keyword"
            clearable
            placeholder="搜索活动商品"
            @keyup.enter="
              page = 1;
              load();
            "
          /><ElButton
            @click="
              page = 1;
              load();
            "
            >查询</ElButton
          >
        </div>
      </section>
      <section class="admin-table-panel" aria-label="活动列表">
        <ElTable v-loading="loading" :data="rows" row-key="id"
          ><ElTableColumn label="商品" min-width="180"
            ><template #default="{ row }">{{
              row.product?.name || "—"
            }}</template></ElTableColumn
          ><ElTableColumn label="类型"
            ><template #default="{ row }">{{
              row.type === "seckill" ? "限时秒杀" : "临期特惠"
            }}</template></ElTableColumn
          ><ElTableColumn label="促销价"
            ><template #default="{ row }"
              >¥{{ fenToYuan(row.price) }}</template
            ></ElTableColumn
          ><ElTableColumn label="商品现价"
            ><template #default="{ row }">{{
              row.product ? `¥${fenToYuan(row.product.price)}` : "—"
            }}</template></ElTableColumn
          ><ElTableColumn
            prop="startsAt"
            label="开始时间"
            min-width="170"
          /><ElTableColumn
            prop="endsAt"
            label="结束时间"
            min-width="170"
          /><ElTableColumn label="状态"
            ><template #default="{ row }"
              ><ElTag>{{ stateText(asPromotion(row)) }}</ElTag></template
            ></ElTableColumn
          ><ElTableColumn label="操作" width="150" fixed="right"
            ><template #default="{ row }"
              ><ElButton
                v-if="hasPerm('PATCH /admin/promotions/:id')"
                link
                type="primary"
                @click="edit(asPromotion(row))"
                >编辑</ElButton
              ><ElButton
                v-if="hasPerm('PATCH /admin/promotions/:id')"
                link
                @click="toggle(asPromotion(row))"
                >{{ row.status === "active" ? "停用" : "启用" }}</ElButton
              ></template
            ></ElTableColumn
          ></ElTable
        ><AdminPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="total"
        /></section></template
    ><ElDialog
      v-model="open"
      :title="editing ? '编辑促销活动' : '新建促销活动'"
      width="min(640px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol v-if="!editing" :xs="24"
            ><ElFormItem label="商品（在售，点击行选中）"
              ><!-- IKGQ6Q 组件化选品（c68a210 重构降级为下拉，2026-10-16 回迁）：
                  类别筛选+搜索+行式卡片，showCost 补显成本价（IKH15V 口径：
                  LOCAL=localPurchasePrice 回落批发价，其余=批发价）防亏本定价 -->
              <ProductPickerField
                remote
                :items="products"
                :loading="productsLoading"
                :has-more="hasMore"
                :loading-more="loadingMore"
                show-cost
                :model-value="form.productId"
                @update:model-value="pickProduct"
                @filter-change="onFilterChange"
                @load-more="loadMoreCandidates" /></ElFormItem></ElCol
          ><ElCol v-if="!editing" :xs="24" :sm="12"
            ><ElFormItem label="类型"
              ><ElSelect v-model="form.type"
                ><ElOption label="限时秒杀" value="seckill" /><ElOption
                  label="临期特惠"
                  value="clearance" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="促销价（元）"
              ><ElInputNumber
                v-model="form.price"
                :min="0.01"
                :precision="2" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="开始时间"
              ><ElDatePicker
                v-model="form.startsAt"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="结束时间"
              ><ElDatePicker
                v-model="form.endsAt"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm" /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="open = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      ></ElDialog
    ></AdminPageShell
  >
</template>
<style scoped>
.marketing-tabs {
  flex: 1 1 auto;
  min-width: 0;
}
.marketing-search {
  display: flex;
  align-items: center;
  gap: 10px;
}
.marketing-search :deep(.el-input) {
  flex: 1 1 280px;
}
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
:deep(.el-dialog .el-select),
:deep(.el-dialog .el-input-number),
:deep(.el-dialog .el-date-editor) {
  width: 100%;
}
/* 选品器在表单项内容区（flex）内占满宽 */
:deep(.el-dialog .el-form-item__content .product-picker) {
  width: 100%;
}
@media (max-width: 760px) {
  .marketing-search {
    align-items: stretch;
    flex-direction: column;
  }
  .marketing-search :deep(.el-button) {
    min-height: 44px;
    margin: 0;
  }
}
</style>
