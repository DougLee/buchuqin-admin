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
/* IKAJSL：一套系统按身份分流——hq 登录见总部板块（跨校区汇总/官方库/营销活动/
   校区与账号管理），校区角色维持原导航。 */
/* IKB5PB：一级「营销活动」= Banner 配置 + 优惠券配置 + 限时秒杀 + 支付广告位；
 *  权限矩阵不变——banners 类归 hq/admin，marketing 类（券/秒杀）归校区角色，
 *  visibleGroups 按 canSee 逐项过滤后各角色只看到自己的子集。 */
const MARKETING_ITEMS: [string, string, string][] = [
  ["/banners", "marketing", "Banner 配置"],
  ["/coupons", "marketing", "优惠券配置"],
  ["/promotions", "marketing", "限时秒杀"],
  ["/pay-ads", "marketing", "支付广告位"],
  // IKD6FC：抽奖大转盘（首页入口显隐随活动开关）
  ["/wheel", "wheel", "抽奖转盘"],
];
const hqGroups = [
  {
    label: "总部总览",
    items: [
      ["/", "dashboard", "跨校区总览"],
      ["/orders", "orders", "订单配送"],
      // IKFOPS：校区经营日报（校区账视角，与总部账 IKFOPR 互补）
      ["/campus-report", "dashboard", "校区日报"],
    ],
  },
  {
    label: "总部商品",
    items: [
      // IKAJSM：hq 的商品板块是官方商品库（商品源头），校区经导入落本地
      // IKCJ46：官方商品库独立菜单路由（/products 恒为本校区商品）
      ["/official-products", "official-products", "官方商品库"],
      ["/categories", "categories", "商品类别"],
    ],
  },
  {
    // IKFOQ0→IKFOQ1 二轮调整（道哥 2026-09-15）：订货/采购两菜单合并为
    // 「采购管理」一组；IKFOPR：组下追加「经营日报」（总部账 T+1）
    label: "采购管理",
    items: [
      ["/restock", "restock", "订货管理"],
      ["/purchase", "purchase", "采购管理"],
      ["/reports", "purchase", "经营日报"],
    ],
  },
  // IKBW0A：hq 移除营销活动组——Banner/广告位校区自管，总部不做投放
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
      // IKFOQ3：营销作战地图（道哥 2026-09-17 移入运营中心；权限仍复用 buildings）
      ["/battle-map", "buildings", "营销作战地图"],
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
    // IKFOQ0：订货管理独立一级菜单（总部批次+审核，校区我的订货）
    label: "订货管理",
    items: [["/restock", "restock", "订货管理"]],
  },
  {
    // IKFOQ1：采购管理独立一级菜单（仅总部可见，后端 purchase 键同口径）
    label: "采购管理",
    items: [["/purchase", "purchase", "采购管理"]],
  },
  // IKB5PB：营销拆出独立一级组（见 MARKETING_ITEMS）
  {
    label: "营销活动",
    items: MARKETING_ITEMS,
  },
  {
    // IKB5PB：组织营销 → 组织管理（营销项已迁出）
    // IKCRS8：「校园组织」拆分为楼栋管理（独立菜单 /buildings）；
    // admin 的组织管理组另注入「校区管理」（见 groups computed）
    label: "组织管理",
    items: [
      ["/staff", "staff", "履约人员"],
      // IKEAGE：楼长招募（报名→面试→审批→实习楼长）
      ["/recruit", "recruit", "楼长招募"],
      ["/buildings", "buildings", "楼栋管理"],
      // IKAJSW/IKAJSY：C 端用户与微信群码进组织板块（运营域）
      ["/users", "staff", "C端用户"],
      ["/wechat-groups", "campus", "微信群码"],
      ["/dispatch", "dispatch", "调配与请假"],
    ],
  },
  {
    label: "财务系统",
    items: [
      ["/finance", "finance", "结算中心"],
      ["/rules", "rules", "提成规则"],
      // IKFOPS：校区经营日报（本校区+楼栋筛选）
      ["/campus-report", "finance", "经营日报"],
      ["/audit", "audit", "审计日志"],
    ],
  },
  {
    label: "系统",
    items: [
      ["/accounts", "accounts", "账号管理"],
      // IKBW0Q：校区自主绑定小票打印机
      ["/printers", "printers", "打印机"],
    ],
  },
];
const groups = computed(() => {
  if (role.value === "hq") return hqGroups;
  // IKCJ46：admin 菜单在仓储中心组头部加「官方商品库」独立入口——
  // 商品管理菜单恒为本校区商品，官方库另开菜单防混淆（道哥 2026-09-01 拍板）
  // IKCRS8：admin 组织管理组头部注入「校区管理」（平台校区 CRUD 限 hq/admin，
  // operations 只见楼栋管理）；楼栋上下文跟随顶栏切换的运营校区
  if (role.value === "admin")
    return campusGroups.map((group) => {
      if (group.label === "仓储中心")
        return {
          ...group,
          items: [
            ["/official-products", "official-products", "官方商品库"],
            ...group.items,
          ],
        };
      if (group.label === "组织管理")
        return {
          ...group,
          items: [
            ["/staff", "staff", "履约人员"],
            ["/recruit", "recruit", "楼长招募"],
            ["/campuses", "campus", "校区管理"],
            ["/buildings", "buildings", "楼栋管理"],
            ["/users", "staff", "C端用户"],
            ["/wechat-groups", "campus", "微信群码"],
            ["/dispatch", "dispatch", "调配与请假"],
          ],
        };
      return group;
    });
  return campusGroups;
});
/** 按 PRD §2.2 权限矩阵过滤侧边栏板块（含 IKB5PB 路由别名映射，见 session.ts）。 */
/* 生产环境临时隐藏「订货管理」「采购管理」菜单入口（道哥 2026-09-16）：
   功能未验收，生产先藏菜单（路由仍可直接访问），测试环境 admin-test.buchuqin.com
   保留菜单用于验收。已于 2026-09-17 道哥验收后放开（域名改为 "__never__"，
   门控结构保留备复用）。 */
const HIDE_RESTOCK_PURCHASE_MENU = location.hostname === "__never__";
const visibleGroups = computed(() =>
  groups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        HIDE_RESTOCK_PURCHASE_MENU &&
        (item[0] === "/restock" || item[0] === "/purchase")
          ? false
          : canSee(item[0] === "/" ? "dashboard" : item[0].slice(1)),
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
