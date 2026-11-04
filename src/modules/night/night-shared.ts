/**
 * 夜宵经营（IKSW1F）页面共享小件：状态字典 / 佣金比例格式化 / 时间档位。
 * 金额一律整数分（展示走 utils/money），佣金比例一律万分比。
 */

/** ElTag type 合法值（夜宵页面动态 tag 共用）。 */
export type NightTagType = "success" | "warning" | "info" | "danger" | "primary";

/** 店铺营业状态 → 展示文案与 ElTag 类型。 */
export const NIGHT_STORE_STATUS: Record<string, { text: string; tag: NightTagType }> = {
  open: { text: "营业中", tag: "success" },
  paused: { text: "已暂停", tag: "warning" },
  closed: { text: "打烊", tag: "info" },
  suspended: { text: "停业", tag: "danger" },
};

export function nightStoreStatus(status: string): { text: string; tag: NightTagType } {
  return NIGHT_STORE_STATUS[status] ?? { text: status || "—", tag: "info" };
}

/** 夜宵订单状态 → 展示文案与 ElTag 类型（与服务端 STATUS_TEXT 对齐）。 */
export const NIGHT_ORDER_STATUS: Record<string, { text: string; tag: NightTagType }> = {
  "pending-payment": { text: "待支付", tag: "warning" },
  "pending-accept": { text: "待接单", tag: "primary" },
  delivering: { text: "配送中", tag: "primary" },
  delivered: { text: "已送达", tag: "success" },
  completed: { text: "已完成", tag: "success" },
  cancelled: { text: "已取消", tag: "info" },
  refunded: { text: "已退款", tag: "danger" },
  exception: { text: "支付异常", tag: "danger" },
};

export function nightOrderStatus(status: string): { text: string; tag: NightTagType } {
  return NIGHT_ORDER_STATUS[status] ?? { text: status || "—", tag: "info" };
}

/** 万分比佣金比例 → 展示文案（2000 → "20%"，2050 → "20.5%"）。 */
export function rateText(rate: number): string {
  const percent = rate / 100;
  const fixed = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  return `${fixed}%`;
}

/** 打烊/场次时间 30 分钟档（00:00~23:30）：下拉天然 24 小时制。 */
export const NIGHT_TIME_OPTIONS = Array.from(
  { length: 48 },
  (_, i) =>
    `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

/** 库存流水类型 → 展示文案。 */
export const NIGHT_STOCK_TXN_TYPE: Record<string, string> = {
  stockIn: "备货入库",
  saleOut: "销售出库",
  refundBack: "退款回库",
  adjust: "后台调整",
  returnOut: "退货出库",
  loss: "报损",
  stocktake: "盘点",
};

/** 押金流水类型 → 展示文案与符号方向（deposit 增 / deduct、refund 减）。 */
export function depositTxnView(type: string): { text: string; minus: boolean } {
  if (type === "deposit") return { text: "缴纳", minus: false };
  if (type === "deduct") return { text: "判责扣除", minus: true };
  if (type === "refund") return { text: "退还", minus: true };
  return { text: type || "—", minus: false };
}
