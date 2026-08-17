/**
 * 金额单位换算（契约：后端全部金额字段为整数「分」，前端展示元、提交分）。
 * 全项目唯一允许出现 /100、*100 的地方——业务代码禁止裸算，一律经由本文件。
 */

/** 分 → 元字符串，固定两位小数；thousand=true 时加千分位。空值/非法值返回 "—"。 */
export function fenToYuan(
  fen: number | null | undefined,
  thousand = false,
): string {
  if (fen === null || fen === undefined || !Number.isFinite(fen)) return "—";
  const fixed = (fen / 100).toFixed(2);
  if (!thousand) return fixed;
  const [int, dec] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${dec ?? "00"}`;
}

/**
 * 元（表单输入）→ 整数分，提交后端前使用。
 * Math.round 规避 19.99 * 100 之类的浮点误差；非法输入（含布尔等非数值）返回 NaN，
 * 由调用方先行校验。
 */
export function yuanToFen(
  yuan: number | string | boolean | null | undefined,
): number {
  const value =
    typeof yuan === "number" ? yuan : Number(String(yuan ?? "").trim());
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(value * 100);
}
