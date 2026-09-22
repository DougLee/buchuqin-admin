import { watch } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import Login from "./pages/Login.vue";
import HelpCenter from "./pages/HelpCenterPage.vue";
import Changelog from "./pages/ChangelogPage.vue";
import AccessPage from "./pages/AccessPage.vue";
import FramePage from "./pages/FramePage.vue";
import { views, superViews } from "./view-catalog";
import { menuTree, sessionUser, loadRbac, isSuper, rbacLoaded } from "./session";
export const router = createRouter({ history: createWebHashHistory(), routes: [
  { path: '/login', name: 'login', component: Login },
  { path: '/access-denied', name: 'access-denied', component: AccessPage },
  // 帮助中心/更新日志（道哥 2026-09-22）：全员只读页，静态注册不走菜单权限
  { path: '/help', name: 'help', component: HelpCenter },
  { path: '/changelog', name: 'changelog', component: Changelog },
  { path: '/:pathMatch(.*)*', name: 'unregistered', component: AccessPage },
] });
let signature = '';
let removers: (() => void)[] = [];
function permittedMenus() {
  return menuTree.value.filter(m => m.type === 1 && m.authorized !== false && (!superViews.has(m.viewPath || m.code) || isSuper.value));
}
function synchronize() {
  const menus = rbacLoaded.value && sessionUser.value ? permittedMenus() : [];
  const next = JSON.stringify(menus);
  if (next === signature) return;
  signature = next;
  removers.forEach(remove => remove()); removers = [];
  for (const menu of menus) {
    if (!menu.path || ['/login','/access-denied'].includes(menu.path)) continue;
    const key = menu.viewPath || menu.code;
    const external = key.startsWith('https://');
    removers.push(router.addRoute({
      path: menu.path, name: `menu:${menu.id}`,
      component: external ? FramePage : (views[key] || AccessPage),
      meta: { dynamic: true, section: key, keepAlive: menu.keepAlive, title: menu.name,
        frameUrl: external ? key : '', configurationError: !external && !views[key] },
    }));
  }
  // Existing purchase screen links to the report subpage; permission follows purchase.
  if (menus.some(m => m.viewPath === 'purchase') && !menus.some(m => m.path === '/reports')) {
    removers.push(router.addRoute({ path: '/reports', name: 'purchase-report', component: views.reports, meta: { dynamic: true } }));
  }
  const current = router.currentRoute.value;
  if (current.meta.dynamic) {
    if (!router.resolve(current.fullPath).meta.dynamic) void router.replace('/access-denied');
    else void router.replace(current.fullPath);
  }
}
watch([menuTree, isSuper, rbacLoaded, sessionUser], synchronize, { flush: 'sync' });
router.beforeEach(async to => {
  const authed = !!localStorage.getItem('adminToken') && !!sessionUser.value;
  if (to.path === '/login') return true;
  if (!authed) return '/login';
  if (!(await loadRbac())) return to.path === '/access-denied' ? true : '/access-denied';
  synchronize();
  if (to.path === '/access-denied') return true;
  // 全员只读页：帮助中心/更新日志（静态注册，非数据库菜单）
  if (to.name === 'help' || to.name === 'changelog') return true;
  const resolved = router.resolve(to.fullPath);
  if (resolved.name !== 'unregistered') return resolved.name === to.name ? true : { path: to.fullPath, replace: true };
  if (to.path === '/') return permittedMenus()[0]?.path || '/access-denied';
  return '/access-denied';
});
