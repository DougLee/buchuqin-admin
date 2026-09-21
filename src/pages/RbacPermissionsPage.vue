<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
type PermissionEntry = { pattern: string; name: string };

/** 与菜单编辑器共用后端登记的接口权限目录。 */
const catalog = ref<PermissionEntry[]>([]);
const loading = ref(true);
const search = ref("");
const loadError = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    catalog.value = (await api.rbacCatalog()).permissions;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

const groups = computed(() => {
  const map = new Map<string, PermissionEntry[]>();
  for (const p of catalog.value) {
    const group = p.name.split(" / ")[0] || "其他接口";
    if (search.value && !`${p.name} ${p.pattern}`.toLowerCase().includes(search.value.toLowerCase())) continue;
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(p);
  }
  return [...map.entries()].map(([group, perms]) => ({ group, perms }));
});
</script>
<template>
  <div class="workspace rbac-workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>权限目录</h1>
        <p>
          浏览系统已登记的接口权限（{{ catalog.length }} 项）。
          通过菜单管理配置接口权限，再在角色管理中分配菜单和操作。
        </p>
      </div>
    </div>

    <div class="rbac-toolbar"><label class="rbac-search"><span>查找权限</span><input v-model="search" placeholder="搜索功能名称、请求方法或接口路径" aria-label="搜索权限目录" /></label><span class="rbac-count">{{ groups.length }} 个模块</span></div>
    <div v-if="!loading && !loadError && !groups.length" class="data-panel rbac-empty">没有匹配的权限，请尝试其他关键词。</div>
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
                <th>请求方法</th>
                <th>接口路径</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in g.perms" :key="p.pattern">
                <td><strong>{{ p.name }}</strong></td>
                <td><span class="rbac-node-kind">{{ p.pattern.split(" ")[0] }}</span></td>
                <td><code>{{ p.pattern.slice(p.pattern.indexOf(" ") + 1) }}</code></td>
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
