import { clearSession, type SessionUser } from "./session";
import type {
  AdminAccount,
  AdminUser,
  UserOrderRow,
  UserStats,
  WechatGroup,
  AfterSale,
  AuditLog,
  Banner,
  BarcodeLookup,
  Building,
  Campus,
  Category,
  CommissionRule,
  Coupon,
  DashboardData,
  HqDashboardData,
  DispatchInvitation,
  InventoryTxn,
  LeaveRequest,
  ListQuery,
  Order,
  PagedResponse,
  PageQuery,
  Product,
  Promotion,
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
    query.buildingId ? `buildingId=${encodeURIComponent(query.buildingId)}` : "",
    // IKAJSL：hq 跨校区视角的校区筛选
    query.campusId ? `campus=${encodeURIComponent(query.campusId)}` : "",
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  // token 过期/失效：无静默重登（真实密码不在前端保存），清会话回登录页
  if (response.status === 401 && !path.startsWith("/auth/")) {
    clearSession();
    token = "";
    window.location.hash = "#/login";
    throw new Error("登录已失效，请重新登录");
  }
  const body = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !body)
    throw new Error(body?.message || `请求失败（${response.status}）`);
  return body.data;
}

/** 后台账号密码登录（IK9JHP：test-login 演示通道已下线）。 */
export async function login(
  username: string,
  password: string,
): Promise<LoginResult> {
  const result = await request<LoginResult>("/auth/admin-login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  token = result.token;
  localStorage.setItem("adminToken", token);
  return result;
}

/**
 * COS 图片上传（IK9RWX，ADR-0003）：multipart 不可复用通用 request
 * （其写死 JSON Content-Type，会破坏 FormData 边界），单独走 fetch，
 * 鉴权与 401 清会话行为保持一致。返回公网 URL 直接落业务字段。
 */
/** folder=app：小程序静态素材（Banner 背景图）落 COS app/ 目录（IK9VBI）；缺省 uploads/。 */
export async function uploadImage(file: File, folder?: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(
    `/api/v1/files/images${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (response.status === 401) {
    clearSession();
    token = "";
    window.location.hash = "#/login";
    throw new Error("登录已失效，请重新登录");
  }
  const body = (await response.json().catch(() => null)) as ApiResult<{
    url: string;
  }> | null;
  if (!response.ok || !body)
    throw new Error(body?.message || `上传失败（${response.status}）`);
  return body.data.url;
}

export const api = {
  /** IKAJSL：hq 不带 campus = 跨校区汇总；带 campus = 单校区明细 */
  dashboard: (campusId?: string) =>
    request<DashboardData | HqDashboardData>(
      `/admin/dashboard${withQuery(campusId ? `campus=${encodeURIComponent(campusId)}` : "")}`,
    ),
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
  /** price 为整数分（表单元输入经 yuanToFen 转换后提交）；image 为 COS URL（IK9RWX 改图）；
   *  images/location 为详情多图与库位（IK9SNS/IK9U40）。 */
  updateProduct: (
    id: string,
    data: {
      price: number;
      stock: number;
      image?: string;
      location?: string;
      locationCode?: string;
      images?: string[];
      /** 资料字段（IKAHAT）：可选，仅提交有值/有变的项 */
      name?: string;
      subtitle?: string;
      originalPrice?: number;
      tag?: string;
      weight?: number;
      categoryId?: string;
      /** 商品介绍（IKAHAU）：整段覆盖，空串清空。 */
      description?: string;
    },
  ) =>
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
  /** 订单状态计数（IKAJSP）：Tab 角标，返回原始状态→数量；hq 可带校区。 */
  orderStatusCounts: (campusId?: string) =>
    request<Record<string, number>>(
      `/admin/orders/status-counts${withQuery(campusId ? `campus=${encodeURIComponent(campusId)}` : "")}`,
    ),
  orderAction: (id: string, action: string) =>
    request<Order>(`/admin/orders/${id}/actions/${action}`, { method: "POST" }),
  /** 手动改订单状态（IKA0UT）：原因进审计日志。 */
  updateOrderStatus: (id: string, status: string, reason: string) =>
    request<Order>(`/admin/orders/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    }),
  /* ---------- 库位管理（IKA0VG） ---------- */
  adminLocations: () =>
    request<Array<{ id: string; name: string; note: string; sort: number; createdAt: string }>>(
      "/admin/locations",
    ),
  createLocation: (data: { name: string; note?: string; sort?: number }) =>
    request<{ id: string }>("/admin/locations", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateLocation: (
    id: string,
    data: { name?: string; note?: string; sort?: number },
  ) =>
    request<{ id: string }>(`/admin/locations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteLocation: (id: string) =>
    request<{ id: string }>(`/admin/locations/${id}`, {
      method: "DELETE",
    }),
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
    /** 调配奖励（分）。 */
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
    /** 提成单价（分/单）。 */
    price: number;
    effectiveAt?: string;
  }) =>
    request<CommissionRule>("/admin/commission-rules", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /** price 为整数分。 */
  updateCommissionRule: (
    id: string,
    data: { status?: "active" | "disabled"; price?: number },
  ) =>
    request<CommissionRule>(`/admin/commission-rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  /** 校区列表（IKAJSL）：后端返回全量数组（非分页信封），keyword 过滤。 */
  campuses: (query?: ListQuery) =>
    request<Campus[]>(
      `/admin/campuses${withQuery(listQuery(query))}`,
    ),
  /** 校区本体增改（IKAJSL）：仅 hq；新校区接入入口。 */
  createCampus: (data: {
    name: string;
    shortName: string;
    warehouseName: string;
    address?: string;
    deliveryFeeInstant?: number;
    deliveryFeeScheduled?: number;
    deliveryThreshold?: number;
  }) =>
    request<Campus>("/admin/campuses", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCampus: (
    id: string,
    data: Partial<{
      name: string;
      shortName: string;
      warehouseName: string;
      address: string;
      status: "active" | "inactive";
      deliveryFeeInstant: number;
      deliveryFeeScheduled: number;
      deliveryThreshold: number;
    }>,
  ) =>
    request<Campus>(`/admin/campuses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  buildings: (query?: ListQuery) =>
    request<PagedResponse<Building>>(
      `/admin/buildings${withQuery(listQuery(query))}`,
    ),
  /** 商品类别（全局字典非分页，直接返回数组；列表带 productCount）。 */
  adminCategories: () => request<Category[]>("/admin/categories"),
  adminCreateCategory: (data: { name: string; sort?: number; image?: string }) =>
    request<Category>("/admin/categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminUpdateCategory: (
    id: string,
    data: { name?: string; sort?: number; image?: string },
  ) =>
    request<Category>(`/admin/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  adminDeleteCategory: (id: string) =>
    request<void>(`/admin/categories/${id}`, { method: "DELETE" }),
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
  /** amount / threshold 为整数分（表单输元，经 yuanToFen 转换后提交）。 */
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
  /** 首页 Banner（IK9RX2）：营销活动板块内 tab 管理。 */
  banners: (query?: ListQuery) =>
    request<PagedResponse<Banner>>(
      `/admin/banners${withQuery(listQuery(query))}`,
    ),
  createBanner: (data: Record<string, unknown>) =>
    request<Banner>("/admin/banners", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateBanner: (id: string, data: Record<string, unknown>) =>
    request<Banner>(`/admin/banners/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteBanner: (id: string) =>
    request<Banner>(`/admin/banners/${id}`, { method: "DELETE" }),
  /** 促销活动（ADR-0006 / IKAHFF）：price 为促销价（分），无删除（留审计）。 */
  promotions: (query?: ListQuery) =>
    request<PagedResponse<Promotion>>(
      `/admin/promotions${withQuery(listQuery(query))}`,
    ),
  createPromotion: (data: {
    productId: string;
    type: "seckill" | "clearance";
    price: number;
    startsAt: string;
    endsAt: string;
  }) =>
    request<Promotion>("/admin/promotions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updatePromotion: (
    id: string,
    data: { price?: number; startsAt?: string; endsAt?: string; status?: string },
  ) =>
    request<Promotion>(`/admin/promotions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  /** 配送费/起送门槛配置（IK9SO6）：金额整数分，校园维度即时生效。 */
  deliveryConfig: () =>
    request<{
      deliveryFeeInstant: number;
      deliveryFeeScheduled: number;
      deliveryThreshold: number;
    }>("/admin/delivery-config"),
  updateDeliveryConfig: (data: {
    deliveryFeeInstant: number;
    deliveryFeeScheduled: number;
    deliveryThreshold: number;
  }) =>
    request<{
      deliveryFeeInstant: number;
      deliveryFeeScheduled: number;
      deliveryThreshold: number;
    }>("/admin/delivery-config", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  adminUsers: (query?: ListQuery) =>
    request<PagedResponse<AdminUser>>(
      `/admin/users${withQuery(listQuery(query))}`,
    ),
  /* C 端用户管理（IKAJSW）：统计 + 单用户订单流水；hq 可带校区（IKAJSL） */
  userStats: (campusId?: string) =>
    request<UserStats>(
      `/admin/users/stats${withQuery(campusId ? `campus=${encodeURIComponent(campusId)}` : "")}`,
    ),
  userOrders: (id: string) =>
    request<UserOrderRow[]>(`/admin/users/${id}/orders`),
  /* 微信群二维码（IKAJSY） */
  wechatGroups: () => request<WechatGroup[]>("/admin/wechat-groups"),
  upsertWechatGroup: (data: { buildingId?: string; image: string }) =>
    request<WechatGroup>("/admin/wechat-groups", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteWechatGroup: (id: string) =>
    request(`/admin/wechat-groups/${id}`, { method: "DELETE" }),
  audits: (query?: ListQuery) =>
    request<PagedResponse<AuditLog>>(
      `/admin/audit-logs${withQuery(listQuery(query))}`,
    ),
  /* 后台账号管理（IK9KWO）：仅 admin 角色可用，后端矩阵兜底 */
  adminAccounts: (query?: ListQuery) =>
    request<PagedResponse<AdminAccount>>(
      `/admin/accounts${withQuery(listQuery(query))}`,
    ),
  createAccount: (data: {
    username: string;
    password: string;
    nickname?: string;
    role: string;
    /** IKAJSL：仅 hq 操作者生效（空串 = 总部账号）。 */
    campusId?: string;
  }) =>
    request<AdminAccount>("/admin/accounts", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAccount: (
    id: string,
    data: { nickname?: string; role?: string; password?: string },
  ) =>
    request<AdminAccount>(`/admin/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteAccount: (id: string) =>
    request(`/admin/accounts/${id}`, { method: "DELETE" }),
  /** 自助改密（当前登录账号） */
  changePassword: (oldPassword: string, newPassword: string) =>
    request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
};
