import type { Component } from "vue";
import Dashboard from "./pages/Dashboard.vue";
import Restock from "./pages/RestockPage.vue";
import Purchase from "./pages/PurchasePage.vue";
import Reports from "./pages/DailyReportPage.vue";
import CampusReport from "./pages/CampusReportPage.vue";
import BehaviorAnalytics from "./pages/BehaviorPage.vue";
import TransferLogs from "./pages/TransferLogsPage.vue";
import BattleMap from "./pages/BattleMapPage.vue";
import Featured from "./pages/FeaturedPage.vue";
import CampusConfig from "./pages/CampusConfigPage.vue";
// IKHZKA 售后退款工作台（Refund 统一申请主表，专用审核交互）
import AfterSales from "./pages/AfterSalesPage.vue";
// 帮助中心/更新日志（道哥 2026-09-22）：内置只读页
import HelpCenter from "./pages/HelpCenterPage.vue";
import Changelog from "./pages/ChangelogPage.vue";
import Accounts from "./pages/AccountsPage.vue";
import Roles from "./pages/RolesPage.vue";
import Menus from "./pages/MenusPage.vue";
import Permissions from "./pages/RbacPermissionsPage.vue";
import Audit from "./pages/RbacAuditPage.vue";
import { catalogViews } from "./modules/catalog";
import { fulfillmentViews } from "./modules/fulfillment";
import { settingsViews } from "./modules/settings";
import { warehouseViews } from "./modules/warehouse";
import { governanceViews } from "./modules/governance";
import { marketingViews } from "./modules/marketing";
import { financeViews } from "./modules/finance";
import { organizationViews } from "./modules/organization";
// 组织管理（IKKRMS）：组织 B 平台端开通一条龙（列表/微信配置/开通向导）
import Organizations from "./pages/OrganizationsPage.vue";
function mergeViewRegistries(...registries: Record<string, Component>[]) {
  const merged: Record<string, Component> = {};
  for (const registry of registries)
    for (const [key, view] of Object.entries(registry)) {
      if (merged[key]) throw new Error(`重复的后台页面注册：${key}`);
      merged[key] = view;
    }
  return merged;
}
const coreViews: Record<string, Component> = {
  dashboard: Dashboard, restock: Restock, purchase: Purchase, reports: Reports,
  "campus-report": CampusReport, "battle-map": BattleMap, featured: Featured,
  "campus-config": CampusConfig, "after-sales": AfterSales, accounts: Accounts, "rbac-roles": Roles, "rbac-menus": Menus,
  "rbac-permissions": Permissions, "rbac-audit": Audit, organizations: Organizations,
  "behavior-analytics": BehaviorAnalytics,
  "transfer-logs": TransferLogs,
  help: HelpCenter, changelog: Changelog,
};
export const views = mergeViewRegistries(coreViews, catalogViews, fulfillmentViews, settingsViews, warehouseViews, governanceViews, marketingViews, financeViews, organizationViews);
// behavior-analytics：IKRGLV 道哥定稿仅超管可见——非超管前端即拦（双保险，
// 后端另有 ctx.super 强制）
export const superViews = new Set(["rbac-roles", "rbac-menus", "rbac-permissions", "behavior-analytics", "transfer-logs"]);
