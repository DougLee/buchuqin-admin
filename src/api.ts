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
  orders: (status = "all") => request<any[]>(`/admin/orders?status=${status}`),
  orderAction: (id: string, action: string) =>
    request<any>(`/admin/orders/${id}/actions/${action}`, { method: "POST" }),
  staff: () => request<any[]>("/admin/staff"),
  afterSales: () => request<any[]>("/admin/after-sales"),
  reviewAfterSale: (id: string, approved: boolean) =>
    request<any>(`/admin/after-sales/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  settlements: () => request<any[]>("/admin/settlements"),
  campuses: () => request<any[]>("/admin/campuses"),
  coupons: () => request<any[]>("/admin/coupons"),
  audits: () => request<any[]>("/admin/audit-logs"),
};
