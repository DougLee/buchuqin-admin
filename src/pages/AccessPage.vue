<template>
  <div class="workspace">
    <h1>
      {{ route.meta.configurationError ? "页面尚未配置" : "当前页面不可访问" }}
    </h1>
    <p>
      {{
        route.meta.configurationError
          ? "该菜单未绑定有效页面，请联系超级管理员修改页面组件。"
          : "页面可能尚未授权或权限已变更，请重试加载或联系超级管理员。"
      }}
    </p>
    <div class="access-actions">
      <button class="btn" :disabled="retrying" @click="retry">
        {{ retrying ? "正在重试…" : "重试加载权限" }}
      </button>
      <RouterLink
        v-if="menuTree.some((m) => m.type === 1 && m.authorized !== false)"
        class="btn ghost"
        :to="
          menuTree.find((m) => m.type === 1 && m.authorized !== false)?.path ||
          '/'
        "
        >打开已授权页面</RouterLink
      >
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { loadRbac, menuTree } from "../session";
const route = useRoute();
const router = useRouter();
/** 拒绝页不再是死胡同（2026-10-13）：网络瞬断导致的误报可就地恢复——
 *  重拉授权成功即跳第一个可见菜单；真·权限变更时重试后仍拒绝，给出明确提示 */
const retrying = ref(false);
async function retry() {
  if (retrying.value) return;
  retrying.value = true;
  try {
    if (await loadRbac()) {
      const target =
        menuTree.value.find((m) => m.type === 1 && m.authorized !== false)
          ?.path || "/";
      await router.replace(target);
    } else {
      ElMessage.warning("仍未恢复授权，请检查网络后重试或联系超级管理员");
    }
  } finally {
    retrying.value = false;
  }
}
</script>
<style scoped>
.access-actions {
  display: flex;
  gap: 14px;
  margin-top: 18px;
  align-items: center;
}
</style>
