<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import AppIcon from "./components/AppIcon.vue";
import { api, clearToken } from "./api";
import {
  applySession,
  canSee,
  clearSession,
  role,
  roleLabel,
  sessionUser,
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
/* IKAJSL：一套系统按身份分流——hq 登录见总部板块（跨校区汇总/官方库/Banner 投放/
   校区与账号管理），校区角色维持原导航。 */
const hqGroups = [
  {
    label: "总部总览",
    items: [
      ["/", "dashboard", "跨校区总览"],
      ["/orders", "orders", "订单配送"],
    ],
  },
  {
    label: "总部商品",
    items: [
      // IKAJSM：hq 的商品板块是官方商品库（商品源头），校区经导入落本地
      ["/products", "products", "官方商品库"],
      ["/categories", "categories", "商品类别"],
    ],
  },
  {
    label: "总部投放",
    items: [["/banners", "marketing", "Banner 投放"]],
  },
  {
    label: "校区与账号",
    items: [
      ["/campuses", "campus", "校区管理"],
      ["/accounts", "accounts", "账号管理"],
      ["/users", "staff", "C端用户"],
      ["/audit", "audit", "审计日志"],
    ],
  },
];
const campusGroups = [
  {
    label: "运营中心",
    items: [
      ["/", "dashboard", "经营总览"],
      ["/orders", "orders", "订单配送"],
      ["/after-sales", "after", "售后退款"],
    ],
  },
  {
    label: "仓储中心",
    items: [
      ["/products", "products", "商品管理"],
      ["/categories", "categories", "商品类别"],
      ["/inventory", "inventory", "库存总览"],
      // IKA0V2：仓库订单/出入库流水独立入口；IKA0VG：库位管理
      ["/warehouse-orders", "warehouse-orders", "拣货任务"],
      ["/inventory-txns", "inventory-txns", "出入库流水"],
      ["/locations", "locations", "库位管理"],
    ],
  },
  {
    label: "组织营销",
    items: [
      ["/staff", "staff", "履约人员"],
      ["/campuses", "campus", "校园组织"],
      // IKAJSW/IKAJSY：C 端用户与微信群码进组织板块（运营域）
      ["/users", "staff", "C端用户"],
      ["/wechat-groups", "campus", "微信群码"],
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
/* Banner 投放（总部投放板块）：2026-08-26 道哥决策，平台超管 admin 与 hq 同见 */
const hqBannerGroup = {
  label: "总部投放",
  items: [["/banners", "marketing", "Banner 投放"]],
};
const groups = computed(() => {
  if (role.value === "hq") return hqGroups;
  // admin 插在组织营销之后，与 hq 的总部投放同入口
  if (role.value === "admin")
    return [
      ...campusGroups.slice(0, 3),
      hqBannerGroup,
      ...campusGroups.slice(3),
    ];
  return campusGroups;
});
/** 按 PRD §2.2 权限矩阵过滤侧边栏板块。 */
const visibleGroups = computed(() =>
  groups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        canSee(item[0] === "/" ? "dashboard" : item[0].slice(1)),
      ),
    }))
    .filter((group) => group.items.length),
);
/* 分组开关（IK9RTU 手风琴 → IKAJT1 默认全展开）：各组独立开关，
   默认全部展开便于查找；功能再多也不用逐组翻 */
function groupLabelOf(path: string): string | null {
  const hit = visibleGroups.value.find((group) =>
    group.items.some((item) => item[0] === path),
  );
  return hit?.label ?? null;
}
const expandedGroups = ref<string[]>(visibleGroups.value.map((g) => g.label));
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
/* IKB3KG 方案A：campus 侧顶栏校区切换（授权范围内自选，切换换发 token 整页刷新）。
 *   单校区账号显示静态校名（去掉写死的"湖北工业大学"）；hq 保持跨校区视角。 */
const campusChoices = ref<
  { id: string; name: string; shortName: string; current: boolean }[]
>([]);
const campusName = ref("湖北工业大学");
const campusSwitching = ref(false);
onMounted(async () => {
  if (!role.value || role.value === "hq") return;
  try {
    campusChoices.value = await api.adminCampuses();
    const hit =
      campusChoices.value.find((c) => c.current) ??
      campusChoices.value.find((c) => c.id === sessionUser.value?.campusId);
    if (hit) campusName.value = hit.shortName || hit.name;
  } catch {
    /* 取不到授权列表保持静态展示，不阻塞后台 */
  }
});
async function switchCampus(event: Event) {
  const campusId = (event.target as HTMLSelectElement).value;
  if (!campusId || campusId === sessionUser.value?.campusId) return;
  campusSwitching.value = true;
  try {
    const result = await api.switchAdminCampus(campusId);
    applySession(result.user);
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
            <span>{{ group.label }}</span><i class="group-arrow">⌄</i>
          </button>
          <!-- 图标折叠态标题已隐藏，菜单项必须全量可见，分组开关仅在展开态生效 -->
          <RouterLink
            v-for="item in collapsed || expandedGroups.includes(group.label)
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
          <!-- IKAJSL：hq 是跨校区视角（订单/用户页内另有校区筛选） -->
          <div v-if="role === 'hq'">
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
              <option
                v-for="c in campusChoices"
                :key="c.id"
                :value="c.id"
              >
                {{ c.shortName || c.name }}
              </option>
            </select>
          </div>
          <div v-else><small>当前运营校园</small><b>{{ campusName }}</b></div>
          <strong v-if="role !== 'hq' && campusChoices.length > 1">⌄</strong>
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
