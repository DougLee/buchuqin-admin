/**
 * 时间格式化（IKC9M2 追修）：API 返回的 DateTime 是 UTC ISO 串，
 * 此前各处直接 replace("T"," ").slice() 原样展示——比北京时间少 8 小时
 * （用户上午 10 点下单显示 02:00）。统一走 Date 本地时区格式化。
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** ISO(UTC) → 本地时区 YYYY-MM-DD HH:mm */
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO(UTC) → 本地时区 YYYY-MM-DD（到期日等仅日期粒度场景） */
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
