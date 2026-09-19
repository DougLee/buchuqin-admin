import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import Dashboard from "./pages/Dashboard.vue";
import DataPage from "./pages/DataPage.vue";
import Login from "./pages/Login.vue";
import RestockPage from "./pages/RestockPage.vue";
import PurchasePage from "./pages/PurchasePage.vue";
import DailyReportPage from "./pages/DailyReportPage.vue";
import CampusReportPage from "./pages/CampusReportPage.vue";
import BattleMapPage from "./pages/BattleMapPage.vue";
import FeaturedPage from "./pages/FeaturedPage.vue";
// RBAC V1：账号/角色/权限目录/权限审计独立页（系统分组）
import AccountsPage from "./pages/AccountsPage.vue";
import RolesPage from "./pages/RolesPage.vue";
import RbacPermissionsPage from "./pages/RbacPermissionsPage.vue";
import RbacAuditPage from "./pages/RbacAuditPage.vue";
import { canSee, hasPerm, sessionUser } from "./session";
import "./style.css";
import "./drawer.css";
const routes = [
  { path: "/login", component: Login },
  { path: "/", component: Dashboard },
  // IKFOQ0：订货管理独立页——批次卡片+订货单编辑器交互重于通用表格，
  // 不塞 DataPage 巨石；权限仍走 canSee("restock")
  { path: "/restock", component: RestockPage },
  // IKFOQ1：采购管理独立页（验收闭环），权限走 canSee("purchase")
  { path: "/purchase", component: PurchasePage },
  // IKFOPR：总部经营日报（发货单实时聚合，T+1），权限同 purchase
  { path: "/reports", component: DailyReportPage },
  // IKFOPS：校区经营日报（C 端订单实时聚合，T+1），权限 campus-report 键
  { path: "/campus-report", component: CampusReportPage },
  // IKFOQ3：营销作战地图（寝室三色格），权限复用 buildings 键
  { path: "/battle-map", component: BattleMapPage },
  // IKH0EK：首页推荐位管理（营销板块）
  { path: "/featured", component: FeaturedPage },
  // RBAC V1：系统分组四页
  { path: "/accounts", component: AccountsPage },
  { path: "/rbac-roles", component: RolesPage },
  { path: "/rbac-permissions", component: RbacPermissionsPage },
  { path: "/rbac-audit", component: RbacAuditPage },
  { path: "/:section", component: DataPage },
];
const router = createRouter({ history: createWebHashHistory(), routes });
// 会话守卫：未登录跳登录页；已登录不可回登录页；无权限板块重定向工作台
router.beforeEach((to) => {
  // RBAC V1：不再按旧角色判定——token + 会话用户即视为已登录
  const authed = Boolean(
    localStorage.getItem("adminToken") && sessionUser.value,
  );
  if (to.path === "/login") return authed ? "/" : true;
  if (!authed) return "/login";
  // RBAC V1：平台账号无本校区商品概念时 /products 直达官方商品库
  if (
    to.path === "/products" &&
    !hasPerm("products.read") &&
    hasPerm("products.official.read")
  )
    return "/official-products";
  // IKFOQ0：独立路由不走 :section 参数，单独过权限
  if (to.path === "/restock") return canSee("restock") ? true : "/";
  if (to.path === "/purchase") return canSee("purchase") ? true : "/";
  if (to.path === "/reports") return canSee("purchase") ? true : "/";
  if (to.path === "/campus-report") return canSee("campus-report") ? true : "/";
  if (to.path === "/battle-map") return canSee("buildings") ? true : "/";
  if (to.path === "/featured") return canSee("marketing") ? true : "/";
  if (to.path === "/accounts") return canSee("accounts") ? true : "/";
  if (to.path === "/rbac-roles") return canSee("rbac-roles") ? true : "/";
  if (to.path === "/rbac-permissions")
    return canSee("rbac-permissions") ? true : "/";
  if (to.path === "/rbac-audit") return canSee("rbac-audit") ? true : "/";
  if (to.path !== "/" && !canSee(String(to.params.section))) return "/";
  return true;
});
createApp(App).use(router).mount("#app");
