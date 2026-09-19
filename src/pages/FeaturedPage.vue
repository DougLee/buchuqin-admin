<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import ProductPickerField from "../components/ProductPickerField.vue";
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
const picked = ref<FeatRow[]>([]);
const saving = ref(false);
const savedIds = ref<string[]>([]);
const toast = ref("");

const dirty = computed(
  () =>
    JSON.stringify(picked.value.map((p) => p.id)) !==
    JSON.stringify(savedIds.value),
);
/** 多选器 model：Record<id, 1>（件数语义在推荐位不适用，仅作选中标记） */
const model = computed<Record<string, number>>(() =>
  Object.fromEntries(picked.value.map((p) => [p.id, 1])),
);

onMounted(async () => {
  try {
    const [prods, feat] = await Promise.all([
      api.products({ page: 1, pageSize: 300, status: "on-sale" }, "campus"),
      api.featured(),
    ]);
    candidates.value = prods.items;
    picked.value = feat;
    savedIds.value = feat.map((f) => f.id);
  } catch (e) {
    toast.value = "加载失败，请刷新重试";
  } finally {
    loadingCands.value = false;
  }
});

/** 选择器变更 → 同步有序列表：新增 append（元数据取候选池），取消则移除 */
function onPick(v: string | Record<string, number>) {
  const ids = typeof v === "object" && v !== null ? Object.keys(v) : v ? [v] : [];
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
  toast.value = "";
  try {
    const r = await api.saveFeatured(picked.value.map((p) => p.id));
    savedIds.value = picked.value.map((p) => p.id);
    toast.value = `已保存 ${r.count} 个推荐位`;
  } catch (e) {
    toast.value = "保存失败，请重试";
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <div class="page-wrap">
    <div class="page-head">
      <div>
        <h2>推荐位管理</h2>
        <p class="muted">
          首页「为你推荐」前排手动位（跟顶栏当前运营校区），未满 18
          个由销量自动补齐；清空即纯销量推荐
        </p>
      </div>
      <button class="primary" :disabled="!dirty || saving" @click="save">
        {{ saving ? "保存中…" : "保存推荐位" }}
      </button>
    </div>
    <p v-if="toast" class="toast">{{ toast }}</p>
    <div class="panel">
      <h3>选择商品</h3>
      <ProductPickerField
        :items="candidates"
        :loading="loadingCands"
        multiple
        :model-value="model"
        @update:model-value="onPick"
      />
    </div>
    <div class="panel">
      <h3>
        已选推荐位（{{ picked.length }}）<span class="muted"
          >列表顺序 = 首页展示顺序</span
        >
      </h3>
      <p v-if="!picked.length" class="muted empty">
        还没有勾选推荐商品，首页推荐位将全部按销量展示
      </p>
      <div v-for="(p, i) in picked" :key="p.id" class="feat-row">
        <span class="feat-row__no">{{ i + 1 }}</span>
        <img class="feat-row__img" :src="p.image" :alt="p.name" />
        <div class="feat-row__main">
          <div class="feat-row__name">{{ p.name }}</div>
          <div class="muted">¥{{ fenToYuan(p.price) }} · 库存 {{ p.stock }}</div>
        </div>
        <div class="feat-row__ops">
          <button :disabled="i === 0" @click="move(i, -1)">上移</button>
          <button
            :disabled="i === picked.length - 1"
            @click="move(i, 1)"
          >
            下移
          </button>
          <button class="danger" @click="remove(p.id)">移除</button>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.page-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.page-head h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.page-head p {
  margin: 0;
  font-size: 13px;
}
.toast {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--brand-soft, #eaf8e8);
  color: #07883b;
  font-size: 13px;
  width: fit-content;
}
.panel {
  background: #fff;
  border: 1px solid #e8ece8;
  border-radius: 14px;
  padding: 16px;
}
.panel h3 {
  margin: 0 0 12px;
  font-size: 15px;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.panel h3 .muted {
  font-size: 12px;
  font-weight: 400;
}
.empty {
  padding: 20px 0;
  text-align: center;
}
.feat-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-bottom: 1px solid #f1f4f1;
}
.feat-row:last-child {
  border-bottom: none;
}
.feat-row__no {
  width: 24px;
  text-align: center;
  font-weight: 700;
  color: #07883b;
}
.feat-row__img {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  background: #f2f5f2;
}
.feat-row__main {
  flex: 1;
  min-width: 0;
}
.feat-row__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feat-row__ops {
  display: flex;
  gap: 6px;
}
.feat-row__ops button {
  padding: 4px 10px;
  font-size: 12px;
}
</style>
