import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import Dashboard from "./pages/Dashboard.vue";
import DataPage from "./pages/DataPage.vue";
import Login from "./pages/Login.vue";
import RestockPage from "./pages/RestockPage.vue";
import { canSee, role } from "./session";
import "./style.css";
import "./drawer.css";
const routes = [
  { path: "/login", component: Login },
  { path: "/", component: Dashboard },
  // IKFOQ0：订货管理独立页——批次卡片+订货单编辑器交互重于通用表格，
  // 不塞 DataPage 巨石；权限仍走 canSee("restock")
  { path: "/restock", component: RestockPage },
  { path: "/:section", component: DataPage },
];
const router = createRouter({ history: createWebHashHistory(), routes });
// 会话守卫：未登录跳登录页；已登录不可回登录页；无权限板块重定向工作台
router.beforeEach((to) => {
  const authed = Boolean(localStorage.getItem("adminToken") && role.value);
  if (to.path === "/login") return authed ? "/" : true;
  if (!authed) return "/login";
  // IKCJ46：hq 无本校区商品概念，/products 直达官方商品库菜单
  if (to.path === "/products" && role.value === "hq") return "/official-products";
  // IKFOQ0：独立路由不走 :section 参数，单独过权限
  if (to.path === "/restock") return canSee("restock") ? true : "/";
  if (to.path !== "/" && !canSee(String(to.params.section))) return "/";
  return true;
});
createApp(App).use(router).mount("#app");
