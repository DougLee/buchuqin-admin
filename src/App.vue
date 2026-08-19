<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
  userMenuOpen.value = false;
  clearSession();
  clearToken();
  router.push("/login");
}
/* 自助改密（IK9KWO）：任意后台角色可用 */
/* 右上角用户菜单：改密/登出入口 */
const userMenuOpen = ref(false);
/* 点空白关闭：header 的 backdrop-filter 会把 fixed 遮罩困在顶栏盒子里，
   所以用 document 级监听代替遮罩层；Esc 也可关 */
function onDocClick(event: MouseEvent) {
  if (!userMenuOpen.value) return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest?.(".user-menu-wrap")) userMenuOpen.value = false;
}
function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") userMenuOpen.value = false;
}
onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onDocKeydown);
});
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
/* 登录页不走后台外壳：无侧边栏/顶栏，只渲染登录卡片（RouterView 即 Login） */
const isLogin = computed(() => route.path === "/login");
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
      ["/categories", "categories", "商品类别"],
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
/* 分组手风琴（IK9RTU）：同一时刻仅一个分组展开，初始定位到当前路由所在组 */
function groupLabelOf(path: string): string | null {
  const hit = visibleGroups.value.find((group) =>
    group.items.some((item) => item[0] === path),
  );
  return hit?.label ?? null;
}
const expandedGroup = ref<string | null>(
  groupLabelOf(route.path) ?? visibleGroups.value[0]?.label ?? null,
);
function toggleGroup(label: string) {
  expandedGroup.value = expandedGroup.value === label ? null : label;
}
/* 全局搜索/顶栏入口等跨组跳转后，目标分组自动展开（导航点击场景天然保持） */
watch(
  () => route.path,
  (path) => {
    const label = groupLabelOf(path);
    if (label) expandedGroup.value = label;
  },
);
</script>
<template>
  <RouterView v-if="isLogin" />
  <div v-else class="shell" :class="{ collapsed }">
    <aside>
      <div class="brand">
        <div class="brand-mark"><span></span></div>
        <div class="brand-copy"><b>不出寝</b><small>OPERATIONS</small></div>
      </div>
      <nav>
        <section v-for="group in visibleGroups" :key="group.label">
          <button
            class="group-head"
            type="button"
            :aria-expanded="expandedGroup === group.label"
            @click="toggleGroup(group.label)"
          >
            <span>{{ group.label }}</span><i class="group-arrow">⌄</i>
          </button>
          <!-- 图标折叠态标题已隐藏，菜单项必须全量可见，手风琴仅在展开态生效 -->
          <RouterLink
            v-for="item in collapsed || expandedGroup === group.label
              ? group.items
              : []"
            :key="item[0]"
            :to="item[0]"
            :class="{ active: route.path === item[0] }"
            ><AppIcon :name="item[1]" /><span>{{ item[2] }}</span></RouterLink
          >
        </section>
      </nav>
    </aside>
    <main>
      <header>
        <button
          class="icon-button"
          :aria-pressed="collapsed"
          :aria-label="collapsed ? '展开菜单' : '折叠菜单'"
          :title="collapsed ? '展开菜单' : '折叠菜单'"
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
            <span></span>
          </button>
          <div class="user-menu-wrap">
            <button
              class="user-chip"
              type="button"
              aria-haspopup="menu"
              :aria-expanded="userMenuOpen"
              @click="userMenuOpen = !userMenuOpen"
            >
              <span class="avatar">{{
                (sessionUser?.nickname || roleLabel).slice(0, 1)
              }}</span>
              <b>{{ sessionUser?.nickname || "平台管理员" }}</b>
              <AppIcon name="chevron" />
            </button>
            <template v-if="userMenuOpen">
              <div class="user-menu" role="menu">
                <p class="user-menu-head">
                  <b>{{ sessionUser?.nickname || "平台管理员" }}</b>
                  <small>{{ roleLabel }}</small>
                </p>
                <button
                  class="menu-item"
                  role="menuitem"
                  @click="userMenuOpen = false; pwdOpen = true"
                >
                  <AppIcon name="password" />修改密码
                </button>
                <button class="menu-item danger" role="menuitem" @click="logout">
                  <AppIcon name="logout" />退出登录
                </button>
              </div>
            </template>
          </div>
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
