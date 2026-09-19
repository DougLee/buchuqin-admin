<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { login } from "../api";
import { applySession, loadRbac } from "../session";

const router = useRouter(),
  username = ref(""),
  password = ref(""),
  error = ref(""),
  submitting = ref(false);

async function submit() {
  error.value = "";
  if (!username.value.trim() || !password.value) {
    error.value = "请输入账号和密码";
    return;
  }
  submitting.value = true;
  try {
    // RBAC V1：不再按旧角色白名单拦截——能否进后台由 /admin/rbac/me 决定；
    // 权限拉取失败=拒绝进入（默认拒绝，不回退宽松）
    const result = await login(username.value.trim(), password.value);
    applySession(result.user);
    if (!(await loadRbac())) {
      error.value = "权限加载失败，请重试";
      return;
    }
    router.push("/");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "登录失败";
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
      <p class="login-sub">使用后台账号登录</p>
      <form class="login-form" @submit.prevent="submit">
        <label for="login-username"
          >账号
          <input
            id="login-username"
            v-model.trim="username"
            placeholder="后台账号"
            autocomplete="username"
            autofocus
        /></label>
        <label for="login-password"
          >密码
          <input
            id="login-password"
            v-model="password"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
        /></label>
        <p v-if="error" class="form-hint">{{ error }}</p>
        <button class="btn primary login-btn" type="submit" :disabled="submitting">
          {{ submitting ? "登录中..." : "登录后台" }}
        </button>
      </form>
      <p class="login-foot">
        仅限授权员工使用 · 账号由管理员分配，忘记密码请联系管理员重置
      </p>
    </div>
  </div>
</template>
