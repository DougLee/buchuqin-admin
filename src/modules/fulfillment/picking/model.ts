export interface PickingSourceLine {
  quantity: number;
  product?: { name?: string; location?: string; locationCode?: string };
}

export interface PickingLine {
  sourceIndex: number;
  name: string;
  quantity: number;
  location: string;
}

/** Builds the operator checklist while retaining the source row identity. */
export function buildPickingLines(items: PickingSourceLine[]): PickingLine[] {
  return items
    .map((line, sourceIndex) => ({
      sourceIndex,
      name: line.product?.name ?? "未知商品",
      quantity: line.quantity,
      location: [line.product?.location ?? "", line.product?.locationCode ?? ""]
        .filter(Boolean)
        .join("-"),
    }))
    .sort((left, right) =>
      (left.location || "ZZZ").localeCompare(right.location || "ZZZ", "zh-CN", { numeric: true }),
    );
}
