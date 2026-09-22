<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api";
import { fenToYuan, yuanToFen } from "../utils/money";
import { hasPerm, hasPlatformPerm, sessionUser } from "../session";
import DataPage from "./DataPage.vue";
import type {
  CampusConfigBundle,
  DeliverySlotRow,
  NoticeRow,
} from "../types";

/**
 * 校区配置聚合页（IKHM1O 道哥 2026-09-21 定版全收）：
 * 顶部校区选择器（平台角色）+ Tab 分区，把原散在 6 处的校区维度配置收进一菜单。
 * - 参数类 Tab（档案/配送营业/楼长结算/送达时段/公告）走聚合接口，支持 ?campus=
 * - 内容类 Tab（群码/打印机/Banner/抽奖）内嵌 DataPage 板块复用——按当前登录
 *   校区取数（平台角色配其他校区请先在顶栏切换校区）
 * - Tab 与写入操作按当前有效接口权限过滤，跨校区写入另校验该操作的平台授权。
 */
const isPlatform = computed(() => hasPlatformPerm("GET /admin/campus-config"));
const canEditProfile = computed(() => hasPlatformPerm("PATCH /admin/campuses/:id"));
const canEditDelivery = computed(() => canEditProfile.value ||
  (bundle.value?.campus.id === sessionUser.value?.campusId && hasPerm("PATCH /admin/delivery-config")));
function canWrite(pattern: string) {
  return hasPerm(pattern) && (bundle.value?.campus.id === sessionUser.value?.campusId || hasPlatformPerm(pattern));
}

const TABS = computed(() => {
  const list: Array<{ key: string; label: string }> = [
    { key: "profile", label: "基础档案" },
    { key: "delivery", label: "配送与营业" },
    { key: "salary", label: "楼长结算" },
    { key: "slots", label: "送达时段" },
    { key: "notices", label: "公告" },

  ];
  if (hasPerm("GET /admin/wechat-groups")) list.push({ key: "wechat-groups", label: "微信群码" });
  if (hasPerm("GET /admin/printers")) list.push({ key: "printers", label: "打印机" });
  if (hasPerm("GET /admin/banners"))
    list.push({ key: "banners", label: "Banner" }, { key: "pay-ads", label: "支付广告位" });
  if (hasPerm("GET /admin/wheel")) list.push({ key: "wheel", label: "抽奖转盘" });
  return list;
});
const activeTab = ref("profile");
const campusOptions = ref<Pick<
  import("../types").Campus,
  "id" | "name" | "shortName"
>[]>([]);
const selectedCampus = ref("");
const bundle = ref<CampusConfigBundle | null>(null);
const loading = ref(false);
const message = ref("");
const messageError = ref(false);
const saving = ref(false);

function notify(text: string, error = false) {
  message.value = text;
  messageError.value = error;
  if (text) setTimeout(() => (message.value = ""), 2600);
}

let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  loading.value = true;
  bundle.value = null;
  try {
    const result = await api.campusConfig(selectedCampus.value || undefined);
    if (sequence !== loadSequence) return;
    bundle.value = result;
  } catch (error) {
    if (sequence === loadSequence) notify(error instanceof Error ? error.message : "加载失败", true);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
onMounted(async () => {
  if (isPlatform.value) {
    try {
      campusOptions.value = await api.adminCampuses("filter");
      selectedCampus.value = campusOptions.value.find(c => c.id === sessionUser.value?.campusId)?.id
        ?? campusOptions.value[0]?.id ?? "";
    } catch {
      selectedCampus.value = sessionUser.value?.campusId ?? "";
    }
  }
  await load();
});
watch(selectedCampus, () => void load());

/* ---------- 基础档案（平台角色可编辑；校区角色只读） ---------- */
const profileForm = ref({
  name: "",
  shortName: "",
  warehouseName: "",
  address: "",
  servicePhone: "",
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
    status: b.campus.status === "inactive" ? "inactive" : "active",
  };
});
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
      status: profileForm.value.status,
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
const closeMode = computed({
  get: () =>
    deliveryForm.value.manualClosed
      ? "now"
      : deliveryForm.value.closeStart === deliveryForm.value.closeEnd
        ? "always"
        : "on-time",
  set: (mode) => {
    if (mode === "now") deliveryForm.value.manualClosed = true;
    else {
      deliveryForm.value.manualClosed = false;
      if (mode === "always") {
        deliveryForm.value.closeStart = "00:00";
        deliveryForm.value.closeEnd = "00:00";
      }
    }
  },
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
  if (!confirm(`删除时段「${row.label}」？`)) return;
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
  if (!confirm(`删除公告「${n.content.slice(0, 20)}…」？`)) return;
  try {
    await api.deleteNotice(n.id);
    notify("公告已删除");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}

/** 内容类 Tab：内嵌 DataPage 板块（按当前登录校区取数） */
const EMBED_SECTIONS = [
  "wechat-groups",
  "printers",
  "banners",
  "pay-ads",
  "wheel",
];
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <p class="eyebrow">CAMPUS SETTINGS</p>
        <h1>校区配置</h1>
        <p>档案、配送营业、结算、时段、公告与营销内容——一个校区的全部配置。</p>
      </div>
      <select
        v-if="isPlatform"
        v-model="selectedCampus"
        class="filter-btn"
        aria-label="校区选择"
      >
        <option
          v-for="c in campusOptions"
          :key="c.id"
          :value="c.id"
        >
          {{ c.shortName || c.name }}
        </option>
      </select>
    </div>
    <!-- 保存反馈走全局 .toast（DataPage 同款 fixed 居中），不再行内文本条 -->
    <div
      v-if="message"
      class="toast"
      :class="{ error: messageError }"
      role="status"
    >
      {{ message }}
    </div>
    <nav class="cc-tabs" aria-label="配置分区">
      <button
        v-for="t in TABS"
        :key="t.key"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <p v-if="loading" class="form-hint">加载中…</p>

    <!-- 基础档案 -->
    <section v-else-if="activeTab === 'profile'" class="cc-panel">
      <template v-if="bundle">
        <div class="cc-form">
          <label
            >校区全称
            <input v-model.trim="profileForm.name" :disabled="!canEditProfile" /></label>
          <label
            >简称
            <input
              v-model.trim="profileForm.shortName"
              :disabled="!canEditProfile"
          /></label>
          <label
            >仓库名
            <input
              v-model.trim="profileForm.warehouseName"
              :disabled="!canEditProfile"
          /></label>
          <label
            >地址
            <input v-model.trim="profileForm.address" :disabled="!canEditProfile" /></label>
          <label
            >客服电话（小程序拨号展示）
            <input
              v-model.trim="profileForm.servicePhone"
              :disabled="!canEditProfile"
              maxlength="20"
              placeholder="如 4008002026"
          /></label>
          <label v-if="canEditProfile"
            >状态
            <select v-model="profileForm.status">
              <option value="active">营业中</option>
              <option value="inactive">已停用</option>
            </select></label
          >
        </div>
        <p v-if="!canEditProfile" class="form-hint"
          >基础档案仅总部/平台账号可修改</p
        >
        <button
          v-if="canEditProfile"
          class="btn primary"
          :disabled="saving"
          @click="saveProfile"
        >
          保存档案</button
        >
      </template>
    </section>

    <!-- 配送与营业 -->
    <section v-else-if="activeTab === 'delivery'" class="cc-panel">
      <template v-if="bundle">
        <fieldset class="cc-form" :disabled="!canEditDelivery">
          <label
            >即时达配送费（元）
            <input
              v-model.number="deliveryForm.instant"
              type="number"
              min="0"
              step="0.01" /></label>
          <label
            >预约达配送费（元）
            <input
              v-model.number="deliveryForm.scheduled"
              type="number"
              min="0"
              step="0.01" /></label>
          <label
            >起送门槛（元）
            <input
              v-model.number="deliveryForm.threshold"
              type="number"
              min="0"
              step="0.01" /></label>
          <label
            >闭店方式
            <select v-model="closeMode">
              <option value="always">24 小时营业</option>
              <option value="on-time">按时间打烊</option>
              <option value="now">立即闭店（手动）</option>
            </select></label
          >
          <template v-if="closeMode === 'on-time'">
            <label
              >打烊开始
              <input
                v-model="deliveryForm.closeStart"
                type="time" /></label>
            <label
              >打烊结束
              <input v-model="deliveryForm.closeEnd" type="time" /></label>
          </template>
          <label class="cc-form--wide"
            >无楼长提示（下单结算弹窗，空=默认文案）
            <textarea
              v-model.trim="deliveryForm.noManagerTip"
              rows="2"
              maxlength="60"
              placeholder="默认：本楼栋正在招募楼长，暂时需要您到寝室楼下取货，感谢理解～"
            ></textarea
          ></label>
        </fieldset>
        <p class="form-hint"
          >打烊窗跨零点合法（如 22:00 ~ 06:00）；立即闭店与时间窗叠加判定。</p
        >
        <button v-if="canEditDelivery" class="btn primary" :disabled="saving" @click="saveDelivery">
          保存配送与营业配置</button
        >
      </template>
    </section>

    <!-- 楼长结算 -->
    <section v-else-if="activeTab === 'salary'" class="cc-panel">
      <template v-if="bundle">
        <div class="cc-form">
          <label
            >楼长月度底薪（元，0 = 无底薪纯提成）
            <input
              v-model.number="salaryForm.baseSalary"
              type="number"
              min="0"
              step="1"
              :disabled="!canEditProfile" /></label>
        </div>
        <p v-if="!canEditProfile" class="form-hint"
          >底薪仅总部/平台账号可修改</p
        >
        <button
          v-if="canEditProfile"
          class="btn primary"
          :disabled="saving"
          @click="saveSalary"
        >
          保存底薪</button
        >
      </template>
    </section>

    <!-- 送达时段 -->
    <section v-else-if="activeTab === 'slots'" class="cc-panel">
      <template v-if="bundle">
        <div v-if="canWrite('POST /admin/delivery-slots')" class="cc-add-row">
          <input
            v-model.trim="slotForm.label"
            placeholder="时段文案，如 12:00-14:00"
            maxlength="20"
          />
          <input
            v-model.number="slotForm.capacity"
            type="number"
            min="0"
            placeholder="容量"
            style="width: 110px"
          />
          <button class="btn primary" @click="addSlot">新增时段</button>
        </div>
        <table class="cc-table">
          <thead>
            <tr>
              <th>时段</th>
              <th>容量</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in slots" :key="s.id">
              <td>{{ s.label }}</td>
              <td>{{ s.capacity }}</td>
              <td
                ><span class="status" :class="s.available ? 'ok' : 'muted'">{{
                  s.available ? "可用" : "停用"
                }}</span></td
              >
              <td class="cc-actions">
                <button class="btn mini ghost" v-if="canWrite('PATCH /admin/delivery-slots/:id')" @click="toggleSlot(s)">
                  {{ s.available ? "停用" : "启用" }}</button
                ><button class="btn mini danger-btn" v-if="canWrite('DELETE /admin/delivery-slots/:id')" @click="removeSlot(s)">
                  删除</button
                ></td
              >
            </tr>
            <tr v-if="!slots.length"
              ><td colspan="4" class="cc-empty">暂无送达时段（预约达下单需要）</td></tr
            >
          </tbody>
        </table>
      </template>
    </section>

    <!-- 公告 -->
    <section v-else-if="activeTab === 'notices'" class="cc-panel">
      <template v-if="bundle">
        <div v-if="canWrite('POST /admin/notices')" class="cc-add-col">
          <textarea
            v-model.trim="noticeForm.content"
            rows="2"
            maxlength="200"
            placeholder="公告内容（小程序首页跑马灯显示，多条自动用「｜」拼接）"
          ></textarea>
          <div class="cc-add-row">
            <label
              >生效起
              <input v-model="noticeForm.startsAt" type="datetime-local" /></label>
            <label
              >生效止
              <input v-model="noticeForm.endsAt" type="datetime-local" /></label>
            <button class="btn primary" @click="addNotice">发布公告</button>
          </div>
        </div>
        <table class="cc-table">
          <thead>
            <tr>
              <th>内容</th>
              <th>生效窗</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in notices" :key="n.id">
              <td style="max-width: 320px">{{ n.content }}</td>
              <td class="cc-mono"
                >{{
                  new Date(n.startsAt).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }}
                ~
               {{
                  new Date(n.endsAt).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }}</td
              >
              <td>
                <span class="status" :class="noticeState(n).tone">{{
                  noticeState(n).text
                }}</span></td
              >
              <td class="cc-actions">
                <button class="btn mini ghost" v-if="canWrite('PATCH /admin/notices/:id')" @click="toggleNotice(n)">
                  {{ n.status === "active" ? "停用" : "启用" }}</button
                ><button class="btn mini danger-btn" v-if="canWrite('DELETE /admin/notices/:id')" @click="removeNotice(n)">
                  删除</button
                ></td
              >
            </tr>
            <tr v-if="!notices.length"
              ><td colspan="4" class="cc-empty"
                >暂无公告——发布后小程序首页顶部跑马灯显示</td
              ></tr
            >
          </tbody>
        </table>
      </template>
    </section>

    <!-- 内容类 Tab：内嵌 DataPage 板块（按当前登录校区） -->
    <template v-else-if="EMBED_SECTIONS.includes(activeTab)">
      <p class="form-hint"
        >此分区按当前登录校区取数；平台账号配置其他校区请先在顶栏切换校区。</p
      >
      <DataPage :fixed-section="activeTab" />
    </template>
  </div>
</template>

<style scoped>
.cc-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.cc-tabs button {
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 8px;
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
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
}
.cc-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.cc-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #475569;
}
.cc-form input,
.cc-form select,
.cc-form textarea {
  /* 数字/时间原生框宽度由浏览器决定（窄、参差）——拉满列宽与档案文本框一致 */
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
}
.cc-form--wide {
  grid-column: 1 / -1;
}
.cc-add-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 14px;
}
.cc-add-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #475569;
}
.cc-add-row input,
.cc-add-col textarea {
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
}
.cc-add-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.cc-add-col textarea,
.cc-form textarea {
  resize: none;
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
</style>
