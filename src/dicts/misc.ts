/**
 * 杂项字典（IKIYMM 字典集中化）：纯搬移，文案与原定义逐字一致。
 */

/** 宿舍性别（原 display() 内联 map，楼栋管理板块） */
export const DORM_GENDER_TEXT: Record<string, string> = {
  male: "男生",
  female: "女生",
  mixed: "混合",
};

/** 作战地图寝室三色（原 BattleMapPage.STATUS_TEXT 落地改名防碰撞） */
export const BATTLE_ROOM_STATUS_TEXT: Record<string, string> = {
  ordered: "已下单",
  registered: "注册未下单",
  fresh: "未开发",
};

/** RBAC 节点类型（原 RolesPage.TYPE_TEXT 落地改名防碰撞） */
export const MENU_TYPE_TEXT: Record<number, string> = {
  0: "目录",
  1: "菜单",
  2: "按钮",
};

/* IKAJSS：动态流直达路由——按 entityType（订单/促销/商品/员工/群码…）跳对应处理页。
 *  IKBDK7：营销拆分后 promotion/coupon 直达新菜单（旧 /marketing 仅剩历史深链兼容）。
 *  （原 Dashboard.ACTIVITY_ROUTES 搬入） */
export const ACTIVITY_ROUTES: Record<string, string> = {
  order: "/orders",
  promotion: "/promotions",
  product: "/products",
  staff: "/staff",
  "wechat-group": "/wechat-groups",
  coupon: "/coupons",
  banner: "/banners",
  "admin-account": "/accounts",
  campus: "/campuses",
  building: "/campuses",
  "after-sale": "/after-sales",
};

/* IKB3KE：水位命名与订单配送 Tab/状态机文案统一（同桶同名），
   超时是横向监控指标非订单状态。（原 Dashboard.FLOW_LABELS 搬入） */
export const FLOW_LABELS: Record<string, string> = {
  waitingPick: "待出库",
  waitingFirstMile: "待配送员接单",
  firstMile: "骑手配送中",
  waitingHandover: "楼下待交接",
  lastMile: "楼长送往寝室",
  delivered: "已送达",
  timeout: "履约超时",
};
