export type PageToken = number | "…";

/** Compact, stable pagination sequence shared by every admin list page. */
export function pageWindow(totalPages: number, currentPage: number): PageToken[] {
  const pages = Math.max(1, Math.trunc(totalPages));
  const current = Math.min(pages, Math.max(1, Math.trunc(currentPage)));
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const start = Math.max(2, Math.min(current - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(current + 1, 5));
  const result: PageToken[] = [1];
  if (start > 2) result.push("…");
  for (let page = start; page <= end; page += 1) result.push(page);
  if (end < pages - 1) result.push("…");
  result.push(pages);
  return result;
}

export function clampPage(value: unknown, totalPages: number): number | null {
  const page = Math.trunc(Number(value));
  if (!Number.isFinite(page) || page < 1) return null;
  return Math.min(Math.max(1, Math.trunc(totalPages)), page);
}
