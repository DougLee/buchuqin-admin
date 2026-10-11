<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import { api, uploadImage } from "../api";
import { fenToYuan, yuanToFen } from "../utils/money";
import {
  effectiveCampusId,
  hasPerm,
  hasPlatformPerm,
  switchableCampuses,
} from "../session";
import PrinterPage from "../modules/settings/printers/pages/PrinterPage.vue";
import WechatGroupPage from "../modules/settings/wechat-groups/pages/WechatGroupPage.vue";
import HomeBannerPage from "../modules/marketing/banners/pages/HomeBannerPage.vue";
import PayAdPage from "../modules/marketing/banners/pages/PayAdPage.vue";
import WheelPage from "../modules/marketing/wheel/pages/WheelPage.vue";
import type { CampusConfigBundle, DeliverySlotRow, NoticeRow } from "../types";

/**
 * 校区配置聚合页（IKHM1O 道哥 2026-09-21 定版全收）：
 * 顶部校区选择器（平台角色）+ Tab 分区，把原散在 6 处的校区维度配置收进一菜单。
 * - 参数类 Tab（档案/配送营业/楼长结算/送达时段/公告）走聚合接口，支持 ?campus=
 * - 内容类 Tab（群码/打印机/Banner/抽奖）组合各业务模块的独立页面——多校区授权
 *   账号经页内选择器切换（IKJA7Y：?campus= 授权集内即可写，顶栏切换器已移除）
 * - Tab 与写入操作按当前有效接口权限过滤，跨校区写入另校验该操作的平台授权。
 */
const isPlatform = computed(() => hasPlatformPerm("GET /admin/campus-config"));
/** IKJA7Y：所选校区在授权集内（或平台角色）即可写 */
const campusWritable = computed(
  () =>
    isPlatform.value ||
    switchableCampuses.value.includes(bundle.value?.campus.id ?? ""),
);
const canEditProfile = computed(() =>
  hasPlatformPerm("PATCH /admin/campuses/:id"),
);
const canEditDelivery = computed(
  () =>
    canEditProfile.value ||
    (campusWritable.value && hasPerm("PATCH /admin/delivery-config")),
);
function canWrite(pattern: string) {
  return hasPerm(pattern) && (campusWritable.value || hasPlatformPerm(pattern));
}

const TABS = computed(() => {
  const list: Array<{ key: string; label: string }> = [
    { key: "profile", label: "基础档案" },
    { key: "delivery", label: "配送与营业" },
    { key: "salary", label: "楼长结算" },
    { key: "slots", label: "送达时段" },
    { key: "notices", label: "公告" },
  ];
  if (hasPerm("GET /admin/wechat-groups"))
    list.push({ key: "wechat-groups", label: "微信群码" });
  if (hasPerm("GET /admin/printers"))
    list.push({ key: "printers", label: "打印机" });
  if (hasPerm("GET /admin/banners"))
    list.push(
      { key: "banners", label: "Banner" },
      { key: "pay-ads", label: "支付广告位" },
    );
  if (hasPerm("GET /admin/wheel"))
    list.push({ key: "wheel", label: "抽奖转盘" });
  return list;
});
const activeTab = ref("profile");
const selectedCampus = effectiveCampusId;
const bundle = ref<CampusConfigBundle | null>(null);
const loading = ref(false);
const saving = ref(false);
const asSlot = (row: unknown) => row as DeliverySlotRow;
const asNotice = (row: unknown) => row as NoticeRow;

function notify(text: string, error = false) {
  ElMessage({
    message: text,
    type: error ? "error" : "success",
    showClose: true,
  });
}

let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  if (!selectedCampus.value) {
    bundle.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  bundle.value = null;
  try {
    const result = await api.campusConfig(selectedCampus.value || undefined);
    if (sequence !== loadSequence) return;
    bundle.value = result;
  } catch (error) {
    if (sequence === loadSequence)
      notify(error instanceof Error ? error.message : "加载失败", true);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
onMounted(load);
watch(selectedCampus, () => {
  activeTab.value = "profile";
  void load();
});

/* ---------- 基础档案（平台角色可编辑；校区角色只读） ---------- */
const profileForm = ref({
  name: "",
  shortName: "",
  warehouseName: "",
  address: "",
  servicePhone: "",
  serviceQrcode: "",
  status: "active" as "active" | "inactive",
});
watch(bundle, (b) => {
  if (!b) return;
  profileForm.value = {
    name: b.campus.name,
    shortName: b.campus.shortName,
    warehouseName: b.campus.warehouseName,
    address: b.campus.address ?? "",
    servicePhone: (b.campus as { servicePhone?: string }).servicePhone ?? "",
    serviceQrcode: (b.campus as { serviceQrcode?: string }).serviceQrcode ?? "",
    status: b.campus.status === "inactive" ? "inactive" : "active",
  };
});
const qrcodeUploading = ref(false);
/** IKKTWP 客服二维码上传（COS webp） */
async function onQrcodeChange(upload: UploadFile) {
  const file = upload.raw;
  if (!file) return;
  qrcodeUploading.value = true;
  try {
    profileForm.value.serviceQrcode = await uploadImage(file, "app");
    ElMessage.success("二维码已上传");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "上传失败");
  } finally {
    qrcodeUploading.value = false;
  }
}
async function saveProfile() {
  if (!canEditProfile.value || !bundle.value || saving.value) return;
  saving.value = true;
  try {
    await api.updateCampus(bundle.value.campus.id, {
      name: profileForm.value.name.trim(),
      shortName: profileForm.value.shortName.trim(),
      warehouseName: profileForm.value.warehouseName.trim(),
      address: profileForm.value.address.trim(),
      // IKHMF1：客服电话（校区自定义，小程序拨号展示）
      servicePhone: profileForm.value.servicePhone.trim(),
      serviceQrcode: profileForm.value.serviceQrcode.trim(),
      // status 不在此提交：防误改校区启停（归校区管理页）
    });
    notify("基础档案已保存");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  } finally {
    saving.value = false;
  }
}

/* ---------- 配送与营业（平台+校区角色均可：平台走 campuses/:id，
 *  校区角色走 delivery-config 本校区端点） ---------- */
/* 闭店方式独立状态（道哥 2026-09-22 bug 修复）：不再从 start/end 反推——
   初始 00:00/00:00 相等会被回算成「24 小时营业」，导致「按时间打烊」选不上、
   时间输入框永远不出现。初始化从数据算一次，之后用户选什么就是什么。 */
const closeMode = ref<"always" | "on-time" | "now">("always");
/** 打烊时间 30 分钟档（00:00~23:30）：下拉天然 24 小时制（原生 time 控件显示格式跟浏览器走）。 */
const TIME_OPTIONS = Array.from(
  { length: 48 },
  (_, i) =>
    `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);
watch(closeMode, (mode) => {
  deliveryForm.value.manualClosed = mode === "now";
  if (mode === "always") {
    deliveryForm.value.closeStart = "00:00";
    deliveryForm.value.closeEnd = "00:00";
  }
});
const deliveryForm = ref({
  instant: 0,
  scheduled: 0,
  threshold: 0,
  closeStart: "00:00",
  closeEnd: "00:00",
  manualClosed: false,
  noManagerTip: "",
});
watch(bundle, (b) => {
  if (!b) return;
  deliveryForm.value = {
    instant: Number(fenToYuan(b.campus.deliveryFeeInstant)),
    scheduled: Number(fenToYuan(b.campus.deliveryFeeScheduled)),
    threshold: Number(fenToYuan(b.campus.deliveryThreshold)),
    closeStart: b.campus.closeStart,
    closeEnd: b.campus.closeEnd,
    manualClosed: b.campus.manualClosed,
    noManagerTip: (b.campus as { noManagerTip?: string }).noManagerTip ?? "",
  };
  closeMode.value = b.campus.manualClosed
    ? "now"
    : b.campus.closeStart === b.campus.closeEnd
      ? "always"
      : "on-time";
});
async function saveDelivery() {
  if (!canEditDelivery.value || !bundle.value || saving.value) return;
  saving.value = true;
  try {
    const payload = {
      deliveryFeeInstant: yuanToFen(deliveryForm.value.instant),
      deliveryFeeScheduled: yuanToFen(deliveryForm.value.scheduled),
      deliveryThreshold: yuanToFen(deliveryForm.value.threshold),
      closeStart: deliveryForm.value.closeStart,
      closeEnd: deliveryForm.value.closeEnd,
      manualClosed: deliveryForm.value.manualClosed,
    };
    if (canEditProfile.value) {
      // 平台角色可保存任意选中校区（含打烊窗/手动闭店/无楼长提示 IKHMKR）
      await api.updateCampus(bundle.value.campus.id, {
        ...payload,
        noManagerTip: deliveryForm.value.noManagerTip.trim(),
      });
    } else {
      // 校区角色走本校区 delivery-config（无楼长提示一并带，服务端 DTO 均收）
      await api.updateDeliveryConfig({
        ...payload,
        noManagerTip: deliveryForm.value.noManagerTip.trim(),
      } as Parameters<typeof api.updateDeliveryConfig>[0]);
    }
    notify("配送与营业配置已保存");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  } finally {
    saving.value = false;
  }
}

/* ---------- 楼长结算（底薪，平台角色） ---------- */
const salaryForm = ref({ baseSalary: 0 });
watch(bundle, (b) => {
  if (b)
    salaryForm.value = {
      baseSalary: Number(fenToYuan(b.campus.buildingManagerBaseSalary)),
    };
});
async function saveSalary() {
  if (!canEditProfile.value || !bundle.value || saving.value) return;
  saving.value = true;
  try {
    await api.updateCampus(bundle.value.campus.id, {
      buildingManagerBaseSalary: yuanToFen(salaryForm.value.baseSalary),
    });
    notify("楼长底薪已保存");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  } finally {
    saving.value = false;
  }
}

/* ---------- 送达时段 CRUD（IKHM1O 补后台管理入口） ---------- */
const slots = computed<DeliverySlotRow[]>(() => bundle.value?.slots ?? []);
const slotForm = ref({ label: "", capacity: 100 });
async function addSlot() {
  if (!canWrite("POST /admin/delivery-slots")) return;
  if (!bundle.value || !slotForm.value.label.trim()) return;
  try {
    await api.createSlot({
      campusId: bundle.value.campus.id,
      label: slotForm.value.label.trim(),
      capacity: slotForm.value.capacity,
    });
    slotForm.value = { label: "", capacity: 100 };
    notify("时段已创建");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "创建失败", true);
  }
}
async function toggleSlot(row: DeliverySlotRow) {
  if (!canWrite("PATCH /admin/delivery-slots/:id")) return;
  try {
    await api.updateSlot(row.id, { available: !row.available });
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "更新失败", true);
  }
}
async function removeSlot(row: DeliverySlotRow) {
  if (!canWrite("DELETE /admin/delivery-slots/:id")) return;
  try {
    await ElMessageBox.confirm(`删除时段「${row.label}」？`, "删除送达时段", {
      type: "warning",
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await api.deleteSlot(row.id);
    notify("时段已删除");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}

/* ---------- 公告 CRUD（IKHM1P） ---------- */
const notices = computed<NoticeRow[]>(() => bundle.value?.notices ?? []);
const noticeForm = ref({
  content: "",
  startsAt: localInput(new Date()),
  endsAt: localInput(new Date(Date.now() + 7 * 86400_000)),
});
/** datetime-local 值（本地时区，提交转 ISO） */
function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function noticeState(n: NoticeRow) {
  const now = Date.now();
  if (n.status === "disabled") return { text: "已停用", tone: "muted" };
  if (new Date(n.startsAt).getTime() > now)
    return { text: "未开始", tone: "info" };
  if (new Date(n.endsAt).getTime() <= now)
    return { text: "已结束", tone: "muted" };
  return { text: "生效中", tone: "ok" };
}
async function addNotice() {
  if (!canWrite("POST /admin/notices")) return;
  if (!bundle.value || !noticeForm.value.content.trim()) return;
  try {
    await api.createNotice({
      campusId: bundle.value.campus.id,
      content: noticeForm.value.content.trim(),
      startsAt: new Date(noticeForm.value.startsAt).toISOString(),
      endsAt: new Date(noticeForm.value.endsAt).toISOString(),
    });
    noticeForm.value.content = "";
    notify("公告已发布");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "发布失败", true);
  }
}
async function toggleNotice(n: NoticeRow) {
  if (!canWrite("PATCH /admin/notices/:id")) return;
  try {
    await api.updateNotice(n.id, {
      status: n.status === "active" ? "disabled" : "active",
    });
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "更新失败", true);
  }
}
async function removeNotice(n: NoticeRow) {
  if (!canWrite("DELETE /admin/notices/:id")) return;
  try {
    await ElMessageBox.confirm(
      `删除公告「${n.content.slice(0, 20)}…」？`,
      "删除公告",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }
  try {
    await api.deleteNotice(n.id);
    notify("公告已删除");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}

/** 内容类 Tab：组合业务模块页面（按顶部当前校区取数）。 */
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <p class="eyebrow">CAMPUS SETTINGS</p>
        <h1>校区配置</h1>
        <p>档案、配送营业、结算、时段、公告与营销内容——一个校区的全部配置。</p>
      </div>
    </div>
    <nav class="cc-tabs single-line-tabs" aria-label="配置分区">
      <ElButton
        v-for="t in TABS"
        :key="t.key"
        text
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </ElButton>
    </nav>

    <p v-if="!selectedCampus" class="form-hint">请先在顶部选择校区</p>
    <p v-else-if="loading" class="form-hint">加载中…</p>

    <!-- 基础档案 -->
    <section v-else-if="activeTab === 'profile'" class="cc-panel">
      <template v-if="bundle">
        <ElForm label-position="top"
          ><ElRow :gutter="16">
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="校区全称"
                ><ElInput
                  v-model.trim="profileForm.name"
                  :disabled="!canEditProfile" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="简称"
                ><ElInput
                  v-model.trim="profileForm.shortName"
                  :disabled="!canEditProfile" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="仓库名"
                ><ElInput
                  v-model.trim="profileForm.warehouseName"
                  :disabled="!canEditProfile" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="地址"
                ><ElInput
                  v-model.trim="profileForm.address"
                  :disabled="!canEditProfile" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="客服电话（小程序拨号展示）"
                ><ElInput
                  v-model.trim="profileForm.servicePhone"
                  :disabled="!canEditProfile"
                  maxlength="20"
                  placeholder="如 4008002026" /></ElFormItem
            ></ElCol>
            <ElCol :span="24"
              ><ElFormItem label="客服微信二维码（小程序客服弹层展示）">
                <div class="qrcode-row">
                  <img
                    v-if="profileForm.serviceQrcode"
                    :src="profileForm.serviceQrcode"
                    class="qrcode-preview"
                    alt="客服二维码"
                  />
                  <div v-else class="qrcode-empty">未上传</div>
                  <div class="qrcode-ops" v-if="canEditProfile">
                    <ElUpload
                      :auto-upload="false"
                      :show-file-list="false"
                      accept="image/*"
                      :on-change="onQrcodeChange"
                      ><ElButton :loading="qrcodeUploading"
                        >上传图片</ElButton
                      ></ElUpload
                    >
                    <ElButton
                      v-if="profileForm.serviceQrcode"
                      text
                      type="danger"
                      @click="profileForm.serviceQrcode = ''"
                      >移除</ElButton
                    >
                  </div>
                </div>
                <p class="qrcode-tip">
                  建议上传校区客服个人微信二维码；未上传时小程序客服入口回落拨打电话
                </p>
              </ElFormItem></ElCol
            >
            <!-- 状态下拉已移除（道哥 2026-09-22）：校区启停属组织动作（校区管理页），
               与「配送与营业」的打烊/闭店是两回事，界面上不做在一起防误触 -->
          </ElRow></ElForm
        >
        <p v-if="!canEditProfile" class="form-hint">
          基础档案仅总部/平台账号可修改
        </p>
        <ElButton
          v-if="canEditProfile"
          type="primary"
          :loading="saving"
          @click="saveProfile"
        >
          保存档案</ElButton
        >
      </template>
    </section>

    <!-- 配送与营业 -->
    <section v-else-if="activeTab === 'delivery'" class="cc-panel">
      <template v-if="bundle">
        <ElForm label-position="top" :disabled="!canEditDelivery"
          ><ElRow :gutter="16">
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="即时达配送费（元）"
                ><ElInputNumber
                  v-model="deliveryForm.instant"
                  :min="0"
                  :precision="2" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="预约达配送费（元）"
                ><ElInputNumber
                  v-model="deliveryForm.scheduled"
                  :min="0"
                  :precision="2" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="起送门槛（元）"
                ><ElInputNumber
                  v-model="deliveryForm.threshold"
                  :min="0"
                  :precision="2" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="闭店方式"
                ><ElSelect v-model="closeMode"
                  ><ElOption label="24 小时营业" value="always" /><ElOption
                    label="按时间打烊"
                    value="on-time" /><ElOption
                    label="立即闭店（手动）"
                    value="now" /></ElSelect></ElFormItem
            ></ElCol>
            <template v-if="closeMode === 'on-time'">
              <!-- 原生 time 控件显示格式跟浏览器语言走（英文环境 12 小时制、属性不可控），
                 改 30 分钟档下拉：天然 24 小时制，跨浏览器一致 -->
              <ElCol :xs="24" :sm="12" :lg="8"
                ><ElFormItem label="打烊开始"
                  ><ElSelect v-model="deliveryForm.closeStart" filterable
                    ><ElOption
                      v-for="t in TIME_OPTIONS"
                      :key="t"
                      :label="t"
                      :value="t" /></ElSelect></ElFormItem
              ></ElCol>
              <ElCol :xs="24" :sm="12" :lg="8"
                ><ElFormItem label="打烊结束"
                  ><ElSelect v-model="deliveryForm.closeEnd" filterable
                    ><ElOption
                      v-for="t in TIME_OPTIONS"
                      :key="t"
                      :label="t"
                      :value="t" /></ElSelect></ElFormItem
              ></ElCol>
            </template>
            <ElCol :span="24"
              ><ElFormItem label="无楼长提示（下单结算弹窗，空=默认文案）"
                ><ElInput
                  v-model.trim="deliveryForm.noManagerTip"
                  type="textarea"
                  :rows="2"
                  maxlength="60"
                  show-word-limit
                  placeholder="默认：本楼栋正在招募楼长，暂时需要您到寝室楼下取货，感谢理解～" /></ElFormItem
            ></ElCol> </ElRow
        ></ElForm>
        <p class="form-hint">
          打烊窗跨零点合法（如 22:00 ~ 06:00）；立即闭店与时间窗叠加判定。
        </p>
        <ElButton
          v-if="canEditDelivery"
          type="primary"
          :loading="saving"
          @click="saveDelivery"
          >保存配送与营业配置</ElButton
        >
      </template>
    </section>

    <!-- 楼长结算 -->
    <section v-else-if="activeTab === 'salary'" class="cc-panel">
      <template v-if="bundle">
        <ElForm label-position="top"
          ><ElRow
            ><ElCol :xs="24" :sm="12" :lg="8"
              ><ElFormItem label="楼长月度底薪（元，0 = 无底薪纯提成）"
                ><ElInputNumber
                  v-model.number="salaryForm.baseSalary"
                  :min="0"
                  :step="1"
                  :disabled="!canEditProfile" /></ElFormItem></ElCol></ElRow
        ></ElForm>
        <p v-if="!canEditProfile" class="form-hint">
          底薪仅总部/平台账号可修改
        </p>
        <ElButton
          v-if="canEditProfile"
          type="primary"
          :loading="saving"
          @click="saveSalary"
        >
          保存底薪</ElButton
        >
      </template>
    </section>

    <!-- 送达时段 -->
    <section v-else-if="activeTab === 'slots'" class="cc-panel">
      <template v-if="bundle">
        <ElForm
          v-if="canWrite('POST /admin/delivery-slots')"
          label-position="top"
          ><ElRow :gutter="16" align="bottom">
            <ElCol :xs="24" :sm="12" :lg="10"
              ><ElFormItem label="时段文案"
                ><ElInput
                  v-model="slotForm.label"
                  placeholder="如 12:00-14:00"
                  maxlength="20" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="8" :lg="6"
              ><ElFormItem label="容量"
                ><ElInputNumber
                  v-model="slotForm.capacity"
                  :min="0"
                  placeholder="容量" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="4" :lg="4"
              ><ElFormItem label=" "
                ><ElButton type="primary" @click="addSlot"
                  >新增时段</ElButton
                ></ElFormItem
              ></ElCol
            >
          </ElRow></ElForm
        >
        <ElTable
          :data="slots"
          row-key="id"
          empty-text="暂无送达时段（预约达下单需要）"
        >
          <ElTableColumn prop="label" label="时段" min-width="160" />
          <ElTableColumn prop="capacity" label="容量" width="100" />
          <ElTableColumn label="状态" width="100"
            ><template #default="{ row }"
              ><ElTag :type="row.available ? 'success' : 'info'">{{
                row.available ? "可用" : "停用"
              }}</ElTag></template
            ></ElTableColumn
          >
          <ElTableColumn label="操作" fixed="right" width="180"
            ><template #default="{ row }"
              ><ElButton
                v-if="canWrite('PATCH /admin/delivery-slots/:id')"
                size="small"
                @click="toggleSlot(asSlot(row))"
                >{{ row.available ? "停用" : "启用" }}</ElButton
              ><ElButton
                v-if="canWrite('DELETE /admin/delivery-slots/:id')"
                size="small"
                type="danger"
                plain
                @click="removeSlot(asSlot(row))"
                >删除</ElButton
              ></template
            ></ElTableColumn
          >
        </ElTable>
      </template>
    </section>

    <!-- 公告 -->
    <section v-else-if="activeTab === 'notices'" class="cc-panel">
      <template v-if="bundle">
        <ElForm v-if="canWrite('POST /admin/notices')" label-position="top"
          ><ElRow :gutter="16" align="bottom">
            <ElCol :span="24"
              ><ElFormItem label="公告内容"
                ><ElInput
                  v-model="noticeForm.content"
                  type="textarea"
                  :rows="2"
                  maxlength="200"
                  placeholder="小程序首页跑马灯显示，多条自动用「｜」拼接" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="10"
              ><ElFormItem label="生效起"
                ><ElDatePicker
                  v-model="noticeForm.startsAt"
                  type="datetime"
                  value-format="YYYY-MM-DDTHH:mm"
                  placeholder="选择开始时间" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="10"
              ><ElFormItem label="生效止"
                ><ElDatePicker
                  v-model="noticeForm.endsAt"
                  type="datetime"
                  value-format="YYYY-MM-DDTHH:mm"
                  placeholder="选择结束时间" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="4"
              ><ElFormItem label=" "
                ><ElButton type="primary" @click="addNotice"
                  >发布公告</ElButton
                ></ElFormItem
              ></ElCol
            >
          </ElRow></ElForm
        >
        <ElTable
          :data="notices"
          row-key="id"
          empty-text="暂无公告——发布后小程序首页顶部跑马灯显示"
        >
          <ElTableColumn
            prop="content"
            label="内容"
            min-width="280"
            show-overflow-tooltip
          />
          <ElTableColumn label="生效窗" min-width="280"
            ><template #default="{ row }"
              >{{
                new Date(row.startsAt).toLocaleString("zh-CN", {
                  hour12: false,
                })
              }}
              ~
              {{
                new Date(row.endsAt).toLocaleString("zh-CN", { hour12: false })
              }}</template
            ></ElTableColumn
          >
          <ElTableColumn label="状态" width="100"
            ><template #default="{ row }"
              ><ElTag
                :type="
                  noticeState(asNotice(row)).tone === 'ok' ? 'success' : 'info'
                "
                >{{ noticeState(asNotice(row)).text }}</ElTag
              ></template
            ></ElTableColumn
          >
          <ElTableColumn label="操作" fixed="right" width="180"
            ><template #default="{ row }"
              ><ElButton
                v-if="canWrite('PATCH /admin/notices/:id')"
                size="small"
                @click="toggleNotice(asNotice(row))"
                >{{ row.status === "active" ? "停用" : "启用" }}</ElButton
              ><ElButton
                v-if="canWrite('DELETE /admin/notices/:id')"
                size="small"
                type="danger"
                plain
                @click="removeNotice(asNotice(row))"
                >删除</ElButton
              ></template
            ></ElTableColumn
          >
        </ElTable>
      </template>
    </section>

    <!-- 内容类 Tab：组合独立业务模块（按顶部当前校区） -->
    <template v-else-if="activeTab === 'printers'">
      <p class="form-hint">
        此分区按当前登录校区取数；平台账号配置其他校区请先在顶栏切换校区。
      </p>
      <PrinterPage />
    </template>
    <template v-else-if="activeTab === 'wechat-groups'">
      <p class="form-hint">此分区按顶部当前校区取数。</p>
      <WechatGroupPage />
    </template>
    <template v-else-if="activeTab === 'banners'">
      <p class="form-hint">此分区按顶部当前校区取数。</p>
      <HomeBannerPage />
    </template>
    <template v-else-if="activeTab === 'pay-ads'">
      <p class="form-hint">此分区按顶部当前校区取数。</p>
      <PayAdPage />
    </template>
    <template v-else-if="activeTab === 'wheel'">
      <p class="form-hint">此分区按顶部当前校区取数。</p>
      <WheelPage embedded />
    </template>
  </div>
</template>

<style scoped>
.cc-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  margin-bottom: 18px;
  padding: 10px;
  overflow-x: auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 8px 24px #163f2b08;
}
.cc-tabs button {
  flex: 0 0 auto;
  border-radius: 10px;
  min-height: 40px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
}
.cc-tabs button.active {
  background: #07883b;
  border-color: #07883b;
  color: #fff;
}
.cc-panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 8px 24px #163f2b08;
  overflow: hidden;
}
.cc-panel :deep(.el-select),
.cc-panel :deep(.el-date-editor),
.cc-panel :deep(.el-input-number) {
  width: 100%;
}
.cc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.cc-table th {
  text-align: left;
  color: #64748b;
  font-weight: 500;
  padding: 8px 10px;
  border-bottom: 1px solid #e2e8f0;
}
.cc-table td {
  padding: 10px;
  border-bottom: 1px solid #f1f5f9;
}
.cc-actions {
  white-space: nowrap;
  display: flex;
  gap: 6px;
}
.cc-empty {
  text-align: center;
  color: #94a3b8;
  padding: 24px 0 !important;
}
.cc-mono {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.qrcode-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 7px;
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
  gap: 8px;
}
.qrcode-btn {
  padding: 5px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
}
.qrcode-btn:hover {
  border-color: var(--brand);
}
.qrcode-tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--muted);
}
@media (max-width: 760px) {
  .cc-tabs {
    border-radius: 14px;
  }
  .cc-panel {
    padding: 14px;
    border-radius: 14px;
  }
  .qrcode-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
