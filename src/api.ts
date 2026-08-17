import { clearSession, type SessionUser } from "./session";
import type {
  AdminUser,
  AfterSale,
  AuditLog,
  BarcodeLookup,
  Building,
  Campus,
  CommissionRule,
  Coupon,
  DashboardData,
  DispatchInvitation,
  InventoryTxn,
  LeaveRequest,
  ListQuery,
  Order,
  PagedResponse,
  PageQuery,
  Product,
  Room,
  Settlement,
  Staff,
} from "./types";

interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

export interface LoginResult {
  token: string;
  user: SessionUser;
}

let token = localStorage.getItem("adminToken") || "";

/** 登出 / 会话失效时清空内存 token（localStorage 由 clearSession 处理）。 */
export function clearToken() {
  token = "";
}

/**
 * 列表统一透传 page/pageSize/keyword query（IK8W5X 契约：所有列表响应
 * 为 { items, page, pageSize, total }，前端直接服务端分页）。
 */
function listQuery(query?: ListQuery): string {
  if (!query) return "";
  return [
    `page=${query.page}`,
    `pageSize=${query.pageSize}`,
    query.keyword ? `keyword=${encodeURIComponent(query.keyword)}` : "",
  ]
    .filter(Boolean)
    .join("&");
}

/**
 * 翻页取全量：下拉选项 / 抽屉列表等需要完整数据的场景使用。
 * maxPages 防失控（默认 50 页 x pageSize 条）。
 */
export async function fetchAllPages<T>(
  fetchPage: (query: PageQuery) => Promise<PagedResponse<T>>,
  pageSize = 100,
  maxPages = 50,
): Promise<T[]> {
  const first = await fetchPage({ page: 1, pageSize });
  const items = [...first.items];
  const size = first.pageSize || pageSize;
  const totalPages = Math.max(1, Math.ceil(first.total / size));
  for (let p = 2; p <= Math.min(totalPages, maxPages); p++) {
    const next = await fetchPage({ page: p, pageSize });
    items.push(...next.items);
  }
  return items;
}

function withQuery(...parts: (string | undefined)[]): string {
  const query = parts.filter(Boolean).join("&");
  return query ? `?${query}` : "";
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  // token 过期/失效：用会话身份重登一次后重试；重登失败（演示别名未开放等）清理会话并回登录页
  if (response.status === 401 && !retried && !path.startsWith("/auth/")) {
    try {
      await ensureLogin();
    } catch (error) {
      clearSession();
      token = "";
      window.location.hash = "#/login";
      throw error;
    }
    return request<T>(path, options, true);
  }
  const body = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !body)
    throw new Error(body?.message || `请求失败（${response.status}）`);
  return body.data;
}

/** 指定身份走 test-login（支持角色别名或具体 staffNo / staff id）。 */
export async function login(identity: string): Promise<LoginResult> {
  const result = await request<LoginResult>("/auth/test-login", {
    method: "POST",
    body: JSON.stringify({ identity }),
  });
  token = result.token;
  localStorage.setItem("adminToken", token);
  return result;
}

/** 401 自愈：按登录时保存的身份重登（默认 admin）。 */
export async function ensureLogin() {
  await login(localStorage.getItem("adminIdentity") || "admin");
}

export const api = {
  dashboard: () => request<DashboardData>("/admin/dashboard"),
  products: (query?: ListQuery) =>
    request<PagedResponse<Product>>(
      `/admin/products${withQuery(listQuery(query))}`,
    ),
  lookupBarcode: (barcode: string) =>
    request<BarcodeLookup>("/admin/products/barcode/lookup", {
      method: "POST",
      body: JSON.stringify({ barcode }),
    }),
  createProduct: (data: Record<string, unknown>) =>
    request<Product>("/admin/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProduct: (id: string, data: { price: number; stock: number }) =>
    request<Product>(`/admin/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  inventory: (query?: ListQuery) =>
    request<PagedResponse<Product>>(
      `/admin/inventory${withQuery(listQuery(query))}`,
    ),
  inventoryTxns: (productId?: string, query?: ListQuery) =>
    request<PagedResponse<InventoryTxn>>(
      `/admin/inventory/txns${withQuery(productId ? `productId=${productId}` : "", listQuery(query))}`,
    ),
  stockIn: (data: { productId: string; quantity: number; reason: string }) =>
    request<InventoryTxn>("/admin/inventory/stock-in", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adjustInventory: (data: { productId: string; delta: number; reason: string }) =>
    request<InventoryTxn>("/admin/inventory/adjust", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  orders: (status = "all", query?: ListQuery) =>
    request<PagedResponse<Order>>(
      `/admin/orders${withQuery(`status=${status}`, listQuery(query))}`,
    ),
  orderAction: (id: string, action: string) =>
    request<Order>(`/admin/orders/${id}/actions/${action}`, { method: "POST" }),
  staff: (query?: ListQuery) =>
    request<PagedResponse<Staff>>(`/admin/staff${withQuery(listQuery(query))}`),
  createStaff: (data: Record<string, unknown>) =>
    request<Staff>("/admin/staff", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateStaff: (id: string, data: Record<string, unknown>) =>
    request<Staff>(`/admin/staff/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteStaff: (id: string) =>
    request<Staff>(`/admin/staff/${id}`, { method: "DELETE" }),
  afterSales: (query?: ListQuery) =>
    request<PagedResponse<AfterSale>>(
      `/admin/after-sales${withQuery(listQuery(query))}`,
    ),
  reviewAfterSale: (id: string, approved: boolean) =>
    request<AfterSale>(`/admin/after-sales/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  settlements: (month?: string, query?: ListQuery) =>
    request<PagedResponse<Settlement>>(
      `/admin/settlements${withQuery(
        month ? `month=${month}` : "",
        listQuery(query),
      )}`,
    ),
  confirmSettlement: (id: string) =>
    request<Settlement>(`/admin/settlements/${id}/confirm`, {
      method: "POST",
    }),
  paySettlement: (id: string) =>
    request<Settlement>(`/admin/settlements/${id}/pay`, { method: "POST" }),
  leaveRequests: (query?: ListQuery) =>
    request<PagedResponse<LeaveRequest>>(
      `/admin/leave-requests${withQuery(listQuery(query))}`,
    ),
  dispatchInvitations: (query?: ListQuery) =>
    request<PagedResponse<DispatchInvitation>>(
      `/admin/dispatch-invitations${withQuery(listQuery(query))}`,
    ),
  createDispatchInvitation: (data: {
    targetStaffId: string;
    buildingId: string;
    startAt: string;
    endAt: string;
    reward?: number;
  }) =>
    request<DispatchInvitation>("/admin/dispatch-invitations", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  cancelDispatchInvitation: (id: string) =>
    request<DispatchInvitation>(`/admin/dispatch-invitations/${id}/cancel`, {
      method: "POST",
    }),
  commissionRules: (query?: ListQuery) =>
    request<PagedResponse<CommissionRule>>(
      `/admin/commission-rules${withQuery(listQuery(query))}`,
    ),
  createCommissionRule: (data: {
    buildingId?: string;
    floor?: number;
    weightFrom?: number;
    weightTo?: number;
    mode?: "instant" | "scheduled";
    price: number;
    effectiveAt?: string;
  }) =>
    request<CommissionRule>("/admin/commission-rules", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCommissionRule: (
    id: string,
    data: { status?: "active" | "disabled"; price?: number },
  ) =>
    request<CommissionRule>(`/admin/commission-rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  campuses: (query?: ListQuery) =>
    request<PagedResponse<Campus>>(
      `/admin/campuses${withQuery(listQuery(query))}`,
    ),
  buildings: (query?: ListQuery) =>
    request<PagedResponse<Building>>(
      `/admin/buildings${withQuery(listQuery(query))}`,
    ),
  createBuilding: (data: Record<string, unknown>) =>
    request<Building>("/admin/buildings", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateBuilding: (id: string, data: Record<string, unknown>) =>
    request<Building>(`/admin/buildings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteBuilding: (id: string) =>
    request<Building>(`/admin/buildings/${id}`, { method: "DELETE" }),
  rooms: (buildingId: string, query?: ListQuery) =>
    request<PagedResponse<Room>>(
      `/admin/buildings/${buildingId}/rooms${withQuery(listQuery(query))}`,
    ),
  createRoom: (buildingId: string, data: { floor: number; roomNo: string }) =>
    request<Room>(`/admin/buildings/${buildingId}/rooms`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteRoom: (buildingId: string, roomId: string) =>
    request<Room>(`/admin/buildings/${buildingId}/rooms/${roomId}`, {
      method: "DELETE",
    }),
  coupons: (query?: ListQuery) =>
    request<PagedResponse<Coupon>>(
      `/admin/coupons${withQuery(listQuery(query))}`,
    ),
  createCoupon: (data: {
    name: string;
    amount: number;
    threshold: number;
    total: number;
    expiresAt: string;
  }) =>
    request<Coupon>("/admin/coupons", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCouponStatus: (id: string, status: "active" | "paused") =>
    request<Coupon>(`/admin/coupons/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  issueCoupon: (id: string, userIds: string[]) =>
    request<Coupon>(`/admin/coupons/${id}/issue`, {
      method: "POST",
      body: JSON.stringify({ userIds }),
    }),
  adminUsers: (query?: ListQuery) =>
    request<PagedResponse<AdminUser>>(
      `/admin/users${withQuery(listQuery(query))}`,
    ),
  audits: (query?: ListQuery) =>
    request<PagedResponse<AuditLog>>(
      `/admin/audit-logs${withQuery(listQuery(query))}`,
    ),
};
