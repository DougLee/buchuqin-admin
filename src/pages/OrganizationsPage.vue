<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, type UploadFile } from "element-plus";
import { api, uploadImage } from "../api";
import AdminPagination from "../shared/ui/AdminPagination.vue";
import { isSuper } from "../session";
import type { AdminOrganization } from "../types";
import { fmtDateTime } from "../utils/datetime";

/**
 * 组织管理（IKKRMS，ADR-0001）：平台组织档案与微信配置。
 * - 列表：每组织聚合校区数/用户数 + 微信配置 hasXxx 状态位（敏感凭据永不回读）；
 * - 新建/编辑弹窗：name/shortName/wxAppId 必填唯一（wxAppId 一经登记，
 *   AppID→组织映射即生效——错登记=组织 B 小程序登录串组织）；
 * - 服务号（派单推送，IKP34J）：四件套（AppID/Token/模板ID/二维码）非敏感
 *   可回读，AppSecret 敏感只写不回读——留空回落平台服务号或关闭通道；
 * - 启停：两击确认。
 * 写操作全部后端超管专属（isSuperOnlyOperation），页内 isSuper 双保险；
 * 组织管理员（org-admin 预设）经菜单授权只读可见本页。
 */
const rows = ref<AdminOrganization[]>([]);
const loading = ref(true);
const loadError = ref("");
const keyword = ref("");
const page = ref(1);
const pageSize = ref(10);
const filteredRows = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase();
  if (!query) return rows.value;
  return rows.value.filter((row) =>
    [row.name, row.shortName].some((name) => name?.toLocaleLowerCase().includes(query)),
  );
});
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredRows.value.slice(start, start + pageSize.value);
});
watch(keyword, () => {
  page.value = 1;
});
watch(pageSize, () => {
  page.value = 1;
});
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
  deliveryWxAppId: "",
  deliveryNotifyTemplateId: "",
  mchId: "",
  serialNo: "",
  notifyDomain: "",
  wxPayPublicKey: "",
  wxSecret: "",
  deliveryWxSecret: "",
  mchApiV3Key: "",
  privateKey: "",
  gzhAppId: "",
  gzhToken: "",
  gzhTemplateId: "",
  gzhQrcodeUrl: "",
  gzhSecret: "",
});
/** 敏感字段只写不回读：勾选=显式传 null 清除（勾选时输入框禁用） */
const clearFlags = ref({
  wxSecret: false,
  deliveryWxSecret: false,
  mchApiV3Key: false,
  privateKey: false,
  gzhSecret: false,
});

/** 服务号关注二维码上传（道哥 2026-10-20：URL 手贴改图片上传）——
 *  COS webp 压缩走 uploads/ 目录，成功回填 URL 表单即预览 */
const gzhQrcodeUploading = ref(false);
async function onGzhQrcodeChange(upload: UploadFile) {
  const file = upload.raw;
  if (!file) return;
  gzhQrcodeUploading.value = true;
  try {
    form.value.gzhQrcodeUrl = await uploadImage(file, "uploads");
    ElMessage.success("二维码已上传");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "上传失败");
  } finally {
    gzhQrcodeUploading.value = false;
  }
}
function openCreate() {
  editing.value = null;
  form.value = {
    name: "",
    shortName: "",
    wxAppId: "",
    deliveryWxAppId: "",
    deliveryNotifyTemplateId: "",
    mchId: "",
    serialNo: "",
    notifyDomain: "",
    wxPayPublicKey: "",
    wxSecret: "",
    deliveryWxSecret: "",
    mchApiV3Key: "",
    privateKey: "",
    gzhAppId: "",
    gzhToken: "",
    gzhTemplateId: "",
    gzhQrcodeUrl: "",
    gzhSecret: "",
  };
  clearFlags.value = {
    wxSecret: false,
    deliveryWxSecret: false,
    mchApiV3Key: false,
    privateKey: false,
    gzhSecret: false,
  };
  drawerError.value = "";
  drawerOpen.value = true;
}
function openEdit(row: AdminOrganization) {
  editing.value = row;
  form.value = {
    name: row.name,
    shortName: row.shortName,
    wxAppId: row.wxAppId ?? "",
    deliveryWxAppId: row.deliveryWxAppId ?? "",
    deliveryNotifyTemplateId: row.deliveryNotifyTemplateId ?? "",
    mchId: row.mchId ?? "",
    serialNo: row.serialNo ?? "",
    notifyDomain: row.notifyDomain ?? "",
    wxPayPublicKey: row.wxPayPublicKey ?? "",
    wxSecret: "",
    deliveryWxSecret: "",
    mchApiV3Key: "",
    privateKey: "",
    gzhAppId: row.gzhAppId ?? "",
    gzhToken: row.gzhToken ?? "",
    gzhTemplateId: row.gzhTemplateId ?? "",
    gzhQrcodeUrl: row.gzhQrcodeUrl ?? "",
    gzhSecret: "",
  };
  clearFlags.value = {
    wxSecret: false,
    deliveryWxSecret: false,
    mchApiV3Key: false,
    privateKey: false,
    gzhSecret: false,
  };
  drawerError.value = "";
  drawerOpen.value = true;
}
/** 敏感行状态：编辑态空输入=保留不传，传值=覆盖，勾清除=null */
function sensValue(
  key:
    | "wxSecret"
    | "deliveryWxSecret"
    | "mchApiV3Key"
    | "privateKey"
    | "gzhSecret",
): string | null | undefined {
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
  const deliveryAppId = form.value.deliveryWxAppId.trim();
  if (deliveryAppId && !WX_APPID_RE.test(deliveryAppId))
    return (drawerError.value = "履约端 AppID 须为 wx 开头 18 位（wx+16 位十六进制）");
  if (deliveryAppId && deliveryAppId === appid)
    return (drawerError.value = "用户端与履约端不能使用相同 AppID");
  // IKP34J 服务号 AppID：宽松校验——填了才验 wx 开头 18 位
  const gzhAppId = form.value.gzhAppId.trim();
  if (gzhAppId && !WX_APPID_RE.test(gzhAppId))
    return (drawerError.value = "服务号 AppID 须为 wx 开头 18 位（wx+16 位十六进制）");
  const base = {
    name: form.value.name.trim(),
    shortName: form.value.shortName.trim(),
    wxAppId: appid || null,
    deliveryWxAppId: deliveryAppId || null,
    deliveryNotifyTemplateId: form.value.deliveryNotifyTemplateId.trim() || null,
    mchId: form.value.mchId.trim() || null,
    serialNo: form.value.serialNo.trim() || null,
    notifyDomain: form.value.notifyDomain.trim() || null,
    // 微信支付公钥非敏感可回读：编辑态总是传（空串=清除），新建态有值才传
    wxPayPublicKey: form.value.wxPayPublicKey.trim(),
    gzhAppId: gzhAppId || null,
    gzhToken: form.value.gzhToken.trim() || null,
    gzhTemplateId: form.value.gzhTemplateId.trim() || null,
    gzhQrcodeUrl: form.value.gzhQrcodeUrl.trim() || null,
  };
  const secrets = {
    wxSecret: sensValue("wxSecret"),
    deliveryWxSecret: sensValue("deliveryWxSecret"),
    mchApiV3Key: sensValue("mchApiV3Key"),
    privateKey: sensValue("privateKey"),
    gzhSecret: sensValue("gzhSecret"),
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
        ...(base.deliveryWxAppId
          ? { deliveryWxAppId: base.deliveryWxAppId }
          : {}),
        ...(base.deliveryNotifyTemplateId
          ? { deliveryNotifyTemplateId: base.deliveryNotifyTemplateId }
          : {}),
        ...(base.mchId ? { mchId: base.mchId } : {}),
        ...(base.serialNo ? { serialNo: base.serialNo } : {}),
        ...(base.notifyDomain ? { notifyDomain: base.notifyDomain } : {}),
        ...(base.wxPayPublicKey
          ? { wxPayPublicKey: base.wxPayPublicKey }
          : {}),
        ...(base.gzhAppId ? { gzhAppId: base.gzhAppId } : {}),
        ...(base.gzhToken ? { gzhToken: base.gzhToken } : {}),
        ...(base.gzhTemplateId ? { gzhTemplateId: base.gzhTemplateId } : {}),
        ...(base.gzhQrcodeUrl ? { gzhQrcodeUrl: base.gzhQrcodeUrl } : {}),
        ...(secrets.wxSecret ? { wxSecret: secrets.wxSecret } : {}),
        ...(secrets.deliveryWxSecret
          ? { deliveryWxSecret: secrets.deliveryWxSecret }
          : {}),
        ...(secrets.mchApiV3Key ? { mchApiV3Key: secrets.mchApiV3Key } : {}),
        ...(secrets.privateKey ? { privateKey: secrets.privateKey } : {}),
        ...(secrets.gzhSecret ? { gzhSecret: secrets.gzhSecret } : {}),
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
      <div class="organization-toolbar">
        <ElInput
          v-model="keyword"
          clearable
          class="organization-search"
          placeholder="搜索组织名称或简称"
          aria-label="搜索组织名称或简称"
        />
      </div>
      <ElAlert v-if="loadError" class="load-alert" type="error" show-icon :closable="false">
        <template #title>{{ loadError }} <ElButton link type="primary" @click="load">重试</ElButton></template>
      </ElAlert>
      <ElTable v-else v-loading="loading" :data="pagedRows" row-key="id" :empty-text="keyword.trim() ? '未找到匹配的组织' : '暂无组织'" class="organization-table">
        <ElTableColumn label="组织" min-width="170"><template #default="{ row }"><strong>{{ row.name }}</strong><small class="muted organization-short-name">{{ row.shortName || "—" }}</small></template></ElTableColumn>
        <ElTableColumn label="状态" width="90"><template #default="{ row }"><ElTag :type="row.status === 'active' ? 'success' : 'warning'">{{ row.status === "active" ? "启用" : "停用" }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="用户端 AppID" min-width="190"><template #default="{ row }"><code v-if="row.wxAppId">{{ row.wxAppId }}</code><span v-else class="muted">未登记（env 兜底）</span></template></ElTableColumn>
        <ElTableColumn label="履约端 AppID" min-width="190"><template #default="{ row }"><code v-if="row.deliveryWxAppId">{{ row.deliveryWxAppId }}</code><span v-else class="muted">未登记</span></template></ElTableColumn>
        <ElTableColumn label="微信配置" min-width="320"><template #default="{ row }"><div class="wx-badges"><ElTag :type="row.hasWxSecret ? 'success' : 'warning'">用户 Secret</ElTag><ElTag :type="row.hasDeliveryWxSecret && row.deliveryNotifyTemplateId ? 'success' : 'warning'">履约消息</ElTag><ElTag :type="row.hasMchApiV3Key ? 'success' : 'warning'">APIv3密钥</ElTag><ElTag :type="row.hasPrivateKey ? 'success' : 'warning'">商户私钥</ElTag><ElTag :type="row.mchId ? 'info' : 'warning'">{{ row.mchId ? `商户号 ${row.mchId}` : "商户号未配" }}</ElTag></div></template></ElTableColumn>
        <ElTableColumn prop="campusCount" label="校区" width="100"><template #default="{ row }">{{ row.campusCount }}<small v-if="row.campusCount === 0" class="muted">（未开通）</small></template></ElTableColumn>
        <ElTableColumn prop="userCount" label="用户" width="80" />
        <ElTableColumn label="创建时间" min-width="170"><template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="180"><template #default="{ row }"><div class="row-actions"><template v-if="isSuper"><ElButton size="small" plain @click="openEdit(organizationRow(row))">编辑</ElButton><ElButton size="small" :type="confirmStatusId === row.id ? 'danger' : 'warning'" plain @click="toggleStatus(organizationRow(row))">{{ confirmStatusId === row.id ? (row.status === "active" ? "确认停用" : "确认启用") : (row.status === "active" ? "停用" : "启用") }}</ElButton></template><span v-else class="muted">只读</span></div></template></ElTableColumn>
      </ElTable>
      <AdminPagination
        v-if="!loadError"
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="filteredRows.length"
      />
    </div>

    <!-- 新建/编辑：基本信息 + 微信配置（敏感凭据只写不回读） -->
    <ElDialog v-model="drawerOpen" class="organization-dialog" :title="editing ? `编辑组织 ${editing.name}` : '新建组织'" width="min(760px, calc(100vw - 32px))" align-center destroy-on-close modal-class="organization-dialog-overlay" :show-close="!drawerSaving" :close-on-click-modal="!drawerSaving" :close-on-press-escape="!drawerSaving">
        <p class="drawer-note">
          用户端和履约端 AppID 一经登记即生效（该小程序登录直接进本组织）；名称/简称/AppID
          全局唯一。敏感凭据只写不回读——留空=保留现状，填写=覆盖，勾选清除=置空。
        </p>
        <ElForm label-position="top"><ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"><ElFormItem label="组织名称"><ElInput v-model="form.name" placeholder="2-50 字，如：某某餐饮管理公司" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="组织简称"><ElInput v-model="form.shortName" placeholder="1-20 字，如：某食社" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem :label="`用户端小程序 AppID${editing ? '（清空=回落平台 env 兜底）' : ''}`"><ElInput v-model="form.wxAppId" placeholder="wx 开头 18 位" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="履约端小程序 AppID"><ElInput v-model="form.deliveryWxAppId" placeholder="骑手小程序 wx 开头 18 位" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="履约端派单订阅模板 ID"><ElInput v-model="form.deliveryNotifyTemplateId" placeholder="微信公众平台订阅消息模板 ID" /></ElFormItem></ElCol>
        </ElRow>
        <p class="drawer-sec">微信支付与回调</p>
        <ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"><ElFormItem label="商户号 mchId（组织 B 独立商户号）"><ElInput v-model="form.mchId" placeholder="未配可留空" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="证书序列号"><ElInput v-model="form.serialNo" placeholder="未配可留空" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="回调域名"><ElInput v-model="form.notifyDomain" placeholder="如 https://api-b.example.com" /></ElFormItem></ElCol>
          <!-- 微信支付公钥（2024+ 新商户回调验签，非敏感可回读；清空=清除） -->
          <ElCol :span="24"><ElFormItem label="微信支付公钥 PEM（新商户平台「API 安全 → 微信支付公钥」下载，pub_key.pem）"><ElInput v-model="form.wxPayPublicKey" type="textarea" :rows="4" placeholder="-----BEGIN PUBLIC KEY----- 开头整段粘贴；留空保留现状，清空后保存=清除" /></ElFormItem></ElCol>
        </ElRow>
        <!-- IKP34J 派单服务号：四件套非敏感可回读；AppSecret 照敏感凭据卡片只写不回读 -->
        <p class="drawer-sec">服务号（派单推送）</p>
        <p class="drawer-note">
          按组织路由派单服务号——配齐四件套后骑手派单从本组织服务号推送；留空回落平台服务号（仅平台组织）或关闭通道。
        </p>
        <ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"><ElFormItem label="服务号 AppID"><ElInput v-model="form.gzhAppId" placeholder="微信公众号 AppID（wx 开头 18 位），未配可留空" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="回调 Token"><ElInput v-model="form.gzhToken" placeholder="服务号后台「服务器配置」里的 Token" /></ElFormItem></ElCol>
          <ElCol :xs="24" :sm="12"><ElFormItem label="派单模板 ID"><ElInput v-model="form.gzhTemplateId" placeholder="服务号模板消息模板 ID" /></ElFormItem></ElCol>
          <ElCol :span="24"><ElFormItem label="关注二维码（配送端引导关注展示）">
            <div class="qrcode-row">
              <ElImage
                v-if="form.gzhQrcodeUrl"
                :src="form.gzhQrcodeUrl"
                class="qrcode-preview"
                :preview-src-list="[form.gzhQrcodeUrl]"
                preview-teleported
                hide-on-click-modal
                fit="cover"
                alt="服务号二维码"
              />
              <div v-else class="qrcode-empty">未上传</div>
              <div class="qrcode-ops">
                <ElUpload
                  :auto-upload="false"
                  :show-file-list="false"
                  accept="image/*"
                  :on-change="onGzhQrcodeChange"
                  ><ElButton :loading="gzhQrcodeUploading"
                    >上传图片</ElButton
                  ></ElUpload
                >
                <ElButton
                  v-if="form.gzhQrcodeUrl"
                  text
                  type="danger"
                  @click="form.gzhQrcodeUrl = ''"
                  >移除</ElButton
                >
              </div>
            </div>
          </ElFormItem></ElCol>
        </ElRow>
        <div class="sens-panel gzh-sens">
          <ElFormItem class="sens-last">
            <template #label
              ><div class="sens-label"
                ><span>服务号 AppSecret</span
                ><ElTag size="small" round effect="light" :type="editing && editing.hasGzhSecret ? 'success' : 'warning'">{{ editing && editing.hasGzhSecret ? "已配置" : "未配置" }}</ElTag
                ><ElCheckbox class="sens-clear" v-model="clearFlags.gzhSecret">清除</ElCheckbox></div
            ></template>
            <ElInput
              v-model="form.gzhSecret"
              type="password"
              show-password
              :disabled="clearFlags.gzhSecret"
              :placeholder="clearFlags.gzhSecret ? '已勾选清除——保存后将清空该凭据' : '粘贴服务号 AppSecret，留空保留现状'"
              autocomplete="new-password"
            />
          </ElFormItem>
        </div>
        <p class="drawer-sec">敏感凭据（只写不回读）</p>
        <div class="sens-panel">
          <ElFormItem>
            <template #label
              ><div class="sens-label"
                ><span>用户端小程序 Secret</span
                ><ElTag size="small" round effect="light" :type="editing && editing.hasWxSecret ? 'success' : 'warning'">{{ editing && editing.hasWxSecret ? "已配置" : "未配置" }}</ElTag
                ><ElCheckbox class="sens-clear" v-model="clearFlags.wxSecret">清除</ElCheckbox></div
            ></template>
            <ElInput
              v-model="form.wxSecret"
              type="password"
              show-password
              :disabled="clearFlags.wxSecret"
              :placeholder="clearFlags.wxSecret ? '已勾选清除——保存后将清空该凭据' : '粘贴小程序 Secret，留空保留现状'"
              autocomplete="new-password"
            />
          </ElFormItem>
          <ElFormItem>
            <template #label
              ><div class="sens-label"
                ><span>履约端小程序 Secret</span
                ><ElTag size="small" round effect="light" :type="editing && editing.hasDeliveryWxSecret ? 'success' : 'warning'">{{ editing && editing.hasDeliveryWxSecret ? "已配置" : "未配置" }}</ElTag
                ><ElCheckbox class="sens-clear" v-model="clearFlags.deliveryWxSecret">清除</ElCheckbox></div
            ></template>
            <ElInput
              v-model="form.deliveryWxSecret"
              type="password"
              show-password
              :disabled="clearFlags.deliveryWxSecret"
              :placeholder="clearFlags.deliveryWxSecret ? '已勾选清除——保存后将清空该凭据' : '粘贴履约端 Secret，留空保留现状'"
              autocomplete="new-password"
            />
          </ElFormItem>
          <ElFormItem>
            <template #label
              ><div class="sens-label"
                ><span>商户 APIv3 密钥</span
                ><ElTag size="small" round effect="light" :type="editing && editing.hasMchApiV3Key ? 'success' : 'warning'">{{ editing && editing.hasMchApiV3Key ? "已配置" : "未配置" }}</ElTag
                ><ElCheckbox class="sens-clear" v-model="clearFlags.mchApiV3Key">清除</ElCheckbox></div
            ></template>
            <ElInput
              v-model="form.mchApiV3Key"
              type="password"
              show-password
              :disabled="clearFlags.mchApiV3Key"
              :placeholder="clearFlags.mchApiV3Key ? '已勾选清除——保存后将清空该凭据' : '32 位 APIv3 密钥，留空保留现状'"
              autocomplete="new-password"
            />
          </ElFormItem>
          <ElFormItem class="sens-last">
            <template #label
              ><div class="sens-label"
                ><span>商户私钥 PEM</span
                ><ElTag size="small" round effect="light" :type="editing && editing.hasPrivateKey ? 'success' : 'warning'">{{ editing && editing.hasPrivateKey ? "已配置" : "未配置" }}</ElTag
                ><ElCheckbox class="sens-clear" v-model="clearFlags.privateKey">清除</ElCheckbox></div
            ></template>
            <ElInput
              v-model="form.privateKey"
              type="textarea"
              :disabled="clearFlags.privateKey"
              :rows="4"
              :placeholder="clearFlags.privateKey ? '已勾选清除——保存后将清空该凭据' : '粘贴 PEM 全文（-----BEGIN PRIVATE KEY----- 开头），留空保留现状'"
            />
          </ElFormItem>
        </div>
      </ElForm>
        <ElAlert v-if="drawerError" class="dialog-error" type="error" show-icon :closable="false" :title="drawerError" />
        <template #footer><div class="dialog-actions"><ElButton :disabled="drawerSaving" @click="drawerOpen = false">取消</ElButton><ElButton type="primary" :loading="drawerSaving" @click="submitDrawer">{{ editing ? "保存修改" : "创建组织" }}</ElButton></div></template>
    </ElDialog>

  </div>
</template>
<style scoped>
/* 服务号关注二维码上传行（照校区配置客服二维码同款视觉） */
.qrcode-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.qrcode-preview {
  width: 88px;
  height: 88px;
  border-radius: 10px;
  border: 1px solid var(--line);
  object-fit: cover;
}
.qrcode-empty {
  width: 88px;
  height: 88px;
  border-radius: 10px;
  border: 1px dashed var(--line);
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--muted);
}
.qrcode-ops {
  display: flex;
  align-items: center;
  gap: 10px;
}
.load-alert { margin: 14px; width: auto; }
.organization-toolbar {
  display: flex;
  align-items: center;
  padding: 14px;
  border-bottom: 1px solid var(--line);
}
.organization-search { width: min(360px, 100%); }
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
/* 敏感凭据卡片（2026-10-16 道哥截图优化）：浅底容器隔离敏感区；
   状态徽章+清除上提到标签行，输入框满宽——扫读路径「字段→状态→输入」一条线 */
.sens-panel {
  padding: 4px 16px 2px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fafbfa;
}
.sens-panel :deep(.el-form-item) { margin-bottom: 14px; }
.sens-panel :deep(.el-form-item.sens-last) { margin-bottom: 8px; }
/* 服务号 Secret 独立小卡片：与敏感凭据区同款视觉，贴合所属分区 */
.gzh-sens { margin: 2px 0 6px; }
.sens-label {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.sens-label .sens-clear {
  margin-left: auto;
  height: auto;
}
.sens-label .sens-clear :deep(.el-checkbox__label) {
  font-size: 12px;
  color: var(--muted);
}
.sens-panel :deep(textarea),
.sens-panel :deep(input[type="password"]) {
  font-family: monospace;
}
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
  .sens-row { grid-template-columns: minmax(0, 1fr) auto; }
  .sens-row :deep(.el-checkbox) { grid-column: 1 / -1; min-height: 44px; }
}
</style>
