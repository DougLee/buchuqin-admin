<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { login } from "../api";
import { applySession, isBackendRole } from "../session";

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
    const result = await login(username.value.trim(), password.value);
    if (!isBackendRole(result.user.role)) {
      error.value = `该账号无后台访问权限（角色：${result.user.role}）`;
      return;
    }
    applySession(result.user);
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
        <label
          >账号
          <input
            v-model.trim="username"
            placeholder="后台账号"
            autocomplete="username"
        /></label>
        <label
          >密码
          <input
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
        权限矩阵：仓储（工作台/商品/订单只读/出入库）· 运营（全部除结算操作）·
        财务（结算与审计）· 管理员（全部）
      </p>
    </div>
  </div>
</template>
