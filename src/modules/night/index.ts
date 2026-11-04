/**
 * 夜宵经营模块（IKSW1F）：菜单三页 + 店铺详情静态路由。
 * registry（api/src/admin/rbac/registry.ts）g.night 组：
 * - night-stores（夜宵店铺，含夜主档 Tab 与夜宵配置弹窗）
 * - night-orders（夜宵订单）
 * - night-settlements（夜宵结算）
 */
import NightStoresPage from "./stores/pages/NightStoresPage.vue";
import NightStoreDetailPage from "./stores/pages/NightStoreDetailPage.vue";
import NightOrdersPage from "./orders/pages/NightOrdersPage.vue";
import NightSettlementsPage from "./settlements/pages/NightSettlementsPage.vue";

export const nightViews = {
  "night-stores": NightStoresPage,
  "night-orders": NightOrdersPage,
  "night-settlements": NightSettlementsPage,
};
export { NightStoreDetailPage };
