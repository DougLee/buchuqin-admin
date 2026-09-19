import { computed, ref } from "vue";

/**
 * 会话与权限（RBAC V1，2026-09-19）：
 * - 角色/权限**不再前端静态矩阵**——登录与切校区后拉取 GET /admin/rbac/me，
 *   菜单/路由/按钮统一以服务端返回的有效权限码为准；
 * - 保留的静态映射只有「路由/菜单 section → 权限码」（下方 ROUTE_PERM），
 *   与后端 src/admin/rbac/registry.ts 的权限登记一一对应；
 * - role 字段仅作旧档案展示（超管/总部长等真实能力看 platform/isSuper）。
 */

/** admin-login 返回的 user/claims（role 为旧档案字段，仅展示）。 */
export interface SessionUser {
  id: string;
  campusId: string;
  role: string;
  nickname?: string;
  phone?: string;
  avatar?: string;
}

/** /admin/rbac/me 返回的授权上下文。 */
export interface RbacMe {
  account: { id: string; username: string; nickname: string; status: string; campusId: string };
  platform: boolean;
  super: boolean;
  contextCampusId: string;
  roles: { id: string; code: string; name: string; scope: "platform" | "campus"; campusId: string | null; status: string; builtin: boolean }[];
  permissions: { code: string; scope: "platform" | "campus" }[];
  switchableCampuses: string[];
  rbacVersion: number;
}

/** 旧角色标签（账号列表/审计展示兜底）。 */
export const ROLE_LABELS: Record<string, string> = {
  hq: "总部长",
  admin: "管理员",
  operations: "运营",
  warehouse: "仓储",
  finance: "财务",
  rbac: "后台账号",
};

/** 路由别名（拆分菜单归并到主板块权限）。
 *  注意：ROUTE_PERM 已单列条目的 key 不进别名（联调实测坑：别名先命中会压制
 *  细粒度码——official-products 曾被别名压回 products.read 导致无官方库权
 *  限的运营也看到官方库菜单）。 */
const SECTION_ALIAS: Record<string, string> = {
  coupons: "marketing",
  promotions: "marketing",
  "pay-ads": "banners",
  wheel: "marketing",
  featured: "marketing",
  "battle-map": "buildings",
  reports: "purchase",
  dispatch: "staff",
  rules: "finance",
};

/**
 * 路由/菜单 section → 权限码（read/write 各一组，any-of 命中）。
 * 口径与后端 registry.ts 各端点 requirePerm 一致。
 */
export const ROUTE_PERM: Record<string, { read: string[]; write: string[] }> = {
  dashboard: { read: ["dashboard.read"], write: ["dashboard.read"] },
  orders: { read: ["orders.read"], write: ["orders.write"] },
  "after-sales": { read: ["after-sales.read"], write: [] },
  products: { read: ["products.read"], write: ["products.write", "products.price", "products.status"] },
  "official-products": { read: ["products.official.read"], write: ["products.official.write"] },
  categories: { read: ["categories.read"], write: ["categories.write"] },
  inventory: { read: ["inventory.read"], write: ["inventory.adjust"] },
  "warehouse-orders": { read: ["orders.read"], write: ["inventory.outbound"] },
  "inventory-txns": { read: ["inventory.read"], write: [] },
  locations: { read: ["locations.read"], write: ["locations.write"] },
  restock: { read: ["restock.read"], write: ["restock.order", "restock.manage"] },
  purchase: { read: ["purchase.read"], write: ["purchase.write"] },
  "campus-report": { read: ["campus-report.read"], write: [] },
  staff: { read: ["staff.read"], write: ["staff.write"] },
  campuses: { read: ["campuses.read"], write: ["campuses.manage"] },
  buildings: { read: ["buildings.read"], write: ["buildings.write"] },
  finance: { read: ["finance.read"], write: ["finance.confirm", "finance.pay"] },
  marketing: { read: ["marketing.read"], write: ["marketing.write"] },
  banners: { read: ["banners.read"], write: ["banners.write"] },
  printers: { read: ["printers.read"], write: ["printers.write"] },
  audit: { read: ["audit.read"], write: [] },
  accounts: { read: ["rbac.accounts.read"], write: ["rbac.accounts.write"] },
  users: { read: ["users.read"], write: ["users.read"] },
  "wechat-groups": { read: ["wechat-groups.read"], write: ["wechat-groups.write"] },
  recruit: { read: ["recruit.read"], write: ["recruit.approve", "recruit.reject", "recruit.note"] },
  // RBAC V1 新增菜单
  "rbac-roles": { read: ["rbac.roles.read"], write: ["rbac.roles.write"] },
  "rbac-permissions": { read: ["rbac.permissions.read"], write: [] },
  "rbac-audit": { read: ["rbac.audit.read"], write: [] },
};

function readUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("adminUser");
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export const sessionUser = ref<SessionUser | null>(readUser());
export const role = computed(() => sessionUser.value?.role ?? null);
export const roleLabel = computed(
  () =>
    (role.value && ROLE_LABELS[role.value]) ||
    rbacRoles.value.map((r) => r.name).join("、") ||
    "未登录",
);

/* ---------- 服务端授权上下文（登录/切校区后刷新） ---------- */
export const permissions = ref<Set<string>>(new Set());
export const isSuper = ref(false);
export const isPlatform = ref(false);
export const rbacRoles = ref<RbacMe["roles"]>([]);
export const switchableCampuses = ref<string[]>([]);
export const rbacVersion = ref(0);
export const rbacLoaded = ref(false);

export function hasPerm(code: string): boolean {
  if (isSuper.value) return true;
  return permissions.value.has(code);
}

/** 任一码命中（菜单/按钮 any-of）。 */
function hasAny(codes: string[]): boolean {
  return codes.length > 0 && codes.some((c) => hasPerm(c));
}

export function canSee(section: string): boolean {
  const key = SECTION_ALIAS[section] ?? section;
  const perm = ROUTE_PERM[key];
  if (!perm) return false;
  return hasAny(perm.read);
}

export function canWrite(section: string): boolean {
  const key = SECTION_ALIAS[section] ?? section;
  const perm = ROUTE_PERM[key];
  if (!perm) return false;
  return hasAny(perm.write);
}

/** 登录成功后落地基础会话（权限随后 loadRbac 拉取）。 */
export function applySession(user: SessionUser) {
  sessionUser.value = user;
  localStorage.setItem("adminUser", JSON.stringify(user));
}

/** 应用 /admin/rbac/me 结果（登录/切校区/权限变更后调用）。 */
export function applyRbac(me: RbacMe) {
  permissions.value = new Set(
    me.super ? ["*"] : me.permissions.map((p) => p.code),
  );
  isSuper.value = me.super;
  isPlatform.value = me.platform;
  rbacRoles.value = me.roles;
  switchableCampuses.value = me.switchableCampuses;
  rbacVersion.value = me.rbacVersion;
  rbacLoaded.value = true;
  try {
    localStorage.setItem("adminRbac", JSON.stringify(me));
  } catch {
    /* 忽略序列化失败（超限时丢缓存，下次登录重拉） */
  }
}

/** 启动时从缓存恢复（避免刷新后菜单闪变；请求前仍会重新校验）。 */
function readCachedRbac() {
  try {
    const raw = localStorage.getItem("adminRbac");
    if (raw) applyRbac(JSON.parse(raw) as RbacMe);
  } catch {
    /* 无效缓存忽略 */
  }
}
readCachedRbac();

/** 拉取有效权限（登录/切校区后调用）。失败=拒绝一切（默认拒绝，不回退宽松）。 */
export async function loadRbac(): Promise<boolean> {
  const { api } = await import("./api");
  try {
    applyRbac(await api.rbacMe());
    return true;
  } catch {
    permissions.value = new Set();
    isSuper.value = false;
    isPlatform.value = false;
    rbacLoaded.value = false;
    return false;
  }
}

export function clearSession() {
  sessionUser.value = null;
  permissions.value = new Set();
  isSuper.value = false;
  isPlatform.value = false;
  rbacRoles.value = [];
  switchableCampuses.value = [];
  rbacLoaded.value = false;
  ["adminToken", "adminUser", "adminRbac"].forEach((key) =>
    localStorage.removeItem(key),
  );
}
