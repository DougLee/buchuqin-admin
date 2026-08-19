import { computed, ref } from "vue";

/** 后台角色，口径与后端 admin.controller authorize 一致（admin/operations/warehouse/finance）。 */
export type AdminRole = "admin" | "operations" | "warehouse" | "finance";

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
  admin: "管理员",
  operations: "运营",
  warehouse: "仓储",
  finance: "财务",
};

/** 全部板块 key（对应路由 section 与侧边栏路径）。 */
const ALL_SECTIONS = [
  "dashboard",
  "orders",
  "after-sales",
  "products",
  "categories",
  "inventory",
  "staff",
  "campuses",
  "marketing",
  "finance",
  "audit",
];

/** PRD §2.2 + ADR-0004 签字权限矩阵：sections=侧边栏可见板块，writable=可执行写操作的板块。
 *  口径与后端 buchuqin-api src/admin/permissions.ts 一致，改动需两侧同步。
 *  售后板块（IK9JHQ）全角色只读留档，不在任何 writable 里。 */
export const PERMISSIONS: Record<
  AdminRole,
  { sections: string[]; writable: string[] }
> = {
  admin: {
    sections: [...ALL_SECTIONS, "dispatch", "rules", "accounts"],
    writable: [
      ...ALL_SECTIONS.filter((s) => s !== "after-sales"),
      "dispatch",
      "rules",
      "accounts",
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
  // 仓储：工作台 / 商品与类别（读写）/ 订单只读 / 出入库。
  warehouse: {
    sections: ["dashboard", "orders", "products", "categories", "inventory"],
    writable: ["inventory", "products", "categories"],
  },
  // 财务：工作台 / 订单只读 / 结算中心 / 提成规则 / 审计日志。
  finance: {
    sections: ["dashboard", "orders", "finance", "rules", "audit"],
    writable: ["finance", "rules"],
  },
};

function readRole(): AdminRole | null {
  const stored = localStorage.getItem("adminRole");
  return stored === "admin" ||
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
    value === "admin" ||
    value === "operations" ||
    value === "warehouse" ||
    value === "finance"
  );
}

export function canSee(section: string): boolean {
  return Boolean(role.value && PERMISSIONS[role.value].sections.includes(section));
}

export function canWrite(section: string): boolean {
  return Boolean(
    role.value && PERMISSIONS[role.value].writable.includes(section),
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
