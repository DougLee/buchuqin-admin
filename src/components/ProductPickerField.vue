<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { fenToYuan } from "../utils/money";
import type { Product } from "../types";
/**
 * 商品选择器（IKGQ6Q，2026-09-18 道哥拍板组件化）：类别下拉 + 模糊搜索 +
 * 行式卡片列表，四处统一——
 * - 单选（multiple 缺省）：采购入库 / 盘点 / 新建促销，点行回填商品 id；
 * - 多选（multiple）：订货单编辑器，行内直接填件数（v-model = {商品id: 件数}）。
 * 候选集 items 由调用方给（全量 / 在售 / 批次可订）；类别内部拉 adminCategories
 * 并缓存，items 自带 category 名（订货单快照）时优先聚合，接口失败降级只剩搜索。
 * 视觉沿用 IKG7B9 已验收样式（36px 筛选行、行式卡片、绿系选中）+ 加载骨架。
 */
const props = defineProps<{
  items: Product[];
  loading?: boolean;
  multiple?: boolean;
  /** 多选行件数输入禁用（订货单非草稿态只读） */
  disabled?: boolean;
  /** IKH0EK 推荐位模式：隐藏多选行件数输入（纯勾选，无件数语义） */
  simple?: boolean;
  modelValue: string | Record<string, number>;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string | Record<string, number>];
}>();

const catId = ref("all");
const keyword = ref("");
const adminCats = ref<{ id: string; name: string }[]>([]);
onMounted(async () => {
  try {
    adminCats.value = (await api.adminCategories()).map((c) => ({
      id: c.id,
      name: c.name,
    }));
  } catch {
    adminCats.value = []; // 类别接口失败：降级只剩搜索，不阻塞选品
  }
});
/** 类别源：items 自带 category 名（订货单快照）则聚合（批次子集口径），
 *  否则用全量类别字典。 */
const categories = computed(() => {
  const seen = new Map<string, string>();
  for (const p of props.items) {
    const c = (p as { category?: { name?: string } }).category;
    if (p.categoryId && c?.name) seen.set(p.categoryId, c.name);
  }
  const base = seen.size
    ? [...seen.entries()].map(([id, name]) => ({ id, name }))
    : adminCats.value;
  return [{ id: "all", name: "全部类别" }, ...base];
});
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return props.items.filter((p) => {
    if (catId.value !== "all" && p.categoryId !== catId.value) return false;
    if (!kw) return true;
    return (
      p.name.toLowerCase().includes(kw) || (p.barcode ?? "").includes(kw)
    );
  });
});

function selectOne(id: string) {
  emit("update:modelValue", id);
}
function qtyOf(id: string): number {
  if (typeof props.modelValue !== "object" || props.modelValue === null) return 0;
  return (props.modelValue as Record<string, number>)[id] ?? 0;
}
function setQty(id: string, q: number) {
  const next = { ...(props.modelValue as Record<string, number>), [id]: q };
  emit("update:modelValue", next);
}
/** simple 模式（无件数输入）：点行即选中/取消——件数输入原本就是多选的选中途径 */
function togglePick(id: string) {
  setQty(id, qtyOf(id) > 0 ? 0 : 1);
}
function unitText(p: Product): string {
  // 快照行 unitsPerCase 可能缺省（订货单旧快照），缺省视为无件概念
  const per = p.unitsPerCase ?? 1;
  return per > 1 ? ` · 1 件=${per}${p.retailUnit || "个"}` : "";
}
</script>

<template>
  <div class="product-picker">
    <div class="pp-bar">
      <select v-model="catId" class="pp-cat-select">
        <option v-for="c in categories" :key="c.id" :value="c.id">
          {{ c.name }}
        </option>
      </select>
      <input v-model="keyword" class="pp-search" placeholder="搜索商品名 / 条码" />
    </div>
    <div class="pp-list">
      <!-- 加载骨架（IKGNQ 道哥反馈）：候选集未就绪给脉冲占位，不裸空白 -->
      <template v-if="loading">
        <div v-for="i in 4" :key="`sk-${i}`" class="pp-item pp-item--skeleton">
          <span class="pp-item__ph skeleton-block"></span>
          <span class="skeleton-line"></span>
          <span class="skeleton-line skeleton-line--short"></span>
        </div>
      </template>
      <template v-else-if="!multiple">
        <button
          v-for="p in filtered"
          :key="p.id"
          type="button"
          class="pp-item"
          :class="{ active: modelValue === p.id }"
          @click="selectOne(p.id)"
        >
          <img v-if="p.image" :src="p.image" alt="" />
          <span v-else class="pp-item__ph"></span>
          <span class="pp-item__name">{{ p.name }}</span>
          <span class="pp-item__meta"
            >¥{{ fenToYuan(p.price) }} · 可售
            {{ p.availableStock ?? p.stock ?? 0 }}</span
          >
        </button>
        <div v-if="!filtered.length" class="pp-empty">
          没有匹配的商品——换个类别或关键词试试。
        </div>
      </template>
      <template v-else>
        <div
          v-for="p in filtered"
          :key="p.id"
          class="pp-item pp-item--multi"
          :class="{ active: simple && qtyOf(p.id) > 0 }"
          @click="simple && togglePick(p.id)"
        >
          <img v-if="p.image" :src="p.image" alt="" />
          <span v-else class="pp-item__ph"></span>
          <span class="pp-item__main">
            <span class="pp-item__name">{{ p.name }}</span>
            <span class="pp-item__meta"
              >批发价 {{ fenToYuan(p.price) }}/{{ p.wholesaleUnit || "件"
              }}{{ unitText(p) }}</span
            >
          </span>
          <span v-if="!simple" class="pp-item__qty">
            <input
              type="number"
              min="0"
              step="1"
              :value="qtyOf(p.id)"
              :disabled="disabled"
              @input="
                setQty(p.id, Number(($event.target as HTMLInputElement).value) || 0)
              "
            /><span>件</span>
          </span>
        </div>
        <div v-if="!filtered.length" class="pp-empty">
          没有匹配的商品——换个类别或关键词试试。
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.product-picker {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pp-bar {
  display: flex;
  gap: 8px;
}
.pp-bar select,
.pp-bar input {
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 0 10px;
  font-size: 13px;
  background: #fff;
  outline: 0;
}
.pp-bar select {
  flex: 0 0 140px;
  color: #1d2b24;
  cursor: pointer;
}
.pp-bar input {
  flex: 1;
}
.pp-bar select:focus,
.pp-bar input:focus {
  border-color: var(--brand);
}
.pp-list {
  height: 224px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}
.pp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  background: #fff;
  text-align: left;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  color: #1d2b24;
}
button.pp-item {
  width: 100%;
}
.pp-item:hover {
  border-color: var(--brand);
}
.pp-item.active {
  border-color: var(--brand);
  background: #eaf8e8;
}
.pp-item.active .pp-item__name {
  color: #07883b;
  font-weight: 600;
}
.pp-item img,
.pp-item__ph {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
  background: #f1f6f2;
}
.pp-item__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp-item--multi .pp-item__name {
  font-weight: 500;
}
.pp-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pp-item__main .pp-item__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp-item__meta {
  flex: none;
  font-size: 12px;
  color: var(--muted);
}
.pp-item__qty {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.pp-item__qty input {
  width: 64px;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 13px;
}
.pp-item__qty input:focus {
  outline: 0;
  border-color: var(--brand);
}
.pp-item--skeleton {
  pointer-events: none;
}
.pp-item--skeleton .pp-item__ph {
  animation: pulse 1.5s infinite;
}
.skeleton-line {
  flex: 1;
  height: 14px;
  border-radius: 5px;
  background: linear-gradient(90deg, #eef2ef, #fafbfa, #eef2ef);
  background-size: 200%;
  animation: pulse 1.5s infinite;
}
.skeleton-line--short {
  flex: 0 0 88px;
}
.pp-empty {
  padding: 18px 0;
  text-align: center;
  font-size: 12px;
  color: #8a988e;
}
</style>
