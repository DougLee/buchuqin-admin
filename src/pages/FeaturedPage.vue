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
    // IKH0EK 验收拍板：有库存才可进推荐位（件数语义不适用，纯勾选）
    candidates.value = prods.items.filter((p) => p.stock > 0);
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
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器（白底 sticky 72px），
         header 标签会误命中变白卡 -->
    <div class="page-head">
      <div>
        <h1>推荐位管理</h1>
        <p>
          首页「为你推荐」前排手动位（跟顶栏当前运营校区），未满 18
          个由销量自动补齐；清空即纯销量推荐。
        </p>
      </div>
      <div class="head-actions">
        <button class="btn primary" :disabled="!dirty || saving" @click="save">
          {{ saving ? "保存中…" : "保存推荐位" }}
        </button>
      </div>
    </div>

    <!-- 行内提示条（RestockPage confirm-banner 同款绿底）；不用全局 .toast：
         那是 fixed 居中且依赖 script 自动消失（本页 toast 常驻至下次操作） -->
    <p v-if="toast" class="feat-toast">{{ toast }}</p>

    <div class="feat-stack">
      <!-- 选择商品：表单内容面板（全局 .panel） -->
      <div class="panel">
        <div class="panel-head">
          <h2>选择商品</h2>
        </div>
        <ProductPickerField
          :items="candidates"
          :loading="loadingCands"
          multiple
          simple
          :model-value="model"
          @update:model-value="onPick"
        />
      </div>

      <!-- 已选推荐位：数据面板 + 表格行（rank 序号/cell-thumb 缩略/row-actions 操作列） -->
      <div class="data-panel">
        <div class="data-summary">
          <div>
            <strong>{{ picked.length }}</strong><span> 个已选</span>
          </div>
          <p>列表顺序 = 首页展示顺序，未满 18 个由销量补齐</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>顺序</th>
                <th>商品</th>
                <th>售价 / 库存</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loadingCands" v-for="i in 3" :key="i">
                <td :colspan="4"><div class="row-skeleton"></div></td>
              </tr>
              <template v-else>
                <tr v-if="!picked.length">
                  <td :colspan="4" class="empty-cell">
                    还没有勾选推荐商品，首页推荐位将全部按销量展示。
                  </td>
                </tr>
                <tr v-for="(p, i) in picked" :key="p.id">
                  <td><span class="rank">{{ i + 1 }}</span></td>
                  <td>
                    <div class="feat-product">
                      <img class="cell-thumb" :src="p.image" :alt="p.name" />
                      <strong>{{ p.name }}</strong>
                    </div>
                  </td>
                  <td>¥{{ fenToYuan(p.price) }} · 库存 {{ p.stock }}</td>
                  <td class="row-actions">
                    <button
                      class="btn mini ghost"
                      :disabled="i === 0"
                      @click="move(i, -1)"
                    >
                      上移
                    </button>
                    <button
                      class="btn mini ghost"
                      :disabled="i === picked.length - 1"
                      @click="move(i, 1)"
                    >
                      下移
                    </button>
                    <button class="btn mini danger" @click="remove(p.id)">
                      移除
                    </button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
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
