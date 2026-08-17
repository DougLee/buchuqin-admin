import { clearSession, type SessionUser } from "./session";
import type {
  AdminUser,
  AfterSale,
  AuditLog,
  BarcodeLookup,
  Building,
  Campus,
  Coupon,
  DashboardData,
  InventoryTxn,
  Order,
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
 * TODO(后端分页)：列表接口透传 page/pageSize query；api 仓列表接口尚未实现分页参数，
 * 服务端会忽略未知 query 并返回全量——前端当前回退内存分页（DataPage 的
 * filtered/paged 计算保持不变），后端分页落地后把「服务端模式」开关置为默认即可生效。
 */
function paginationQuery(query?: PageQuery): string {
  return query ? `page=${query.page}&pageSize=${query.pageSize}` : "";
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
  products: (query?: PageQuery) =>
    request<Product[]>(`/admin/products${withQuery(paginationQuery(query))}`),
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
  inventory: (query?: PageQuery) =>
    request<Product[]>(`/admin/inventory${withQuery(paginationQuery(query))}`),
  inventoryTxns: (productId?: string, query?: PageQuery) =>
    request<InventoryTxn[]>(
      `/admin/inventory/txns${withQuery(productId ? `productId=${productId}` : "", paginationQuery(query))}`,
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
  orders: (status = "all", query?: PageQuery) =>
    request<Order[]>(
      `/admin/orders${withQuery(`status=${status}`, paginationQuery(query))}`,
    ),
  orderAction: (id: string, action: string) =>
    request<Order>(`/admin/orders/${id}/actions/${action}`, { method: "POST" }),
  staff: () => request<Staff[]>("/admin/staff"),
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
  afterSales: () => request<AfterSale[]>("/admin/after-sales"),
  reviewAfterSale: (id: string, approved: boolean) =>
    request<AfterSale>(`/admin/after-sales/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  settlements: (query?: PageQuery) =>
    request<Settlement[]>(
      `/admin/settlements${withQuery(paginationQuery(query))}`,
    ),
  campuses: () => request<Campus[]>("/admin/campuses"),
  buildings: () => request<Building[]>("/admin/buildings"),
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
  rooms: (buildingId: string) =>
    request<Room[]>(`/admin/buildings/${buildingId}/rooms`),
  createRoom: (buildingId: string, data: { floor: number; roomNo: string }) =>
    request<Room>(`/admin/buildings/${buildingId}/rooms`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteRoom: (buildingId: string, roomId: string) =>
    request<Room>(`/admin/buildings/${buildingId}/rooms/${roomId}`, {
      method: "DELETE",
    }),
  coupons: () => request<Coupon[]>("/admin/coupons"),
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
  adminUsers: () => request<AdminUser[]>("/admin/users"),
  audits: () => request<AuditLog[]>("/admin/audit-logs"),
};
