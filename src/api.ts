import { clearSession, type SessionUser } from "./session";
import { compressToWebp } from "./utils/image";
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
  MarketingMapData,
  Printer,
  LeaveRequest,
  ListQuery,
  Order,
  PagedResponse,
  PageQuery,
  Product,
  Promotion,
  RecruitingApplication,
  RestockBatch,
  RestockBatchProduct,
  RestockOrder,
  RestockShipmentDetail,
  HqDailyReport,
  PurchaseOrderRow,
  PurchaseOrderDetail,
  BatchMarginSummary,
  Room,
  RoomImportResult,
  Settlement,
  Staff,
  StocktakeResult,
  WheelConfig,
  WheelPrizeInput,
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
    // IKB3K9：商品状态 Tab 的服务端过滤
    query.status ? `status=${encodeURIComponent(query.status)}` : "",
    // IKD6FG：分类筛选（商品管理/官方商品库/库存总览共用；IKDCDP 补序列化——
    // loader 传了 categoryId 但白名单漏拼，请求从未带上，筛选一直不生效）
    query.categoryId ? `categoryId=${encodeURIComponent(query.categoryId)}` : "",
    // IKD6FG：订单配送方式筛选（instant/scheduled）——同 IKDCDP 病灶：
    // loader 传了 deliveryMode 但白名单漏拼，请求从未带上（2026-09-05 道哥）
    query.deliveryMode
      ? `deliveryMode=${encodeURIComponent(query.deliveryMode)}`
      : "",
    // 全量断链审计（2026-09-05）：履约人员角色筛选——types/loader/后端三处
    // 早已支持，唯独此处白名单漏拼，role 从未上请求（同 IKDCDP 病灶第四例）
    query.role ? `role=${encodeURIComponent(query.role)}` : "",
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
/** folder=app：小程序静态素材（Banner 背景图）落 COS app/ 目录（IK9VBI）；缺省 uploads/。
 *  IKE9Q5：上传前统一压缩转 webp（gif/webp 原样、异常降级），全线展示图瘦身。 */
export async function uploadImage(file: File, folder?: string): Promise<string> {
  const form = new FormData();
  form.append("file", await compressToWebp(file));
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

/**
 * 寝室导入模板下载（IKD6FH）：xlsx 二进制下载，通用 request 走 JSON 信封
 * 不适用，单独 fetch+blob+a[download]（鉴权与 401 清会话行为同 uploadImage）。
 * 文件名优先取 Content-Disposition 的 UTF-8 filename*（后端附楼栋名）。
 */
export async function downloadRoomTemplate(buildingId: string): Promise<void> {
  const response = await fetch(
    `/api/v1/admin/buildings/${buildingId}/rooms/template`,
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
  );
  if (response.status === 401) {
    clearSession();
    token = "";
    window.location.hash = "#/login";
    throw new Error("登录已失效，请重新登录");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | ApiResult<unknown>
      | null;
    throw new Error(body?.message || `模板下载失败（${response.status}）`);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = utf8
    ? decodeURIComponent(utf8[1])
    : plain
      ? plain[1]
      : "rooms-template.xlsx";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const api = {
  /** IKAJSL：hq 不带 campus = 跨校区汇总；带 campus = 单校区明细 */
  dashboard: (campusId?: string) =>
    request<DashboardData | HqDashboardData>(
      `/admin/dashboard${withQuery(campusId ? `campus=${encodeURIComponent(campusId)}` : "")}`,
    ),
  /** view（IKCHEW 商品双视角）：仅 admin 生效——official 官方库 / campus 本校区 */
  products: (query?: ListQuery, view?: string) =>
    request<PagedResponse<Product>>(
      `/admin/products${withQuery(listQuery(query), view ? `view=${view}` : undefined)}`,
    ),
  /** 商品状态计数（IKB3K9 列表 Tab 角标）：口径同列表（含售罄映射）。 */
  productStatusCounts: (view?: string) =>
    request<Record<string, number>>(
      `/admin/products/status-counts${withQuery(view ? `view=${view}` : undefined)}`,
    ),
  /** 官方库浏览（IKAJSO 导入弹窗）：只读官方库行，校区角色可查。 */
  officialProducts: (query?: ListQuery) =>
    request<PagedResponse<Product>>(
      `/admin/products/official-library${withQuery(listQuery(query))}`,
    ),
  /** 从官方库批量导入本校区（IKAJSO）：初始下架零库存，售价/库存/上下架自管。 */
  importProducts: (productIds: string[]) =>
    request<{
      importedCount: number;
      importedProductIds: string[];
      skipped: { id: string; name: string; reason: string }[];
    }>("/admin/products/import", {
      method: "POST",
      body: JSON.stringify({ productIds }),
    }),
  /** 一键拉取官方库最新资料（IKAJSO）：不动本地售价/上下架/库存。 */
  pullUpstream: (id: string) =>
    request<Product>(`/admin/products/${id}/pull-upstream`, {
      method: "POST",
    }),
  lookupBarcode: (barcode: string, view?: string) =>
    request<BarcodeLookup>(
      `/admin/products/barcode/lookup${withQuery(view ? `view=${view}` : undefined)}`,
      {
        method: "POST",
        body: JSON.stringify({ barcode }),
      },
    ),
  createProduct: (data: Record<string, unknown>, view?: string) =>
    request<Product>(
      `/admin/products${withQuery(view ? `view=${view}` : undefined)}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  /** price 为整数分（表单元输入经 yuanToFen 转换后提交）；image 为 COS URL（IK9RWX 改图）；
   *  images/location 为详情多图与库位（IK9SNS/IK9U40）。 */
  updateProduct: (
    id: string,
    data: {
      /** 后端 DTO 全字段可选（行内快捷 toggle 只提交 status） */
      price?: number;
      stock?: number;
      /** 上下架（IKC1AB）：hq 官方库放行/回收、校区自管本地上架。 */
      status?: "on-sale" | "off-sale";
      /** 进货价/批发价格（IKC1AC，分）：仅官方库行提交。 */
      costPrice?: number;
      wholesalePrice?: number;
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
    /** IKCHEW 商品双视角：仅 admin 生效（official 官方库 / campus 本校区） */
    view?: string,
  ) =>
    request<Product>(
      `/admin/products/${id}${withQuery(view ? `view=${view}` : undefined)}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    ),
  /** 批量放行/回收（IKCKX4）：返回实际更新数（越界 id 由后端忽略）。 */
  batchUpdateProductStatus: (
    ids: string[],
    status: "on-sale" | "off-sale",
    view?: string,
  ) =>
    request<{ count: number }>(
      `/admin/products/batch-status${withQuery(view ? `view=${view}` : undefined)}`,
      {
        method: "POST",
        body: JSON.stringify({ ids, status }),
      },
    ),
  inventory: (query?: ListQuery) =>
    request<PagedResponse<Product>>(
      `/admin/inventory${withQuery(listQuery(query))}`,
    ),
  inventoryTxns: (productId?: string, query?: ListQuery) =>
    request<PagedResponse<InventoryTxn>>(
      `/admin/inventory/txns${withQuery(productId ? `productId=${productId}` : "", listQuery(query))}`,
    ),
  stockIn: (
    data: { productId: string; quantity: number; reason: string },
    // IKFOPY：平台视角入库须指定仓库（校区/总部仓），走 campusScope 序列化
    campus?: string,
  ) =>
    request<InventoryTxn>(
      `/admin/inventory/stock-in${withQuery(campus ? `campus=${encodeURIComponent(campus)}` : "")}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  adjustInventory: (data: { productId: string; delta: number; reason: string }) =>
    request<InventoryTxn>("/admin/inventory/adjust", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /** 盘点（IKD6FJ，原「盘点校准」）：提交实际清点数量，后端自动算差额落账（账实相符不落流水）。 */
  stocktake: (
    data: {
      productId: string;
      countedQty: number;
      reason?: string;
    },
    // IKFOPY：平台视角盘点须指定仓库（校区/总部仓）
    campus?: string,
  ) =>
    request<StocktakeResult>(
      `/admin/inventory/stocktake${withQuery(campus ? `campus=${encodeURIComponent(campus)}` : "")}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  orders: (status = "all", query?: ListQuery) =>
    request<PagedResponse<Order>>(
      `/admin/orders${withQuery(`status=${status}`, listQuery(query))}`,
    ),
  /** ===== 订货批次（IKFOQ0）：独立「订货管理」板块 ===== */
  /** 批次列表：phase 由时间窗推导；校区角色附带本校区单况统计。 */
  restockBatches: () => request<RestockBatch[]>("/admin/restock/batches"),
  /** 建批次（hq/admin）：商品范围恒等官方库在售全集，不勾选（IKFOQ0 第二轮）。 */
  createRestockBatch: (data: { name: string; startAt: string; endAt: string }) =>
    request<RestockBatch>("/admin/restock/batches", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /** 改批次：只改名称与窗口。 */
  updateRestockBatch: (
    id: string,
    data: { name?: string; startAt?: string; endAt?: string },
  ) =>
    request<RestockBatch>(`/admin/restock/batches/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  /** 手动提前关闭（幂等）。 */
  closeRestockBatch: (id: string) =>
    request<RestockBatch>(`/admin/restock/batches/${id}/close`, {
      method: "POST",
      body: "{}",
    }),
  /** 批次详情：可订商品 + 订货单 + 毛利聚合（IKFOQ1 IQ8，总部=全校区 / 校区=本校区）。 */
  restockBatchDetail: (id: string) =>
    request<
      RestockBatch & {
        items: RestockBatchProduct[];
        orders: RestockOrder[];
      } & BatchMarginSummary
    >(`/admin/restock/batches/${id}`),
  /** 校区保存本批次订货单（upsert，草稿/驳回态可改，items 全量替换）。 */
  saveRestockOrder: (
    batchId: string,
    items: { productId: string; cases: number; remark?: string }[],
  ) =>
    request<RestockOrder>(`/admin/restock/batches/${batchId}/order`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  submitRestockOrder: (batchId: string) =>
    request<{ id: string; status: string }>(
      `/admin/restock/batches/${batchId}/order/submit`,
      { method: "POST", body: "{}" },
    ),
  withdrawRestockOrder: (batchId: string) =>
    request<{ id: string; status: string }>(
      `/admin/restock/batches/${batchId}/order/withdraw`,
      { method: "POST", body: "{}" },
    ),
  /* ---------- 采购单（IKFOQ1） ---------- */
  purchaseOrders: () =>
    request<PurchaseOrderRow[]>("/admin/purchase/orders"),
  purchaseOrderDetail: (id: string) =>
    request<PurchaseOrderDetail>(`/admin/purchase/orders/${id}`),
  /** 一键聚合生成（IQ2）：行单价预填 costPrice 可改；应收以后端聚合为准 */
  createPurchaseOrder: (
    batchId: string,
    body: { supplierName: string; lines: { productId: string; unitCost: number }[] },
  ) =>
    request<{ id: string }>(
      `/admin/restock/batches/${batchId}/purchase-order`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  /** 验收入库（IQ3/IQ4）：快捷全收+坏品出库；receiveCases=0 的行忽略 */
  receivePurchaseOrder: (
    id: string,
    lines: { productId: string; receiveCases: number; badCases: number; note?: string }[],
  ) =>
    request<{ id: string; phase: string }>(
      `/admin/purchase/orders/${id}/receive`,
      { method: "POST", body: JSON.stringify({ lines }) },
    ),
  closePurchaseOrder: (id: string, note?: string) =>
    request<{ id: string; phase: string }>(
      `/admin/purchase/orders/${id}/close`,
      { method: "POST", body: JSON.stringify(note ? { note } : {}) },
    ),
  reopenPurchaseOrder: (id: string) =>
    request<{ id: string }>(`/admin/purchase/orders/${id}/reopen`, {
      method: "POST",
      body: "{}",
    }),
  restockOrders: (query?: { batchId?: string; status?: string }) =>
    request<RestockOrder[]>(
      `/admin/restock/orders${withQuery(
        query?.batchId ? `batchId=${encodeURIComponent(query.batchId)}` : undefined,
        query?.status ? `status=${encodeURIComponent(query.status)}` : undefined,
      )}`,
    ),
  restockOrderDetail: (id: string) =>
    request<RestockOrder>(`/admin/restock/orders/${id}`),
  /** 总部审核：confirm 锁总部仓库存（不足阻断），reject 驳回，revoke 撤销放锁。 */
  auditRestockOrder: (
    id: string,
    action: "confirm" | "reject" | "revoke",
    note?: string,
  ) =>
    request<{ id: string; status: string }>(
      `/admin/restock/orders/${id}/audit`,
      {
        method: "POST",
        body: JSON.stringify({ action, ...(note ? { note } : {}) }),
      },
    ),
  /** 分拨发货（IKFOQ2）：整单发，锁定转实扣，库存不足后端拦截报缺货数量。 */
  shipRestockOrder: (id: string, note?: string) =>
    request<{ id: string; status: string }>(
      `/admin/restock/orders/${id}/ship`,
      { method: "POST", body: JSON.stringify(note ? { note } : {}) },
    ),
  /** 校区确认到货：按发货数全额入账（收货校区本人操作）。 */
  confirmRestockReceipt: (id: string) =>
    request<{ id: string; status: string }>(
      `/admin/restock/orders/${id}/receipt`,
      { method: "POST", body: "{}" },
    ),
  /** 发货单详情：行快照价+发货/收货信息。 */
  restockShipmentDetail: (id: string) =>
    request<RestockShipmentDetail>(`/admin/restock/orders/${id}/shipment`),
  /** 总部经营日报（IKFOPR）：receivedAt 落日×校区聚合；start/end YYYY-MM-DD，缺省昨日。 */
  hqDailyReport: (start?: string, end?: string, campusId?: string) =>
    request<HqDailyReport>(
      `/admin/reports/hq-daily${withQuery(
        start ? `start=${start}` : undefined,
        end ? `end=${end}` : undefined,
        campusId ? `campusId=${encodeURIComponent(campusId)}` : undefined,
      )}`,
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
  /** 补打小票（IKBT6N）：芯烨云重推订单小票，写审计日志。 */
  printReceipt: (id: string) =>
    request<{ printed: boolean; orderNo: string }>(
      `/admin/orders/${id}/print-receipt`,
      { method: "POST" },
    ),
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
  /** IKB5PA：status 过滤（online/paused/offline，状态 Tab 用）。 */
  staff: (query?: ListQuery, status?: string) =>
    request<PagedResponse<Staff>>(
      `/admin/staff${withQuery(
        status ? `status=${status}` : "",
        listQuery(query),
      )}`,
    ),
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
  /** IKB5PA：status 过滤（pending/cancelled，状态 Tab 用）。 */
  afterSales: (query?: ListQuery, status?: string) =>
    request<PagedResponse<AfterSale>>(
      `/admin/after-sales${withQuery(
        status ? `status=${status}` : "",
        listQuery(query),
      )}`,
    ),
  /** IKB5PA：status 过滤（pending-review/confirmed/paid，状态 Tab 用）。 */
  settlements: (month?: string, query?: ListQuery, status?: string) =>
    request<PagedResponse<Settlement>>(
      `/admin/settlements${withQuery(
        month ? `month=${month}` : "",
        status ? `status=${status}` : "",
        listQuery(query),
      )}`,
    ),
  confirmSettlement: (id: string) =>
    request<Settlement>(`/admin/settlements/${id}/confirm`, {
      method: "POST",
    }),
  paySettlement: (id: string) =>
    request<Settlement>(`/admin/settlements/${id}/pay`, { method: "POST" }),
  /** IKB5PA：status 过滤（pending/approved/rejected/cancelled，状态 Tab 用）。 */
  leaveRequests: (query?: ListQuery, status?: string) =>
    request<PagedResponse<LeaveRequest>>(
      `/admin/leave-requests${withQuery(
        status ? `status=${status}` : "",
        listQuery(query),
      )}`,
    ),
  /** IKB5PA：status 过滤（invited/accepted/rejected/cancelled，状态 Tab 用）。 */
  dispatchInvitations: (query?: ListQuery, status?: string) =>
    request<PagedResponse<DispatchInvitation>>(
      `/admin/dispatch-invitations${withQuery(
        status ? `status=${status}` : "",
        listQuery(query),
      )}`,
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
    /** 楼长月度底薪（IKDOIU，分）：0 = 无底薪。 */
    buildingManagerBaseSalary?: number;
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
      buildingManagerBaseSalary?: number;
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
  adminCreateCategory: (data: {
    name: string;
    sort?: number;
    image?: string;
    hidden?: boolean;
  }) =>
    request<Category>("/admin/categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminUpdateCategory: (
    id: string,
    data: { name?: string; sort?: number; image?: string; hidden?: boolean },
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
  /** 寝室批量导入（IKD6FH）：multipart 不可复用通用 request（写死 JSON 头会
   *  破坏 FormData 边界），单独走 fetch，鉴权与 401 行为同 uploadImage。 */
  importRooms: async (
    buildingId: string,
    file: File,
  ): Promise<RoomImportResult> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(
      `/api/v1/admin/buildings/${buildingId}/rooms/import`,
      {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      },
    );
    if (response.status === 401) {
      clearSession();
      token = "";
      window.location.hash = "#/login";
      throw new Error("登录已失效，请重新登录");
    }
    const body = (await response.json().catch(() => null)) as ApiResult<
      RoomImportResult
    > | null;
    if (!response.ok || !body)
      throw new Error(body?.message || `导入失败（${response.status}）`);
    return body.data;
  },
  /** IKB5PA：status 过滤（active/paused，状态 Tab 用）。 */
  coupons: (query?: ListQuery, status?: string) =>
    request<PagedResponse<Coupon>>(
      `/admin/coupons${withQuery(
        status ? `status=${status}` : "",
        listQuery(query),
      )}`,
    ),
  /** amount / threshold 为整数分（表单输元，经 yuanToFen 转换后提交）。
   *  IKDCVO：kind/trigger/remark 可选；expiresAt 空 = 长期有效；
   *  partner 异业券 amount/threshold 固定传 0；
   *  IKDEN2：total 不传 = 不限量。 */
  createCoupon: (data: {
    name: string;
    amount: number;
    threshold: number;
    total?: number;
    expiresAt?: string;
    kind?: "platform" | "partner";
    trigger?: "manual" | "lottery" | "signup";
    remark?: string;
    /** 支付后推荐（支付成功页领券卡） */
    featuredAfterPay?: boolean;
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
  /** 优惠券编辑（IKDERC）：全字段可选；已发放券面额/门槛后端锁定，
   *  total/expiresAt 传 null = 转不限量/长期。 */
  updateCoupon: (
    id: string,
    data: Partial<{
      status: "active" | "paused";
      name: string;
      remark: string;
      /** 支付后推荐（支付成功页领券卡） */
      featuredAfterPay?: boolean;
      amount: number;
      threshold: number;
      total: number | null;
      expiresAt: string | null;
    }>,
  ) =>
    request<Coupon>(`/admin/coupons/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  /** 优惠券删除（IKDES1）：仅未发放（claimed=0）可删，后端同口径校验。 */
  deleteCoupon: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/admin/coupons/${id}`, {
      method: "DELETE",
    }),
  /** 定向发放（IKD6FI）：userIds 与定向条件（手机号 / 楼栋楼层寝室）至少一种，
   *  后端并集去重，返回实发张数。 */
  issueCoupon: (
    id: string,
    data: {
      userIds?: string[];
      phones?: string[];
      buildingId?: string;
      floor?: number;
      roomNos?: string[];
    },
  ) =>
    request<{ issued: number; targets: string[]; couponId: string }>(
      `/admin/coupons/${id}/issue`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  /* ---------- 营销地图（IKD6FI）：楼栋×楼层×寝室下单聚合 ---------- */
  /** hq 跨校区视角需带 campus（未选校区时后端 400 提示先选校区）。 */
  marketingMap: (buildingId: string, days: number, campusId?: string) =>
    request<MarketingMapData>(
      `/admin/marketing/map${withQuery(
        `buildingId=${encodeURIComponent(buildingId)}`,
        `days=${days}`,
        campusId ? `campus=${encodeURIComponent(campusId)}` : "",
      )}`,
    ),
  /** 首页 Banner（IK9RX2）：营销活动板块内 tab 管理。
   *  IKB5PB：placement 过滤（支付广告位菜单只看 pay-success）；
   *  IKB5PA：status 过滤（启用/隐藏 Tab）。 */
  banners: (query?: ListQuery, placement?: string, status?: string) =>
    request<PagedResponse<Banner>>(
      `/admin/banners${withQuery(
        placement ? `placement=${placement}` : "",
        status ? `status=${status}` : "",
        listQuery(query),
      )}`,
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
  /* ---------- 楼长招募（IKEAGE）：报名审批全流程 ---------- */
  /** 报名列表（status 过滤即状态 Tab；keyword 搜姓名/手机号；campus 跨校区筛选）。 */
  recruitApplications: (query?: ListQuery, status?: string) =>
    request<PagedResponse<RecruitingApplication>>(
      `/admin/recruit-applications${withQuery(
        status ? `status=${encodeURIComponent(status)}` : "",
        listQuery(query),
      )}`,
    ),
  /** 状态 Tab 角标：原始状态→数量。 */
  recruitStatusCounts: (campusId?: string) =>
    request<Record<string, number>>(
      `/admin/recruit-applications/status-counts${withQuery(
        campusId ? `campus=${encodeURIComponent(campusId)}` : "",
      )}`,
    ),
  /** 身份证等资料补录（IKEAGE：运营线下收集后代录，C 端不采集）。 */
  updateRecruitApplication: (
    id: string,
    data: { idCardNo?: string; idCardImages?: string[]; staffRemark?: string },
  ) =>
    request<RecruitingApplication>(`/admin/recruit-applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  /** pending → interviewing（标记面试中）。 */
  recruitTransition: (id: string) =>
    request<RecruitingApplication>(
      `/admin/recruit-applications/${id}/transition`,
      { method: "POST" },
    ),
  /** 拒绝报名：原因必填（C 端进度页展示）。 */
  rejectRecruit: (id: string, reason: string) =>
    request<RecruitingApplication>(
      `/admin/recruit-applications/${id}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  /** 通过并自动创建实习楼长（工号 IBM-xxx，骑手小程序工号+姓名登录）。 */
  approveRecruit: (id: string) =>
    request<{
      application: RecruitingApplication;
      staff: { id: string; staffNo: string; name: string };
    }>(`/admin/recruit-applications/${id}/approve`, { method: "POST" }),
  /** 促销活动（ADR-0006 / IKAHFF）：price 为促销价（分），无删除（留审计）。 */
  /** IKB5PA：state 过滤（live/upcoming/ended/disabled，按时间窗判定）。 */
  promotions: (query?: ListQuery, state?: string) =>
    request<PagedResponse<Promotion>>(
      `/admin/promotions${withQuery(
        state ? `state=${state}` : "",
        listQuery(query),
      )}`,
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
  /** 查看用户明文手机号（IKDG8V）：列表恒脱敏，按需单查 + 后端审计留痕。 */
  revealUserPhone: (id: string) =>
    request<{ id: string; phone: string }>(`/admin/users/${id}/phone`),
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
    /** IKB3KG 方案A：可运营校区全集（仅 hq 生效；缺省=[campusId]）。 */
    campusIds?: string[];
  }) =>
    request<AdminAccount>("/admin/accounts", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAccount: (
    id: string,
    data: {
      nickname?: string;
      role?: string;
      password?: string;
      /** IKB3KG 方案A：整体替换可运营校区（仅 hq 生效）。 */
      campusIds?: string[];
    },
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
  /** IKB3KG 方案A：我的可运营校区（>1 时顶栏出现切换下拉）。 */
  adminCampuses: () =>
    request<
      { id: string; name: string; shortName: string; current: boolean }[]
    >("/auth/admin/campuses"),
  /** IKB3KG 方案A：切换运营校区（授权范围内），换发 token 后整页刷新。 */
  switchAdminCampus: async (campusId: string) => {
    const result = await request<LoginResult>("/auth/admin/campuses/select", {
      method: "POST",
      body: JSON.stringify({ campusId }),
    });
    token = result.token;
    localStorage.setItem("adminToken", token);
    return result;
  },
  /* ---------- 校区打印机（IKBW0Q）：绑定/测试打印/解绑 ---------- */
  /** 本校区打印机（一校区一台，未绑定为空数组）。 */
  printers: () => request<Printer[]>("/admin/printers"),
  /** 绑定/换绑（upsert 本校区记录；后端先把终端加进芯烨云账号）。
   *  IKC3FF：芯烨云无按台密钥，只凭 SN。 */
  bindPrinter: (data: {
    name: string;
    sn: string;
    copies?: number;
    /** 联间发送间隔秒数（IKFFHO）：0=连续；1-10 逐联推送。 */
    copiesGapSeconds?: number;
  }) =>
    request<Printer>("/admin/printers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  unbindPrinter: (id: string) =>
    request<Printer>(`/admin/printers/${id}`, { method: "DELETE" }),
  testPrintPrinter: (id: string) =>
    request<{ printed: boolean; sn: string }>(
      `/admin/printers/${id}/test-print`,
      { method: "POST", body: "{}" },
    ),
  /* ---------- 抽奖大转盘（IKD6FC）：单校区单配置 ---------- */
  wheel: () => request<WheelConfig>("/admin/wheel"),
  upsertWheel: (data: { active: boolean; prizes: WheelPrizeInput[] }) =>
    request("/admin/wheel", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
