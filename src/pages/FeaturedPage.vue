<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import {
  accountOrgLevel,
  activeCampus,
  hasPerm,
  sessionUser,
} from "../session";
const canEdit = computed(() => hasPerm("PUT /admin/featured"));
import ProductPickerField from "../components/ProductPickerField.vue";
import AdminPageShell from "../shared/ui/AdminPageShell.vue";
import type { Product } from "../types";
import { fenToYuan } from "../utils/money";

/**
 * 首页推荐位管理（IKH0EK 2026-09-19 道哥定版）：
 * - 手动优先+销量补齐：勾选商品按序展示在首页推荐位前排，剩余按销量补满 18
 * - 编辑态+保存按钮：勾选/移除/排序全本地，一次全量有序提交（原子落库）
 * - 校区隔离：跟 admin 顶栏当前运营校区（session token campusId）
 */
interface FeatRow {
  id: string;
  name: string;
  price: number;
  image: string;
  status: string;
  stock: number;
  sales: number;
  categoryId: string;
}
const candidates = ref<Product[]>([]);
const loadingCands = ref(true);
const operationalCampusId = computed(() =>
  accountOrgLevel.value === "platform" || accountOrgLevel.value === "org"
    ? activeCampus.value
    : (sessionUser.value?.campusId ?? ""),
);
const picked = ref<FeatRow[]>([]);
/** 隐藏分类的商品不进推荐位候选池（C 端全链路不露出，勾了不显示） */
const hiddenCategoryIds = ref<Set<string>>(new Set());
const saving = ref(false);
const savedIds = ref<string[]>([]);
const notify = (message: string, error = false) =>
  ElMessage({ message, type: error ? "error" : "success", showClose: true });

const dirty = computed(
  () =>
    JSON.stringify(picked.value.map((p) => p.id)) !==
    JSON.stringify(savedIds.value),
);
/** 多选器 model：Record<id, 1>（件数语义在推荐位不适用，仅作选中标记） */
const model = computed<Record<string, number>>(() =>
  Object.fromEntries(picked.value.map((p) => [p.id, 1])),
);

/** 候选池服务端过滤（道哥 2026-09-22 修复）：在售商品已超 300，
 *  原 pageSize:300 截断 + 本地过滤导致新品/低销量商品（如销量 0 的蛋挞）
 *  永远搜不到——改为类别/关键词上抛服务端查询，pageSize 500 兜底 */
let lastFilter: { categoryId: string; keyword: string } = {
  categoryId: "all",
  keyword: "",
};
const page = ref(1);
const total = ref(0);
const hasMore = computed(() => candidates.value.length < total.value);
const loadingMore = ref(false);
/** 分页拉取：首页覆盖 / loadMore 追加（后端 pageSize 封顶 100，翻页搜全） */
async function loadHiddenCategories() {
  try {
    const cats = await api.adminCategories();
    hiddenCategoryIds.value = new Set(
      cats.filter((c) => c.hidden).map((c) => c.id as string),
    );
  } catch {
    /* 拉不到不过滤（容错） */
  }
}
async function loadCandidates(append = false) {
  if (!operationalCampusId.value) {
    candidates.value = [];
    total.value = 0;
    loadingCands.value = false;
    return;
  }
  if (!append) loadingCands.value = true;
  else loadingMore.value = true;
  try {
    const f = lastFilter;
    const prods = await api.products(
      {
        page: page.value,
        pageSize: 100,
        status: "on-sale",
        categoryId: f.categoryId !== "all" ? f.categoryId : undefined,
        keyword: f.keyword || undefined,
      },
      "campus",
    );
    // IKH0EK 验收拍板：有库存才可进推荐位（件数语义不适用，纯勾选）
    // 道哥 2026-09-28：隐藏分类的商品前台全链路不露出，勾了也白勾——候选池排除
    const fresh = prods.items.filter(
      (p) => p.stock > 0 && !hiddenCategoryIds.value.has(p.categoryId),
    );
    candidates.value = append ? [...candidates.value, ...fresh] : fresh;
    total.value = prods.total;
  } catch (e) {
    notify("加载失败，请刷新重试", true);
  } finally {
    loadingCands.value = false;
    loadingMore.value = false;
  }
}
function loadMore() {
  if (loadingMore.value || !hasMore.value) return;
  page.value += 1;
  void loadCandidates(true);
}
function onFilterChange(f: { categoryId: string; keyword: string }) {
  lastFilter = f;
  page.value = 1;
  void loadCandidates();
}
async function loadPage() {
  if (!operationalCampusId.value) {
    candidates.value = [];
    picked.value = [];
    savedIds.value = [];
    loadingCands.value = false;
    return;
  }
  void loadHiddenCategories();
  try {
    const [, feat] = await Promise.all([loadCandidates(), api.featured()]);
    picked.value = feat;
    savedIds.value = feat.map((f) => f.id);
  } catch (e) {
    notify("加载失败，请刷新重试", true);
  }
}
onMounted(loadPage);
watch(operationalCampusId, loadPage);

/** 选择器变更 → 同步有序列表：新增 append（元数据取候选池），取消则移除 */
function onPick(v: string | Record<string, number>) {
  const ids =
    typeof v === "object" && v !== null
      ? Object.keys(v).filter((k) => (v as Record<string, number>)[k] > 0)
      : v
        ? [v]
        : [];
  const idSet = new Set(ids);
  const byId = new Map(candidates.value.map((c) => [c.id, c]));
  const next: FeatRow[] = picked.value.filter((p) => idSet.has(p.id));
  const exist = new Set(next.map((p) => p.id));
  ids.forEach((id) => {
    if (!exist.has(id)) {
      const c = byId.get(id);
      if (c)
        next.push({
          id: c.id,
          name: c.name,
          price: c.price,
          image: c.image,
          status: c.status,
          stock: c.stock,
          sales: c.sales,
          categoryId: c.categoryId,
        });
    }
  });
  picked.value = next;
}
function move(i: number, delta: -1 | 1) {
  const j = i + delta;
  if (j < 0 || j >= picked.value.length) return;
  const arr = [...picked.value];
  [arr[i], arr[j]] = [arr[j], arr[i]];
  picked.value = arr;
}
function remove(id: string) {
  picked.value = picked.value.filter((p) => p.id !== id);
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    const r = await api.saveFeatured(picked.value.map((p) => p.id));
    savedIds.value = picked.value.map((p) => p.id);
    notify(`已保存 ${r.count} 个推荐位`);
  } catch (e) {
    notify("保存失败，请重试", true);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <AdminPageShell
    title="推荐位管理"
    eyebrow="FEATURED PRODUCTS"
    description="首页「为你推荐」前排手动位，未满 18 个由销量自动补齐；清空即纯销量推荐。"
  >
    <template #actions>
      <ElButton
        v-if="canEdit"
        type="primary"
        :loading="saving"
        :disabled="!operationalCampusId || !dirty"
        @click="save"
      >
        {{ saving ? "保存中…" : "保存推荐位" }}
      </ElButton>
    </template>

    <div class="feat-stack">
      <!-- 选择商品：表单内容面板（全局 .panel） -->
      <section
        v-if="canEdit && hasPerm('GET /admin/products')"
        class="admin-filter-panel"
      >
        <div class="panel-head">
          <h2>选择商品</h2>
        </div>
        <ProductPickerField
          :items="candidates"
          :loading="loadingCands"
          multiple
          simple
          remote
          :has-more="hasMore"
          :loading-more="loadingMore"
          :model-value="model"
          @update:model-value="onPick"
          @filter-change="onFilterChange"
          @load-more="loadMore"
        />
      </section>

      <!-- 已选推荐位：数据面板 + 表格行（rank 序号/cell-thumb 缩略/row-actions 操作列） -->
      <section class="admin-table-panel">
        <div class="data-summary">
          <div>
            <strong>{{ picked.length }}</strong
            ><span> 个已选</span>
          </div>
          <p>列表顺序 = 首页展示顺序，未满 18 个由销量补齐</p>
        </div>
        <ElTable
          v-loading="loadingCands"
          :data="picked"
          row-key="id"
          :empty-text="
            operationalCampusId
              ? '还没有勾选推荐商品，首页推荐位将全部按销量展示。'
              : '请先在顶部选择校区'
          "
        >
          <ElTableColumn type="index" label="顺序" width="80" />
          <ElTableColumn label="商品" min-width="260"
            ><template #default="{ row: p }">
              <div class="feat-product">
                <img class="cell-thumb" :src="p.image" :alt="p.name" />
                <strong>{{ p.name }}</strong>
                <!-- 道哥 2026-09-28：分类已隐藏的商品前台不露出，标记提醒 -->
                <span
                  v-if="hiddenCategoryIds.has(p.categoryId)"
                  class="cat-hidden-badge"
                  title="该商品所属分类已隐藏，小程序不会显示；建议移除或恢复分类"
                  >分类已隐藏</span
                >
              </div>
            </template></ElTableColumn
          >
          <ElTableColumn label="售价 / 库存" min-width="160"
            ><template #default="{ row: p }"
              >¥{{ fenToYuan(p.price) }} · 库存 {{ p.stock }}</template
            ></ElTableColumn
          >
          <ElTableColumn label="操作" fixed="right" width="220"
            ><template #default="{ row: p, $index: i }">
              <template v-if="canEdit"
                ><ElButton
                  size="small"
                  :disabled="i === 0"
                  @click="move(i, -1)"
                >
                  上移 </ElButton
                ><ElButton
                  size="small"
                  :disabled="i === picked.length - 1"
                  @click="move(i, 1)"
                >
                  下移 </ElButton
                ><ElButton
                  size="small"
                  type="danger"
                  plain
                  @click="remove(p.id)"
                >
                  移除
                </ElButton>
              </template>
            </template></ElTableColumn
          >
        </ElTable>
      </section>
    </div>
  </AdminPageShell>
</template>
<style scoped>
/* 页面壳/页头/面板/表格/按钮全走全局（style.css + drawer.css），与订货/采购管理
   同源；scoped 只留四处私有（IKH0EK 样式对齐 2026-09-19）：
   面板纵向间距 / 商品单元格横排 / 行内提示条（色值同 .status.success） */
.feat-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.feat-stack .panel-head {
  margin-bottom: 12px;
}
.feat-toast {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #e5f6eb;
  color: #087641;
  font-size: 12px;
  width: fit-content;
}
.feat-product {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.feat-product strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
<style scoped>
.cat-hidden-badge {
  margin-left: 8px;
  font-size: 11px;
  color: #b45309;
  background: #fef3c7;
  border-radius: 99px;
  padding: 2px 8px;
  flex-shrink: 0;
}
</style>
