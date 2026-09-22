<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { superViews } from "./view-catalog";
import AppIcon from "./components/AppIcon.vue";
import { api, clearToken } from "./api";
import {
  applySession,
  authorizationEpoch,
  isSuper,
  canSee,
  clearSession,
  isPlatform,
  loadRbac,
  menuTree,
  roleLabel,
  sessionUser,
  switchableCampuses,
} from "./session";
import { isUnread as changelogUnread } from "./changelog";
const route = useRoute(),
  router = useRouter(),
  collapsed = ref(false),
  globalKeyword = ref("");
/* 更新日志红点：有未读发版即亮；进入日志页（onMounted 标已读后）刷新——
   flush post 保证在页面组件 mounted 之后执行 */
const clUnread = ref(changelogUnread());
watch(
  () => route.path,
  () => {
    clUnread.value = changelogUnread();
  },
  { flush: "post" },
);
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
    logout();
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
  const rows = [...menuTree.value].sort((a,b) => (a.orderNum ?? 0) - (b.orderNum ?? 0));
  const byCode = new Map(rows.map(m => [m.code, m]));
  const grouped = new Map<string, { label: string; items: SidebarItem[]; order: number[] }>();
  for (const m of rows) {
    if (m.type !== 1 || m.authorized === false || m.isShow === false) continue;
    if (superViews.has(m.viewPath || m.code) && !isSuper.value) continue;
    const labels: string[] = [];
    const ancestors: string[] = [];
    const order = [m.orderNum ?? 0];
    let parent = m.parentId;
    const seen = new Set<string>();
    let hidden = false;
    while (parent && !seen.has(parent)) {
      seen.add(parent); const ancestor = byCode.get(parent); if (!ancestor) break;
      if (ancestor.isShow === false) hidden = true;
      labels.unshift(ancestor.name); ancestors.unshift(ancestor.code);
      order.unshift(ancestor.orderNum ?? 0); parent = ancestor.parentId;
    }
    if (hidden) continue;
    const group = ancestors.join('/') || '__root';
    if (!grouped.has(group)) grouped.set(group, { label: labels.join(' / ') || '工作台', items: [], order });
    grouped.get(group)!.items.push({ path: m.path, code: m.code, name: m.name, icon: m.icon || m.code });
  }
  const groups = [...grouped.values()].sort((a, b) => {
    for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) {
      const diff = (a.order[i] ?? 0) - (b.order[i] ?? 0);
      if (diff) return diff;
    }
    return a.label.localeCompare(b.label);
  });
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
/* ---------- IKHFWV 新订单提醒：30s 轮询水位线（今日已支付累计）----------
   受众=canSee('orders')（订单配送菜单可见者全收，道哥定版）；顶栏铃铛可关
   （localStorage）；形态=右下浮窗+叮两声（WebAudio 合成免音频资产）+
   页面后台时系统通知（已授权才发）。首次取基线，仅增量弹（累计口径防漏报）。 */
const notifyOn = ref(localStorage.getItem("newOrderNotify") !== "off");
function toggleNotify() {
  notifyOn.value = !notifyOn.value;
  localStorage.setItem("newOrderNotify", notifyOn.value ? "on" : "off");
  if (notifyOn.value && "Notification" in window && Notification.permission === "default")
    void Notification.requestPermission();
}
const notifyCards = ref<
  { key: string; id: string; no: string; amount: number; extra: number }[]
>([]);
let orderWatermark: number | null = null;
let audioCtx: AudioContext | null = null;
function dingTwice() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [0, 0.35].forEach((delay) => {
      const o = audioCtx!.createOscillator();
      const g = audioCtx!.createGain();
      o.frequency.value = 1244;
      g.gain.setValueAtTime(0.001, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + 0.3);
      o.connect(g).connect(audioCtx!.destination);
      o.start(t0 + delay);
      o.stop(t0 + delay + 0.32);
    });
  } catch {
    /* 无声环境（未交互/被策略拦）忽略——浮窗仍有效 */
  }
}
/** IKHFWV 二轮（道哥）：叮叮后语音播报——浏览器本地 TTS（zh-CN），无音频资产 */
function speakNewOrder() {
  try {
    const u = new SpeechSynthesisUtterance("您有新的订单，请注意查收");
    u.lang = "zh-CN";
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch {
    /* 无 TTS 环境忽略 */
  }
}
/** IKHFWV 三轮：浏览器 autoplay 策略——页面刷新后需一次用户交互才允许出声。
 *  任意首次点击/按键即解锁（resume AudioContext + TTS warm）；运营点过菜单即常响。
 *  无声兜底：有未关浮窗时标题栏交替「🔔 新订单」，后台标签也醒目。 */
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    /* 无声环境忽略 */
  }
}
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });
let titleBlinkTimer: number | undefined;
watch(
  () => notifyCards.value.length,
  (n) => {
    const base = "不出寝食社管理后台";
    if (titleBlinkTimer) {
      clearInterval(titleBlinkTimer);
      titleBlinkTimer = undefined;
    }
    if (n > 0) {
      let on = false;
      titleBlinkTimer = window.setInterval(() => {
        on = !on;
        document.title = on ? `🔔 新订单 ×${n}` : base;
      }, 900);
    } else document.title = base;
  },
);
async function pollNewOrders() {
  if (!notifyOn.value || !canSee("orders") || !localStorage.getItem("adminToken"))
    return;
  try {
    const d = await api.newOrderWatch();
    if (orderWatermark === null) {
      orderWatermark = d.todayPaid; // 首次=基线，存量不弹
      return;
    }
    if (d.todayPaid > orderWatermark && d.latest) {
      const extra = d.todayPaid - orderWatermark;
      const key = `${d.latest.id}-${Date.now()}`;
      notifyCards.value.push({
        key,
        id: d.latest.id,
        no: d.latest.orderNo.slice(-8),
        amount: d.latest.payableAmount,
        extra,
      });
      dingTwice();
      speakNewOrder();
      if (
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      )
        new Notification("新订单", {
          body: `¥${(d.latest.payableAmount / 100).toFixed(2)} · 尾号 ${d.latest.orderNo.slice(-8)}${extra > 1 ? ` 等 ${extra} 单` : ""}`,
        });
    }
    orderWatermark = d.todayPaid;
  } catch {
    /* 轮询失败静默（登录过期由 request 层统一处理） */
  }
}
onMounted(pollNewOrders);
setInterval(pollNewOrders, 30_000);
function dismissNotify(key: string) {
  notifyCards.value = notifyCards.value.filter((c) => c.key !== key);
}
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
// Refresh permission changes made in another session; never trust cached menus indefinitely.
let permissionTimer: ReturnType<typeof setInterval> | undefined;
const refreshPermissions = () => { if (sessionUser.value && !isLogin.value) void loadRbac(); };
onMounted(() => {
  permissionTimer = setInterval(refreshPermissions, 15000);
  window.addEventListener('focus', refreshPermissions);
});
onBeforeUnmount(() => {
  if (permissionTimer) clearInterval(permissionTimer);
  window.removeEventListener('focus', refreshPermissions);
});
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
            ><AppIcon :name="item.icon" /><span>{{ item.name }}</span
            ><!-- 更新日志红点：有未读发版即亮 -->
            <i
              v-if="item.path === '/changelog' && clUnread"
              class="cl-dot"
              aria-label="有新更新"
            /></RouterLink
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
          <!-- IKHFWV 新订单提醒开关（订单菜单可见者显示；关=偏好本地记） -->
          <button
            v-if="canSee('orders')"
            class="notification notify-bell"
            :class="{ 'notify-bell--off': !notifyOn }"
            :aria-label="notifyOn ? '新订单提醒开（点击关闭）' : '新订单提醒关（点击开启）'"
            @click="toggleNotify"
          >
            <span class="notify-bell-glyph">{{ notifyOn ? "🔔" : "🔕" }}</span>
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
      <RouterView v-slot="{ Component, route: pageRoute }">
        <KeepAlive :key="authorizationEpoch">
          <component :is="Component" v-if="pageRoute.meta.keepAlive" :key="pageRoute.path" />
        </KeepAlive>
        <component :is="Component" v-if="!pageRoute.meta.keepAlive" :key="`${authorizationEpoch}:${pageRoute.path}`" />
      </RouterView>
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
    <!-- IKHFWV 新订单浮窗栈：右下角，点击跳订单页 -->
  <div v-if="!isLogin && notifyCards.length" class="new-order-toasts">
    <div
      v-for="c in notifyCards"
      :key="c.key"
      class="new-order-toast"
      role="alert"
      @click="router.push('/orders'); dismissNotify(c.key)"
    >
      <button
        class="new-order-toast__close"
        aria-label="关闭提醒"
        @click.stop="dismissNotify(c.key)"
      >
        ×
      </button>
      <b>📦 新订单</b>
      <span>¥{{ (c.amount / 100).toFixed(2) }} · 尾号 {{ c.no }}</span>
      <small v-if="c.extra > 1">共 {{ c.extra }} 个新订单</small>
      <small v-else>点击卡片去处理</small>
    </div>
  </div>
</div>
</template>
