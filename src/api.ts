interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}
let token = localStorage.getItem("adminToken") || "";
async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json()) as ApiResult<T>;
  if (!response.ok) throw new Error(body.message || "请求失败");
  return body.data;
}
export async function ensureLogin() {
  const result = await request<{ token: string }>("/auth/test-login", {
    method: "POST",
    body: JSON.stringify({ identity: "admin" }),
  });
  token = result.token;
  localStorage.setItem("adminToken", token);
}
export const api = {
  dashboard: () => request<any>("/admin/dashboard"),
  products: () => request<any[]>("/admin/products"),
  lookupBarcode: (barcode: string) =>
    request<any>("/admin/products/barcode/lookup", {
      method: "POST",
      body: JSON.stringify({ barcode }),
    }),
  createProduct: (data: Record<string, unknown>) =>
    request<any>("/admin/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProduct: (id: string, data: { price: number; stock: number }) =>
    request<any>(`/admin/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  inventory: () => request<any[]>("/admin/inventory"),
  inventoryTxns: (productId?: string) =>
    request<any[]>(
      `/admin/inventory/txns${productId ? `?productId=${productId}` : ""}`,
    ),
  stockIn: (data: { productId: string; quantity: number; reason: string }) =>
    request<any>("/admin/inventory/stock-in", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adjustInventory: (data: { productId: string; delta: number; reason: string }) =>
    request<any>("/admin/inventory/adjust", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  orders: (status = "all") => request<any[]>(`/admin/orders?status=${status}`),
  orderAction: (id: string, action: string) =>
    request<any>(`/admin/orders/${id}/actions/${action}`, { method: "POST" }),
  staff: () => request<any[]>("/admin/staff"),
  createStaff: (data: Record<string, unknown>) =>
    request<any>("/admin/staff", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateStaff: (id: string, data: Record<string, unknown>) =>
    request<any>(`/admin/staff/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteStaff: (id: string) =>
    request<any>(`/admin/staff/${id}`, { method: "DELETE" }),
  afterSales: () => request<any[]>("/admin/after-sales"),
  reviewAfterSale: (id: string, approved: boolean) =>
    request<any>(`/admin/after-sales/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  settlements: () => request<any[]>("/admin/settlements"),
  campuses: () => request<any[]>("/admin/campuses"),
  buildings: () => request<any[]>("/admin/buildings"),
  createBuilding: (data: Record<string, unknown>) =>
    request<any>("/admin/buildings", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateBuilding: (id: string, data: Record<string, unknown>) =>
    request<any>(`/admin/buildings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteBuilding: (id: string) =>
    request<any>(`/admin/buildings/${id}`, { method: "DELETE" }),
  rooms: (buildingId: string) =>
    request<any[]>(`/admin/buildings/${buildingId}/rooms`),
  createRoom: (buildingId: string, data: { floor: number; roomNo: string }) =>
    request<any>(`/admin/buildings/${buildingId}/rooms`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteRoom: (buildingId: string, roomId: string) =>
    request<any>(`/admin/buildings/${buildingId}/rooms/${roomId}`, {
      method: "DELETE",
    }),
  coupons: () => request<any[]>("/admin/coupons"),
  createCoupon: (data: {
    name: string;
    amount: number;
    threshold: number;
    total: number;
    expiresAt: string;
  }) =>
    request<any>("/admin/coupons", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCouponStatus: (id: string, status: "active" | "paused") =>
    request<any>(`/admin/coupons/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  issueCoupon: (id: string, userIds: string[]) =>
    request<any>(`/admin/coupons/${id}/issue`, {
      method: "POST",
      body: JSON.stringify({ userIds }),
    }),
  adminUsers: () => request<any[]>("/admin/users"),
  audits: () => request<any[]>("/admin/audit-logs"),
};
