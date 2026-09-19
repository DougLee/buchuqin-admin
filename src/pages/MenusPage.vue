<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { canWrite } from "../session";
import type { RbacMenuRow } from "../types";

/**
 * 菜单管理（RBAC 蛋词体系，2026-09-19）：
 * - 菜单表全量树表格（目录/菜单/按钮三级缩进），结构与 perms 后端登记；
 * - 编辑只许展示字段（name/icon/orderNum/isShow——PATCH 契约限制），
 *   结构字段（code/type/父级/path/perms）只读展示；
 * - 新建自建节点（POST 规则后端校验）；删除两击确认，403 人话 toast；
 * - 无侧栏菜单行：入口在角色管理页头，守卫 canWrite('rbac-roles')。
 */
const router = useRouter();
const toast = ref("");
const toastError = ref(false);
function notify(msg: string, error = false) {
  toast.value = msg;
  toastError.value = error;
}

const rows = ref<RbacMenuRow[]>([]);
const loading = ref(true);
const loadError = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    rows.value = await api.rbacMenus();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

/* ---------- 树组树 + 拍平（parentId=行 id） ---------- */
interface MenuNode {
  row: RbacMenuRow;
  children: MenuNode[];
}
const menuTree = computed<MenuNode[]>(() => {
  const nodes = new Map<string, MenuNode>(
    rows.value.map((r) => [r.id, { row: r, children: [] }]),
  );
  const roots: MenuNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.row.parentId ? nodes.get(node.row.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortAll = (list: MenuNode[]) => {
    list.sort((a, b) => (a.row.orderNum ?? 0) - (b.row.orderNum ?? 0));
    list.forEach((n) => sortAll(n.children));
  };
  sortAll(roots);
  return roots;
});
interface FlatRow {
  node: MenuNode;
  depth: number;
}
const flatRows = computed<FlatRow[]>(() => {
  const out: FlatRow[] = [];
  const walk = (list: MenuNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(menuTree.value, 0);
  return out;
});
const TYPE_TEXT: Record<number, string> = { 0: "目录", 1: "菜单", 2: "按钮" };
const TYPE_CLASS: Record<number, string> = { 0: "info", 1: "success", 2: "warning" };
/** 父行名（结构只读展示用）。 */
function parentLabel(row: RbacMenuRow): string {
  if (!row.parentId) return "—（根级）";
  const parent = rows.value.find((r) => r.id === row.parentId);
  return parent ? `${parent.name}（${parent.code}）` : row.parentId;
}

/* ---------- 编辑弹层（PATCH 只许 name/icon/orderNum/isShow） ---------- */
const editOpen = ref(false);
const editSaving = ref(false);
const editError = ref("");
const editTarget = ref<RbacMenuRow | null>(null);
const editForm = ref({ name: "", icon: "", orderNum: 0, isShow: true });
function openEdit(row: RbacMenuRow) {
  editTarget.value = row;
  editForm.value = {
    name: row.name,
    icon: row.icon ?? "",
    orderNum: row.orderNum ?? 0,
    isShow: row.isShow !== false,
  };
  editError.value = "";
  editOpen.value = true;
}
async function submitEdit() {
  if (!editTarget.value) return;
  editError.value = "";
  if (!editForm.value.name.trim())
    return (editError.value = "请输入菜单名称");
  editSaving.value = true;
  try {
    await api.rbacUpdateMenu(editTarget.value.id, {
      name: editForm.value.name.trim(),
      icon: editForm.value.icon.trim() || undefined,
      orderNum: Number(editForm.value.orderNum) || 0,
      isShow: editForm.value.isShow,
    });
    notify("菜单已更新");
    editOpen.value = false;
    await load();
  } catch (e) {
    editError.value = e instanceof Error ? e.message : "保存失败";
  } finally {
    editSaving.value = false;
  }
}

/* ---------- 新建自建节点 ---------- */
const createOpen = ref(false);
const createSaving = ref(false);
const createError = ref("");
const createForm = ref({
  parentId: "" as string,
  type: 1 as 0 | 1 | 2,
  code: "",
  name: "",
  path: "",
  permsText: "",
  icon: "",
  orderNum: 0,
});
/** 可挂靠的父级：目录/菜单行（按钮只能挂菜单下，前端提示后端校验兜底）。 */
const parentOptions = computed(() =>
  rows.value.filter((r) => r.type !== 2),
);
function openCreate() {
  createForm.value = {
    parentId: "",
    type: 1,
    code: "",
    name: "",
    path: "",
    permsText: "",
    icon: "",
    orderNum: 0,
  };
  createError.value = "";
  createOpen.value = true;
}
async function submitCreate() {
  createError.value = "";
  const code = createForm.value.code.trim();
  const name = createForm.value.name.trim();
  if (!code) return (createError.value = "请输入菜单编码");
  if (!name) return (createError.value = "请输入菜单名称");
  if (createForm.value.type === 1 && !createForm.value.path.trim())
    return (createError.value = "菜单行需填写路由 path（如 /products）");
  const perms = createForm.value.permsText
    .split(/[\n,，；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (createForm.value.type === 2 && !perms.length)
    return (createError.value = "按钮行至少填写一个 URL 模式（如 POST /admin/xxx）");
  createSaving.value = true;
  try {
    await api.rbacCreateMenu({
      parentId: createForm.value.parentId || null,
      type: createForm.value.type,
      code,
      name,
      ...(createForm.value.type === 1
        ? { path: createForm.value.path.trim() }
        : {}),
      ...(createForm.value.type === 2 ? { perms } : {}),
      ...(createForm.value.icon.trim()
        ? { icon: createForm.value.icon.trim() }
        : {}),
      orderNum: Number(createForm.value.orderNum) || 0,
    });
    notify("菜单已创建");
    createOpen.value = false;
    await load();
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "创建失败";
  } finally {
    createSaving.value = false;
  }
}

/* ---------- 删除（两击确认；后端 403/规则校验人话 toast） ---------- */
const confirmRowId = ref("");
async function removeRow(row: RbacMenuRow) {
  if (confirmRowId.value !== row.id) {
    confirmRowId.value = row.id;
    return;
  }
  confirmRowId.value = "";
  try {
    await api.rbacDeleteMenu(row.id);
    notify("菜单已删除");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "删除失败", true);
  }
}
function removeLabel(row: RbacMenuRow): string {
  return confirmRowId.value === row.id ? "确认删除？" : "删除";
}
</script>
<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>菜单管理</h1>
        <p>
          菜单表结构维护（目录/菜单/按钮）；编辑只改名称/图标/排序/显隐，
          结构与 URL 模式由代码登记，删除规则后端校验。
        </p>
      </div>
      <div class="head-actions">
        <button class="btn ghost" @click="router.push('/rbac-roles')">
          返回角色管理
        </button>
        <button
          v-if="canWrite('rbac-roles')"
          class="btn primary"
          @click="openCreate"
        >
          ＋ 新建菜单
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
              <th>类型</th>
              <th>path</th>
              <th>URL 模式</th>
              <th>排序</th>
              <th>显隐</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="8"><div class="row-skeleton"></div></td>
            </tr>
            <tr v-else-if="loadError">
              <td colspan="8" class="empty-cell">
                {{ loadError }}
                <button class="btn mini ghost" @click="load">重试</button>
              </td>
            </tr>
            <tr v-else-if="!flatRows.length">
              <td colspan="8" class="empty-cell">暂无菜单</td>
            </tr>
            <tr v-for="{ node, depth } in flatRows" v-else :key="node.row.id">
              <td>
                <span :style="{ display: 'inline-block', width: `${depth * 16}px` }"></span>
                <code>{{ node.row.code }}</code>
                <span v-if="node.row.builtin" class="status info builtin-tag">内置</span>
              </td>
              <td><strong>{{ node.row.name }}</strong></td>
              <td>
                <span class="status" :class="TYPE_CLASS[node.row.type]">{{
                  TYPE_TEXT[node.row.type]
                }}</span>
              </td>
              <td><code class="cell-path">{{ node.row.path || "—" }}</code></td>
              <td>
                <code class="cell-perms">{{
                  node.row.perms?.length ? node.row.perms.join("；") : "—"
                }}</code>
              </td>
              <td>{{ node.row.orderNum ?? 0 }}</td>
              <td>
                <span
                  class="status"
                  :class="node.row.isShow !== false ? 'success' : 'warning'"
                  >{{ node.row.isShow !== false ? "显示" : "隐藏" }}</span
                >
              </td>
              <td class="row-actions">
                <button
                  v-if="canWrite('rbac-roles')"
                  class="btn mini primary"
                  @click="openEdit(node.row)"
                >
                  编辑
                </button>
                <button
                  v-if="canWrite('rbac-roles')"
                  class="btn mini danger-btn"
                  @click="removeRow(node.row)"
                >
                  {{ removeLabel(node.row) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 编辑弹层：结构字段只读展示，可编辑仅 name/icon/orderNum/isShow -->
    <div v-if="editOpen" class="drawer-mask" @click.self="editOpen = false">
      <aside class="drawer product-create menu-drawer">
        <div class="drawer-head">
          <div>
            <h2>编辑菜单 · {{ editTarget?.code }}</h2>
          </div>
          <button aria-label="关闭" @click="editOpen = false">×</button>
        </div>
        <div class="struct-card">
          <p><b>类型</b>{{ TYPE_TEXT[editTarget?.type ?? 1] }}<b>父级</b>{{ editTarget ? parentLabel(editTarget) : "" }}</p>
          <p v-if="editTarget?.path"><b>path</b>{{ editTarget.path }}</p>
          <p v-if="editTarget?.perms?.length">
            <b>URL 模式</b>{{ editTarget.perms.join("；") }}
          </p>
          <p class="struct-hint">
            结构字段（编码/类型/父级/path/URL 模式）由代码登记，页内不可改。
          </p>
        </div>
        <div class="product-form">
          <label>
            名称
            <input v-model.trim="editForm.name" placeholder="菜单显示名" />
          </label>
          <label>
            图标
            <input
              v-model.trim="editForm.icon"
              placeholder="如 orders / products（未知图标回退总览）"
            />
          </label>
          <label>
            排序
            <input v-model.number="editForm.orderNum" type="number" step="1" />
          </label>
          <label class="checkbox-row">
            <input
              v-model="editForm.isShow"
              type="checkbox"
              class="raw-checkbox"
            />
            侧栏显示（隐藏=授权也不出现在菜单树）
          </label>
        </div>
        <p v-if="editError" class="form-hint">{{ editError }}</p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="editOpen = false">取消</button>
          <button class="btn primary" :disabled="editSaving" @click="submitEdit">
            {{ editSaving ? "保存中..." : "保存修改" }}
          </button>
        </div>
      </aside>
    </div>

    <!-- 新建自建节点：结构字段全开放（POST 规则后端校验） -->
    <div v-if="createOpen" class="drawer-mask" @click.self="createOpen = false">
      <aside class="drawer product-create menu-drawer">
        <div class="drawer-head">
          <div>
            <h2>新建菜单</h2>
          </div>
          <button aria-label="关闭" @click="createOpen = false">×</button>
        </div>
        <div class="product-form">
          <label>
            父级
            <select v-model="createForm.parentId">
              <option value="">—（根级）—</option>
              <option v-for="p in parentOptions" :key="p.id" :value="p.id">
                {{ p.name }}（{{ p.code }}·{{ TYPE_TEXT[p.type] }}）
              </option>
            </select>
          </label>
          <label>
            类型
            <select v-model.number="createForm.type">
              <option :value="0">目录（侧栏分组）</option>
              <option :value="1">菜单（路由页面）</option>
              <option :value="2">按钮（绑定 URL 模式）</option>
            </select>
          </label>
          <label>
            编码
            <input
              v-model.trim="createForm.code"
              placeholder="如 campus-manager-tools（唯一）"
            />
          </label>
          <label>
            名称
            <input v-model.trim="createForm.name" placeholder="菜单显示名" />
          </label>
          <label v-if="createForm.type === 1">
            路由 path
            <input v-model.trim="createForm.path" placeholder="如 /products" />
          </label>
          <label v-if="createForm.type === 2" class="wide">
            URL 模式（每行一个）
            <textarea
              v-model.trim="createForm.permsText"
              rows="3"
              placeholder="POST /admin/xxx&#10;PATCH /admin/xxx/:id"
            ></textarea>
          </label>
          <label>
            图标
            <input
              v-model.trim="createForm.icon"
              placeholder="如 orders / products（选填）"
            />
          </label>
          <label>
            排序
            <input v-model.number="createForm.orderNum" type="number" step="1" />
          </label>
        </div>
        <p v-if="createError" class="form-hint">{{ createError }}</p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="createOpen = false">取消</button>
          <button
            class="btn primary"
            :disabled="createSaving"
            @click="submitCreate"
          >
            {{ createSaving ? "创建中..." : "创建菜单" }}
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
.menu-drawer {
  width: min(560px, 96vw);
}
.builtin-tag {
  margin-left: 6px;
  font-size: 10px;
}
.cell-path,
.cell-perms {
  font-size: 11px;
  color: var(--muted);
}
.cell-perms {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.struct-card {
  border: 1px dashed #c2d4c9;
  border-radius: 12px;
  background: #f6faf7;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--muted);
}
.struct-card p {
  margin: 2px 0;
  word-break: break-all;
}
.struct-card b {
  margin-right: 8px;
  color: var(--text, #1c2b21);
}
.struct-card b + b {
  margin-left: 12px;
}
.struct-hint {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.8;
}
</style>
