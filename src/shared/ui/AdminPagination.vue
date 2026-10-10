<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { clampPage, pageWindow } from "../data/pagination";

const props = withDefaults(defineProps<{ page: number; pageSize: number; total: number; pageSizes?: number[] }>(), {
  pageSizes: () => [10, 20, 50],
});
const emit = defineEmits<{ (event: "update:page", value: number): void; (event: "update:pageSize", value: number): void }>();
const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const tokens = computed(() => pageWindow(totalPages.value, props.page));
const jump = ref<number | "">("");
watch(totalPages, (pages) => { if (props.page > pages) emit("update:page", pages); });
function go() {
  const target = clampPage(jump.value, totalPages.value);
  jump.value = "";
  if (target != null) emit("update:page", target);
}
</script>

<template>
  <div class="pagination">
    <span>第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
    <div class="pager-right">
      <label class="page-mode">每页
        <select :value="pageSize" aria-label="每页条数" @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))">
          <option v-for="size in pageSizes" :key="size" :value="size">{{ size }} 条</option>
        </select>
      </label>
      <div class="pager-buttons">
        <button :disabled="page === 1" @click="emit('update:page', page - 1)">←</button>
        <template v-for="(token, index) in tokens" :key="`${index}-${token}`">
          <button v-if="token !== '…'" :class="{ active: token === page }" @click="emit('update:page', token)">{{ token }}</button>
          <span v-else class="pager-ellipsis">…</span>
        </template>
        <button :disabled="page === totalPages" @click="emit('update:page', page + 1)">→</button>
      </div>
      <label class="page-mode">跳至
        <input v-model.number="jump" type="number" min="1" :max="totalPages" aria-label="页码跳转" @keyup.enter="go" />页
        <button @click="go">GO</button>
      </label>
    </div>
  </div>
</template>

<style scoped>
.pager-buttons { display: flex; align-items: center; }
@media (max-width: 760px) {
  .pagination { flex-direction: column; }
  .pager-buttons { max-width: 100%; overflow-x: auto; }
}
</style>
