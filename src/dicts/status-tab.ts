/**
 * 状态 Tab 值域（IKIYMM 字典集中化）：key=前端过滤值，statuses=服务端逗号状态集。
 * 纯搬移重构——label 文案与 statuses 与原 DataPage 内定义逐字一致。
 */
export interface StatusTab {
  key: string;
  label: string;
  statuses: string[];
}

/** 拣货任务（仓储中心）：paid+picking 合并为「全部」 */
export const PICKING_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: ["paid", "picking"] },
  { key: "paid", label: "待出库", statuses: ["paid"] },
  { key: "picking", label: "拣货中", statuses: ["picking"] },
];

/** 订单配送：9 tab 聚合 13 个原始状态（delivering 为前端聚合桶） */
export const ORDER_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending-payment", label: "待支付", statuses: ["pending-payment"] },
  { key: "awaiting-outbound", label: "待出库", statuses: ["paid", "picking"] },
  {
    key: "delivering",
    label: "配送中",
    statuses: ["waiting-first-mile", "first-mile", "last-mile"],
  },
  {
    key: "waiting-handover",
    label: "楼下待交接",
    statuses: ["waiting-handover"],
  },
  { key: "delivered", label: "已送达", statuses: ["delivered"] },
  { key: "completed", label: "已完成", statuses: ["completed"] },
  {
    key: "closed",
    label: "取消/退款",
    statuses: ["cancelled", "refunded"],
  },
  /* 异常独立成桶：工作台「待处理异常」直达定位（?status=exception），
     混在取消/退款里按时间倒序翻不到 */
  { key: "exception", label: "异常", statuses: ["exception"] },
];

/* IKB3K9：商品状态 Tab（口径含售罄映射——在售但库存 0 = 售罄）。 */
export const PRODUCT_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "on-sale", label: "在售", statuses: ["on-sale"] },
  { key: "off-sale", label: "已下架", statuses: ["off-sale"] },
  { key: "sold-out", label: "售罄", statuses: ["sold-out"] },
];

/* 官方库 Tab 无售罄（库存归校区，官方行不参与售罄映射）。 */
export const HQ_PRODUCT_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "on-sale", label: "在售", statuses: ["on-sale"] },
  { key: "off-sale", label: "已下架", statuses: ["off-sale"] },
];

/** 调配与请假（请假审核状态） */
export const LEAVE_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending", label: "待审核", statuses: ["pending"] },
  { key: "approved", label: "已通过", statuses: ["approved"] },
  { key: "rejected", label: "已驳回", statuses: ["rejected"] },
  { key: "cancelled", label: "已撤销", statuses: ["cancelled"] },
];

/** 跨楼调配邀请 */
export const INVITE_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "invited", label: "待响应", statuses: ["invited"] },
  { key: "accepted", label: "已接受", statuses: ["accepted"] },
  { key: "rejected", label: "已拒绝", statuses: ["rejected"] },
  { key: "cancelled", label: "已取消", statuses: ["cancelled"] },
];

/** 促销 Tab（IKB5PA）：key 即后端 state 过滤值（时间窗读时判定）。 */
export const PROMOTION_STATE_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "live", label: "进行中", statuses: ["live"] },
  { key: "upcoming", label: "未开始", statuses: ["upcoming"] },
  { key: "ended", label: "已结束", statuses: ["ended"] },
  { key: "disabled", label: "已停用", statuses: ["disabled"] },
];

/** 员工账号（Staff.status 三态） */
export const STAFF_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "online", label: "在线", statuses: ["online"] },
  { key: "paused", label: "暂停", statuses: ["paused"] },
  { key: "offline", label: "离线", statuses: ["offline"] },
];

/** 售后审核（after-sales 板块可见态） */
export const AFTER_SALE_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending", label: "待处理", statuses: ["pending"] },
  { key: "cancelled", label: "已取消", statuses: ["cancelled"] },
];

/** 优惠券 */
export const COUPON_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "active", label: "发放中", statuses: ["active"] },
  { key: "paused", label: "已暂停", statuses: ["paused"] },
];

/** Banner */
export const BANNER_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "active", label: "启用", statuses: ["active"] },
  { key: "hidden", label: "已隐藏", statuses: ["hidden"] },
];

/** 财务结算（BmBill：与 STATUS_TEXT「待确认/已确认/已打款」同源） */
export const BILL_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending-review", label: "待确认", statuses: ["pending-review"] },
  { key: "confirmed", label: "已确认", statuses: ["confirmed"] },
  { key: "paid", label: "已打款", statuses: ["paid"] },
];

/* IKEAGE 楼长招募：报名状态 Tab（待联系→面试中→已通过/已拒绝） */
export const RECRUIT_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending", label: "待联系", statuses: ["pending"] },
  { key: "interviewing", label: "面试中", statuses: ["interviewing"] },
  { key: "approved", label: "已通过", statuses: ["approved"] },
  { key: "rejected", label: "已拒绝", statuses: ["rejected"] },
];
