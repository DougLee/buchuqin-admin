<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { canWrite, loadRbac, menuPath } from "../session";
import type { RbacMenuRow, RbacRole } from "../types";

/**
 * 角色管理（RBAC 蛋词体系，2026-09-19，对齐 cool-admin）：
 * - 一棵三级树勾选（目录→菜单→按钮）：勾了哪些行就存哪些 code
 *   （menuCodes 混合集），不做父子自动补全——后端 role_menu 无父子推导；
 * - 组/菜单级「全选子级」只勾子级，不改父级自身勾选状态；
 * - 内置角色只读（超管=全菜单通配，禁改）；复制=预填勾选开新码；
 * - 菜单管理入口在页头（无侧栏行，守卫同 canWrite('rbac-roles')）。
 */
const router = useRouter();
const toast = ref("");
const toastError = ref(false);
/** 行内两击删除确认 */
const confirmRowId = ref("");
function notify(msg: string, error = false) {
  toast.value = msg;
  toastError.value = error;
}

const rows = ref<RbacRole[]>([]);
/** 菜单全量树扁平行（含按钮行与 perms 串；parentId 为行 id）。 */
const menuRows = ref<RbacMenuRow[]>([]);
const loading = ref(true);
const loadError = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const [roles, menus] = await Promise.all([
      api.rbacRoles(),
      api.rbacMenus(),
    ]);
    rows.value = roles;
    menuRows.value = menus;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

/* ---------- 菜单树组树（parentId=行 id）与渲染拍平 ---------- */
interface MenuNode {
  row: RbacMenuRow;
  children: MenuNode[];
  /** 全部后代（含按钮）——「全选子级」用。 */
  descendants: MenuNode[];
}
function buildTree(flat: RbacMenuRow[]): MenuNode[] {
  const nodes = new Map<string, MenuNode>(
    flat.map((r) => [r.id, { row: r, children: [], descendants: [] }]),
  );
  const roots: MenuNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.row.parentId ? nodes.get(node.row.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortAll = (list: MenuNode[]) => {
    list.sort((a, b) => (a.row.orderNum ?? 0) - (b.row.orderNum ?? 0));
    list.forEach((n) => {
      n.descendants = collect(n.children);
      sortAll(n.children);
    });
  };
  const collect = (list: MenuNode[]): MenuNode[] =>
    list.flatMap((n) => [n, ...collect(n.children)]);
  sortAll(roots);
  return roots;
}
const menuTree = computed(() => buildTree(menuRows.value));

/** 拍平成渲染行（带深度；折叠的祖先整枝隐藏）。 */
interface FlatRow {
  node: MenuNode;
  depth: number;
}
const treeSearch = ref("");
const flatRows = computed<FlatRow[]>(() => {
  const out: FlatRow[] = [];
  const walk = (list: MenuNode[], depth: number, hidden: boolean) => {
    for (const node of list) {
      const folded = foldedNodes.value.has(node.row.id);
      const q = treeSearch.value.trim().toLowerCase();
      const matches = !q || [node, ...node.descendants].some(n => `${n.row.name} ${n.row.code}`.toLowerCase().includes(q));
      if ((!hidden || q) && matches) out.push({ node, depth });
      walk(node.children, depth + 1, hidden || folded);
    }
  };
  walk(menuTree.value, 0, false);
  return out;
});
const TYPE_TEXT: Record<number, string> = { 0: "目录", 1: "菜单", 2: "按钮" };

/* 折叠（默认全展开；checkbox 点击不冒泡折叠） */
const foldedNodes = ref<Set<string>>(new Set());
function toggleFold(id: string) {
  const next = new Set(foldedNodes.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  foldedNodes.value = next;
}

/* ---------- 勾选（只记 code，无父子推导） ---------- */
const checkedCodes = ref<Set<string>>(new Set());
function setChecked(code: string, on: boolean) {
  const next = new Set(checkedCodes.value);
  const node = flatAll().find(n => n.row.code === code);
  if (!node) return;
  for (const n of [node, ...node.descendants]) on ? next.add(n.row.code) : next.delete(n.row.code);
  let parent = node.row.parentId;
  while (parent) {
    const ancestor = flatAll().find(n => n.row.id === parent);
    if (!ancestor) break;
    if (ancestor.descendants.some(n => next.has(n.row.code))) next.add(ancestor.row.code);
    else next.delete(ancestor.row.code);
    parent = ancestor.row.parentId;
  }
  checkedCodes.value = next;
}
function flatAll(): MenuNode[] {
  const walk = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap(n => [n, ...walk(n.children)]);
  return walk(menuTree.value);
}
function selectReadOnly(node: MenuNode) {
  setChecked(node.row.code, false);
  const next = new Set(checkedCodes.value);
  next.add(node.row.code);
  let parent = node.row.parentId;
  while (parent) {
    const ancestor = menuRows.value.find(n => n.id === parent);
    if (!ancestor) break;
    next.add(ancestor.code); parent = ancestor.parentId;
  }
  checkedCodes.value = next;
}
function toggleDescendants(node: MenuNode, on: boolean) { setChecked(node.row.code, on); }
function descendantsAllChecked(node: MenuNode): boolean {
  return (
    node.descendants.length > 0 &&
    node.descendants.every((d) => checkedCodes.value.has(d.row.code))
  );
}
function descendantsSomeChecked(node: MenuNode): boolean {
  return node.descendants.some((d) => checkedCodes.value.has(d.row.code));
}

/* ---------- 编辑抽屉 ---------- */
const drawerOpen = ref(false);
const drawerSaving = ref(false);
const drawerError = ref("");
/** 编辑中的角色 id；null = 新建/复制 */
const editingId = ref<string | null>(null);
/** 内置角色（超管等）只读展示 */
const editingBuiltin = ref(false);
const form = ref({ code: "", name: "", remark: "", status: "active" as "active" | "disabled" });

function openCreate() {
  editingId.value = null;
  editingBuiltin.value = false;
  form.value = { code: "", name: "", remark: "", status: "active" };
  checkedCodes.value = new Set();
  drawerError.value = "";
  drawerOpen.value = true;
}
function openEdit(role: RbacRole) {
  editingId.value = role.id;
  // 内置超管整卡禁用（通配全菜单）；其它内置角色可编辑，后端兜底校验
  editingBuiltin.value = role.builtin && role.code === "super-admin";
  form.value = {
    code: role.code,
    name: role.name,
    remark: role.remark,
    status: role.status,
  };
  checkedCodes.value = new Set(role.menuCodes ?? []);
  drawerError.value = "";
  drawerOpen.value = true;
}
/** 复制：预填勾选与名称，code 留空新开（内置角色也可复制成自定义角色）。 */
function openCopy(role: RbacRole) {
  editingId.value = null;
  editingBuiltin.value = false;
  form.value = {
    code: "",
    name: `${role.name} 副本`,
    remark: role.remark,
    status: "active",
  };
  checkedCodes.value = new Set(
    // 超管通配不落清单——复制时按全量树预填
    role.builtin && role.code === "super-admin"
      ? menuRows.value.map((m) => m.code)
      : (role.menuCodes ?? []),
  );
  drawerError.value = "";
  drawerOpen.value = true;
}
async function submitDrawer() {
  drawerError.value = "";
  const code = form.value.code.trim();
  const name = form.value.name.trim();
  if (!editingId.value && !code)
    return (drawerError.value = "请输入角色编码");
  if (!name) return (drawerError.value = "请输入角色名称");
  drawerSaving.value = true;
  try {
    if (editingId.value) {
      // 内置超管不可改（整卡禁用，此处理论不可达，双保险）
      if (editingBuiltin.value) return (drawerError.value = "内置角色不可编辑");
      await api.rbacUpdateRole(editingId.value, {
        name,
        remark: form.value.remark.trim(),
        status: form.value.status,
        menuCodes: [...checkedCodes.value],
      });
      notify("角色已更新");
    } else {
      await api.rbacCreateRole({
        code,
        name,
        remark: form.value.remark.trim() || undefined,
        menuCodes: [...checkedCodes.value],
      });
      notify("角色已创建");
    }
    drawerOpen.value = false;
    await loadRbac();
    await load();
  } catch (e) {
    drawerError.value = e instanceof Error ? e.message : "保存失败";
  } finally {
    drawerSaving.value = false;
  }
}

/* ---------- 删除（两击确认，文案带关联账号数；后端 403 人话 toast） ---------- */
async function removeRow(role: RbacRole) {
  if (confirmRowId.value !== role.id) {
    confirmRowId.value = role.id;
    return;
  }
  confirmRowId.value = "";
  try {
    await api.rbacDeleteRole(role.id);
    notify("角色已删除");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "删除失败", true);
  }
}
/** 删除提示文案（两击确认亮出）。 */
function removeLabel(role: RbacRole): string {
  return confirmRowId.value === role.id
    ? role.accountCount > 0
      ? `确认删除？将影响 ${role.accountCount} 个账号`
      : "确认删除？"
    : "删除";
}
</script>
<template>
  <div class="workspace rbac-workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>角色管理</h1>
        <p>角色的菜单权限集合管理（编码不可改）；内置角色只读，可复制为新角色。</p>
      </div>
      <div class="head-actions">
        <button
          v-if="canWrite('rbac-roles')"
          class="btn ghost"
          @click="router.push(menuPath('rbac-menus') || '/access-denied')"
        >
          菜单管理
        </button>
        <button
          v-if="canWrite('rbac-roles')"
          class="btn primary"
          @click="openCreate"
        >
          ＋ 新建角色
        </button>
      </div>
    </div>

    <p v-if="toast" class="feat-toast" :class="{ error: toastError }">
      {{ toast }}
    </p>

    <div class="data-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>编码</th>
              <th>名称</th>
              <th>状态</th>
              <th>内置</th>
              <th>关联账号</th>
              <th>菜单项</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7"><div class="row-skeleton"></div></td>
            </tr>
            <tr v-else-if="loadError">
              <td colspan="7" class="empty-cell">
                {{ loadError }}
                <button class="btn mini ghost" @click="load">重试</button>
              </td>
            </tr>
            <tr v-else-if="!rows.length">
              <td colspan="7" class="empty-cell">暂无角色</td>
            </tr>
            <tr v-for="role in rows" v-else :key="role.id">
              <td><code>{{ role.code }}</code></td>
              <td>
                <strong>{{ role.name }}</strong>
                <p v-if="role.remark" class="role-remark">{{ role.remark }}</p>
              </td>
              <td>
                <span
                  class="status"
                  :class="role.status === 'active' ? 'success' : 'warning'"
                  >{{ role.status === "active" ? "启用" : "停用" }}</span
                >
              </td>
              <td>{{ role.builtin ? "内置" : "—" }}</td>
              <td>{{ role.accountCount }}</td>
              <td>
                {{
                  role.builtin && role.code === "super-admin"
                    ? "全部"
                    : (role.menuCodes ?? []).length
                }}
              </td>
              <td class="row-actions">
                <button
                  v-if="canWrite('rbac-roles')"
                  class="btn mini primary"
                  :disabled="role.builtin && role.code === 'super-admin'"
                  @click="openEdit(role)"
                >
                  编辑
                </button>
                <button
                  v-if="canWrite('rbac-roles')"
                  class="btn mini ghost"
                  @click="openCopy(role)"
                >
                  复制
                </button>
                <button
                  v-if="canWrite('rbac-roles') && !role.builtin"
                  class="btn mini danger-btn"
                  @click="removeRow(role)"
                >
                  {{ removeLabel(role) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 编辑/新建/复制抽屉：基本信息 + 一棵三级勾选树（目录→菜单→按钮） -->
    <div v-if="drawerOpen" class="drawer-mask" @click.self="drawerOpen = false">
      <aside class="drawer product-create role-drawer">
        <div class="drawer-head">
          <div>
            <h2>{{ editingId ? `编辑角色 ${form.name}` : "新建角色" }}</h2>
          </div>
          <button aria-label="关闭" @click="drawerOpen = false">×</button>
        </div>
        <div class="product-form">
          <label>
            角色编码
            <input
              v-model.trim="form.code"
              :disabled="!!editingId"
              placeholder="如：campus-manager"
            /></label>
          <label>
            角色名称
            <input v-model.trim="form.name" placeholder="如：校区店长" />
          </label>
          <label>
            状态
            <select v-model="form.status">
              <option value="active">启用</option>
              <option value="disabled">停用（挂此角色的授权失效）</option>
            </select>
          </label>
          <label class="wide">
            备注
            <input v-model.trim="form.remark" placeholder="职责说明（选填）" />
          </label>
        </div>
        <p class="drawer-sec">功能权限（父子联动，支持仅查看和清空授权）</p>
        <!-- 内置超管：通配全菜单，整树禁用 -->
        <div v-if="editingBuiltin && form.code === 'super-admin'" class="builtin-card">
          全部菜单（内置通配）——超级管理员不受菜单勾选约束，不可编辑。
        </div>
        <input v-if="!editingBuiltin" v-model="treeSearch" placeholder="搜索菜单或操作" aria-label="搜索功能权限" />
        <div v-if="!editingBuiltin" class="menu-tree" :class="{ 'is-locked': editingBuiltin }">
          <div
            v-for="{ node, depth } in flatRows"
            :key="node.row.id"
            class="menu-node"
            :class="{ 'is-dir': node.row.type === 0 }"
          >
            <div
              class="menu-node__line"
              :style="{ paddingLeft: `${depth * 18}px` }"
            >
              <button
                v-if="node.children.length"
                type="button"
                class="menu-fold-btn"
                :aria-expanded="!foldedNodes.has(node.row.id)"
                @click="toggleFold(node.row.id)"
              >
                {{ foldedNodes.has(node.row.id) ? "▸" : "▾" }}
              </button>
              <span v-else class="menu-fold-spacer"></span>
              <label class="checkbox-row menu-node__check" @click.stop>
                <input
                  type="checkbox"
                  class="raw-checkbox"
                  :disabled="editingBuiltin"
                  :checked="node.children.length ? descendantsAllChecked(node) : checkedCodes.has(node.row.code)"
                  :indeterminate="node.children.length > 0 && checkedCodes.has(node.row.code) && !descendantsAllChecked(node)"
                  @change="setChecked(node.row.code, ($event.target as HTMLInputElement).checked)"
                />
                <span class="menu-node__name">{{ node.row.name }}</span>
                <code class="menu-node__code">{{ node.row.code }}</code>
              </label>
              <span class="status info menu-node__type">{{
                TYPE_TEXT[node.row.type]
              }}</span>
              <code v-if="node.row.path" class="menu-node__path">{{
                node.row.path
              }}</code>
              <code v-if="node.row.perms?.length" class="menu-node__perms">{{
                node.row.perms.join("；")
              }}</code>
              <button v-if="node.row.type === 1" type="button" class="btn mini" @click="selectReadOnly(node)">仅查看</button>
              <!-- 全选子级：只勾子级（含按钮），不改本行勾选状态 -->
              <label
                v-if="node.children.length"
                class="checkbox-row menu-node__all"
                @click.stop
              >
                <input
                  type="checkbox"
                  class="raw-checkbox"
                  :disabled="editingBuiltin"
                  :checked="descendantsAllChecked(node)"
                  @change="toggleDescendants(node, !descendantsAllChecked(node))"
                />
                全选子级
                <small v-if="descendantsSomeChecked(node) && !descendantsAllChecked(node)">
                  （部分）
                </small>
              </label>
            </div>
          </div>
        </div>
        <p v-if="drawerError" class="form-hint">{{ drawerError }}</p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="drawerOpen = false">取消</button>
          <button
            v-if="!editingBuiltin"
            class="btn primary"
            :disabled="drawerSaving"
            @click="submitDrawer"
          >
            {{ drawerSaving ? "保存中..." : editingId ? "保存修改" : "创建角色" }}
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>
<style scoped>
/* 全局 .workspace/.page-head/.data-panel/table/.btn/checkbox-row 不重写；
   scoped 只留本页私有。 */
.feat-toast {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #e5f6eb;
  color: #087641;
  font-size: 12px;
  width: fit-content;
}
.feat-toast.error {
  background: #fdeeee;
  color: #b42323;
}
.role-remark {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--muted);
}
.role-drawer {
  width: min(680px, 96vw);
}
.drawer-sec {
  margin: 18px 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}
.builtin-card {
  padding: 14px;
  border: 1px dashed #c2d4c9;
  border-radius: 12px;
  background: #f6faf7;
  color: var(--muted);
  font-size: 12px;
}
/* ---------- 一棵三级勾选树 ---------- */
.menu-tree {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 8px 10px;
  max-height: 52vh;
  overflow: auto;
}
.menu-tree.is-locked {
  opacity: 0.6;
  pointer-events: none;
}
.menu-node__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-radius: 8px;
  font-size: 12px;
}
.menu-node.is-dir > .menu-node__line {
  border-bottom: 1px dashed #eef2ef;
}
.menu-fold-btn {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
  flex: none;
}
.menu-fold-btn:hover {
  color: #07883b;
}
.menu-fold-spacer {
  width: 18px;
  flex: none;
}
.menu-node__check {
  cursor: pointer;
  flex: 0 0 auto;
  max-width: 100%;
  min-width: 0;
}
.menu-node__name {
  flex: none;
  white-space: nowrap;
  font-size: 13px;
}
.menu-node.is-dir .menu-node__name {
  font-weight: 700;
}
.menu-node__code,
.menu-node__path,
.menu-node__perms {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-node__perms {
  order: 2;
  flex: 1 0 100%;
  max-width: 100%;
  padding-left: 26px;
  box-sizing: border-box;
}
.menu-node__code { max-width: 160px; }
.menu-node__path { max-width: 140px; }
.menu-node__type {
  flex: none;
  font-size: 11px;
}
.menu-node__all {
  margin-left: auto;
  flex: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
}
</style>
