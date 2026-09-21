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
import Accounts from "./pages/AccountsPage.vue";
import Roles from "./pages/RolesPage.vue";
import Menus from "./pages/MenusPage.vue";
import Permissions from "./pages/RbacPermissionsPage.vue";
import Audit from "./pages/RbacAuditPage.vue";
export const views: Record<string, Component> = {
  dashboard: Dashboard, restock: Restock, purchase: Purchase, reports: Reports,
  "campus-report": CampusReport, "battle-map": BattleMap, featured: Featured,
  "campus-config": CampusConfig, accounts: Accounts, "rbac-roles": Roles, "rbac-menus": Menus,
  "rbac-permissions": Permissions, "rbac-audit": Audit,
};
for (const key of ["orders", "after-sales", "official-products", "products", "categories", "inventory", "warehouse-orders", "inventory-txns", "locations", "banners", "pay-ads", "coupons", "promotions", "wheel", "wechat-groups", "staff", "recruit", "buildings", "campuses", "users", "dispatch", "finance", "rules", "audit", "printers"]) views[key] = DataPage;
export const superViews = new Set(["rbac-roles", "rbac-menus", "rbac-permissions"]);
