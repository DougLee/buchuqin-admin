<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { canWrite, type RbacMe } from "../session";
import type {
  AccountGrant,
  AdminAccount,
  AdminPermission,
  Campus,
  RbacRole,
} from "../types";
import { fmtDateTime } from "../utils/datetime";

/**
 * 账号管理（RBAC V1，2026-09-19）：
 * - 列表/新建/编辑走新 grants 授权模型（一账号多角色，角色×范围×校区）；
 * - 行内「预览权限」调 /admin/rbac/accounts/:id/preview 展示有效角色+权限码；
 * - 写操作按钮由 rbac.accounts.write 门控（路由层已挡只读用户，此处双保险）。
 */
const PAGE_SIZES = [10, 20, 50];
const rows = ref<AdminAccount[]>([]);
const loading = ref(true);
const loadError = ref("");
const keyword = ref("");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const toast = ref("");
const toastError = ref(false);
/** 行内两击删除确认（IKCJ3M 惯例：第一击亮确认文案，第二击执行） */
const confirmRowId = ref("");

function notify(msg: string, error = false) {
  toast.value = msg;
  toastError.value = error;
}

/* ---------- 下拉数据：全量角色 + 校区 ---------- */
const roleOptions = ref<RbacRole[]>([]);
const campusOptions = ref<Pick<Campus, "id" | "name" | "shortName">[]>([]);
async function ensureOptions() {
  try {
    const [roles, campuses] = await Promise.all([
      api.rbacRoles(),
      api.campuses(),
    ]);
    roleOptions.value = roles;
    campusOptions.value = campuses;
  } catch {
    /* 表单打开时再兜底提示 */
  }
}
function campusLabel(id?: string | null): string {
  if (!id) return "—";
  const hit = campusOptions.value.find((c) => c.id === id);
  return hit?.shortName || hit?.name || id;
}
function grantLabel(g: AccountGrant): string {
  return g.scope === "platform"
    ? `${g.roleName}·平台`
    : `${g.roleName}·${campusLabel(g.campusId)}`;
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const res = await api.adminAccounts({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
    });
    rows.value = res.items;
    total.value = res.total;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void load();
  void ensureOptions();
});
function search() {
  page.value = 1;
  void load();
}
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
);
const pageList = computed<(number | "…")[]>(() => {
  const pages = totalPages.value;
  const cur = page.value;
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const start = Math.max(2, Math.min(cur - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(cur + 1, 5));
  const list: (number | "…")[] = [1];
  if (start > 2) list.push("…");
  for (let p = start; p <= end; p++) list.push(p);
  if (end < pages - 1) list.push("…");
  list.push(pages);
  return list;
});
function goto(p: number | "…") {
  if (p === "…") return;
  page.value = p;
  void load();
}

/* ---------- 新建/编辑抽屉 ---------- */
interface GrantDraft {
  roleCode: string;
  scope: "platform" | "campus";
  campusId: string;
}
const drawerOpen = ref(false);
const drawerSaving = ref(false);
const drawerError = ref("");
const editingId = ref<string | null>(null); // null = 新建
const form = ref({
  username: "",
  password: "",
  nickname: "",
  status: "active" as "active" | "disabled",
});
const grantDrafts = ref<GrantDraft[]>([]);
/** 内置超管：不可编辑授权（后端通配全权限），下拉标「内置」 */
function roleOptionLabel(r: RbacRole): string {
  return r.builtin && r.code === "super"
    ? "超级管理员(内置)"
    : `${r.name}${r.builtin ? "(内置)" : ""}`;
}
function openCreate() {
  editingId.value = null;
  form.value = { username: "", password: "", nickname: "", status: "active" };
  grantDrafts.value = [{ roleCode: "", scope: "campus", campusId: "" }];
  drawerError.value = "";
  drawerOpen.value = true;
  if (!roleOptions.value.length) void ensureOptions();
}
function openEdit(row: AdminAccount) {
  editingId.value = row.id;
  form.value = {
    username: row.username,
    password: "",
    nickname: row.nickname,
    status: row.status,
  };
  grantDrafts.value = (row.grants ?? []).map((g) => ({
    roleCode: g.roleCode,
    scope: g.scope,
    campusId: g.campusId ?? "",
  }));
  drawerError.value = "";
  drawerOpen.value = true;
  if (!roleOptions.value.length) void ensureOptions();
}
function addGrant() {
  grantDrafts.value.push({ roleCode: "", scope: "campus", campusId: "" });
}
function removeGrant(i: number) {
  grantDrafts.value.splice(i, 1);
}
function validateGrants(): string | null {
  const seen = new Set<string>();
  for (const g of grantDrafts.value) {
    if (!g.roleCode) return "有授权行未选择角色";
    if (g.scope === "campus" && !g.campusId)
      return `校区范围授权必须选择校区（${roleNameOf(g.roleCode)}）`;
    const key = `${g.roleCode}:${g.scope}:${g.campusId}`;
    if (seen.has(key)) return "存在重复的授权行";
    seen.add(key);
  }
  return null;
}
function roleNameOf(code: string): string {
  return roleOptions.value.find((r) => r.code === code)?.name ?? code;
}
async function submitDrawer() {
  drawerError.value = "";
  if (!editingId.value) {
    if (!form.value.username.trim())
      return (drawerError.value = "请输入账号名");
    if (form.value.password.length < 8)
      return (drawerError.value = "初始密码至少 8 位");
  } else if (form.value.password && form.value.password.length < 8) {
    return (drawerError.value = "重置密码至少 8 位");
  }
  const grantError = validateGrants();
  if (grantError) return (drawerError.value = grantError);
  const grants: AccountGrant[] = grantDrafts.value.map((g) => ({
    roleCode: g.roleCode,
    roleName: roleNameOf(g.roleCode),
    roleStatus: "active",
    scope: g.scope,
    campusId: g.scope === "campus" ? g.campusId : null,
  }));
  drawerSaving.value = true;
  try {
    if (editingId.value) {
      await api.updateAccount(editingId.value, {
        nickname: form.value.nickname.trim(),
        status: form.value.status,
        ...(form.value.password ? { password: form.value.password } : {}),
        grants,
      });
      notify("账号已更新");
    } else {
      await api.createAccount({
        username: form.value.username.trim(),
        password: form.value.password,
        nickname: form.value.nickname.trim() || undefined,
        grants,
      });
      notify("账号已创建");
    }
    drawerOpen.value = false;
    await load();
  } catch (e) {
    drawerError.value = e instanceof Error ? e.message : "保存失败";
  } finally {
    drawerSaving.value = false;
  }
}

/* ---------- 有效权限预览（弹层） ---------- */
const previewOpen = ref(false);
const previewLoading = ref(false);
const previewAccount = ref<AdminAccount | null>(null);
const previewMe = ref<RbacMe | null>(null);
const permissionCatalog = ref<AdminPermission[]>([]);
async function openPreview(row: AdminAccount) {
  previewAccount.value = row;
  previewOpen.value = true;
  previewLoading.value = true;
  previewMe.value = null;
  try {
    const [me, catalog] = await Promise.all([
      api.rbacPreview(row.id),
      permissionCatalog.value.length
        ? Promise.resolve(permissionCatalog.value)
        : api.rbacPermissions(),
    ]);
    permissionCatalog.value = catalog;
    previewMe.value = me;
  } catch (e) {
    notify(e instanceof Error ? e.message : "预览加载失败", true);
    previewOpen.value = false;
  } finally {
    previewLoading.value = false;
  }
}
/** 权限码按目录 group 分块（目录外或超管通配归「其他/全部」）。 */
const previewGroups = computed(() => {
  const me = previewMe.value;
  if (!me) return [];
  if (me.super)
    return [{ group: "全部权限（内置通配）", perms: [{ code: "*", name: "全部权限", scope: "platform" as const }] }];
  const byGroup = new Map<string, { code: string; name: string; scope: string }[]>();
  for (const p of me.permissions) {
    const meta = permissionCatalog.value.find((c) => c.code === p.code);
    const group = meta?.group ?? "其他";
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push({
      code: p.code,
      name: meta?.name ?? p.code,
      scope: p.scope,
    });
  }
  return [...byGroup.entries()].map(([group, perms]) => ({ group, perms }));
});

/* ---------- 删除（两击确认；后端 403 人话 toast） ---------- */
async function removeRow(row: AdminAccount) {
  if (confirmRowId.value !== row.id) {
    confirmRowId.value = row.id;
    return;
  }
  confirmRowId.value = "";
  try {
    await api.deleteAccount(row.id);
    notify("账号已删除");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "删除失败", true);
  }
}
</script>
<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>账号管理</h1>
        <p>
          后台账号与角色授权（一账号可挂多角色，角色×范围×校区）；
          停用账号立即失去后台访问。
        </p>
      </div>
      <div class="head-actions">
        <button
          v-if="canWrite('accounts')"
          class="btn primary"
          @click="openCreate"
        >
          ＋ 新建账号
        </button>
      </div>
    </div>

    <p v-if="toast" class="feat-toast" :class="{ error: toastError }">
      {{ toast }}
    </p>

    <div class="data-panel">
      <div class="panel-head toolbar">
        <div class="filter-search">
          <span></span
          ><input
            v-model.trim="keyword"
            aria-label="搜索账号"
            placeholder="搜索账号 / 昵称..."
            @keyup.enter="search"
          />
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>昵称</th>
              <th>角色授权</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6"><div class="row-skeleton"></div></td>
            </tr>
            <tr v-else-if="loadError">
              <td colspan="6" class="empty-cell">
                {{ loadError }}
                <button class="btn mini ghost" @click="load">重试</button>
              </td>
            </tr>
            <tr v-else-if="!rows.length">
              <td colspan="6" class="empty-cell">暂无账号</td>
            </tr>
            <tr v-for="row in rows" v-else :key="row.id">
              <td><strong>{{ row.username }}</strong></td>
              <td>{{ row.nickname || "—" }}</td>
              <td>
                <div class="grant-badges">
                  <span
                    v-for="(g, i) in row.grants ?? []"
                    :key="i"
                    class="status"
                    :class="g.roleStatus === 'active' ? 'info' : 'warning'"
                    >{{ grantLabel(g) }}</span
                  >
                  <span v-if="!(row.grants ?? []).length" class="muted">未授权</span>
                </div>
              </td>
              <td>
                <span
                  class="status"
                  :class="row.status === 'active' ? 'success' : 'warning'"
                  >{{ row.status === "active" ? "启用" : "停用" }}</span
                >
              </td>
              <td>{{ fmtDateTime(row.createdAt) }}</td>
              <td class="row-actions">
                <button class="btn mini ghost" @click="openPreview(row)">
                  预览权限
                </button>
                <template v-if="canWrite('accounts')">
                  <button class="btn mini primary" @click="openEdit(row)">
                    编辑
                  </button>
                  <button class="btn mini danger-btn" @click="removeRow(row)">
                    {{ confirmRowId === row.id ? "确认删除" : "删除" }}
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
        <div class="pager-right">
          <label class="page-mode"
            >每页
            <select
              v-model.number="pageSize"
              aria-label="每页条数"
              @change="page = 1; load()"
            >
              <option v-for="size in PAGE_SIZES" :key="size" :value="size">
                {{ size }} 条
              </option>
            </select>
          </label>
          <div>
            <button :disabled="page === 1" @click="goto(page - 1)">←</button>
            <template v-for="(p, i) in pageList" :key="`${i}-${p}`">
              <button
                v-if="p !== '…'"
                :class="{ active: p === page }"
                @click="goto(p)"
              >
                {{ p }}
              </button>
              <span v-else class="pager-ellipsis">…</span>
            </template>
            <button :disabled="page === totalPages" @click="goto(page + 1)">
              →
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建/编辑抽屉：基本信息 + 授权编辑器（多行 角色×范围×校区） -->
    <div v-if="drawerOpen" class="drawer-mask" @click.self="drawerOpen = false">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <h2>{{ editingId ? `编辑账号 ${form.username}` : "新建账号" }}</h2>
          </div>
          <button aria-label="关闭" @click="drawerOpen = false">×</button>
        </div>
        <div class="product-form">
          <label>
            账号
            <input
              v-model.trim="form.username"
              :disabled="!!editingId"
              placeholder="3-20 位字母/数字/下划线"
          /></label>
          <label>
            {{ editingId ? "重置密码（留空不改）" : "初始密码" }}
            <input
              v-model="form.password"
              type="password"
              placeholder="至少 8 位"
              autocomplete="new-password"
          /></label>
          <label>
            昵称
            <input v-model.trim="form.nickname" placeholder="如：仓储小王" />
          </label>
          <label v-if="editingId">
            状态
            <select v-model="form.status">
              <option value="active">启用</option>
              <option value="disabled">停用（立即失去后台访问）</option>
            </select>
          </label>
        </div>
        <p class="drawer-sec">角色授权</p>
        <p class="drawer-note">
          一账号可挂多角色；范围选「校区」须指定归属校区（该角色仅在该校区生效）。
        </p>
        <div
          v-for="(g, i) in grantDrafts"
          :key="i"
          class="grant-row"
        >
          <select v-model="g.roleCode" aria-label="角色">
            <option value="" disabled>选择角色</option>
            <option
              v-for="r in roleOptions"
              :key="r.code"
              :value="r.code"
              :disabled="r.status === 'disabled'"
            >
              {{ roleOptionLabel(r) }}
            </option>
          </select>
          <select v-model="g.scope" aria-label="范围">
            <option value="campus">校区</option>
            <option value="platform">平台（跨校区）</option>
          </select>
          <select
            v-if="g.scope === 'campus'"
            v-model="g.campusId"
            aria-label="归属校区"
          >
            <option value="" disabled>选择校区</option>
            <option v-for="c in campusOptions" :key="c.id" :value="c.id">
              {{ c.shortName || c.name }}
            </option>
          </select>
          <button
            class="btn mini danger-btn"
            type="button"
            aria-label="移除此授权"
            @click="removeGrant(i)"
          >
            移除
          </button>
        </div>
        <button class="btn ghost add-grant" type="button" @click="addGrant">
          ＋ 添加授权
        </button>
        <p v-if="drawerError" class="form-hint">{{ drawerError }}</p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="drawerOpen = false">取消</button>
          <button
            class="btn primary"
            :disabled="drawerSaving"
            @click="submitDrawer"
          >
            {{ drawerSaving ? "保存中..." : editingId ? "保存修改" : "创建账号" }}
          </button>
        </div>
      </aside>
    </div>

    <!-- 有效权限预览：角色 + 权限码按目录组分块 -->
    <div
      v-if="previewOpen"
      class="drawer-mask"
      @click.self="previewOpen = false"
    >
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <h2>有效权限 · {{ previewAccount?.username }}</h2>
          </div>
          <button aria-label="关闭" @click="previewOpen = false">×</button>
        </div>
        <div v-if="previewLoading" class="preview-loading">加载中...</div>
        <template v-else-if="previewMe">
          <p class="drawer-sec">生效角色</p>
          <div class="drawer-fields">
            <div
              v-for="r in previewMe.roles"
              :key="r.id"
              class="wide preview-role"
            >
              <span class="status" :class="r.status === 'active' ? 'info' : 'warning'"
                >{{ r.name }}</span
              >
              <small>
                {{ r.scope === "platform" ? "平台/跨校区" : `校区 · ${campusLabel(r.campusId)}` }}
                {{ r.builtin ? "· 内置" : "" }}
                {{ r.status === "active" ? "" : "· 已停用" }}
              </small>
            </div>
            <div v-if="!previewMe.roles.length" class="wide muted">
              未挂任何角色（无后台权限）
            </div>
          </div>
          <p class="drawer-sec">有效权限码</p>
          <div
            v-for="group in previewGroups"
            :key="group.group"
            class="preview-group"
          >
            <h3>{{ group.group }}</h3>
            <div class="preview-perms">
              <span
                v-for="p in group.perms"
                :key="p.code"
                class="status info"
                >{{ p.name }}（{{ p.code }}）</span
              >
            </div>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>
<style scoped>
/* 样式对齐 FeaturedPage：全局 .workspace/.page-head/.data-panel/table/.btn 不重写，
   scoped 只留本页私有（行内提示条含错误态 / 授权徽章 / 授权编辑行 / 预览分块）。 */
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
.toolbar {
  padding: 14px 16px;
  display: flex;
  gap: 10px;
}
.grant-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.drawer-sec {
  margin: 18px 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}
.drawer-note {
  margin: 0 0 10px;
  font-size: 11px;
  color: var(--muted);
}
.grant-row {
  display: grid;
  grid-template-columns: 1.3fr 0.8fr 1.2fr auto;
  gap: 8px;
  margin-bottom: 8px;
}
.grant-row select {
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  padding: 0 8px;
  color: #153628;
  min-width: 0;
}
.grant-row .btn {
  height: 36px;
}
.add-grant {
  margin-top: 4px;
}
.preview-loading {
  color: var(--muted);
  font-size: 12px;
  padding: 20px 0;
}
.preview-role {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-role small {
  color: var(--muted);
}
.preview-group {
  margin-bottom: 12px;
}
.preview-group h3 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--green);
}
.preview-perms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
