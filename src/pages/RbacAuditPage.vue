<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type { AuditLog } from "../types";
import { fmtDateTime } from "../utils/datetime";

/**
 * 权限审计（RBAC V1，2026-09-19）：账号/角色/授权变更留痕，
 * before/after 摘要展示（截断 JSON，点行展开完整 diff）。
 */
const PAGE_SIZES = [10, 20, 50];
const rows = ref<AuditLog[]>([]);
const loading = ref(true);
const loadError = ref("");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const expandedId = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const res = await api.rbacAudit(page.value, pageSize.value);
    rows.value = res.items;
    total.value = res.total;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
);
const pageList = computed<(number | "…")[]>(() => {
  const pages = totalPages.value;
  const cur = page.value;
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const start = Math.max(2, Math.min(cur - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(cur + 1, 5));
  const list: (number | "…")[] = [1];
  if (start > 2) list.push("…");
  for (let p = start; p <= end; p++) list.push(p);
  if (end < pages - 1) list.push("…");
  list.push(pages);
  return list;
});
function goto(p: number | "…") {
  if (p === "…") return;
  page.value = p;
  expandedId.value = "";
  void load();
}
/** 变更摘要：before/after 截断 JSON（展开行看完整）。 */
function brief(value: Record<string, unknown> | null): string {
  if (!value) return "—";
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
function toggleRow(id: string) {
  expandedId.value = expandedId.value === id ? "" : id;
}
</script>
<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>权限审计</h1>
        <p>账号、角色与授权的变更留痕（谁在何时改了什么）；点行展开变更明细。</p>
      </div>
    </div>

    <div class="data-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>实体 ID</th>
              <th>变更摘要</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6"><div class="row-skeleton"></div></td>
            </tr>
            <tr v-else-if="loadError">
              <td colspan="6" class="empty-cell">
                {{ loadError }}
                <button class="btn mini ghost" @click="load">重试</button>
              </td>
            </tr>
            <tr v-else-if="!rows.length">
              <td colspan="6" class="empty-cell">暂无审计记录</td>
            </tr>
            <template v-for="row in rows" v-else :key="row.id">
              <tr
                class="audit-row"
                :class="{ open: expandedId === row.id }"
                @click="toggleRow(row.id)"
              >
                <td>{{ fmtDateTime(row.createdAt) }}</td>
                <td>{{ row.operator }}</td>
                <td><code>{{ row.action }}</code></td>
                <td>{{ row.entityType }}</td>
                <td><code>{{ row.entityId }}</code></td>
                <td class="audit-brief">
                  <template v-if="row.before || row.after">
                    <template v-if="expandedId === row.id">▲</template>
                    <template v-else>▼</template>
                    {{ brief(row.after ?? row.before) }}
                  </template>
                  <template v-else>—</template>
                </td>
              </tr>
              <tr v-if="expandedId === row.id" class="audit-detail">
                <td colspan="6">
                  <div class="audit-diff">
                    <pre>before: {{ row.before ? JSON.stringify(row.before, null, 2) : "—" }}</pre>
                    <pre>after: {{ row.after ? JSON.stringify(row.after, null, 2) : "—" }}</pre>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
        <div class="pager-right">
          <label class="page-mode"
            >每页
            <select
              v-model.number="pageSize"
              aria-label="每页条数"
              @change="page = 1; load()"
            >
              <option v-for="size in PAGE_SIZES" :key="size" :value="size">
                {{ size }} 条
              </option>
            </select>
          </label>
          <div>
            <button :disabled="page === 1" @click="goto(page - 1)">←</button>
            <template v-for="(p, i) in pageList" :key="`${i}-${p}`">
              <button
                v-if="p !== '…'"
                :class="{ active: p === page }"
                @click="goto(p)"
              >
                {{ p }}
              </button>
              <span v-else class="pager-ellipsis">…</span>
            </template>
            <button :disabled="page === totalPages" @click="goto(page + 1)">
              →
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.audit-row {
  cursor: pointer;
}
.audit-row.open {
  background: #f7fbf8;
}
.audit-brief {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--muted);
}
.audit-detail td {
  background: #f7fbf8;
  padding: 0 14px 12px;
}
.audit-diff {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.audit-diff pre {
  margin: 0;
  padding: 10px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
code {
  font-size: 11px;
  color: var(--muted);
}
@media (max-width: 900px) {
  .audit-diff {
    grid-template-columns: 1fr;
  }
}
</style>
