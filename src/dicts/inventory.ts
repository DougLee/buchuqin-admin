/**
 * 库存/仓储域字典（IKIYMM 字典集中化）：纯搬移，文案与原定义逐字一致。
 */

/** 流水类型字典（与 API 落库 type 一一对应；adjust 含手工调整与盘点，reason 区分） */
export const TXN_TYPE_TEXT: Record<string, string> = {
  "stock-in": "人工入库",
  adjust: "盘点调整",
  out: "订单出库",
  "purchase-receive": "采购收货",
  "purchase-bad": "采购坏品",
  "restock-out": "订货发货",
  "restock-in": "订货到货",
};

/** 采购单阶段（PurchasePage，原 PHASE_TEXT 落地改名防碰撞） */
export const PURCHASE_PHASE_TEXT: Record<string, string> = {
  pending: "待到货",
  partial: "部分到货",
  completed: "已收齐",
  closed: "已关闭",
};
export const PURCHASE_PHASE_CLASS: Record<string, string> = {
  pending: "info",
  partial: "warning",
  completed: "success",
  closed: "",
};

/** 订货批次阶段（RestockPage，原 PHASE_TEXT 落地改名防碰撞） */
export const RESTOCK_PHASE_TEXT: Record<string, string> = {
  upcoming: "未开始",
  open: "进行中",
  ended: "已结束",
  closed: "已关闭",
};
export const RESTOCK_PHASE_CLASS: Record<string, string> = {
  upcoming: "info",
  open: "success",
  ended: "",
  closed: "danger",
};

/** 订货单状态（RestockPage，原 ORDER_STATUS_TEXT 落地改名防碰撞） */
export const RESTOCK_ORDER_STATUS_TEXT: Record<string, string> = {
  draft: "草稿",
  submitted: "待审核",
  confirmed: "已确认",
  rejected: "已驳回",
  shipped: "已发货",
  received: "已到货",
};
export const RESTOCK_ORDER_STATUS_CLASS: Record<string, string> = {
  draft: "",
  submitted: "warning",
  confirmed: "success",
  rejected: "danger",
  shipped: "info",
  received: "success",
};
