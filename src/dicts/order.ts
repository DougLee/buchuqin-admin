/**
 * 订单/售后域字典（IKIYMM 字典集中化）：纯搬移，文案与原定义逐字一致。
 * 注意：STATUS_TEXT 是跨域大杂烩（财务账单/校区/员工/招募多域共用键空间），
 * 原样保留避免键碰撞；同域分叉见 AFTER_SALE_TYPE_TEXT 注释。
 */

/** 万能状态中文（17 键）：多域共用的键空间，历史上随用随补——勿按域拆分 */
export const STATUS_TEXT: Record<string, string> = {
  // IKDFIN：与财务 Tab 文案对齐（原「待复核/已支付」，两值仅财务账单外露）
  "pending-review": "待确认",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  confirmed: "已确认",
  paid: "已打款",
  active: "启用",
  // inactive：校区停用值（UpdateCampusDto active|inactive）——此前表里漏了，
  // 校区管理列表停用行原样显示英文（道哥 2026-09-14 截图反馈）
  inactive: "已停用",
  paused: "已暂停",
  disabled: "已停用",
  hidden: "已隐藏",
  // IKB5PA：状态 Tab 化后新增的展示值
  cancelled: "已取消",
  invited: "待响应",
  accepted: "已接受",
  online: "在线",
  offline: "离线",
  completed: "已完成",
};

/** 售后类型（DataPage 用）。分叉提示：AfterSalesPage.TYPE_TEXT 同域文案不同
 *  （missing 此处「商品缺失」/彼处「缺件」）——纯重构保持两套，统一待后续拍板。 */
export const AFTER_SALE_TYPE_TEXT: Record<string, string> = {
  quality: "质量问题",
  missing: "商品缺失",
  damaged: "包装破损",
  wrong: "错发",
  other: "其他",
};

/** 售后行内状态（DataPage 明细行，原 DataPage:2350 匿名 map 落地） */
export const AFTER_SALE_ROW_STATUS_TEXT: Record<string, string> = {
  pending: "待处理",
  cancelled: "已取消",
};

/** 退款状态 Tab（AfterSalesPage，原 TABS 落地） */
export const REFUND_STATUS_TABS = [
  { key: "pending", label: "待审核" },
  { key: "refunding", label: "退款中" },
  { key: "refunded", label: "已退款" },
  { key: "rejected", label: "已拒绝" },
  { key: "failed", label: "退款失败" },
] as const;

/** 退款来源（AfterSalesPage） */
export const REFUND_SOURCE_TEXT: Record<string, string> = {
  "after-sale": "送达后售后",
  "pre-delivery": "未发货",
};

/** 售后类型（AfterSalesPage 用）。分叉提示：与 AFTER_SALE_TYPE_TEXT 同域
 *  文案不同（missing「缺件」vs「商品缺失」、键集少 damaged/wrong/other 的
 *  翻译差异）——纯重构保持两套，统一待后续拍板。 */
export const AFTERSALE_PAGE_TYPE_TEXT: Record<string, string> = {
  quality: "质量问题",
  missing: "缺件",
  damaged: "破损",
};

/** 订单状态中文（退款拒绝后回滚去向展示，AfterSalesPage） */
export const REFUND_ROLLBACK_STATUS_TEXT: Record<string, string> = {
  paid: "仓库正在接单",
  delivered: "已送达",
  completed: "已确认收货",
};
