<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { isSuper, type RbacMe } from "../session";
import type {
  AccountGrant,
  AdminAccount,
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
/** 删除确认弹窗目标账号（道哥 2026-10-10：弃两击改统一弹窗） */
const deleteTarget = ref<AdminAccount | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function notify(msg: string, error = false) {
  toast.value = msg;
  toastError.value = error;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), error ? 4200 : 2600);
}

/* ---------- 下拉数据：全量角色 + 组织 + 校区 ---------- */
const roleOptions = ref<RbacRole[]>([]);
type CampusOpt = Pick<Campus, "id" | "name" | "shortName"> & {
  organizationId?: string | null;
};
const campusOptions = ref<Array<CampusOpt>>([]);
/** IKKRMP 组织化：组织列表（账号层级与校区分组过滤共用） */
const orgOptions = ref<{ id: string; name: string; shortName?: string }[]>([]);
async function ensureOptions() {
  try {
    const [rolesRaw, campuses] = await Promise.all([
      isSuper.value ? api.rbacRoles() : Promise.resolve([]),
      api.adminCampuses("filter"),
    ]);
    // 超级管理员为系统内置唯一身份（道哥 2026-09-22）：授权下拉不显示、不可选
    roleOptions.value = rolesRaw.filter((r) => r.code !== "super-admin");
    campusOptions.value = campuses as typeof campusOptions.value;
    api
      .organizations()
      .then((list) => (orgOptions.value = list))
      .catch(() => {});
  } catch {
    /* 表单打开时再兜底提示 */
  }
}
function orgLabel(id?: string | null): string {
  if (!id) return "—";
  const hit = orgOptions.value.find((o) => o.id === id);
  return hit?.shortName || hit?.name || id;
}
/** 校区范围选择器：组织只用于筛选，不参与最终授权数据。 */
const campusFilterOrgId = ref("");
const groupedCampuses = computed(() =>
  campusFilterOrgId.value
    ? campusOptions.value.filter((c) => c.organizationId === campusFilterOrgId.value)
    : campusOptions.value,
);
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
const drawerOpen = ref(false);
const drawerSaving = ref(false);
const drawerError = ref("");
const editingId = ref<string | null>(null); // null = 新建
const form = ref({
  username: "",
  password: "",
  nickname: "",
  status: "active" as "active" | "disabled",
  /** IKKRMP 账号层级与组织固定（平台/组织/校区；空=历史推导） */
  orgLevel: "" as "" | "platform" | "org" | "campus",
  organizationId: "",
});
/**
 * 角色只描述“能做什么”，数据边界由账号统一描述；提交时再转成 API grants。
 * 这样同一账号的多个角色不会各自携带不同范围，避免角色意外放大数据权限。
 */
const selectedRoleCodes = ref<string[]>([]);
const selectedCampusIds = ref<string[]>([]);
/** 内置超管：不可编辑授权（后端通配全权限），下拉标「内置」 */
function roleOptionLabel(r: RbacRole): string {
  return r.builtin && r.code === "super-admin"
    ? "超级管理员(内置)"
    : `${r.name}${r.builtin ? "(内置)" : ""}`;
}
function openCreate() {
  editingId.value = null;
  form.value = { username: "", password: "", nickname: "", status: "active", orgLevel: "campus", organizationId: "" };
  selectedRoleCodes.value = [];
  selectedCampusIds.value = [];
  campusFilterOrgId.value = "";
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
    orgLevel: row.orgLevel ?? (row.grants?.some((g) => g.scope === "platform") ? "platform" : "campus"),
    organizationId: row.organizationId ?? "",
  };
  selectedRoleCodes.value = [...new Set((row.grants ?? []).map((g) => g.roleCode))];
  selectedCampusIds.value = [...new Set((row.grants ?? []).flatMap((g) => g.campusId ? [g.campusId] : []))];
  campusFilterOrgId.value = row.organizationId ?? "";
  drawerError.value = "";
  drawerOpen.value = true;
  if (!roleOptions.value.length) void ensureOptions();
}
function validateGrants(): string | null {
  if (!selectedRoleCodes.value.length) return "请至少选择一个角色";
  if (form.value.orgLevel === "campus" && !selectedCampusIds.value.length)
    return "请选择该账号可以管理的校区";
  return null;
}
function roleNameOf(code: string): string {
  return roleOptions.value.find((r) => r.code === code)?.name ?? code;
}
function toggleRole(code: string) {
  selectedRoleCodes.value = selectedRoleCodes.value.includes(code)
    ? selectedRoleCodes.value.filter((item) => item !== code)
    : [...selectedRoleCodes.value, code];
}
function toggleCampus(id: string) {
  selectedCampusIds.value = selectedCampusIds.value.includes(id)
    ? selectedCampusIds.value.filter((item) => item !== id)
    : [...selectedCampusIds.value, id];
}
const allVisibleCampusesSelected = computed(() =>
  groupedCampuses.value.length > 0 && groupedCampuses.value.every((c) => selectedCampusIds.value.includes(c.id)),
);
function toggleVisibleCampuses() {
  const visibleIds = groupedCampuses.value.map((c) => c.id);
  if (allVisibleCampusesSelected.value) {
    selectedCampusIds.value = selectedCampusIds.value.filter((id) => !visibleIds.includes(id));
  } else {
    selectedCampusIds.value = [...new Set([...selectedCampusIds.value, ...visibleIds])];
  }
}
function setOrgLevel(level: "platform" | "org" | "campus") {
  form.value.orgLevel = level;
  if (level !== "org") form.value.organizationId = "";
}
const authorizationSummary = computed(() => {
  const roles = selectedRoleCodes.value.map(roleNameOf);
  const roleText = roles.length ? roles.join("、") : "尚未选择角色";
  if (form.value.orgLevel === "platform") return `${roleText}，可在平台全部组织和校区生效`;
  if (form.value.orgLevel === "org") return `${roleText}，仅在 ${form.value.organizationId ? orgLabel(form.value.organizationId) : "所选组织"} 内生效`;
  const campuses = selectedCampusIds.value.map(campusLabel);
  return `${roleText}，仅在${campuses.length ? ` ${campuses.join("、")} ` : "所选校区"}生效`;
});
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
  if (form.value.orgLevel === "org" && !form.value.organizationId)
    return (drawerError.value = "组织级账号必须选择所属组织");
  const grantError = validateGrants();
  if (grantError) return (drawerError.value = grantError);
  const scope = form.value.orgLevel === "campus" ? "campus" : "platform";
  const grantCampuses = scope === "campus" ? selectedCampusIds.value : [null];
  const grants: AccountGrant[] = selectedRoleCodes.value.flatMap(roleCode =>
    grantCampuses.map(campusId => ({
      roleCode, roleName: roleNameOf(roleCode), roleStatus: "active" as const,
      scope, campusId,
    })),
  );
  drawerSaving.value = true;
  try {
    if (editingId.value) {
      await api.updateAccount(editingId.value, {
        nickname: form.value.nickname.trim(),
        status: form.value.status,
        ...(form.value.password ? { password: form.value.password } : {}),
        orgLevel: form.value.orgLevel || null,
        organizationId:
          form.value.orgLevel === "org" ? form.value.organizationId : null,
        grants,
      });
      notify("账号已更新");
    } else {
      await api.createAccount({
        username: form.value.username.trim(),
        password: form.value.password,
        nickname: form.value.nickname.trim() || undefined,
        orgLevel: form.value.orgLevel || null,
        organizationId:
          form.value.orgLevel === "org" ? form.value.organizationId : null,
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

/* ---------- 有效权限预览（弹层，蛋词：URL 模式串 + 可见菜单树） ---------- */
const previewOpen = ref(false);
const previewLoading = ref(false);
const previewAccount = ref<AdminAccount | null>(null);
const previewMe = ref<RbacMe | null>(null);
async function openPreview(row: AdminAccount) {
  previewAccount.value = row;
  previewOpen.value = true;
  previewLoading.value = true;
  previewMe.value = null;
  try {
    previewMe.value = await api.rbacPreview(row.id);
  } catch (e) {
    notify(e instanceof Error ? e.message : "预览加载失败", true);
    previewOpen.value = false;
  } finally {
    previewLoading.value = false;
  }
}
/** URL 模式串按接口域分块（'PATCH /admin/products/:id' → 'products'；超管通配归全部）。 */
const previewGroups = computed(() => {
  const me = previewMe.value;
  if (!me) return [];
  if (me.super) return [{ group: "全部权限（超管通配 *）", perms: ["*"] }];
  const byGroup = new Map<string, string[]>();
  for (const p of me.perms ?? []) {
    const seg = /\/admin\/([^/:]+)/.exec(p)?.[1] ?? "其他";
    if (!byGroup.has(seg)) byGroup.set(seg, []);
    byGroup.get(seg)!.push(p);
  }
  return [...byGroup.entries()].map(([group, perms]) => ({ group, perms }));
});

/* ---------- 删除（确认弹窗；后端 403 人话 toast） ---------- */
function removeRow(row: AdminAccount) {
  deleteTarget.value = row;
}
async function confirmDelete() {
  const row = deleteTarget.value;
  if (!row) return;
  try {
    await api.deleteAccount(row.id);
    deleteTarget.value = null;
    notify("账号已删除");
    await load();
  } catch (e) {
    deleteTarget.value = null;
    notify(e instanceof Error ? e.message : "删除失败", true);
  }
}
</script>
<template>
  <div class="workspace rbac-workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>账号管理</h1>
        <p>
          后台账号与角色授权（角色决定功能，账号范围决定可见数据）；
          停用账号立即失去后台访问。
        </p>
      </div>
      <div class="head-actions">
        <button
          v-if="isSuper"
          class="btn primary"
          @click="openCreate"
        >
          ＋ 新建账号
        </button>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="{ error: toastError }" role="status">
      {{ toast }}
    </div>

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
                <!-- 内置超管（道哥 2026-09-22）：系统唯一身份，不可编辑/删除 -->
                <template v-if="isSuper && row.username !== 'admin'">
                  <button class="btn mini primary" @click="openEdit(row)">
                    编辑
                  </button>
                  <button class="btn mini danger-btn" @click="removeRow(row)">
                    删除
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
        <section class="permission-builder" aria-labelledby="permission-heading">
          <div class="permission-heading">
            <div>
              <p class="step-kicker">权限设置</p>
              <h3 id="permission-heading">这个账号能做什么、能看哪里</h3>
            </div>
            <span class="selection-count">已选 {{ selectedRoleCodes.length }} 个角色</span>
          </div>

          <fieldset class="permission-step">
            <legend><span>1</span>选择角色</legend>
            <p class="step-help">角色只决定功能权限，可同时选择多个，最终权限会自动合并。</p>
            <div class="role-choice-grid">
              <button
                v-for="r in roleOptions"
                :key="r.code"
                type="button"
                class="role-choice"
                :class="{ selected: selectedRoleCodes.includes(r.code) }"
                :disabled="r.status === 'disabled'"
                :aria-pressed="selectedRoleCodes.includes(r.code)"
                @click="toggleRole(r.code)"
              >
                <span class="choice-check" aria-hidden="true">
                  <svg v-if="selectedRoleCodes.includes(r.code)" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
                </span>
                <span class="choice-copy">
                  <strong>{{ roleOptionLabel(r) }}</strong>
                  <small>{{ r.remark || (r.builtin ? "系统预设角色" : "自定义角色") }}</small>
                </span>
                <span v-if="r.status === 'disabled'" class="role-state">已停用</span>
              </button>
            </div>
          </fieldset>

          <fieldset class="permission-step">
            <legend><span>2</span>设置数据范围</legend>
            <p class="step-help">数据范围属于账号本身，不会因选择不同角色而改变。</p>
            <div class="scope-options" role="radiogroup" aria-label="账号数据范围">
              <button
                type="button"
                role="radio"
                :aria-checked="form.orgLevel === 'campus'"
                :class="{ selected: form.orgLevel === 'campus' }"
                @click="setOrgLevel('campus')"
              ><strong>指定校区</strong><small>只访问选中的一个或多个校区</small></button>
              <button
                type="button"
                role="radio"
                :aria-checked="form.orgLevel === 'org'"
                :class="{ selected: form.orgLevel === 'org' }"
                @click="setOrgLevel('org')"
              ><strong>整个组织</strong><small>访问某个组织下的全部校区</small></button>
              <button
                type="button"
                role="radio"
                :aria-checked="form.orgLevel === 'platform'"
                :class="{ selected: form.orgLevel === 'platform' }"
                @click="setOrgLevel('platform')"
              ><strong>整个平台</strong><small>访问所有组织和校区</small></button>
            </div>

            <div v-if="form.orgLevel === 'org'" class="scope-detail">
              <label for="account-organization">选择组织</label>
              <select id="account-organization" v-model="form.organizationId">
                <option value="">请选择组织</option>
                <option v-for="o in orgOptions" :key="o.id" :value="o.id">
                  {{ o.shortName || o.name }}
                </option>
              </select>
            </div>

            <div v-if="form.orgLevel === 'campus'" class="scope-detail campus-picker">
              <div class="campus-picker-toolbar">
                <label for="campus-org-filter">选择校区</label>
                <div class="campus-picker-actions">
                  <select id="campus-org-filter" v-model="campusFilterOrgId" aria-label="按组织筛选校区">
                    <option value="">全部组织</option>
                    <option v-for="o in orgOptions" :key="o.id" :value="o.id">
                      {{ o.shortName || o.name }}
                    </option>
                  </select>
                  <button type="button" class="text-button" @click="toggleVisibleCampuses">
                    {{ allVisibleCampusesSelected ? "取消全选" : "全选当前结果" }}
                  </button>
                </div>
              </div>
              <div class="campus-choice-grid">
                <button
                  v-for="c in groupedCampuses"
                  :key="c.id"
                  type="button"
                  class="campus-choice"
                  :class="{ selected: selectedCampusIds.includes(c.id) }"
                  :aria-pressed="selectedCampusIds.includes(c.id)"
                  @click="toggleCampus(c.id)"
                >
                  <span class="choice-check" aria-hidden="true">
                    <svg v-if="selectedCampusIds.includes(c.id)" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
                  </span>
                  <span><strong>{{ c.shortName || c.name }}</strong><small>{{ orgLabel(c.organizationId) }}</small></span>
                </button>
                <p v-if="!groupedCampuses.length" class="empty-choice">当前组织下没有可授权校区</p>
              </div>
            </div>
          </fieldset>

          <div class="authorization-summary" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.4 8.2 8 10 4.6-1.8 8-5 8-10V6l-8-3Zm-3 9 2 2 4-5" /></svg>
            <div><strong>授权结果</strong><p>{{ authorizationSummary }}</p></div>
          </div>
        </section>
        <p v-if="drawerError" class="form-hint" role="alert">{{ drawerError }}</p>
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
          <p class="drawer-sec">可见菜单</p>
          <div class="preview-perms">
            <span
              v-for="m in previewMe.menus ?? []"
              :key="m.code"
              class="status info"
              >{{ m.name }}</span
            >
            <span v-if="!(previewMe.menus ?? []).length" class="muted"
              >无可见菜单</span
            >
          </div>
          <p class="drawer-sec">有效权限（URL 模式）</p>
          <div
            v-for="group in previewGroups"
            :key="group.group"
            class="preview-group"
          >
            <h3>{{ group.group }}</h3>
            <div class="preview-perms">
              <span
                v-for="p in group.perms"
                :key="p"
                class="status info"
                >{{ p }}</span
              >
            </div>
          </div>
        </template>
      </aside>
    </div>
  
    <!-- 删除确认弹窗（与角色管理同款） -->
    <div
      v-if="deleteTarget"
      class="drawer-mask confirm-mask"
      @click.self="deleteTarget = null"
    >
      <div class="confirm-card">
        <h3>删除账号</h3>
        <p>
          确认删除账号「{{ deleteTarget.username }}」？删除后该账号立即无法登录，
          已授角色与数据边界一并失效。
        </p>
        <div class="confirm-actions">
          <button class="btn ghost" @click="deleteTarget = null">取消</button>
          <button class="btn danger-btn" @click="confirmDelete">
            确认删除
          </button>
        </div>
      </div>
    </div>
</div>
</template>
<style scoped>
/* 样式对齐 FeaturedPage：全局 .workspace/.page-head/.data-panel/table/.btn 不重写，
   scoped 只留本页私有（行内提示条含错误态 / 授权徽章 / 授权编辑行 / 预览分块）。 */
/* 删除确认弹窗：复用全局 mask+toast；卡片走站点 token */
.confirm-card {
  width: min(400px, 92vw);
  background: #fff;
  border-radius: 16px;
  padding: 22px 24px 18px;
  box-shadow: 0 18px 48px #062e2326;
}
.confirm-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
  color: #153628;
}
.confirm-card p {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: #4c5c53;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
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
.permission-builder {
  margin-top: 22px;
  border-top: 1px solid var(--line);
  padding-top: 20px;
}
.permission-heading,
.campus-picker-toolbar,
.campus-picker-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.step-kicker {
  margin: 0 0 4px;
  color: var(--green);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
}
.permission-heading h3 {
  margin: 0;
  color: #153628;
  font-size: 16px;
}
.selection-count {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #edf7f2;
  padding: 6px 10px;
  color: #21644d;
  font-size: 11px;
  font-weight: 700;
}
.permission-step {
  margin: 20px 0 0;
  border: 0;
  padding: 0;
}
.permission-step legend {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  color: #153628;
  font-size: 13px;
  font-weight: 800;
}
.permission-step legend span {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 50%;
  background: #175c45;
  color: #fff;
  font-size: 11px;
}
.step-help {
  margin: 6px 0 10px 32px;
  color: #61736a;
  font-size: 12px;
  line-height: 1.55;
}
.role-choice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.role-choice,
.campus-choice,
.scope-options button {
  cursor: pointer;
  transition: border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}
.role-choice {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 10px;
  border: 1px solid #d8e3dd;
  border-radius: 12px;
  background: #fff;
  padding: 10px 12px;
  text-align: left;
}
.role-choice:hover:not(:disabled),
.campus-choice:hover,
.scope-options button:hover {
  border-color: #82aa99;
  background: #f7fbf9;
}
.role-choice.selected,
.campus-choice.selected,
.scope-options button.selected {
  border-color: #247558;
  background: #f0f8f4;
  box-shadow: 0 0 0 2px #24755816;
}
.role-choice:focus-visible,
.campus-choice:focus-visible,
.scope-options button:focus-visible,
.text-button:focus-visible {
  outline: 3px solid #3b82f640;
  outline-offset: 2px;
}
.role-choice:disabled {
  cursor: not-allowed;
  opacity: .55;
}
.choice-check {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  place-items: center;
  border: 1.5px solid #a9bbb2;
  border-radius: 6px;
  background: #fff;
}
.selected > .choice-check {
  border-color: #247558;
  background: #247558;
}
.choice-check svg {
  width: 14px;
  fill: none;
  stroke: #fff;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.5;
}
.choice-copy,
.campus-choice > span:last-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.choice-copy strong,
.campus-choice strong {
  overflow: hidden;
  color: #153628;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-copy small,
.campus-choice small {
  overflow: hidden;
  color: #61736a;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-state {
  margin-left: auto;
  color: #9a5a35;
  font-size: 10px;
}
.scope-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.scope-options button {
  display: grid;
  min-height: 68px;
  gap: 4px;
  border: 1px solid #d8e3dd;
  border-radius: 12px;
  background: #fff;
  padding: 11px 12px;
  color: #153628;
  text-align: left;
}
.scope-options strong { font-size: 13px; }
.scope-options small { color: #61736a; font-size: 10px; line-height: 1.45; }
.scope-detail {
  margin-top: 10px;
  border: 1px solid #dfe9e4;
  border-radius: 12px;
  background: #f9fbfa;
  padding: 12px;
}
.scope-detail > label,
.campus-picker-toolbar > label {
  color: #354b40;
  font-size: 12px;
  font-weight: 700;
}
.scope-detail > select,
.campus-picker-actions select {
  width: 100%;
  min-height: 44px;
  margin-top: 7px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  padding: 0 10px;
  color: #153628;
}
.campus-picker-actions select {
  width: auto;
  min-width: 128px;
  margin-top: 0;
}
.text-button {
  min-height: 44px;
  cursor: pointer;
  border: 0;
  background: transparent;
  padding: 0 4px;
  color: #17674d;
  font-size: 12px;
  font-weight: 700;
}
.campus-choice-grid {
  display: grid;
  max-height: 210px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 10px;
  overflow-y: auto;
}
.campus-choice {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 9px;
  border: 1px solid #d8e3dd;
  border-radius: 10px;
  background: #fff;
  padding: 8px 10px;
  text-align: left;
}
.empty-choice {
  grid-column: 1 / -1;
  margin: 0;
  padding: 20px;
  color: #61736a;
  text-align: center;
  font-size: 12px;
}
.authorization-summary {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 16px;
  border: 1px solid #bcd9cc;
  border-radius: 12px;
  background: #f0f8f4;
  padding: 12px 14px;
}
.authorization-summary > svg {
  width: 20px;
  flex: 0 0 20px;
  fill: none;
  stroke: #247558;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}
.authorization-summary strong { color: #174f3c; font-size: 12px; }
.authorization-summary p { margin: 3px 0 0; color: #3f5d50; font-size: 12px; line-height: 1.55; }
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
@media (max-width: 720px) {
  .role-choice-grid,
  .scope-options,
  .campus-choice-grid { grid-template-columns: 1fr; }
  .permission-heading,
  .campus-picker-toolbar { align-items: flex-start; flex-direction: column; }
  .campus-picker-actions { width: 100%; }
  .campus-picker-actions select { flex: 1; min-width: 0; }
  .step-help { margin-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .role-choice,
  .campus-choice,
  .scope-options button { transition: none; }
}
</style>
