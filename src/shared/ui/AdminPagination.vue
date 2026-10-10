<script setup lang="ts">
import { computed, watch } from "vue";

const props = withDefaults(defineProps<{ page: number; pageSize: number; total: number; pageSizes?: number[] }>(), {
  pageSizes: () => [10, 20, 50],
});
const emit = defineEmits<{ (event: "update:page", value: number): void; (event: "update:pageSize", value: number): void }>();
const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
watch(totalPages, (pages) => { if (props.page > pages) emit("update:page", pages); });
</script>

<template>
  <nav class="admin-pagination" aria-label="分页导航">
    <ElPagination
      background
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="pageSizes"
      :pager-count="5"
      :total="total"
      layout="total, sizes, prev, pager, next, jumper"
      @current-change="emit('update:page', $event)"
      @size-change="emit('update:pageSize', $event)"
    />
  </nav>
</template>

<style scoped>
.admin-pagination {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: flex-end;
  padding: 10px 14px;
  overflow-x: auto;
}
:deep(.el-pagination) { flex-wrap: nowrap; }
:deep(.el-pagination button),
:deep(.el-pager li) { min-width: 34px; height: 34px; }
@media (max-width: 760px) {
  .admin-pagination { justify-content: center; padding-inline: 8px; overflow-x: visible; }
  :deep(.el-pagination__total),
  :deep(.el-pagination__sizes),
  :deep(.el-pagination__jump) { display: none; }
  :deep(.el-pagination button),
  :deep(.el-pager li) { min-width: 44px; height: 44px; }
}
</style>
