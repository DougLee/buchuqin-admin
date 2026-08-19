/**
 * 管理后台领域类型 —— 字段以 buchuqin-api /api/v1 实测响应为准
 * （2026-08-17 curl，契约见 buchuqin-api/docs/MILESTONE_API.md）。
 * 金额契约：全部金额字段为整数「分」，展示经 utils/money.fenToYuan、
 * 表单提交经 yuanToFen，禁止在业务代码裸除/乘 100。
 */

/** 服务端分页参数。 */
export interface PageQuery {
  page: number;
  pageSize: number;
}

/**
 * 列表请求参数（IK8W5X 契约）：page/pageSize 分页透传；
 * keyword 随请求发送，后端未实现 keyword 过滤前由前端对当前页兜底（见 DataPage TODO）。
 */
export interface ListQuery extends PageQuery {
  keyword?: string;
}

/** 列表统一分页响应（IK8W5X 契约：所有列表接口返回该结构）。 */
export interface PagedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Campus {
  id: string;
  name: string;
  shortName: string;
  warehouseName: string;
  address: string;
  status: string;
  createdAt: string;
  buildings: number;
  rooms: number;
  users: number;
}

/** 商品类别（全局字典，2026-08-19 类别管理）。productCount 为关联商品数，image 为类别图（IK9RX0）。 */
export interface Category {
  id: string;
  name: string;
  sort: number;
  image: string;
  productCount?: number;
}

export interface Product {
  id: string;
  barcode: string | null;
  campusId: string;
  categoryId: string;
  name: string;
  subtitle: string;
  /** 售价（分）。 */
  price: number;
  /** 建议零售价（分）。 */
  originalPrice: number;
  stock: number;
  lockedStock: number;
  sales: number;
  tag: string;
  image: string;
  weight: number;
  status: string;
  skuNo: string;
  actualStock: number;
  availableStock: number;
  warehouse?: string;
  batchNo?: string;
  expiryDate?: string;
  warning?: boolean;
}

export interface OrderAddress {
  buildingName: string;
  room: string;
  floor: number;
  contactName: string;
  phone: string;
}

export interface OrderItem {
  product: Partial<Product>;
  quantity: number;
}

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  campusId: string;
  status: string;
  statusText: string;
  createdAt: string;
  paidAt: string | null;
  deliveryMode: string;
  remark: string;
  totalQuantity: number;
  /** 实付金额（分）。 */
  payableAmount: number;
  /** 商品金额（分）。 */
  productAmount?: number;
  /** 运费（分）。 */
  deliveryFee?: number;
  /** 优惠金额（分）。 */
  discount?: number;
  estimatedArrival: string;
  packageNo: string;
  userPhone?: string;
  address?: OrderAddress;
  items?: OrderItem[];
}

export interface Staff {
  id: string;
  campusId: string;
  name: string;
  role: string;
  roleText: string;
  staffNo: string;
  buildingId: string | null;
  building: string | null;
  status: string;
  completedToday: number;
  onTimeRate: number;
  proofRate?: number;
  income?: number;
  online: boolean;
  buildingRef?: Building;
}

/** 首页 Banner（IK9RX2）：后台管理视图，color 为预置主题键或自定义 hex。 */
export interface Banner {
  id: string;
  campusId: string;
  title: string;
  subtitle: string;
  badge: string;
  color: string;
  image: string | null;
  sort: number;
  status: string;
}
export interface Coupon {
  id: string;
  campusId: string;
  name: string;
  /** 面额（分）。 */
  amount: number;
  /** 使用门槛（分）。 */
  threshold: number;
  total: number;
  status: string;
  expiresAt: string;
  issued: number;
  claimed: number;
  used: number;
  remain: number;
}

export interface Building {
  id: string;
  name: string;
  floors: number;
  hasElevator: boolean;
  gender: string;
  roomsCount?: number;
  staffName?: string | null;
  status?: string;
}

export interface Room {
  id: string;
  floor: number;
  roomNo: string;
  qrToken: string;
}

export interface InventoryTxn {
  id: string;
  productId: string;
  type: string;
  quantity?: number;
  delta?: number;
  reason: string;
  operator: string;
  createdAt: string;
  product?: { id: string; name: string };
}

/** 月度账单（BmBill 物化）。 */
export interface Settlement {
  id: string;
  staffId: string;
  staffName: string;
  staffNo?: string;
  roleText: string;
  period: string;
  /** 底薪（分）。 */
  baseSalary: number;
  /** 提成合计（分）。 */
  commissionTotal: number;
  /** 调整项（分）。 */
  adjustment: number;
  /** 应结（分）。 */
  payable: number;
  status: "pending-review" | "confirmed" | "paid";
  confirmedAt?: string | null;
  paidAt?: string | null;
}

/** 提成规则（维度 null=通配）。 */
export interface CommissionRule {
  id: string;
  campusId: string;
  buildingId: string | null;
  floor: number | null;
  weightFrom: number | null;
  weightTo: number | null;
  mode: "instant" | "scheduled" | null;
  /** 提成单价（分/单）。 */
  price: number;
  version: number;
  status: "active" | "disabled";
  effectiveAt: string;
  createdAt: string;
}

export interface LeaveStaff {
  id: string;
  name: string;
  role: string;
  roleText: string;
  staffNo: string;
  building: string | null;
  buildingId: string | null;
}

export interface LeaveRequest {
  id: string;
  staffId: string;
  startAt: string;
  endAt: string;
  reason: string;
  status: string;
  statusText: string;
  createdAt: string;
  staff: LeaveStaff;
}

export interface DispatchStaff {
  id: string;
  name: string;
  roleText: string;
  staffNo: string;
}

export interface DispatchInvitation {
  id: string;
  staffId: string;
  buildingId: string | null;
  building: string | null;
  startAt: string;
  endAt: string;
  /** 调配奖励（分）。 */
  reward: number;
  status: string;
  statusText: string;
  createdAt: string;
  staff?: DispatchStaff;
}

export interface AuditLog {
  id: string;
  campusId: string;
  operator: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

/** 后台账号（IK9KWO）：后端不下发 passwordHash。 */
export interface AdminAccount {
  id: string;
  username: string;
  nickname: string;
  role: string;
  campusId: string;
  createdAt: string;
}
/** 账号管理板块表格行：附角色中文文案。 */
export type AccountRow = AdminAccount & { roleText: string };

export interface AdminUser {
  id: string;
  nickname: string;
  phone: string;
}

export interface AfterSale {
  id: string;
  userId: string;
  orderId: string;
  type: string;
  description: string;
  images: string[];
  status: string;
  createdAt: string;
  order?: Order;
}

/**
 * 售后列表扁平化视图行（IK97FJ）：typeText 为类型中文文案
 * （映射表见 DataPage AFTER_SALE_TYPE_TEXT，未命中 fallback 原值）。
 */
export interface AfterSaleRow {
  id: string;
  userId: string;
  orderId: string;
  type: string;
  typeText: string;
  description: string;
  images: string[];
  status: string;
  createdAt: string;
  order?: Order;
}

/* ---------- 看板 ---------- */

export interface TrendPoint {
  date: string;
  orders: number;
  /** 支付金额（分）。 */
  paidAmount: number;
  newUsers: number;
}

export interface DashboardActivity {
  time: string;
  text: string;
  type: string;
}

export interface HotBuilding {
  name: string;
  orders: number;
  /** 成交金额（分）。 */
  revenue: number;
  completionRate: number;
  onTimeRate: number;
}

export interface DashboardKpis {
  /** 今日支付金额（分）。 */
  revenue: number;
  orders: number;
  paidUsers: number;
  newUsers: number;
  /** 今日退款金额（分）。 */
  refundedAmount: number;
  fulfillmentRate: number;
  exceptions: number;
  onTimeRate: number;
}

export interface DashboardData {
  campus: Campus;
  updatedAt: string;
  kpis: DashboardKpis;
  caliber: Record<string, string>;
  trend: TrendPoint[];
  activities: DashboardActivity[];
  fulfillment: Record<string, number>;
  hotBuildings: HotBuilding[];
}

export interface BarcodeLookup {
  found: boolean;
  exists?: boolean;
  product: Partial<Product>;
}

/* ---------- 表格通用行（各板块行类型的并集） ---------- */

export type AdminRow =
  | Product
  | Order
  | Staff
  | Coupon
  | Banner
  | Building
  | Room
  | InventoryTxn
  | Settlement
  | CommissionRule
  | LeaveRequest
  | DispatchInvitation
  | AuditLog
  | AdminUser
  | AfterSale
  | Campus
  /* 扁平化视图行 */
  | LeaveRow
  | DispatchRow
  | RuleRow
  | AfterSaleRow
  | AccountRow
  | CategoryRow;

/* 类别字典表格行（name/sort 全局字典 + 派生商品数 + 类别图 IK9RX0） */
export interface CategoryRow {
  id: string;
  name: string;
  sort: number;
  image: string;
  productCount: number;
}

/* ---------- 调配与请假 / 提成规则的扁平化视图行 ---------- */

export interface LeaveRow {
  id: string;
  staffName: string;
  staffNo: string;
  building: string;
  buildingId: string | null;
  startAt: string;
  endAt: string;
  reason: string;
  status: string;
  statusText: string;
}

export interface DispatchRow {
  id: string;
  staffName: string;
  roleText: string;
  building: string;
  startAt: string;
  endAt: string;
  /** 调配奖励（分）。 */
  reward: number;
  status: string;
  statusText: string;
}

export interface RuleRow extends CommissionRule {
  buildingName: string | null;
  weightRange: string;
  modeText: string;
}
