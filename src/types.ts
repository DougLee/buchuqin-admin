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
  /** 楼栋筛选（IKAJSW 用户列表）。 */
  buildingId?: string;
  /** 校区筛选（IKAJSL：hq 跨校区视角选单校区；校区角色后端忽略）。 */
  campusId?: string;
  /** 逗号状态过滤（IKB3K9 商品状态 Tab；订单走独立 status 路径参数）。 */
  status?: string;
  /** 分类筛选（IKD6FG：商品库/库存列表）。 */
  categoryId?: string;
  /** 配送方式筛选（IKD6FG：订单列表，instant/scheduled）。 */
  deliveryMode?: string;
  /** 角色筛选（IKD6FG：履约人员列表）。 */
  role?: string;
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
  /** 在小程序显示（IKC9M4 类目开关）：false = C 端全链路隐藏该类目及其商品 */
  hidden?: boolean;
}

export interface Product {
  id: string;
  barcode: string | null;
  campusId: string;
  categoryId: string;
  name: string;
  subtitle: string;
  /** 售价（分）：官方行=批发价格，校区行=实际售价（IKC1AC）。 */
  price: number;
  /** 建议零售价（分）。 */
  originalPrice: number;
  /** 进货价（分，IKC1AC）：总部专用，校区视角不可见。 */
  costPrice?: number;
  /** 批发价格（分，IKC1AC）：校区行为导入/拉取时的官方批发价快照。 */
  wholesalePrice?: number;
  stock: number;
  lockedStock: number;
  sales: number;
  tag: string;
  image: string;
  /** 详情多图（IK9SNS）：COS URL 数组，顺序即详情页轮播顺序；空回退头图。 */
  images?: string[] | null;
  /** 库位（IK9U40）：区域代码+序号（如 冷A-03），拣货指引。 */
  location?: string;
  /** 库位编号（IKA0VG）：与区域拼接展示（零食区-001）；订单回查实时库位用。 */
  locationCode?: string;
  /** 单位属性（IKFOPU）：零售单位空 = 不显示单位文字；含量=件含零售数。 */
  retailUnit?: string;
  wholesaleUnit?: string;
  unitsPerCase?: number;
  weight: number;
  /** 商品介绍（IKAHAU）：纯文本 ≤2000 字，空串/null = 详情页不渲染。 */
  description?: string | null;
  status: string;
  skuNo: string;
  actualStock: number;
  availableStock: number;
  warehouse?: string;
  batchNo?: string;
  expiryDate?: string;
  warning?: boolean;
  /** 官方库来源（IKAJSO）：本校区行来自官方库哪个商品；自建/历史商品为空。 */
  sourceProductId?: string | null;
  /** 上游已更新（IKAJSO）：官方库资料晚于本校区同步时间，可一键拉取。 */
  upstreamChanged?: boolean;
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
  /** IKAJSL：跨校区列表的校区列（单校区视角冗余）。 */
  campusName?: string;
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
  /** IKA57P：配送单号概念已下线（做多单合并配送时再启用），后台仅显订单号。 */
  packageNo?: string;
  userPhone?: string;
  address?: OrderAddress;
  items?: OrderItem[];
  /** 履约凭证快照（IKA57U）：交接拍照 / 送达凭证由履约端写入 package JSON。 */
  package?: {
    handoverProof?: { images?: string[]; time?: string };
    deliveredProof?: { images?: string[]; remark?: string; time?: string };
  } | null;
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
  /** IKAJSL：总部视角列表的投放范围（空 campusId = 全部校区）。 */
  campusName?: string;
  title: string;
  subtitle: string;
  badge: string;
  color: string;
  image: string | null;
  /** 详情长图（IKC1AD）：点击 Banner 进详情页通铺展示；空 = 不可点。 */
  detailImage?: string | null;
  /** 旧版逐行文字详情（IK9SNN），保留兼容。 */
  content?: string | null;
  /** 展示位置（IKA57F）：home 首页轮播 / pay-success 支付成功页广告位。 */
  placement?: "home" | "pay-success";
  /** 点击跳转（IKE9YC）：none 无 / page 站内页面；配置后优先于图文详情。 */
  linkType?: "none" | "page";
  /** 站内页面路径（支持带参，如 pages/product/detail?id=xxx）。 */
  linkUrl?: string;
  sort: number;
  status: string;
}

/** 楼长招募报名（IKEAGE）：C 端报名 → 后台联系面试/补录身份证 → 审批通过创建实习楼长 */
export interface RecruitingApplication {
  id: string;
  campusId: string;
  /** 后端列表附带（跨校区视角辨识） */
  campusName?: string;
  buildingId: string;
  buildingName: string;
  name: string;
  phone: string;
  /** 报名备注（候选人自我介绍） */
  note: string;
  /** 运营备注（面试评价等，admin 补录；与候选人自我介绍 note 相互独立） */
  staffRemark: string;
  /** pending 待联系 | interviewing 面试中 | approved 已通过 | rejected 已拒绝 */
  status: "pending" | "interviewing" | "approved" | "rejected";
  /** 拒绝原因（C 端进度页可见） */
  rejectReason: string;
  /** 身份证号（运营线下收集后台代录，C 端不采集） */
  idCardNo: string;
  /** 身份证照片 URL 数组（后台代录） */
  idCardImages: string[] | null;
  /** approved 时附带：创建的实习楼长工号（骑手小程序登录凭证） */
  staffNo?: string;
  createdAt: string;
  updatedAt?: string;
}

/** 校区打印机（IKBW0Q）：一校区一台小票机（芯烨云终端）。 */
export interface Printer {
  id: string;
  campusId: string;
  /** 归属校区（IKC1AF：列表/编辑页展示）。 */
  campusName?: string;
  name: string;
  sn: string;
  /** 预留列（IKC3FF：芯烨云无按台密钥，恒为空串）。 */
  key: string;
  /** 小票联数（IKCZOX）：1=单联无联名；2=商家联+骑手联；3=再加用户联。 */
  copies: number;
  /** 联间发送间隔秒数（IKFFHO）：0=连续出纸（单次 POST 拼联）；1-10 逐联推送。 */
  copiesGapSeconds: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}
/** 促销活动（ADR-0006 / IKAHFF）：type 区分秒杀/临期，price 为促销价（分）。 */
export interface Promotion {
  id: string;
  productId: string;
  type: "seckill" | "clearance";
  /** 促销价，单位：分 */
  price: number;
  startsAt: string;
  endsAt: string;
  /** active 生效 | disabled 运营停用 */
  status: string;
  createdAt: string;
  product?: {
    id: string;
    name: string;
    image: string;
    /** 商品现价，单位：分 */
    price: number;
    status: string;
  };
}
export interface Coupon {
  id: string;
  campusId: string;
  name: string;
  /** 券品种（IKDCVO）：platform 金额券下单抵扣 | partner 异业券到店展示暂不核销。 */
  kind: "platform" | "partner";
  /** 发放方式：manual 手动领取 | lottery 转盘 | signup 注册自动发。 */
  trigger: "manual" | "lottery" | "signup";
  /** 优惠说明（异业券到店权益等）。 */
  remark: string;
  /** 面额（分）。partner 券恒为 0。 */
  amount: number;
  /** 使用门槛（分）。partner 券恒为 0。 */
  threshold: number;
  /** 发放总量；null = 不限量（IKDEN2）。 */
  total: number | null;
  status: string;
  /** 过期时间；null = 长期有效（IKDCVO）。 */
  expiresAt: string | null;
  /** 支付后推荐（道哥 2026-09-08）：支付成功页领券卡展示。 */
  featuredAfterPay: boolean;
  issued: number;
  claimed: number;
  used: number;
  /** 剩余可发；null = 不限量（IKDEN2）。 */
  remain: number | null;
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
  /** 操作人人话化（IKDHKE）：AdminAccount 昵称/账号名，miss 回退 operator 原值 */
  operatorName?: string;
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
  /** 请假期间调配方式（IK9U4B）：self=自己联系代班，platform=平台派单。 */
  dispatchMode?: string;
  /** 自己调配指定的代班楼长（IKA57Y）：id + 姓名快照。 */
  substituteStaffId?: string | null;
  substituteName?: string | null;
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
  /** IKAJSL：hq 视角附校区名（空 campusId = 总部）。 */
  campusName?: string;
  /** IKB3KG 方案A：可运营校区全集（campusId=当前登录校区）。 */
  campusIds?: string[];
}
/** 账号管理板块表格行：附角色中文文案。 */
export type AccountRow = AdminAccount & { roleText: string };

/** C 端用户（IKAJSW 聚合列表；手机/openid 脱敏口径同后端）。 */
export interface AdminUser {
  id: string;
  nickname: string;
  openidMasked: string;
  phoneMasked: string;
  buildingName: string;
  room: string;
  createdAt: string;
  orderCount: number;
  /** 累计消费（分，有效支付单）。 */
  totalSpend: number;
}

/** C 端用户统计（IKAJSW）。 */
export interface UserStats {
  total: number;
  todayNew: number;
  monthActive: number;
  avgOrders: number;
  /** 企微绑定率（预留，接入企微 API 后供数）。 */
  wechatWorkBindRate: number | null;
}

/** 用户订单流水（IKAJSW 详情抽屉）。 */
export interface UserOrderRow {
  id: string;
  orderNo: string;
  status: string;
  statusText: string;
  /** 实付（分）。 */
  payableAmount: number;
  createdAt: string;
}

/** 微信群码（IKAJSY：buildingId 空 = 校级大群）。 */
export interface WechatGroup {
  id: string;
  campusId: string;
  buildingId: string;
  buildingName: string;
  image: string;
  updatedAt: string;
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
  /** IKB5PA：状态中文（待处理/已取消），列表状态列用。 */
  statusText?: string;
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
  /** IKAJSS：直达路由用（order/promotion/product/staff/...）。 */
  entityType?: string;
  orderNo?: string;
}

/** 水位节点下钻（IKAJSS）：作业人数 + 平均停留分钟（自支付起算）。 */
export interface FulfillmentNodeDetail {
  staff: number;
  avgMinutes: number | null;
}

/** 超时单（IKAJSS Top5）：工作台直达处理。 */
export interface TimeoutOrder {
  id: string;
  orderNo: string;
  overtimeMinutes: number;
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

/** hq 跨校区汇总看板（IKAJSL）：每校区今日概览 + 总部合计。 */
export interface HqDashboardData {
  campusRows: Array<{
    campusId: string;
    name: string;
    shortName: string;
    status: string;
    buildings: number;
    revenue: number;
    orders: number;
    newUsers: number;
    exceptions: number;
  }>;
  kpis: {
    revenue: number;
    orders: number;
    newUsers: number;
    exceptions: number;
    campuses: number;
  };
  caliber: Record<string, string>;
}

export interface DashboardData {
  campus: Campus;
  updatedAt: string;
  kpis: DashboardKpis;
  caliber: Record<string, string>;
  trend: TrendPoint[];
  activities: DashboardActivity[];
  fulfillment: Record<string, number>;
  /** IKAJSS：水位节点下钻数据。 */
  fulfillmentDetail: Record<string, FulfillmentNodeDetail>;
  timeoutOrders: TimeoutOrder[];
  hotBuildings: HotBuilding[];
}

export interface BarcodeLookup {
  found: boolean;
  exists?: boolean;
  /** product-database 本校区库内 | official-library 官方库命中（IKAJSO 导入入口）| open-food-facts | manual */
  source?: string;
  product: Partial<Product>;
}

/* ---------- 表格通用行（各板块行类型的并集） ---------- */

export type AdminRow =
  | Product
  | Order
  | Staff
  | Coupon
  | Banner
  | Promotion
  | Printer
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
  | WechatGroup
  /* IKEAGE：楼长招募报名行 */
  | RecruitingApplication
  /* 扁平化视图行 */
  | LeaveRow
  | DispatchRow
  | RuleRow
  | AfterSaleRow
  | AccountRow
  | CategoryRow
  | WheelRow;

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
  /** 调配方式文案（IK9U4B）。 */
  dispatchModeText: string;
  /** 代班楼长姓名（IKA57Y），未指定为 —。 */
  substituteText: string;
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

/* ---------- 抽奖大转盘（IKD6FC） ---------- */
export interface WheelPrize {
  type: "coupon" | "partner" | "none";
  label: string;
  couponId?: string;
  bizTitle?: string;
  bizImage?: string;
  bizNote?: string;
  weight: number;
  /** GET /admin/wheel 附加读视图。 */
  couponName?: string;
  couponLeft?: number | null;
  weightPct?: number;
}
export interface WheelConfig {
  active: boolean;
  prizes: WheelPrize[];
}
export type WheelPrizeInput = WheelPrize;

/* 抽奖转盘奖位行（IKD6FC）：单例配置展开的 8 行视图 */
export interface WheelRow {
  /** 行键：奖位序号派生（单例配置无真实 id）。 */
  id: string;
  index: number;
  typeText: string;
  label: string;
  content: string;
  weight: number;
  weightPct: number;
  active: boolean;
}

/* ---------- 寝室批量导入（IKD6FH） ---------- */

/** 导入结果：合法行照常入库，行级错误（楼层非法/寝室号空）收集进 errors。 */
export interface RoomImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

/* ---------- 盘点校准与采购申请（IKD6FJ） ---------- */

/** 盘点校准结果：delta = 实际-账面差额；账实相符（delta=0）时 applied=false 不落流水。 */
export interface StocktakeResult {
  productId: string;
  before: number;
  countedQty: number;
  delta: number;
  applied: boolean;
}

/** 采购申请行：后端全量返回（take 200 倒序，非分页信封）。 */
export interface PurchaseRequest {
  id: string;
  campusId: string;
  /** hq 跨校区视角的校区名。 */
  campusName: string;
  productId: string;
  productName: string;
  productStock: number;
  quantity: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  applyByName: string;
  auditByName: string;
  auditNote: string;
  createdAt: string;
  auditedAt: string;
}

/* ---------- 营销地图（IKD6FI）：楼栋×楼层×寝室下单聚合 ---------- */

export interface MarketingMapRoom {
  room: string;
  orders: number;
  /** 金额（分）。 */
  amount: number;
  users: number;
}

export interface MarketingMapFloor {
  floor: number;
  orders: number;
  /** 金额（分）。 */
  amount: number;
  rooms: MarketingMapRoom[];
}

export interface MarketingMapData {
  building: { id: string; name: string };
  days: number;
  totals: {
    orders: number;
    /** 金额（分）。 */
    amount: number;
  };
  floors: MarketingMapFloor[];
}
