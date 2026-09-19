<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type { AdminPermission } from "../types";

/**
 * 权限目录（RBAC V1，2026-09-19）：只读登记表，按 group 分块展示；
 * 角色编辑的权限矩阵数据同源（GET /admin/rbac/permissions）。
 */
const catalog = ref<AdminPermission[]>([]);
const loading = ref(true);
const loadError = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    catalog.value = await api.rbacPermissions();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

const groups = computed(() => {
  const map = new Map<string, AdminPermission[]>();
  for (const p of [...catalog.value].sort((a, b) => a.sort - b.sort)) {
    if (!map.has(p.group)) map.set(p.group, []);
    map.get(p.group)!.push(p);
  }
  return [...map.entries()].map(([group, perms]) => ({ group, perms }));
});
function scopeText(scope: string): string {
  return scope === "platform" ? "平台/跨校区" : "校区业务";
}
</script>
<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>权限目录</h1>
        <p>
          系统全部权限码登记（{{ catalog.length }} 项，按模块分组）；
          角色管理里勾选的就是这些权限。
        </p>
      </div>
    </div>

    <div v-if="loading" class="data-panel">
      <div class="table-wrap"><div class="row-skeleton"></div></div>
    </div>
    <div v-else-if="loadError" class="data-panel">
      <div class="table-wrap">
        <p class="empty-cell">
          {{ loadError }}
          <button class="btn mini ghost" @click="load">重试</button>
        </p>
      </div>
    </div>
    <div v-else class="perm-stack">
      <div v-for="g in groups" :key="g.group" class="data-panel">
        <div class="panel-head group-title">
          <h2>{{ g.group }}</h2>
          <small>{{ g.perms.length }} 项</small>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>权限</th>
                <th>权限码</th>
                <th>作用域</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in g.perms" :key="p.code">
                <td><strong>{{ p.name }}</strong></td>
                <td><code>{{ p.code }}</code></td>
                <td>
                  <span
                    class="status"
                    :class="p.scope === 'platform' ? 'info' : 'success'"
                    >{{ scopeText(p.scope) }}</span
                  >
                </td>
                <td>{{ p.remark || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.perm-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.group-title {
  padding: 16px 18px 0;
}
.group-title small {
  color: var(--muted);
}
code {
  font-size: 12px;
  color: var(--muted);
}
</style>
