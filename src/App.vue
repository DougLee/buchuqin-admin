<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import AppIcon from "./components/AppIcon.vue";
import { api, clearToken } from "./api";
import { canSee, clearSession, roleLabel, sessionUser } from "./session";
const route = useRoute(),
  router = useRouter(),
  collapsed = ref(false),
  globalKeyword = ref("");
function search() {
  const value = globalKeyword.value.trim();
  if (!value) return;
  const path = /^(SKU|p\d|\d{8,14})/i.test(value)
    ? "/products"
    : /^BCQ|order/i.test(value)
      ? "/orders"
      : "/staff";
  router.push({ path, query: { q: value } });
}
function logout() {
  clearSession();
  clearToken();
  router.push("/login");
}
/* 自助改密（IK9KWO）：任意后台角色可用 */
const pwdOpen = ref(false),
  oldPassword = ref(""),
  newPassword = ref(""),
  pwdError = ref(""),
  pwdSaving = ref(false);
async function submitPassword() {
  pwdError.value = "";
  if (newPassword.value.length < 8) {
    pwdError.value = "新密码至少 8 位";
    return;
  }
  pwdSaving.value = true;
  try {
    await api.changePassword(oldPassword.value, newPassword.value);
    pwdOpen.value = false;
    oldPassword.value = newPassword.value = "";
  } catch (error) {
    pwdError.value = error instanceof Error ? error.message : "修改失败";
  } finally {
    pwdSaving.value = false;
  }
}
const groups = [
  {
    label: "运营中心",
    items: [
      ["/", "dashboard", "经营总览"],
      ["/orders", "orders", "订单履约"],
      ["/after-sales", "after", "售后退款"],
    ],
  },
  {
    label: "商品仓储",
    items: [
      ["/products", "products", "商品管理"],
      ["/inventory", "inventory", "库存与批次"],
    ],
  },
  {
    label: "组织营销",
    items: [
      ["/staff", "staff", "履约人员"],
      ["/campuses", "campus", "校园组织"],
      ["/marketing", "marketing", "营销活动"],
      ["/dispatch", "dispatch", "调配与请假"],
    ],
  },
  {
    label: "财务系统",
    items: [
      ["/finance", "finance", "结算中心"],
      ["/rules", "rules", "提成规则"],
      ["/audit", "audit", "审计日志"],
    ],
  },
  {
    label: "系统",
    items: [["/accounts", "accounts", "账号管理"]],
  },
];
/** 按 PRD §2.2 权限矩阵过滤侧边栏板块。 */
const visibleGroups = computed(() =>
  groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        canSee(item[0] === "/" ? "dashboard" : item[0].slice(1)),
      ),
    }))
    .filter((group) => group.items.length),
);
</script>
<template>
  <div class="shell" :class="{ collapsed }">
    <aside>
      <div class="brand">
        <div class="brand-mark"><span></span></div>
        <div class="brand-copy"><b>不出寝</b><small>OPERATIONS</small></div>
      </div>
      <nav>
        <section v-for="group in visibleGroups" :key="group.label">
          <p>{{ group.label }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item[0]"
            :to="item[0]"
            :class="{ active: route.path === item[0] }"
            ><AppIcon :name="item[1]" /><span>{{ item[2] }}</span
            ><i v-if="item[0] === '/after-sales'">2</i></RouterLink
          >
        </section>
      </nav>
      <div class="operator">
        <div class="avatar">{{
          (sessionUser?.nickname || roleLabel).slice(0, 1)
        }}</div>
        <div>
          <b>{{ sessionUser?.nickname || "平台管理员" }}</b>
          <small>{{ roleLabel }} · 湖北工业大学</small>
        </div>
        <button class="logout-btn" @click="pwdOpen = true">改密</button>
        <button class="logout-btn" @click="logout">登出</button>
      </div>
    </aside>
    <main>
      <header>
        <button
          class="icon-button"
          aria-label="折叠菜单"
          @click="collapsed = !collapsed"
        >
          <span></span><span></span><span></span>
        </button>
        <div class="campus-select">
          <span class="live-dot"></span>
          <div><small>当前运营校园</small><b>湖北工业大学</b></div>
          <strong>⌄</strong>
        </div>
        <div class="header-actions">
          <input
            v-model="globalKeyword"
            class="search"
            aria-label="全局搜索"
            placeholder="搜索订单 / SKU / 人员"
            @keyup.enter="search"
          />
          <button
            class="notification"
            aria-label="查看待处理售后"
            @click="router.push('/after-sales')"
          >
            <span></span><i>2</i>
          </button>
        </div>
      </header>
      <RouterView />
    </main>
    <!-- 自助改密弹窗 -->
    <div v-if="pwdOpen" class="modal-mask" @click.self="pwdOpen = false">
      <form class="login-card pwd-card" @submit.prevent="submitPassword">
        <h2>修改密码</h2>
        <label
          >原密码
          <input
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
        /></label>
        <label
          >新密码（至少 8 位）
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
        /></label>
        <p v-if="pwdError" class="form-hint">{{ pwdError }}</p>
        <div class="drawer-actions">
          <button class="btn primary" type="submit" :disabled="pwdSaving">
            {{ pwdSaving ? "提交中..." : "确认修改" }}
          </button>
          <button class="btn ghost" type="button" @click="pwdOpen = false">
            取消
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
