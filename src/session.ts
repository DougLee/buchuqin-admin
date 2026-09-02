import { computed, ref } from "vue";

/** 后台角色，口径与后端 admin.controller authorize 一致（hq/admin/operations/warehouse/finance）。
 *  IKAJSL：hq=总部长，campusId 空=跨校区视角。 */
export type AdminRole = "hq" | "admin" | "operations" | "warehouse" | "finance";

/** admin-login 返回的 user/claims。 */
export interface SessionUser {
  id: string;
  campusId: string;
  role: string;
  nickname?: string;
  phone?: string;
  avatar?: string;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  hq: "总部长",
  admin: "管理员",
  operations: "运营",
  warehouse: "仓储",
  finance: "财务",
};

/** 校区侧板块（对应路由 section 与侧边栏路径）。 */
const ALL_SECTIONS = [
  "dashboard",
  "orders",
  "after-sales",
  "products",
  "categories",
  "inventory",
  "warehouse-orders",
  "inventory-txns",
  "locations",
  "staff",
  "campuses",
  "buildings",
  "users",
  "wechat-groups",
  "marketing",
  "finance",
  "audit",
];

/** 总部长板块（IKAJSL）：跨校区汇总 + 官方商品库 + 校区/账号/用户/审计。
 *  products 对 hq 是官方商品库视图（IKAJSM）；orders/users/audit 只读跨校区。
 *  IKBW0A：Banner/广告位移出 hq——投放范围概念废止，校区自管。 */
const HQ_SECTIONS = [
  "dashboard",
  "orders",
  "products",
  "categories",
  "campuses",
  "accounts",
  "users",
  "audit",
];

/** PRD §2.2 + ADR-0004 签字权限矩阵：sections=侧边栏可见板块，writable=可执行写操作的板块。
 *  口径与后端 buchuqin-api src/admin/permissions.ts 一致，改动需两侧同步。
 *  售后板块（IK9JHQ）全角色只读留档，不在任何 writable 里。 */
export const PERMISSIONS: Record<
  AdminRole,
  { sections: string[]; writable: string[] }
> = {
  // 总部长（IKAJSL）：总部板块；订单/用户/审计只读，不参与校区履约与本地营销。
  // IKBW0A：banners 移出 hq（总部不做投放，Banner/广告位校区自管）。
  hq: {
    sections: HQ_SECTIONS,
    writable: ["products", "categories", "campuses", "accounts"],
  },
  admin: {
    // 平台超管全菜单开放（2026-08-26 道哥决策）；IKBW0A 起 banners 归本校区自管
    sections: [
      ...ALL_SECTIONS,
      "dispatch",
      "rules",
      "accounts",
      "banners",
      "printers",
    ],
    writable: [
      ...ALL_SECTIONS.filter((s) => s !== "after-sales"),
      "dispatch",
      "rules",
      "accounts",
      "banners",
      "printers",
    ],
  },
  // 运营：全部板块可见，但结算/提成规则只读（不含结算类写操作）；可发起调配。
  operations: {
    sections: [...ALL_SECTIONS, "dispatch", "rules"],
    writable: [
      ...ALL_SECTIONS.filter((s) => s !== "finance" && s !== "after-sales"),
      "dispatch",
    ],
  },
  // 仓储：工作台 / 商品与类别（读写）/ 订单只读 / 出入库与仓库订单 / 库位。
  warehouse: {
    sections: [
      "dashboard",
      "orders",
      "products",
      "categories",
      "inventory",
      "warehouse-orders",
      "inventory-txns",
      "locations",
    ],
    writable: [
      "inventory",
      "products",
      "categories",
      "warehouse-orders",
      "locations",
    ],
  },
  // 财务：工作台 / 订单只读 / 结算中心 / 提成规则 / 审计日志。
  finance: {
    sections: ["dashboard", "orders", "finance", "rules", "audit"],
    writable: ["finance", "rules"],
  },
};

function readRole(): AdminRole | null {
  const stored = localStorage.getItem("adminRole");
  return stored === "hq" ||
    stored === "admin" ||
    stored === "operations" ||
    stored === "warehouse" ||
    stored === "finance"
    ? stored
    : null;
}

function readUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("adminUser");
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export const role = ref<AdminRole | null>(readRole());
export const sessionUser = ref<SessionUser | null>(readUser());
export const roleLabel = computed(() =>
  role.value ? ROLE_LABELS[role.value] : "未登录",
);

export function isBackendRole(value: string): value is AdminRole {
  return (
    value === "hq" ||
    value === "admin" ||
    value === "operations" ||
    value === "warehouse" ||
    value === "finance"
  );
}

/** IKB5PB：营销拆分路由的权限映射——/coupons//promotions 归 marketing，
 *  /pay-ads 归 banners；权限矩阵本身不变，只是路由别名。 */
const SECTION_ALIAS: Record<string, string> = {
  coupons: "marketing",
  promotions: "marketing",
  "pay-ads": "banners",
  // IKCJ46：官方商品库独立菜单（权限复用 products 板块）
  "official-products": "products",
};

export function canSee(section: string): boolean {
  const key = SECTION_ALIAS[section] ?? section;
  return Boolean(role.value && PERMISSIONS[role.value].sections.includes(key));
}

export function canWrite(section: string): boolean {
  const key = SECTION_ALIAS[section] ?? section;
  return Boolean(
    role.value && PERMISSIONS[role.value].writable.includes(key),
  );
}

/** 登录成功后落地会话（role 来自 admin-login 返回的账号角色）。 */
export function applySession(user: SessionUser) {
  role.value = isBackendRole(user.role) ? user.role : null;
  sessionUser.value = user;
  localStorage.setItem("adminRole", role.value ?? "");
  localStorage.setItem("adminUser", JSON.stringify(user));
}

export function clearSession() {
  role.value = null;
  sessionUser.value = null;
  ["adminToken", "adminRole", "adminUser"].forEach((key) =>
    localStorage.removeItem(key),
  );
}
