<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { login } from "../api";
import {
  applySession,
  isBackendRole,
  ROLE_IDENTITIES,
  type AdminRole,
} from "../session";

const router = useRouter(),
  selectedRole = ref<AdminRole>("admin"),
  username = ref(""),
  password = ref(""),
  error = ref(""),
  submitting = ref(false);

const roles = Object.entries(ROLE_IDENTITIES) as [
  AdminRole,
  (typeof ROLE_IDENTITIES)[AdminRole],
][];

async function submit() {
  error.value = "";
  // username 可填具体工号（后端支持 staffNo/staff id 登录），留空则用所选身份别名
  const identity = username.value.trim() || ROLE_IDENTITIES[selectedRole.value].identity;
  submitting.value = true;
  try {
    const result = await login(identity);
    if (!isBackendRole(result.user.role)) {
      error.value = `该账号无后台访问权限（角色：${result.user.role}），请改用后台角色登录`;
      return;
    }
    applySession(result.user, identity);
    router.push("/");
  } catch (e) {
    error.value =
      e instanceof Error
        ? `${e.message}（演示角色待后端开放时，请先用管理员身份登录）`
        : "登录失败";
  } finally {
    submitting.value = false;
  }
}
</script>
<template>
  <div class="login-shell">
    <div class="login-card">
      <div class="brand-mark big"><span></span></div>
      <h1>不出寝 · 运营后台</h1>
      <p class="login-sub">选择后台角色并登录（演示通道 test-login）</p>
      <div class="role-grid">
        <button
          v-for="[key, info] in roles"
          :key="key"
          type="button"
          class="role-card"
          :class="{ active: selectedRole === key, pending: info.demoPending }"
          @click="selectedRole = key"
        >
          <strong>{{ info.label }}</strong>
          <small>{{ info.desc }}</small>
          <em v-if="info.demoPending">演示角色待后端开放</em>
        </button>
      </div>
      <form class="login-form" @submit.prevent="submit">
        <label
          >用户名（可选工号）
          <input
            v-model.trim="username"
            placeholder="留空使用所选身份；也可填工号如 BM-HBUT-005"
            autocomplete="username"
        /></label>
        <label
          >密码
          <input
            v-model="password"
            type="password"
            placeholder="演示通道无需密码，任意填写"
            autocomplete="current-password"
        /></label>
        <p v-if="error" class="form-hint">{{ error }}</p>
        <button class="btn primary login-btn" type="submit" :disabled="submitting">
          {{ submitting ? "登录中..." : "登录后台" }}
        </button>
      </form>
      <p class="login-foot">
        权限矩阵：仓储（工作台/商品/订单只读/出入库）· 运营（全部除结算操作）·
        财务（结算与审计）· 管理员（全部）
      </p>
    </div>
  </div>
</template>
