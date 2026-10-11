<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import { isSuper, type RbacMe } from "../session";
import type {
  AccountGrant,
  AdminAccount,
  Campus,
  RbacRole,
} from "../types";
import { fmtDateTime } from "../utils/datetime";
import AdminPagination from "../shared/ui/AdminPagination.vue";

/**
 * 账号管理（RBAC V1，2026-09-19）：
 * - 列表/新建/编辑将角色（功能权限）与账号数据范围分开展示；
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
const deleteSaving = ref(false);
const deleteDialogOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (open: boolean) => {
    if (!open && !deleteSaving.value) deleteTarget.value = null;
  },
});

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
    if (
      drawerOpen.value &&
      form.value.orgLevel === "campus" &&
      !campusFilterOrgId.value &&
      selectedCampusIds.value.length
    ) {
      campusFilterOrgId.value = inferCampusOrganization(selectedCampusIds.value);
    }
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
    : [],
);
function inferCampusOrganization(campusIds: string[]): string {
  const organizationIds = new Set(
    campusOptions.value
      .filter((campus) => campusIds.includes(campus.id))
      .map((campus) => campus.organizationId)
      .filter((organizationId): organizationId is string => Boolean(organizationId)),
  );
  return organizationIds.size === 1 ? [...organizationIds][0] : "";
}
function changeCampusOrganization(organizationId: string) {
  campusFilterOrgId.value = organizationId;
  selectedCampusIds.value = organizationId
    ? selectedCampusIds.value.filter((campusId) =>
        campusOptions.value.some(
          (campus) => campus.id === campusId && campus.organizationId === organizationId,
        ),
      )
    : [];
}
function campusLabel(id?: string | null): string {
  if (!id) return "—";
  const hit = campusOptions.value.find((c) => c.id === id);
  return hit?.shortName || hit?.name || id;
}
function accountRoleNames(row: AdminAccount): string[] {
  return [...new Set((row.grants ?? []).map((grant) => grant.roleName || grant.roleCode))];
}
function accountScopeLabel(row: AdminAccount): string {
  if (row.orgLevel === "platform") return "整个平台";
  if (row.orgLevel === "org") return `整个组织 · ${orgLabel(row.organizationId)}`;
  if (row.orgLevel === "campus") {
    const campuses = [...new Set((row.grants ?? []).flatMap((grant) => grant.campusId ? [campusLabel(grant.campusId)] : []))];
    return campuses.length ? `指定校区 · ${campuses.join("、")}` : "指定校区";
  }
  // 兼容尚未迁移 orgLevel 的历史账号，仅用于展示，不参与权限判定。
  return (row.grants ?? []).some((grant) => grant.scope === "platform")
    ? "整个平台（历史账号）"
    : "指定校区（历史账号）";
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
function changePage(nextPage: number) {
  page.value = nextPage;
  void load();
}
function changePageSize(nextPageSize: number) {
  pageSize.value = nextPageSize;
  page.value = 1;
  void load();
}

/* ---------- 新建/编辑抽屉 ---------- */
const drawerOpen = ref(false);
const drawerSaving = ref(false);
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
const hasCampusAdminRole = computed(() => selectedRoleCodes.value.includes("campus-admin"));
function showDrawerError(message: string) {
  ElMessage({ message, type: "error", duration: 3500, showClose: true });
}
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
  campusFilterOrgId.value =
    row.organizationId ?? inferCampusOrganization(selectedCampusIds.value);
  drawerOpen.value = true;
  if (!roleOptions.value.length) void ensureOptions();
}
function validateGrants(): string | null {
  if (!selectedRoleCodes.value.length) return "请至少选择一个角色";
  if (hasCampusAdminRole.value && form.value.orgLevel !== "campus")
    return "校区管理员的数据范围只能设置为指定校区";
  if (form.value.orgLevel === "campus" && !campusFilterOrgId.value)
    return "请先选择校区所属组织";
  if (form.value.orgLevel === "campus" && !selectedCampusIds.value.length)
    return "请选择该账号可以管理的校区";
  if (hasCampusAdminRole.value && selectedCampusIds.value.length !== 1)
    return "校区管理员只能管理一个校区";
  return null;
}
function roleNameOf(code: string): string {
  return roleOptions.value.find((r) => r.code === code)?.name ?? code;
}
function toggleRole(code: string) {
  const adding = !selectedRoleCodes.value.includes(code);
  selectedRoleCodes.value = !adding
    ? selectedRoleCodes.value.filter((item) => item !== code)
    : [...selectedRoleCodes.value, code];
  if (adding && code === "campus-admin") {
    form.value.orgLevel = "campus";
    form.value.organizationId = "";
    selectedCampusIds.value = selectedCampusIds.value.slice(0, 1);
  }
}
function toggleCampus(id: string) {
  if (hasCampusAdminRole.value) {
    selectedCampusIds.value = selectedCampusIds.value.includes(id) ? [] : [id];
    return;
  }
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
  if (hasCampusAdminRole.value && level !== "campus") {
    showDrawerError("校区管理员只能绑定一个指定校区");
    return;
  }
  form.value.orgLevel = level;
  if (level !== "org") form.value.organizationId = "";
}
const authorizationSummary = computed(() => {
  const roles = selectedRoleCodes.value.map(roleNameOf);
  const roleText = roles.length ? roles.join("、") : "尚未选择角色";
  if (form.value.orgLevel === "platform") return `${roleText}，可在平台全部组织和校区生效`;
  if (form.value.orgLevel === "org") return `${roleText}，仅在 ${form.value.organizationId ? orgLabel(form.value.organizationId) : "所选组织"} 内生效`;
  if (!campusFilterOrgId.value) return `${roleText}，请先选择组织，再选择该组织下的校区`;
  const campuses = selectedCampusIds.value.map(campusLabel);
  return campuses.length
    ? `${roleText}，仅在 ${orgLabel(campusFilterOrgId.value)} 的 ${campuses.join("、")} 生效`
    : `${roleText}，已选择 ${orgLabel(campusFilterOrgId.value)}，请继续选择校区`;
});
async function submitDrawer() {
  if (!editingId.value) {
    if (!form.value.username.trim())
      return showDrawerError("请输入账号名");
    if (form.value.password.length < 8)
      return showDrawerError("初始密码至少 8 位");
  } else if (form.value.password && form.value.password.length < 8) {
    return showDrawerError("重置密码至少 8 位");
  }
  if (form.value.orgLevel === "org" && !form.value.organizationId)
    return showDrawerError("组织级账号必须选择所属组织");
  const grantError = validateGrants();
  if (grantError) return showDrawerError(grantError);
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
    showDrawerError(e instanceof Error ? e.message : "保存失败");
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
/** Element Plus 表格槽位暴露 DefaultRow；运行时校验身份字段后再收窄。 */
function accountRow(row: unknown): AdminAccount {
  if (
    !row ||
    typeof row !== "object" ||
    typeof (row as { id?: unknown }).id !== "string" ||
    typeof (row as { username?: unknown }).username !== "string"
  ) {
    throw new TypeError("账号列表返回了无效的行数据");
  }
  return row as AdminAccount;
}
async function confirmDelete() {
  const row = deleteTarget.value;
  if (!row) return;
  deleteSaving.value = true;
  try {
    await api.deleteAccount(row.id);
    deleteTarget.value = null;
    notify("账号已删除");
    await load();
  } catch (e) {
    deleteTarget.value = null;
    notify(e instanceof Error ? e.message : "删除失败", true);
  } finally {
    deleteSaving.value = false;
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
        <ElButton v-if="isSuper" type="primary" @click="openCreate">
          新建账号
        </ElButton>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="{ error: toastError }" role="status">
      {{ toast }}
    </div>

    <div class="data-panel">
      <div class="panel-head toolbar">
        <ElInput
          v-model="keyword"
          class="account-search"
          clearable
          aria-label="搜索账号"
          placeholder="搜索账号 / 昵称..."
          @keyup.enter="search"
          @clear="search"
        >
          <template #append>
            <ElButton @click="search">搜索</ElButton>
          </template>
        </ElInput>
      </div>
      <ElAlert v-if="loadError" class="load-alert" type="error" show-icon :closable="false">
        <template #title>
          {{ loadError }}
          <ElButton link type="primary" @click="load">重试</ElButton>
        </template>
      </ElAlert>
      <ElTable
        v-if="!loadError"
        v-loading="loading"
        :data="rows"
        row-key="id"
        empty-text="暂无账号"
        class="account-table"
      >
        <ElTableColumn prop="username" label="账号" min-width="150">
          <template #default="{ row }"><strong>{{ row.username }}</strong></template>
        </ElTableColumn>
        <ElTableColumn prop="nickname" label="昵称" min-width="130">
          <template #default="{ row }">{{ row.nickname || "—" }}</template>
        </ElTableColumn>
        <ElTableColumn label="角色授权" min-width="240">
          <template #default="{ row }">
            <div class="grant-badges">
              <ElTag
                v-for="roleName in accountRoleNames(accountRow(row))"
                :key="roleName"
                type="info"
                effect="light"
              >
                {{ roleName }}
              </ElTag>
              <span v-if="!(row.grants ?? []).length" class="muted">未授权</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="数据范围" min-width="220">
          <template #default="{ row }">
            <span>{{ accountScopeLabel(accountRow(row)) }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="status" label="状态" width="90">
          <template #default="{ row }">
            <ElTag :type="row.status === 'active' ? 'success' : 'warning'">
              {{ row.status === "active" ? "启用" : "停用" }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="createdAt" label="创建时间" min-width="170">
          <template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="250">
          <template #default="{ row }">
            <div class="row-actions">
              <ElButton size="small" plain @click="openPreview(accountRow(row))">预览权限</ElButton>
              <template v-if="isSuper && row.username !== 'admin'">
                <ElButton size="small" type="primary" plain @click="openEdit(accountRow(row))">编辑</ElButton>
                <ElButton size="small" type="danger" plain @click="removeRow(accountRow(row))">删除</ElButton>
              </template>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
      <AdminPagination
        v-if="!loadError"
        :page="page"
        :page-size="pageSize"
        :page-sizes="PAGE_SIZES"
        :total="total"
        @update:page="changePage"
        @update:page-size="changePageSize"
      />
    </div>

    <!-- 新建/编辑抽屉：基本信息 + 授权编辑器（多行 角色×范围×校区） -->
    <ElDialog
      v-model="drawerOpen"
      class="account-dialog account-edit-dialog"
      :title="editingId ? `编辑账号 ${form.username}` : '新建账号'"
      width="min(760px, calc(100vw - 32px))"
      align-center
      destroy-on-close
      modal-class="account-dialog-overlay"
      :show-close="!drawerSaving"
      :close-on-click-modal="!drawerSaving"
      :close-on-press-escape="!drawerSaving"
    >
      <ElForm class="account-form" label-position="top">
        <ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"><ElFormItem label="账号">
            <ElInput
              v-model="form.username"
              :disabled="!!editingId"
              placeholder="3-20 位字母/数字/下划线"
            />
          </ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem :label="editingId ? '重置密码（留空不改）' : '初始密码'">
            <ElInput
              v-model="form.password"
              type="password"
              show-password
              placeholder="至少 8 位"
              autocomplete="new-password"
            />
          </ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="昵称">
            <ElInput v-model="form.nickname" placeholder="如：仓储小王" />
          </ElFormItem></ElCol>
          <ElCol v-if="editingId" :xs="24" :sm="12"><ElFormItem label="状态">
            <ElSelect v-model="form.status" class="full-width">
              <ElOption label="启用" value="active" />
              <ElOption label="停用（立即失去后台访问）" value="disabled" />
            </ElSelect>
          </ElFormItem></ElCol>
        </ElRow>
      </ElForm>
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
            <p class="step-help">
              {{ hasCampusAdminRole ? "校区管理员只能绑定一个校区。" : "数据范围属于账号本身，不会因选择不同角色而改变。" }}
            </p>
            <div class="scope-options" role="radiogroup" aria-label="账号数据范围">
              <button
                type="button"
                role="radio"
                :disabled="hasCampusAdminRole"
                :aria-checked="form.orgLevel === 'platform'"
                :class="{ selected: form.orgLevel === 'platform' }"
                @click="setOrgLevel('platform')"
              ><strong>整个平台</strong><small>访问所有组织和校区</small></button>
              <button
                type="button"
                role="radio"
                :disabled="hasCampusAdminRole"
                :aria-checked="form.orgLevel === 'org'"
                :class="{ selected: form.orgLevel === 'org' }"
                @click="setOrgLevel('org')"
              ><strong>整个组织</strong><small>访问某个组织下的全部校区</small></button>
              <button
                type="button"
                role="radio"
                :aria-checked="form.orgLevel === 'campus'"
                :class="{ selected: form.orgLevel === 'campus' }"
                @click="setOrgLevel('campus')"
              ><strong>指定校区</strong><small>先选组织，再选择其中一个或多个校区</small></button>
            </div>

            <div v-if="form.orgLevel === 'org'" class="scope-detail">
              <label for="account-organization">选择组织</label>
              <ElSelect id="account-organization" v-model="form.organizationId" class="scope-select" placeholder="请选择组织">
                <ElOption v-for="o in orgOptions" :key="o.id" :label="o.shortName || o.name" :value="o.id" />
              </ElSelect>
            </div>

            <div v-if="form.orgLevel === 'campus'" class="scope-detail campus-cascade">
              <div class="cascade-step">
                <div class="cascade-step-heading">
                  <span>1</span>
                  <div><strong>选择组织</strong><small>校区必须属于同一个组织</small></div>
                </div>
                <ElSelect
                  id="campus-org-filter"
                  :model-value="campusFilterOrgId"
                  class="campus-org-select"
                  placeholder="请选择组织"
                  aria-label="选择校区所属组织"
                  @change="changeCampusOrganization"
                >
                    <ElOption v-for="o in orgOptions" :key="o.id" :label="o.shortName || o.name" :value="o.id" />
                </ElSelect>
              </div>
              <div class="cascade-step" :class="{ disabled: !campusFilterOrgId }">
                <div class="campus-picker-toolbar">
                  <div class="cascade-step-heading">
                    <span>2</span>
                    <div><strong>选择校区</strong><small>{{ campusFilterOrgId ? `仅显示 ${orgLabel(campusFilterOrgId)} 的校区` : "完成上一步后可选择" }}</small></div>
                  </div>
                  <ElButton v-if="!hasCampusAdminRole && campusFilterOrgId && groupedCampuses.length" link type="primary" @click="toggleVisibleCampuses">
                    {{ allVisibleCampusesSelected ? "取消全选" : "全选当前结果" }}
                  </ElButton>
                </div>
                <div v-if="campusFilterOrgId" class="campus-choice-grid">
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
                <div v-else class="campus-prerequisite">请先选择组织，再选择校区</div>
              </div>
            </div>
          </fieldset>

          <div class="authorization-summary" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.4 8.2 8 10 4.6-1.8 8-5 8-10V6l-8-3Zm-3 9 2 2 4-5" /></svg>
            <div><strong>授权结果</strong><p>{{ authorizationSummary }}</p></div>
          </div>
        </section>
      <template #footer>
        <div class="account-dialog-actions">
          <ElButton :disabled="drawerSaving" @click="drawerOpen = false">取消</ElButton>
          <ElButton type="primary" :loading="drawerSaving" @click="submitDrawer">
            {{ editingId ? "保存修改" : "创建账号" }}
          </ElButton>
        </div>
      </template>
    </ElDialog>

    <!-- 有效权限预览：角色 + 权限码按目录组分块 -->
    <ElDialog
      v-model="previewOpen"
      class="account-dialog permission-preview-dialog"
      :title="`有效权限 · ${previewAccount?.username ?? ''}`"
      width="min(680px, calc(100vw - 32px))"
      align-center
      destroy-on-close
      modal-class="account-dialog-overlay"
    >
      <div v-loading="previewLoading" class="permission-preview-body">
        <template v-if="previewMe">
          <p class="drawer-sec">账号数据范围</p>
          <div class="preview-perms">
            <ElTag type="success">{{ previewAccount ? accountScopeLabel(previewAccount) : "—" }}</ElTag>
          </div>
          <p class="drawer-sec">生效角色</p>
          <div class="preview-roles">
            <div
              v-for="r in previewMe.roles"
              :key="r.id"
              class="preview-role"
            >
              <ElTag :type="r.status === 'active' ? 'info' : 'warning'">{{ r.name }}</ElTag>
              <small>
                {{ r.builtin ? "系统内置角色" : "自定义角色" }}
                {{ r.status === "active" ? "" : "· 已停用" }}
              </small>
            </div>
            <ElEmpty v-if="!previewMe.roles.length" description="未挂任何角色（无后台权限）" :image-size="72" />
          </div>
          <p class="drawer-sec">可见菜单</p>
          <div class="preview-perms">
            <ElTag v-for="m in previewMe.menus ?? []" :key="m.code" type="info">{{ m.name }}</ElTag>
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
              <ElTag v-for="permission in group.perms" :key="permission" type="info">
                {{ permission }}
              </ElTag>
            </div>
          </div>
        </template>
      </div>
    </ElDialog>
  
    <!-- 删除确认弹窗（与角色管理同款） -->
    <ElDialog
      v-model="deleteDialogOpen"
      class="account-dialog delete-account-dialog"
      title="删除账号"
      width="min(420px, 92vw)"
      align-center
      modal-class="account-dialog-overlay"
      :show-close="!deleteSaving"
      :close-on-click-modal="!deleteSaving"
      :close-on-press-escape="!deleteSaving"
    >
      <p class="delete-copy">
        确认删除账号「{{ deleteTarget?.username }}」？删除后该账号立即无法登录，
        已授角色与数据边界一并失效。
      </p>
      <template #footer>
        <ElButton :disabled="deleteSaving" @click="deleteDialogOpen = false">取消</ElButton>
        <ElButton type="danger" :loading="deleteSaving" @click="confirmDelete">确认删除</ElButton>
      </template>
    </ElDialog>
</div>
</template>
<style scoped>
/* 样式对齐 FeaturedPage：全局 .workspace/.page-head/.data-panel/table/.btn 不重写，
   scoped 只留本页私有（行内提示条含错误态 / 授权徽章 / 授权编辑行 / 预览分块）。 */
.toolbar {
  padding: 14px 16px;
  display: flex;
  gap: 10px;
}
.account-search { width: min(420px, 100%); }
.load-alert { margin: 0 14px 12px; width: auto; }
.account-table { width: 100%; }
.row-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
}
.row-actions :deep(.el-button + .el-button) { margin-left: 0; }
.full-width,
.scope-select { width: 100%; }
.delete-copy {
  margin: 0;
  color: #4c5c53;
  font-size: 14px;
  line-height: 1.7;
}
.permission-preview-body { min-height: 120px; }
.preview-roles { display: grid; gap: 8px; }
.account-dialog-actions {
  display: flex;
  gap: 10px;
}
.account-dialog-actions :deep(.el-button) {
  min-height: 44px;
  flex: 1;
  border-radius: 10px;
  font-weight: 700;
}
.account-dialog-actions :deep(.el-button + .el-button) { margin-left: 0; }
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
.campus-picker-toolbar {
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
.scope-options button:focus-visible {
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
.scope-select { margin-top: 7px; }
.campus-cascade {
  display: grid;
  gap: 12px;
  padding: 14px;
}
.cascade-step {
  border: 1px solid #dce7e1;
  border-radius: 11px;
  background: #fff;
  padding: 12px;
}
.cascade-step.disabled {
  border-style: dashed;
  background: #f6f8f7;
}
.cascade-step-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.cascade-step-heading > span {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border-radius: 50%;
  background: #e6f1ec;
  color: #175c45;
  font-size: 11px;
  font-weight: 800;
}
.cascade-step-heading > div { display: grid; min-width: 0; gap: 2px; }
.cascade-step-heading strong { color: #294a3c; font-size: 12px; }
.cascade-step-heading small { color: #687970; font-size: 11px; line-height: 1.4; }
.campus-org-select { width: 100%; margin-top: 10px; }
.campus-prerequisite {
  margin-top: 10px;
  border-radius: 9px;
  background: #eef2f0;
  padding: 18px 12px;
  color: #687970;
  font-size: 12px;
  text-align: center;
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
  .campus-picker-toolbar :deep(.el-button) { align-self: flex-end; min-height: 44px; }
  .step-help { margin-left: 0; }
}

:deep(.account-table .el-table__cell) { padding-block: 12px; }

/* Element Plus 保留行为与可访问性，视觉延续旧版居中弹框。 */
:global(.account-dialog-overlay) {
  background: #061d1680;
  backdrop-filter: blur(3px);
}
:global(.account-dialog.el-dialog) {
  display: flex;
  max-height: min(90vh, 900px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  box-shadow: 0 24px 70px #062e2340;
}
:global(.account-dialog .el-dialog__header) {
  min-height: 72px;
  margin: 0;
  padding: 24px 26px 16px;
  border-bottom: 1px solid var(--line);
}
:global(.account-dialog .el-dialog__title) {
  color: #153628;
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -0.3px;
}
:global(.account-dialog .el-dialog__headerbtn) {
  top: 18px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #f0f4f1;
}
:global(.account-dialog .el-dialog__headerbtn:hover) { background: #e3ece6; }
:global(.account-dialog .el-dialog__headerbtn .el-dialog__close) {
  color: #52645a;
  font-size: 20px;
}
:global(.account-dialog .el-dialog__body) {
  min-height: 0;
  overflow-y: auto;
  padding: 22px 26px 8px;
  scrollbar-color: #c2d4c9 transparent;
  scrollbar-width: thin;
}
:global(.account-dialog .el-dialog__footer) {
  padding: 14px 26px 26px;
  border-top: 1px solid var(--line);
  background: #fff;
  box-shadow: 0 -10px 24px #163f2b0a;
}
:global(.permission-preview-dialog .el-dialog__body) { padding-bottom: 26px; }
:global(.delete-account-dialog .el-dialog__header) { min-height: 64px; padding-top: 20px; }
:global(.delete-account-dialog .el-dialog__body) { padding: 18px 26px 8px; }

@media (prefers-reduced-motion: reduce) {
  .role-choice,
  .campus-choice,
  .scope-options button { transition: none; }
}
</style>
