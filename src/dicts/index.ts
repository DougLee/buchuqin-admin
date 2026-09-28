/**
 * 字典统一出口（IKIYMM）：业务代码只 import 本入口，不深入子文件。
 * 边界约定：SectionConfig（含列头）/view-catalog/ROUTE_PERM 不属字典，留原处。
 */
export * from "./status-tab";
export * from "./order";
export * from "./product";
export * from "./inventory";
export * from "./staff";
export * from "./marketing";
export * from "./misc";
export * from "./section";
