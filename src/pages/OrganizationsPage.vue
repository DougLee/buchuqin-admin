<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { isSuper } from "../session";
import type { AdminOrganization, OrganizationBootstrapResult } from "../types";
import { fmtDateTime } from "../utils/datetime";

/**
 * 组织管理（IKKRMS，ADR-0001）：组织 B 平台端开通流程。
 * - 列表：每组织聚合校区数/用户数 + 微信配置 hasXxx 状态位（敏感凭据永不回读）；
 * - 新建/编辑抽屉：name/shortName/wxAppId 必填唯一（wxAppId 一经登记，
 *   AppID→组织映射即生效——错登记=组织 B 小程序登录串组织）；
 * - 开通向导抽屉：组织管理员+首个校区一次提交（后端幂等，重复提交返回现状）；
 * - 启停：两击确认。
 * 写操作全部后端超管专属（isSuperOnlyOperation），页内 isSuper 双保险；
 * 组织管理员（org-admin 预设）经菜单授权只读可见本页。
 */
const rows = ref<AdminOrganization[]>([]);
const loading = ref(true);
const loadError = ref("");
const toast = ref("");
const toastError = ref(false);
/** 两击确认（启停）：第一击亮确认文案，第二击执行 */
const confirmStatusId = ref("");

function notify(msg: string, error = false) {
  toast.value = msg;
  toastError.value = error;
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

/* ---------- 新建/编辑抽屉 ---------- */
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

/* ---------- 开通组织向导（管理员+首校区一次提交，后端幂等） ---------- */
const wizardOpen = ref(false);
const wizardSaving = ref(false);
const wizardError = ref("");
const wizardOrg = ref<AdminOrganization | null>(null);
const wizardResult = ref<OrganizationBootstrapResult | null>(null);
const wizard = ref({
  adminUsername: "",
  adminPassword: "",
  adminNickname: "",
  campusName: "",
  campusShortName: "",
  campusWarehouseName: "",
});
function openWizard(row: AdminOrganization) {
  wizardOrg.value = row;
  wizardResult.value = null;
  wizard.value = {
    adminUsername: "",
    adminPassword: "",
    adminNickname: "",
    campusName: "",
    campusShortName: "",
    campusWarehouseName: "",
  };
  wizardError.value = "";
  wizardOpen.value = true;
}
async function submitWizard() {
  wizardError.value = "";
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(wizard.value.adminUsername.trim()))
    return (wizardError.value = "管理员账号需为 3-20 位字母/数字/下划线");
  if (wizard.value.adminPassword.length < 8)
    return (wizardError.value = "管理员密码至少 8 位");
  if (wizard.value.campusName.trim().length < 2)
    return (wizardError.value = "校区全称至少 2 字");
  if (wizard.value.campusShortName.trim().length < 2)
    return (wizardError.value = "校区简称至少 2 字");
  if (wizard.value.campusWarehouseName.trim().length < 2)
    return (wizardError.value = "仓库名至少 2 字");
  wizardSaving.value = true;
  try {
    wizardResult.value = await api.bootstrapOrganization(wizardOrg.value!.id, {
      adminUsername: wizard.value.adminUsername.trim(),
      adminPassword: wizard.value.adminPassword,
      ...(wizard.value.adminNickname.trim()
        ? { adminNickname: wizard.value.adminNickname.trim() }
        : {}),
      campusName: wizard.value.campusName.trim(),
      campusShortName: wizard.value.campusShortName.trim(),
      campusWarehouseName: wizard.value.campusWarehouseName.trim(),
    });
    const c = wizardResult.value.created;
    notify(
      c.admin && c.campus
        ? "开通完成：管理员与首校区已建齐"
        : `返回现状（未重复建）：管理员${c.admin ? "新建" : "沿用现有"}、校区${c.campus ? "新建" : "沿用现有"}`,
    );
    await load();
  } catch (e) {
    wizardError.value = e instanceof Error ? e.message : "开通失败";
  } finally {
    wizardSaving.value = false;
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
</script>
<template>
  <div class="workspace rbac-workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，会误染白卡 -->
    <div class="page-head">
      <div>
        <h1>组织管理</h1>
        <p>
          多租户组织与组织 B 开通（建组登记小程序 AppID 即生效映射；开通=
          组织管理员+首校区一条龙，重复提交幂等）。写操作仅超级管理员。
        </p>
      </div>
      <div class="head-actions">
        <button v-if="isSuper" class="btn primary" @click="openCreate">
          ＋ 新建组织
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
              <th>组织</th>
              <th>状态</th>
              <th>小程序 AppID</th>
              <th>微信配置</th>
              <th>校区</th>
              <th>用户</th>
              <th>创建时间</th>
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
            <tr v-else-if="!rows.length">
              <td colspan="8" class="empty-cell">暂无组织</td>
            </tr>
            <tr v-for="row in rows" v-else :key="row.id">
              <td>
                <strong>{{ row.name }}</strong>
                <small class="muted">{{ row.shortName || "—" }}</small>
              </td>
              <td>
                <span
                  class="status"
                  :class="row.status === 'active' ? 'success' : 'warning'"
                  >{{ row.status === "active" ? "启用" : "停用" }}</span
                >
              </td>
              <td>
                <code v-if="row.wxAppId">{{ row.wxAppId }}</code>
                <span v-else class="muted">未登记（env 兜底）</span>
              </td>
              <td>
                <div class="wx-badges">
                  <span class="status" :class="row.hasWxSecret ? 'success' : 'warning'">Secret</span>
                  <span class="status" :class="row.hasMchApiV3Key ? 'success' : 'warning'">APIv3密钥</span>
                  <span class="status" :class="row.hasPrivateKey ? 'success' : 'warning'">商户私钥</span>
                  <span class="status" :class="row.mchId ? 'info' : 'warning'">{{
                    row.mchId ? `商户号 ${row.mchId}` : "商户号未配"
                  }}</span>
                </div>
              </td>
              <td>
                {{ row.campusCount }}
                <small v-if="row.campusCount === 0" class="muted">（未开通）</small>
              </td>
              <td>{{ row.userCount }}</td>
              <td>{{ fmtDateTime(row.createdAt) }}</td>
              <td class="row-actions">
                <template v-if="isSuper">
                  <button class="btn mini primary" @click="openWizard(row)">
                    开通组织
                  </button>
                  <button class="btn mini ghost" @click="openEdit(row)">编辑</button>
                  <button class="btn mini danger-btn" @click="toggleStatus(row)">
                    {{ confirmStatusId === row.id
                      ? (row.status === "active" ? "确认停用" : "确认启用")
                      : (row.status === "active" ? "停用" : "启用") }}
                  </button>
                </template>
                <span v-else class="muted">只读</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新建/编辑抽屉：基本信息 + 微信配置（敏感凭据只写不回读） -->
    <div v-if="drawerOpen" class="drawer-mask" @click.self="drawerOpen = false">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <h2>{{ editing ? `编辑组织 ${editing.name}` : "新建组织" }}</h2>
          </div>
          <button aria-label="关闭" @click="drawerOpen = false">×</button>
        </div>
        <p class="drawer-note">
          AppID 一经登记即生效（该小程序登录直接进本组织）；名称/简称/AppID
          全局唯一。敏感凭据只写不回读——留空=保留现状，填写=覆盖，勾选清除=置空。
        </p>
        <div class="product-form">
          <label>
            组织名称
            <input v-model.trim="form.name" placeholder="2-50 字，如：某某餐饮管理公司" />
          </label>
          <label>
            组织简称
            <input v-model.trim="form.shortName" placeholder="1-20 字，如：某食社" />
          </label>
          <label>
            小程序 AppID{{ editing ? "（清空=回落平台 env 兜底）" : "" }}
            <input v-model.trim="form.wxAppId" placeholder="wx 开头 18 位" />
          </label>
        </div>
        <p class="drawer-sec">微信支付与回调</p>
        <div class="product-form">
          <label>
            商户号 mchId（组织 B 独立商户号）
            <input v-model.trim="form.mchId" placeholder="未配可留空" />
          </label>
          <label>
            证书序列号
            <input v-model.trim="form.serialNo" placeholder="未配可留空" />
          </label>
          <label>
            回调域名
            <input v-model.trim="form.notifyDomain" placeholder="如 https://api-b.example.com" />
          </label>
        </div>
        <p class="drawer-sec">敏感凭据（只写不回读）</p>
        <div class="sens-list">
          <div class="sens-row">
            <input
              v-model="form.wxSecret"
              type="password"
              :disabled="clearFlags.wxSecret"
              placeholder="小程序 Secret"
              autocomplete="new-password"
            />
            <span class="status" :class="editing && editing.hasWxSecret ? 'success' : 'warning'">{{
              editing && editing.hasWxSecret ? "已配置" : "未配置"
            }}</span>
            <label class="checkbox-row">
              <input v-model="clearFlags.wxSecret" class="raw-checkbox" type="checkbox" />
              清除
            </label>
          </div>
          <div class="sens-row">
            <input
              v-model="form.mchApiV3Key"
              type="password"
              :disabled="clearFlags.mchApiV3Key"
              placeholder="商户 APIv3 密钥"
              autocomplete="new-password"
            />
            <span class="status" :class="editing && editing.hasMchApiV3Key ? 'success' : 'warning'">{{
              editing && editing.hasMchApiV3Key ? "已配置" : "未配置"
            }}</span>
            <label class="checkbox-row">
              <input v-model="clearFlags.mchApiV3Key" class="raw-checkbox" type="checkbox" />
              清除
            </label>
          </div>
          <div class="sens-row sens-tall">
            <textarea
              v-model="form.privateKey"
              :disabled="clearFlags.privateKey"
              rows="3"
              placeholder="商户私钥 PEM（-----BEGIN PRIVATE KEY-----）"
            ></textarea>
            <span class="status" :class="editing && editing.hasPrivateKey ? 'success' : 'warning'">{{
              editing && editing.hasPrivateKey ? "已配置" : "未配置"
            }}</span>
            <label class="checkbox-row">
              <input v-model="clearFlags.privateKey" class="raw-checkbox" type="checkbox" />
              清除
            </label>
          </div>
        </div>
        <p v-if="drawerError" class="form-hint">{{ drawerError }}</p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="drawerOpen = false">取消</button>
          <button class="btn primary" :disabled="drawerSaving" @click="submitDrawer">
            {{ drawerSaving ? "保存中..." : editing ? "保存修改" : "创建组织" }}
          </button>
        </div>
      </aside>
    </div>

    <!-- 开通组织向导：组织管理员 + 首个校区一次提交（幂等） -->
    <div v-if="wizardOpen" class="drawer-mask" @click.self="wizardOpen = false">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <h2>开通组织 · {{ wizardOrg?.name }}</h2>
          </div>
          <button aria-label="关闭" @click="wizardOpen = false">×</button>
        </div>
        <template v-if="!wizardResult">
          <p class="drawer-note">
            一条龙创建组织管理员（绑定本组织 + org-admin 预设角色）与首个校区；
            重复提交幂等——已存在的部分沿用现状，不会重复创建。
          </p>
          <p class="drawer-sec">组织管理员</p>
          <div class="product-form">
            <label>
              管理员账号
              <input v-model.trim="wizard.adminUsername" placeholder="3-20 位字母/数字/下划线" />
            </label>
            <label>
              初始密码
              <input
                v-model="wizard.adminPassword"
                type="password"
                placeholder="至少 8 位"
                autocomplete="new-password"
              />
            </label>
            <label>
              昵称（可选）
              <input v-model.trim="wizard.adminNickname" placeholder="如：组织B管理员" />
            </label>
          </div>
          <p class="drawer-sec">首个校区</p>
          <div class="product-form">
            <label>
              校区全称
              <input v-model.trim="wizard.campusName" placeholder="2-30 字" />
            </label>
            <label>
              校区简称
              <input v-model.trim="wizard.campusShortName" placeholder="2-15 字" />
            </label>
            <label>
              仓库名
              <input v-model.trim="wizard.campusWarehouseName" placeholder="2-30 字" />
            </label>
          </div>
          <p v-if="wizardError" class="form-hint">{{ wizardError }}</p>
          <div class="drawer-actions">
            <button class="btn ghost" @click="wizardOpen = false">取消</button>
            <button class="btn primary" :disabled="wizardSaving" @click="submitWizard">
              {{ wizardSaving ? "开通中..." : "确认开通" }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="drawer-sec">开通结果</p>
          <div class="result-grid">
            <div class="result-item">
              <small>组织管理员</small>
              <strong>{{ wizardResult.admin.username }}</strong>
              <span class="status" :class="wizardResult.created.admin ? 'info' : 'warning'">{{
                wizardResult.created.admin ? "本次新建" : "沿用现有"
              }}</span>
            </div>
            <div class="result-item">
              <small>首个校区</small>
              <strong>{{ wizardResult.campus.name }}</strong>
              <span class="status" :class="wizardResult.created.campus ? 'info' : 'warning'">{{
                wizardResult.created.campus ? "本次新建" : "沿用现有"
              }}</span>
            </div>
          </div>
          <p class="drawer-note">
            管理员已绑 org-admin 预设角色（数据边界=本组织）；初始密码请线下交付并提醒尽快修改。
          </p>
          <div class="drawer-actions">
            <button class="btn primary" @click="wizardOpen = false">完成</button>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>
<style scoped>
/* 对齐 AccountsPage：全局 .workspace/.page-head/.data-panel/table/.btn/.drawer
   不重写，scoped 只留本页私有（提示条/徽章组/敏感行/开通结果网格）。 */
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
.sens-row input,
.sens-row textarea {
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  padding: 0 8px;
  color: #153628;
  min-width: 0;
  font-size: 12px;
}
.sens-row.sens-tall textarea {
  height: auto;
  padding: 8px;
  font-family: monospace;
}
.result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.result-item {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.result-item small {
  color: var(--muted);
}
</style>
