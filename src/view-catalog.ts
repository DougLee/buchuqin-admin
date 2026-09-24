import SkuAnalysis from "./pages/SkuAnalysisPage.vue";
import type { Component } from "vue";
import Dashboard from "./pages/Dashboard.vue";
import DataPage from "./pages/DataPage.vue";
import Restock from "./pages/RestockPage.vue";
import Purchase from "./pages/PurchasePage.vue";
import Reports from "./pages/DailyReportPage.vue";
import CampusReport from "./pages/CampusReportPage.vue";
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
export const views: Record<string, Component> = {
  "sku-analysis": SkuAnalysis,
  dashboard: Dashboard, restock: Restock, purchase: Purchase, reports: Reports,
  "campus-report": CampusReport, "battle-map": BattleMap, featured: Featured,
  "campus-config": CampusConfig, "after-sales": AfterSales, accounts: Accounts, "rbac-roles": Roles, "rbac-menus": Menus,
  "rbac-permissions": Permissions, "rbac-audit": Audit,
  help: HelpCenter, changelog: Changelog,
};
for (const key of ["orders", "official-products", "products", "categories", "inventory", "warehouse-orders", "inventory-txns", "locations", "banners", "pay-ads", "coupons", "promotions", "wheel", "wechat-groups", "staff", "recruit", "buildings", "campuses", "users", "dispatch", "finance", "rules", "audit", "printers"]) views[key] = DataPage;
export const superViews = new Set(["rbac-roles", "rbac-menus", "rbac-permissions"]);
