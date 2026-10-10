<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import { isSuper } from "../session";
import type { AdminOrganization } from "../types";
import { fmtDateTime } from "../utils/datetime";

/**
 * 组织管理（IKKRMS，ADR-0001）：平台组织档案与微信配置。
 * - 列表：每组织聚合校区数/用户数 + 微信配置 hasXxx 状态位（敏感凭据永不回读）；
 * - 新建/编辑弹窗：name/shortName/wxAppId 必填唯一（wxAppId 一经登记，
 *   AppID→组织映射即生效——错登记=组织 B 小程序登录串组织）；
 * - 启停：两击确认。
 * 写操作全部后端超管专属（isSuperOnlyOperation），页内 isSuper 双保险；
 * 组织管理员（org-admin 预设）经菜单授权只读可见本页。
 */
const rows = ref<AdminOrganization[]>([]);
const loading = ref(true);
const loadError = ref("");
/** 两击确认（启停）：第一击亮确认文案，第二击执行 */
const confirmStatusId = ref("");

function notify(msg: string, error = false) {
  ElMessage({
    message: msg,
    type: error ? "error" : "success",
    duration: 2500,
    showClose: true,
  });
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    rows.value = await api.organizations();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void load();
});

/* ---------- 新建/编辑弹窗 ---------- */
const WX_APPID_RE = /^wx[0-9a-f]{16}$/;
const drawerOpen = ref(false);
const drawerSaving = ref(false);
const drawerError = ref("");
const editing = ref<AdminOrganization | null>(null); // null = 新建
const form = ref({
  name: "",
  shortName: "",
  wxAppId: "",
  mchId: "",
  serialNo: "",
  notifyDomain: "",
  wxSecret: "",
  mchApiV3Key: "",
  privateKey: "",
});
/** 敏感字段只写不回读：勾选=显式传 null 清除（勾选时输入框禁用） */
const clearFlags = ref({ wxSecret: false, mchApiV3Key: false, privateKey: false });

function openCreate() {
  editing.value = null;
  form.value = {
    name: "",
    shortName: "",
    wxAppId: "",
    mchId: "",
    serialNo: "",
    notifyDomain: "",
    wxSecret: "",
    mchApiV3Key: "",
    privateKey: "",
  };
  clearFlags.value = { wxSecret: false, mchApiV3Key: false, privateKey: false };
  drawerError.value = "";
  drawerOpen.value = true;
}
function openEdit(row: AdminOrganization) {
  editing.value = row;
  form.value = {
    name: row.name,
    shortName: row.shortName,
    wxAppId: row.wxAppId ?? "",
    mchId: row.mchId ?? "",
    serialNo: row.serialNo ?? "",
    notifyDomain: row.notifyDomain ?? "",
    wxSecret: "",
    mchApiV3Key: "",
    privateKey: "",
  };
  clearFlags.value = { wxSecret: false, mchApiV3Key: false, privateKey: false };
  drawerError.value = "";
  drawerOpen.value = true;
}
/** 敏感行状态：编辑态空输入=保留不传，传值=覆盖，勾清除=null */
function sensValue(key: "wxSecret" | "mchApiV3Key" | "privateKey"): string | null | undefined {
  if (clearFlags.value[key]) return null;
  const v = form.value[key];
  return v ? v : undefined;
}
async function submitDrawer() {
  drawerError.value = "";
  if (form.value.name.trim().length < 2) return (drawerError.value = "组织名称至少 2 字");
  if (!form.value.shortName.trim()) return (drawerError.value = "请输入组织简称");
  const appid = form.value.wxAppId.trim();
  if (!editing.value || appid) {
    if (!WX_APPID_RE.test(appid))
      return (drawerError.value = "AppID 须为 wx 开头 18 位（wx+16 位十六进制）");
  }
  const base = {
    name: form.value.name.trim(),
    shortName: form.value.shortName.trim(),
    wxAppId: appid || null,
    mchId: form.value.mchId.trim() || null,
    serialNo: form.value.serialNo.trim() || null,
    notifyDomain: form.value.notifyDomain.trim() || null,
  };
  const secrets = {
    wxSecret: sensValue("wxSecret"),
    mchApiV3Key: sensValue("mchApiV3Key"),
    privateKey: sensValue("privateKey"),
  };
  drawerSaving.value = true;
  try {
    if (editing.value) {
      await api.updateOrganization(editing.value.id, { ...base, ...secrets });
      notify("组织已更新");
    } else {
      await api.createOrganization({
        name: base.name,
        shortName: base.shortName,
        wxAppId: appid,
        ...(base.mchId ? { mchId: base.mchId } : {}),
        ...(base.serialNo ? { serialNo: base.serialNo } : {}),
        ...(base.notifyDomain ? { notifyDomain: base.notifyDomain } : {}),
        ...(secrets.wxSecret ? { wxSecret: secrets.wxSecret } : {}),
        ...(secrets.mchApiV3Key ? { mchApiV3Key: secrets.mchApiV3Key } : {}),
        ...(secrets.privateKey ? { privateKey: secrets.privateKey } : {}),
      });
      notify("组织已创建");
    }
    drawerOpen.value = false;
    await load();
  } catch (e) {
    drawerError.value = e instanceof Error ? e.message : "保存失败";
  } finally {
    drawerSaving.value = false;
  }
}

/* ---------- 启停（两击确认） ---------- */
async function toggleStatus(row: AdminOrganization) {
  if (confirmStatusId.value !== row.id) {
    confirmStatusId.value = row.id;
    return;
  }
  confirmStatusId.value = "";
  const next = row.status === "active" ? "disabled" : "active";
  try {
    await api.setOrganizationStatus(row.id, next);
    notify(next === "active" ? "组织已启用" : "组织已停用");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  }
}
function organizationRow(row: unknown): AdminOrganization {
  if (!row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string")
    throw new TypeError("组织列表返回了无效的行数据");
  return row as AdminOrganization;
}
</script>
<template>
  <div class="workspace rbac-workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>组织管理</h1>
        <p>
          维护多租户组织档案、微信小程序与支付配置；登记 AppID 后立即生效组织映射。
          写操作仅超级管理员。
        </p>
      </div>
      <div class="head-actions">
        <ElButton v-if="isSuper" type="primary" @click="openCreate">新建组织</ElButton>
      </div>
    </div>

    <div class="data-panel">
      <ElAlert v-if="loadError" class="load-alert" type="error" show-icon :closable="false">
        <template #title>{{ loadError }} <ElButton link type="primary" @click="load">重试</ElButton></template>
      </ElAlert>
      <ElTable v-else v-loading="loading" :data="rows" row-key="id" empty-text="暂无组织" class="organization-table">
        <ElTableColumn label="组织" min-width="170"><template #default="{ row }"><strong>{{ row.name }}</strong><small class="muted organization-short-name">{{ row.shortName || "—" }}</small></template></ElTableColumn>
        <ElTableColumn label="状态" width="90"><template #default="{ row }"><ElTag :type="row.status === 'active' ? 'success' : 'warning'">{{ row.status === "active" ? "启用" : "停用" }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="小程序 AppID" min-width="190"><template #default="{ row }"><code v-if="row.wxAppId">{{ row.wxAppId }}</code><span v-else class="muted">未登记（env 兜底）</span></template></ElTableColumn>
        <ElTableColumn label="微信配置" min-width="280"><template #default="{ row }"><div class="wx-badges"><ElTag :type="row.hasWxSecret ? 'success' : 'warning'">Secret</ElTag><ElTag :type="row.hasMchApiV3Key ? 'success' : 'warning'">APIv3密钥</ElTag><ElTag :type="row.hasPrivateKey ? 'success' : 'warning'">商户私钥</ElTag><ElTag :type="row.mchId ? 'info' : 'warning'">{{ row.mchId ? `商户号 ${row.mchId}` : "商户号未配" }}</ElTag></div></template></ElTableColumn>
        <ElTableColumn prop="campusCount" label="校区" width="100"><template #default="{ row }">{{ row.campusCount }}<small v-if="row.campusCount === 0" class="muted">（未开通）</small></template></ElTableColumn>
        <ElTableColumn prop="userCount" label="用户" width="80" />
        <ElTableColumn label="创建时间" min-width="170"><template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="180"><template #default="{ row }"><div class="row-actions"><template v-if="isSuper"><ElButton size="small" plain @click="openEdit(organizationRow(row))">编辑</ElButton><ElButton size="small" :type="confirmStatusId === row.id ? 'danger' : 'warning'" plain @click="toggleStatus(organizationRow(row))">{{ confirmStatusId === row.id ? (row.status === "active" ? "确认停用" : "确认启用") : (row.status === "active" ? "停用" : "启用") }}</ElButton></template><span v-else class="muted">只读</span></div></template></ElTableColumn>
      </ElTable>
    </div>

    <!-- 新建/编辑：基本信息 + 微信配置（敏感凭据只写不回读） -->
    <ElDialog v-model="drawerOpen" class="organization-dialog" :title="editing ? `编辑组织 ${editing.name}` : '新建组织'" width="min(760px, calc(100vw - 32px))" align-center destroy-on-close modal-class="organization-dialog-overlay" :show-close="!drawerSaving" :close-on-click-modal="!drawerSaving" :close-on-press-escape="!drawerSaving">
        <p class="drawer-note">
          AppID 一经登记即生效（该小程序登录直接进本组织）；名称/简称/AppID
          全局唯一。敏感凭据只写不回读——留空=保留现状，填写=覆盖，勾选清除=置空。
        </p>
        <div class="organization-form-grid">
          <label>
            组织名称
            <ElInput v-model="form.name" placeholder="2-50 字，如：某某餐饮管理公司" />
          </label>
          <label>
            组织简称
            <ElInput v-model="form.shortName" placeholder="1-20 字，如：某食社" />
          </label>
          <label>
            小程序 AppID{{ editing ? "（清空=回落平台 env 兜底）" : "" }}
            <ElInput v-model="form.wxAppId" placeholder="wx 开头 18 位" />
          </label>
        </div>
        <p class="drawer-sec">微信支付与回调</p>
        <div class="organization-form-grid">
          <label>
            商户号 mchId（组织 B 独立商户号）
            <ElInput v-model="form.mchId" placeholder="未配可留空" />
          </label>
          <label>
            证书序列号
            <ElInput v-model="form.serialNo" placeholder="未配可留空" />
          </label>
          <label>
            回调域名
            <ElInput v-model="form.notifyDomain" placeholder="如 https://api-b.example.com" />
          </label>
        </div>
        <p class="drawer-sec">敏感凭据（只写不回读）</p>
        <div class="sens-list">
          <div class="sens-row">
            <ElInput
              v-model="form.wxSecret"
              type="password"
              show-password
              :disabled="clearFlags.wxSecret"
              placeholder="小程序 Secret"
              autocomplete="new-password"
            />
            <ElTag :type="editing && editing.hasWxSecret ? 'success' : 'warning'">{{ editing && editing.hasWxSecret ? "已配置" : "未配置" }}</ElTag>
            <ElCheckbox v-model="clearFlags.wxSecret">清除</ElCheckbox>
          </div>
          <div class="sens-row">
            <ElInput
              v-model="form.mchApiV3Key"
              type="password"
              show-password
              :disabled="clearFlags.mchApiV3Key"
              placeholder="商户 APIv3 密钥"
              autocomplete="new-password"
            />
            <ElTag :type="editing && editing.hasMchApiV3Key ? 'success' : 'warning'">{{ editing && editing.hasMchApiV3Key ? "已配置" : "未配置" }}</ElTag>
            <ElCheckbox v-model="clearFlags.mchApiV3Key">清除</ElCheckbox>
          </div>
          <div class="sens-row sens-tall">
            <ElInput
              v-model="form.privateKey"
              type="textarea"
              :disabled="clearFlags.privateKey"
              :rows="3"
              placeholder="商户私钥 PEM（-----BEGIN PRIVATE KEY-----）"
            />
            <ElTag :type="editing && editing.hasPrivateKey ? 'success' : 'warning'">{{ editing && editing.hasPrivateKey ? "已配置" : "未配置" }}</ElTag>
            <ElCheckbox v-model="clearFlags.privateKey">清除</ElCheckbox>
          </div>
        </div>
        <ElAlert v-if="drawerError" class="dialog-error" type="error" show-icon :closable="false" :title="drawerError" />
        <template #footer><div class="dialog-actions"><ElButton :disabled="drawerSaving" @click="drawerOpen = false">取消</ElButton><ElButton type="primary" :loading="drawerSaving" @click="submitDrawer">{{ editing ? "保存修改" : "创建组织" }}</ElButton></div></template>
    </ElDialog>

  </div>
</template>
<style scoped>
.load-alert { margin: 14px; width: auto; }
.organization-table { width: 100%; }
.organization-short-name { display: block; }
.row-actions { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
.row-actions :deep(.el-button + .el-button) { margin-left: 0; }
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
.organization-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
  margin-top: 14px;
}
.organization-form-grid label {
  display: grid;
  gap: 7px;
  color: #374b41;
  font-size: 12px;
  font-weight: 600;
}
.wx-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
td small.muted {
  display: block;
}
.sens-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sens-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
}
.sens-row.sens-tall {
  align-items: start;
}
.sens-row :deep(.el-input),
.sens-row :deep(.el-textarea) { min-width: 0; }
.sens-row.sens-tall :deep(textarea) { font-family: monospace; }
.dialog-error { margin-top: 14px; }
.dialog-actions { display: flex; gap: 10px; }
.dialog-actions :deep(.el-button) { min-height: 44px; flex: 1; border-radius: 10px; font-weight: 700; }
.dialog-actions :deep(.el-button + .el-button) { margin-left: 0; }
:deep(.organization-table .el-table__cell) { padding-block: 12px; }
:global(.organization-dialog-overlay) { background: #061d1680; backdrop-filter: blur(3px); }
:global(.organization-dialog.el-dialog) { display: flex; max-height: min(90vh, 900px); flex-direction: column; overflow: hidden; border-radius: 18px; box-shadow: 0 24px 70px #062e2340; }
:global(.organization-dialog .el-dialog__header) { min-height: 72px; margin: 0; padding: 24px 26px 16px; border-bottom: 1px solid var(--line); }
:global(.organization-dialog .el-dialog__title) { color: #153628; font-size: 18px; font-weight: 750; }
:global(.organization-dialog .el-dialog__headerbtn) { top: 18px; right: 20px; width: 36px; height: 36px; border-radius: 10px; background: #f0f4f1; }
:global(.organization-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; padding: 22px 26px 8px; }
:global(.organization-dialog .el-dialog__footer) { padding: 14px 26px 26px; border-top: 1px solid var(--line); background: #fff; box-shadow: 0 -10px 24px #163f2b0a; }
@media (max-width: 720px) {
  .organization-form-grid { grid-template-columns: 1fr; }
  .sens-row { grid-template-columns: minmax(0, 1fr) auto; }
  .sens-row :deep(.el-checkbox) { grid-column: 1 / -1; min-height: 44px; }
}
</style>
