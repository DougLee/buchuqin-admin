import { computed, ref } from "vue";

/**
 * 会话与权限（RBAC 蛋词体系，2026-09-19，对齐 dancikeji cool-admin）：
 * - 登录与切校区后拉取 GET /admin/rbac/permmenu：
 *   · perms = URL 模式串全集（如 'PATCH /admin/products/:id'，超管 ['*']）；
 *   · menus = 可见菜单树扁平行（只含 type!=2 且 isShow 行）——侧栏/路由显隐的唯一依据；
 * - 按钮显隐不再按权限码（products.write 等），改按 hasPerm(模式串)（超管恒真）；
 * - 保留的静态映射只有「路由/菜单 section → write 模式串」（下方 ROUTE_PERM），
 *   口径与后端各端点登记一一对应；
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

/** permmenu.menus 菜单树扁平行（parentId=父节点 code，根为 null；只含 type!=2 且 isShow 行）。 */
export interface MeMenu {
  id: string;
  code: string;
  parentId: string | null;
  name: string;
  /** 0=目录 1=菜单（permmenu 不含 2=按钮）。 */
  type: 0 | 1 | 2;
  path: string;
  viewPath?: string;
  icon?: string;
  orderNum?: number;
  isShow?: boolean;
}

/** GET /admin/rbac/permmenu 返回的授权上下文。 */
export interface RbacMe {
  account: { id: string; username: string; nickname: string; status: string; campusId: string };
  platform: boolean;
  super: boolean;
  contextCampusId: string;
  roles: { id: string; code: string; name: string; scope: "platform" | "campus"; campusId: string | null; status: string; builtin: boolean }[];
  /** URL 模式串（如 'PATCH /admin/products/:id'）；超管为 ['*']。 */
  perms: string[];
  /** 可见菜单树扁平行（type!=2 且 isShow；超管=全量）。 */
  menus: MeMenu[];
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

/**
 * 路由/菜单 section → write URL 模式串（any-of 命中即可写）。
 * 口径与后端各端点 requirePerm 登记（蛋词 perms）一一对应；
 * 空数组 = 只读板块（无写操作）。
 * 别名映射已删除（蛋词体系下每个菜单 code 各自带 perms，不再归并——
 * 旧别名压制细粒度码的坑见 git 历史）。
 */
export const ROUTE_PERM: Record<string, string[]> = {
  // 只读板块
  dashboard: [],
  "after-sales": [],
  "inventory-txns": [],
  "campus-report": [],
  "battle-map": [],
  reports: [],
  audit: [],
  users: [],
  "rbac-permissions": [],
  "rbac-audit": [],

  orders: [
    "POST /admin/orders/:id/status",
    "POST /admin/orders/:id/actions/:action",
  ],
  products: ["POST /admin/products", "PATCH /admin/products/:id"],
  "official-products": ["POST /admin/products", "PATCH /admin/products/:id"],
  categories: [
    "POST /admin/categories",
    "PATCH /admin/categories/:id",
    "DELETE /admin/categories/:id",
  ],
  inventory: ["POST /admin/inventory/stocktake", "POST /admin/inventory/adjust"],
  "warehouse-orders": ["POST /admin/orders/:id/actions/outbound"],
  locations: [
    "POST /admin/locations",
    "PATCH /admin/locations/:id",
    "DELETE /admin/locations/:id",
  ],
  staff: [
    "POST /admin/staff",
    "PATCH /admin/staff/:id",
    "DELETE /admin/staff/:id",
  ],
  recruit: [
    "POST /admin/recruit-applications/:id/approve",
    "POST /admin/recruit-applications/:id/reject",
    "PATCH /admin/recruit-applications/:id",
  ],
  buildings: ["POST /admin/buildings", "PATCH /admin/buildings/:id"],
  campuses: ["PATCH /admin/delivery-config", "POST /admin/campuses"],
  finance: [
    "POST /admin/settlements/:id/confirm",
    "POST /admin/settlements/:id/pay",
  ],
  rules: ["POST /admin/commission-rules", "PATCH /admin/commission-rules/:id"],
  marketing: ["POST /admin/coupons", "POST /admin/promotions"],
  banners: ["POST /admin/banners", "PATCH /admin/banners/:id"],
  "pay-ads": [
    "POST /admin/banners",
    "PATCH /admin/banners/:id",
    "DELETE /admin/banners/:id",
  ],
  coupons: [
    "POST /admin/coupons",
    "PATCH /admin/coupons/:id",
    "DELETE /admin/coupons/:id",
    "POST /admin/coupons/:id/issue",
  ],
  promotions: ["POST /admin/promotions", "PATCH /admin/promotions/:id"],
  wheel: ["PUT /admin/wheel"],
  featured: ["PUT /admin/featured"],
  "wechat-groups": ["POST /admin/wechat-groups"],
  restock: [
    "POST /admin/restock/batches",
    "PUT /admin/restock/batches/:batchId/order",
  ],
  purchase: [
    "POST /admin/purchase/orders/:id/receive",
    "POST /admin/restock/batches/:batchId/purchase-order",
  ],
  accounts: ["POST /admin/accounts", "PATCH /admin/accounts/:id"],
  "rbac-roles": ["POST /admin/rbac/roles", "PATCH /admin/rbac/roles/:id"],
  printers: ["POST /admin/printers"],
  dispatch: ["POST /admin/dispatch-invitations"],
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
/** 有效 URL 模式串全集（超管为 {'*'}）。 */
export const patterns = ref<Set<string>>(new Set());
/** 可见菜单树扁平行（permmenu.menus；侧栏与路由显隐的唯一依据）。 */
export const menuTree = ref<MeMenu[]>([]);
export const isSuper = ref(false);
export const isPlatform = ref(false);
export const rbacRoles = ref<RbacMe["roles"]>([]);
export const switchableCampuses = ref<string[]>([]);
export const rbacVersion = ref(0);
export const rbacLoaded = ref(false);

/** 按钮显隐：模式串精确命中（perms.includes 语义）；超管恒真。 */
export function hasPerm(pattern: string): boolean {
  if (isSuper.value) return true;
  return patterns.value.has(pattern);
}

/** 路由/菜单 section 归一：'/'→dashboard，去头斜杠。 */
function menuKeyOf(section: string): string {
  if (!section || section === "/") return "dashboard";
  return section.startsWith("/") ? section.slice(1) : section;
}

/**
 * 菜单/路由可见性：menuTree 里存在 code===key（或 path 对应）的 type=1 行。
 * 树本身就是授权结果（后端只回可见行），此处不再做权限码推导；
 * 超管恒真（防后端对超管只回 perms=['*'] 不回树的实现差异）。
 */
export function canSee(section: string): boolean {
  if (isSuper.value) return true;
  const key = menuKeyOf(section);
  const path = `/${key}`;
  return menuTree.value.some(
    (m) => m.type === 1 && (m.code === key || m.path === path),
  );
}

/** 写能力：section → write 模式串 any-of 命中（空数组=只读，恒 false）。 */
export function canWrite(section: string): boolean {
  const write = ROUTE_PERM[section];
  if (!write || write.length === 0) return false;
  return write.some((p) => hasPerm(p));
}

/** 登录成功后落地基础会话（权限随后 loadRbac 拉取）。 */
export function applySession(user: SessionUser) {
  sessionUser.value = user;
  localStorage.setItem("adminUser", JSON.stringify(user));
}

/** 应用 /admin/rbac/permmenu 结果（登录/切校区/权限变更后调用）。 */
export function applyRbac(me: RbacMe) {
  patterns.value = new Set(me.perms ?? []);
  menuTree.value = Array.isArray(me.menus) ? me.menus : [];
  isSuper.value = me.super;
  isPlatform.value = me.platform;
  rbacRoles.value = me.roles ?? [];
  switchableCampuses.value = me.switchableCampuses ?? [];
  rbacVersion.value = me.rbacVersion ?? 0;
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
    if (!raw) return;
    const cached = JSON.parse(raw) as RbacMe;
    // 旧两层模型缓存（permissions/menus:string[]）不兼容——丢弃等登录重拉
    if (!Array.isArray(cached.perms)) return;
    applyRbac(cached);
  } catch {
    /* 无效缓存忽略 */
  }
}
readCachedRbac();

/** 拉取有效授权（登录/切校区后调用）。失败=拒绝一切（默认拒绝，不回退宽松）。 */
export async function loadRbac(): Promise<boolean> {
  const { api } = await import("./api");
  try {
    applyRbac(await api.rbacPermmenu());
    return true;
  } catch {
    patterns.value = new Set();
    menuTree.value = [];
    isSuper.value = false;
    isPlatform.value = false;
    rbacLoaded.value = false;
    return false;
  }
}

export function clearSession() {
  sessionUser.value = null;
  patterns.value = new Set();
  menuTree.value = [];
  isSuper.value = false;
  isPlatform.value = false;
  rbacRoles.value = [];
  switchableCampuses.value = [];
  rbacLoaded.value = false;
  ["adminToken", "adminUser", "adminRbac"].forEach((key) =>
    localStorage.removeItem(key),
  );
}
