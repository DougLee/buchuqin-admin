<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import AppIcon from "./components/AppIcon.vue";
import { api, clearToken } from "./api";
import {
  applySession,
  canSee,
  clearSession,
  isPlatform,
  loadRbac,
  menuTree,
  roleLabel,
  sessionUser,
  switchableCampuses,
} from "./session";
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
  pwdSaving = ref(false),
  pwdShow = ref(false);
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
/* RBAC 蛋词体系（2026-09-19）：侧栏完全由 permmenu.menus 菜单树渲染——
 * 目录（type=0，parentId=code 组树）为分组，菜单（type=1）为条目；
 * 树本身就是授权结果（后端只回可见行），不再逐项 canSee 过滤；
 * 名称/图标/排序均以数据库菜单行为准，改菜单不用发前端版。 */
interface SidebarItem {
  path: string;
  code: string;
  name: string;
  icon: string;
}
interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}
const visibleGroups = computed<SidebarGroup[]>(() => {
  const rows = [...menuTree.value].sort(
    (a, b) => (a.orderNum ?? 0) - (b.orderNum ?? 0),
  );
  const childrenOf = (parentCode: string | null) =>
    rows.filter((r) => (r.parentId ?? null) === parentCode);
  const toItem = (r: (typeof rows)[number]): SidebarItem => ({
    path: r.path || "/",
    code: r.code,
    name: r.name,
    icon: r.icon || r.code,
  });
  const groups: SidebarGroup[] = [];
  // 根级菜单（无目录父级，如 dashboard）：归入「工作台」组置顶
  const rootMenus = childrenOf(null).filter((r) => r.type === 1);
  if (rootMenus.length)
    groups.push({ label: "工作台", items: rootMenus.map(toItem) });
  // 目录 → 分组（空组隐藏；组内只渲染菜单行）
  for (const dir of childrenOf(null).filter((r) => r.type === 0)) {
    const items = childrenOf(dir.code).filter((r) => r.type === 1);
    if (items.length) groups.push({ label: dir.name, items: items.map(toItem) });
  }
  return groups;
});
/* 分组开关（IK9RTU 手风琴 → IKAJT1 默认全展开）：各组独立开关，
   默认全部展开便于查找；功能再多也不用逐组翻 */
function groupLabelOf(path: string): string | null {
  const hit = visibleGroups.value.find((group) =>
    group.items.some((item) => item.path === path),
  );
  return hit?.label ?? null;
}
const expandedGroups = ref<string[]>(visibleGroups.value.map((g) => g.label));
/* IKCJ3L：分组默认全部展开——登录前 role 未定时 visibleGroups 尚不全，
   登录后新增分组自动补齐展开（只加不删，保留用户手动折叠的选择） */
watch(
  visibleGroups,
  (groups) => {
    for (const group of groups)
      if (!expandedGroups.value.includes(group.label))
        expandedGroups.value = [...expandedGroups.value, group.label];
  },
  { immediate: true },
);
function toggleGroup(label: string) {
  expandedGroups.value = expandedGroups.value.includes(label)
    ? expandedGroups.value.filter((l) => l !== label)
    : [...expandedGroups.value, label];
}
/* 全局搜索/顶栏入口等跨组跳转后，目标分组自动展开（导航点击场景天然保持） */
watch(
  () => route.path,
  (path) => {
    const label = groupLabelOf(path);
    if (label && !expandedGroups.value.includes(label))
      expandedGroups.value = [...expandedGroups.value, label];
  },
);
/* IKB3KG 方案A → RBAC V1：顶栏校区切换（授权范围内自选，切换换发 token）。
 *   RBAC V1：平台账号无可切校区（switchableCampuses 空）时显示「全校区视角」；
 *   其余账号多校区出下拉、单校区显示静态校名。 */
const campusChoices = ref<
  { id: string; name: string; shortName: string; current: boolean }[]
>([]);
const campusName = ref("湖北工业大学");
const campusSwitching = ref(false);
/** 平台账号且无可切校区 = 跨校区汇总视角（无当前校区概念）。 */
const isAllCampusView = computed(
  () => isPlatform.value && switchableCampuses.value.length === 0,
);
async function loadCampusChoices() {
  // 未登录不发注定 401 的请求（登录页停留期 console 曾报错）；登录后由 watch 补拉
  if (isAllCampusView.value || !localStorage.getItem("adminToken")) return;
  try {
    campusChoices.value = await api.adminCampuses();
    const hit =
      campusChoices.value.find((c) => c.current) ??
      campusChoices.value.find((c) => c.id === sessionUser.value?.campusId);
    if (hit) campusName.value = hit.shortName || hit.name;
  } catch {
    /* 取不到授权列表保持静态展示，不阻塞后台 */
  }
}
onMounted(loadCampusChoices);
/* 登录成功（Login push 不重挂载 App）：会话建立后补拉授权校区，多校区下拉才有数据 */
watch(sessionUser, (u) => {
  if (u) void loadCampusChoices();
});
async function switchCampus(event: Event) {
  const campusId = (event.target as HTMLSelectElement).value;
  if (!campusId || campusId === sessionUser.value?.campusId) return;
  campusSwitching.value = true;
  try {
    const result = await api.switchAdminCampus(campusId);
    applySession(result.user);
    // RBAC V1：权限随校区上下文变化——先刷新授权再整页重载
    // （失败也继续 reload：token 已换发，停留旧页面只会更不一致）
    await loadRbac();
    window.location.reload();
  } catch (error) {
    campusSwitching.value = false;
    alert(error instanceof Error ? error.message : "校区切换失败");
  }
}
</script>
<template>
  <RouterView v-if="isLogin" />
  <div v-else class="shell" :class="{ collapsed }">
    <aside>
      <div class="brand">
        <div class="brand-mark"><span></span></div>
        <div class="brand-copy"><b>不出寝食社</b></div>
      </div>
      <nav>
        <section v-for="group in visibleGroups" :key="group.label">
          <button
            class="group-head"
            type="button"
            :aria-expanded="expandedGroups.includes(group.label)"
            @click="toggleGroup(group.label)"
          >
            <span>{{ group.label }}</span
            ><i class="group-arrow">⌄</i>
          </button>
          <!-- 图标折叠态标题已隐藏，菜单项必须全量可见，分组开关仅在展开态生效 -->
          <RouterLink
            v-for="item in collapsed || expandedGroups.includes(group.label)
              ? group.items
              : []"
            :key="item.path"
            :to="item.path"
            :class="{ active: route.path === item.path }"
            ><AppIcon :name="item.icon" /><span>{{ item.name }}</span></RouterLink
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
          <!-- RBAC V1：平台账号无可切校区 = 跨校区视角（订单/用户页内另有校区筛选） -->
          <div v-if="isAllCampusView">
            <small>总部运营</small><b>全校区视角</b>
          </div>
          <!-- IKB3KG 方案A：授权多校区出现下拉，单校区显示静态校名 -->
          <div v-else-if="campusChoices.length > 1" class="campus-picker">
            <small>当前运营校园</small>
            <select
              :value="sessionUser?.campusId"
              :disabled="campusSwitching"
              aria-label="切换运营校区"
              @change="switchCampus"
            >
              <option v-for="c in campusChoices" :key="c.id" :value="c.id">
                {{ c.shortName || c.name }}
              </option>
            </select>
          </div>
          <div v-else>
            <small>当前运营校园</small><b>{{ campusName }}</b>
          </div>
          <strong v-if="!isAllCampusView && campusChoices.length > 1">⌄</strong>
        </div>
        <div class="header-actions">
          <input
            v-model="globalKeyword"
            class="search"
            aria-label="全局搜索"
            placeholder="搜索订单 / SKU / 人员"
            @keyup.enter="search"
          />
          <!-- IKAJSL：售后是校区板块，hq 无入口 -->
          <button
            v-if="canSee('after-sales')"
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
                  @click="
                    userMenuOpen = false;
                    pwdOpen = true;
                  "
                >
                  <AppIcon name="password" />修改密码
                </button>
                <button
                  class="menu-item danger"
                  role="menuitem"
                  @click="logout"
                >
                  <AppIcon name="logout" />退出登录
                </button>
              </div>
            </template>
          </div>
        </div>
      </header>
      <RouterView />
    </main>
    <!-- 自助改密弹窗（IKCJ3L：独立样式，不再蹭 login-card/drawer-actions） -->
    <div v-if="pwdOpen" class="modal-mask" @click.self="pwdOpen = false">
      <form class="pwd-card" @submit.prevent="submitPassword">
        <div class="pwd-card__head">
          <h2>修改密码</h2>
          <button
            type="button"
            class="pwd-card__close"
            aria-label="关闭"
            @click="pwdOpen = false"
          >
            ×
          </button>
        </div>
        <div class="login-form">
          <label
            >原密码
            <input
              v-model="oldPassword"
              :type="pwdShow ? 'text' : 'password'"
              autocomplete="current-password"
          /></label>
          <label
            >新密码（至少 8 位）
            <input
              v-model="newPassword"
              :type="pwdShow ? 'text' : 'password'"
              autocomplete="new-password"
          /></label>
          <button
            type="button"
            class="pwd-card__toggle"
            @click="pwdShow = !pwdShow"
          >
            {{ pwdShow ? "隐藏密码" : "显示密码" }}
          </button>
          <p v-if="pwdError" class="form-hint" role="alert">{{ pwdError }}</p>
          <div class="pwd-card__actions">
            <button class="btn ghost" type="button" @click="pwdOpen = false">
              取消
            </button>
            <button class="btn primary" type="submit" :disabled="pwdSaving">
              {{ pwdSaving ? "提交中..." : "确认修改" }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
