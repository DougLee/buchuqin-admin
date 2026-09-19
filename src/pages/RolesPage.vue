<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { canWrite } from "../session";
import type { AdminPermission, RbacRole } from "../types";

/**
 * 角色管理（RBAC V1，2026-09-19）：
 * - 角色表 CRUD + 权限矩阵（按权限目录 group 分组勾选）；
 * - 内置角色只读（超管=全权限通配，禁改）；复制=预填权限开新码；
 * - 删除前提示关联账号数（后端仍按引用校验，403 人话 toast）。
 */
const toast = ref("");
const toastError = ref(false);
/** 行内两击删除确认 */
const confirmRowId = ref("");
function notify(msg: string, error = false) {
  toast.value = msg;
  toastError.value = error;
}

const rows = ref<RbacRole[]>([]);
const catalog = ref<AdminPermission[]>([]);
const loading = ref(true);
const loadError = ref("");

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const [roles, perms] = await Promise.all([
      api.rbacRoles(),
      api.rbacPermissions(),
    ]);
    rows.value = roles;
    catalog.value = perms;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

/** 权限矩阵分组视图：目录按 group+sort 排序分块。 */
const permGroups = computed(() => {
  const groups = new Map<
    string,
    AdminPermission[]
  >();
  for (const p of [...catalog.value].sort((a, b) => a.sort - b.sort)) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }
  return [...groups.entries()].map(([group, perms]) => ({ group, perms }));
});

/* ---------- 编辑抽屉 ---------- */
const drawerOpen = ref(false);
const drawerSaving = ref(false);
const drawerError = ref("");
/** 编辑中的角色 id；null = 新建/复制 */
const editingId = ref<string | null>(null);
/** 内置角色（超管等）只读展示 */
const editingBuiltin = ref(false);
const form = ref({ code: "", name: "", remark: "", status: "active" as "active" | "disabled" });
const checked = ref<Set<string>>(new Set());
function setChecked(code: string, on: boolean) {
  const next = new Set(checked.value);
  if (on) next.add(code);
  else next.delete(code);
  checked.value = next;
}
function toggleGroup(perms: AdminPermission[], on: boolean) {
  const next = new Set(checked.value);
  perms.forEach((p) => (on ? next.add(p.code) : next.delete(p.code)));
  checked.value = next;
}
function groupAllChecked(perms: AdminPermission[]): boolean {
  return perms.every((p) => checked.value.has(p.code));
}
function groupSomeChecked(perms: AdminPermission[]): boolean {
  return perms.some((p) => checked.value.has(p.code));
}
function scopeText(scope: string): string {
  return scope === "platform" ? "平台/跨校区" : "校区业务";
}

function openCreate() {
  editingId.value = null;
  editingBuiltin.value = false;
  form.value = { code: "", name: "", remark: "", status: "active" };
  checked.value = new Set();
  drawerError.value = "";
  drawerOpen.value = true;
}
function openEdit(role: RbacRole) {
  editingId.value = role.id;
  // 内置超管整卡禁用（通配全权限）；其它内置角色可编辑，后端兜底校验
  editingBuiltin.value = role.builtin && role.code === "super";
  form.value = {
    code: role.code,
    name: role.name,
    remark: role.remark,
    status: role.status,
  };
  checked.value = new Set(role.permissions);
  drawerError.value = "";
  drawerOpen.value = true;
}
/** 复制：预填权限与名称，code 留空新开（内置角色也可复制成自定义角色） */
function openCopy(role: RbacRole) {
  editingId.value = null;
  editingBuiltin.value = false;
  form.value = {
    code: "",
    name: `${role.name} 副本`,
    remark: role.remark,
    status: "active",
  };
  checked.value = new Set(role.permissions);
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
  if (!checked.value.size)
    return (drawerError.value = "至少勾选一个权限");
  drawerSaving.value = true;
  try {
    if (editingId.value) {
      // 内置超管不可改（整卡禁用，此处理论不可达，双保险）
      if (editingBuiltin.value) return (drawerError.value = "内置角色不可编辑");
      await api.rbacUpdateRole(editingId.value, {
        name,
        remark: form.value.remark.trim(),
        status: form.value.status,
        permissionCodes: [...checked.value],
      });
      notify("角色已更新");
    } else {
      await api.rbacCreateRole({
        code,
        name,
        remark: form.value.remark.trim() || undefined,
        permissionCodes: [...checked.value],
      });
      notify("角色已创建");
    }
    drawerOpen.value = false;
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
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>角色管理</h1>
        <p>角色的权限集合管理（编码不可改）；内置角色只读，可复制为新角色。</p>
      </div>
      <div class="head-actions">
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
              <th>权限数</th>
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
                {{ role.builtin && role.code === "super" ? "全部" : role.permissions.length }}
              </td>
              <td class="row-actions">
                <button
                  v-if="canWrite('rbac-roles')"
                  class="btn mini primary"
                  :disabled="role.builtin && role.code === 'super'"
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

    <!-- 编辑/新建/复制抽屉：基本信息 + 权限矩阵（目录组分块勾选） -->
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
        <p class="drawer-sec">权限矩阵</p>
        <!-- 内置超管：通配全权限，整卡禁用 -->
        <div v-if="editingBuiltin && form.code === 'super'" class="builtin-card">
          全部权限（内置通配）——超级管理员不受权限矩阵约束，不可编辑。
        </div>
        <template v-else>
          <div
            v-for="group in permGroups"
            :key="group.group"
            class="perm-group"
            :class="{ 'is-locked': editingBuiltin }"
          >
            <div class="perm-group-head">
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  class="raw-checkbox"
                  :disabled="editingBuiltin"
                  :checked="groupAllChecked(group.perms)"
                  @change="toggleGroup(group.perms, !groupAllChecked(group.perms))"
                />
                {{ group.group }}
                <small v-if="groupSomeChecked(group.perms) && !groupAllChecked(group.perms)">
                  （部分）
                </small>
              </label>
            </div>
            <div
              v-for="p in group.perms"
              :key="p.code"
              class="perm-line"
              :class="{ checked: checked.has(p.code) }"
            >
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  class="raw-checkbox"
                  :disabled="editingBuiltin"
                  :checked="checked.has(p.code)"
                  @change="setChecked(p.code, !checked.has(p.code))"
                />
                <span class="perm-name">{{ p.name }}</span>
                <code>{{ p.code }}</code>
                <span class="status info perm-scope">{{ scopeText(p.scope) }}</span>
              </label>
              <p v-if="p.remark" class="perm-remark">{{ p.remark }}</p>
            </div>
          </div>
        </template>
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
  width: min(640px, 96vw);
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
.perm-group {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.perm-group.is-locked {
  opacity: 0.65;
}
.perm-group-head {
  border-bottom: 1px solid #eef2ef;
  padding-bottom: 8px;
  margin-bottom: 6px;
}
.perm-line {
  padding: 5px 0;
}
.perm-line.checked {
  background: #f4fbf6;
}
.perm-name {
  font-size: 13px;
}
.perm-line code {
  font-size: 11px;
  color: var(--muted);
}
.perm-scope {
  flex: none;
}
.perm-remark {
  margin: 2px 0 0 32px;
  font-size: 11px;
  color: var(--muted);
}
</style>
