<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, downloadRoomTemplate, fetchAllPages } from "../api";
import IdCardImagesField from "../components/IdCardImagesField.vue";
import ImageUploadField from "../components/ImageUploadField.vue";
import ProductImagesField from "../components/ProductImagesField.vue";
import ProductPickerField from "../components/ProductPickerField.vue";
import {
  canWrite,
  role,
  ROLE_LABELS,
  sessionUser,
  type AdminRole,
} from "../session";
import { resolveImageUrl } from "../utils/image";
import { fmtDate, fmtDateTime } from "../utils/datetime";
import { fenToYuan, yuanToFen } from "../utils/money";
import type {
  AccountRow,
  AdminRow,
  AdminUser,
  AfterSale,
  AfterSaleRow,
  BarcodeLookup,
  Banner,
  Building,
  Campus,
  Category,
  Printer,
  CategoryRow,
  CommissionRule,
  Coupon,
  DispatchInvitation,
  DispatchRow,
  InventoryTxn,
  LeaveRequest,
  LeaveRow,
  ListQuery,
  MarketingMapData,
  Order,
  PagedResponse,
  Product,
  Promotion,
  RecruitingApplication,
  Room,
  RuleRow,
  Settlement,
  Staff,
  UserOrderRow,
  UserStats,
  WechatGroup,
  WheelPrizeInput,
  WheelRow,
} from "../types";
const route = useRoute(),
  rows = ref<AdminRow[]>([]),
  loading = ref(true),
  loadError = ref(""),
  keyword = ref(""),
  selected = ref<AdminRow>(),
  message = ref(""),
  messageError = ref(false),
  creating = ref(false),
  scanning = ref(false),
  video = ref<HTMLVideoElement>(),
  scanError = ref(""),
  confirmDelete = ref(false),
  productEdit = ref({
    // 资料字段（IKAHAT）：名称/副标题/分类/原价/标签/重量可编辑
    name: "",
    subtitle: "",
    categoryId: "",
    originalPrice: 0,
    tag: "",
    weight: 0,
    price: 0,
    // IKC1AC 价格三层：进货价/批发价仅 hq 编辑；status 上下架（IKC1AB）
    costPrice: 0,
    wholesalePrice: 0,
    status: "on-sale" as "on-sale" | "off-sale",
    stock: 0,
    image: "",
    location: "",
    locationCode: "",
    images: [] as string[],
    // 单位属性（IKFOPU）：官方资料，校区同步行只读
    retailUnit: "",
    wholesaleUnit: "件",
    unitsPerCase: 1,
    // 商品介绍（IKAHAU）：整段覆盖，空串清空
    description: "",
  }),
  productForm = ref({
    barcode: "",
    name: "",
    subtitle: "",
    categoryId: "snack",
    price: 0,
    originalPrice: 0,
    // IKC1AC：官方库建档的三层价格（进货价/批发价格）
    costPrice: 0,
    wholesalePrice: 0,
    stock: 0,
    tag: "新品",
    image: "",
    location: "",
    locationCode: "",
    images: [] as string[],
    weight: 0,
    // 单位属性（IKFOPU）：零售按听/瓶卖、订货按件批发；含量=件含零售数
    retailUnit: "",
    wholesaleUnit: "件",
    unitsPerCase: 1,
    // 商品介绍（IKAHAU）：纯文本多行，空 = 小程序详情页不渲染
    description: "",
  });
const statusFilter = ref("all"),
  exporting = ref(false),
  page = ref(1),
  pageSize = ref(10),
  total = ref(0),
  jumpTo = ref<number | "">(""),
  keywordTimer = ref<ReturnType<typeof setTimeout>>();
const PAGE_SIZES = [10, 20, 50];
let cameraStream: MediaStream | undefined;

/* ---------- 通用表单抽屉（新建/编辑：优惠券、楼栋、员工、库存操作） ---------- */
type FormValue = string | number | boolean | string[];
interface FieldDef {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "date"
    | "datetime"
    | "select"
    | "checkbox"
    | "password"
    | "image"
    | "textarea"
    | "campus-multi"
    | "product-picker";
  options?: () => { value: string | number; label: string }[];
  placeholder?: string;
  wide?: boolean;
  min?: number;
  step?: number;
  optional?: boolean;
  optionalLabel?: string;
  /** 条件显隐（IK9U3Y）：按当前表单值判断，如角色=配送员时隐藏绑定楼栋。 */
  visible?: (data: Record<string, FormValue>) => boolean;
  /** 条件禁用（IKDERC）：如已发放券的面额/门槛锁定。 */
  disabled?: (data: Record<string, FormValue>) => boolean;
  /** 字段级动态风险提醒（IKB3K1）：返回 undefined 不渲染。 */
  hint?: (data: Record<string, FormValue>) => string | undefined;
  /** 商品选择器候选源（IKGNQ 三轮）：如促销只用本校区在售商品；缺省全量缓存 */
  ppItems?: () => Product[];
  /** 选品行补显进货价（IKH15V）：定促销价对照毛利用；其余选择器场景缺省不显示 */
  ppShowCost?: boolean;
  /** COS 目录（IK9VBI）：app=小程序素材（Banner 背景）；缺省 uploads/。 */
  folder?: string;
}
interface FormMeta {
  eyebrow: string;
  title: string;
  submit: string;
  fields: FieldDef[];
  done: string;
  save: (data: Record<string, FormValue>) => Promise<void>;
}
const formOpen = ref(false),
  formError = ref(""),
  formSaving = ref(false),
  formData = ref<Record<string, FormValue>>({}),
  formMeta = ref<FormMeta>();
function openForm(meta: FormMeta, initial: Record<string, FormValue>) {
  formMeta.value = meta;
  formData.value = { ...initial };
  formError.value = "";
  formOpen.value = true;
}
/** 条件字段过滤（IK9U3Y）：visible 不满足的字段不渲染也不参与提交。 */
const visibleFields = computed(
  () =>
    formMeta.value?.fields.filter(
      (field) => !field.visible || field.visible(formData.value),
    ) ?? [],
);
function fieldOptions(field: FieldDef) {
  const options = [...(field.options?.() ?? [])];
  const current = formData.value[field.key];
  if (
    current !== undefined &&
    current !== "" &&
    !options.some((o) => String(o.value) === String(current))
  )
    options.push({ value: String(current), label: `当前值：${current}` });
  return options;
}
function fieldInputType(field: FieldDef): string {
  if (field.type === "datetime") return "datetime-local";
  return field.type || "text";
}
async function submitForm() {
  const meta = formMeta.value;
  if (!meta) return;
  formError.value = "";
  formSaving.value = true;
  try {
    await meta.save({ ...formData.value });
    notify(meta.done);
    formOpen.value = false;
    await load();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "保存失败";
  } finally {
    formSaving.value = false;
  }
}

/* ---------- 楼栋 / 寝室 ---------- */
const buildings = ref<Building[]>([]);
async function ensureBuildings() {
  if (!buildings.value.length) buildings.value = await fetchAllPages(api.buildings);
  return buildings.value;
}
function buildingOptions() {
  return buildings.value.map((b) => ({ value: b.id, label: b.name }));
}
async function refreshBuildings() {
  buildings.value = await fetchAllPages(api.buildings);
}
function buildingPayload(d: Record<string, FormValue>) {
  return {
    name: String(d.name || "").trim(),
    floors: Number(d.floors),
    hasElevator: !!d.hasElevator,
    gender: String(d.gender || "").trim(),
  };
}
function openBuildingCreate() {
  openForm(
    {
      eyebrow: "NEW BUILDING",
      title: "新建楼栋",
      submit: "保存楼栋",
      done: "楼栋已创建",
      fields: [
        { key: "name", label: "楼栋名称", placeholder: "例如：西区 5 栋" },
        { key: "floors", label: "楼层数", type: "number", min: 1 },
        { key: "gender", label: "性别分区", type: "select", options: () => [
          { value: "male", label: "男生" },
          { value: "female", label: "女生" },
          { value: "mixed", label: "混合" },
        ] },
        { key: "hasElevator", label: "有电梯", type: "checkbox" },
      ],
      save: async (d) => void (await api.createBuilding(buildingPayload(d))),
    },
    // 2026-09-05 道哥：电梯默认不勾选（多数学生楼无电梯，选错影响配送时效）
    { name: "", floors: 6, gender: "mixed", hasElevator: false },
  );
}
/* ---------- 配送费配置（IK9SO6）：校园维度即时/预约达运费与起送门槛；
   打烊停单（IKGI1C）：时间窗 + 手动闭店随同一配置提交 ---------- */
/** 打烊时间下拉选项：30 分钟粒度 00:00–23:30（当前值不在粒度内由表单层兜底回填） */
function closeTimeOptions() {
  const list: { value: string; label: string }[] = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    list.push({ value: v, label: v });
  }
  return list;
}
async function openDeliveryConfig() {
  let initial = {
    instant: 4,
    scheduled: 2,
    threshold: 10,
    closeMode: "always",
    closeStart: "00:00",
    closeEnd: "00:00",
  };
  try {
    const config = await api.deliveryConfig();
    initial = {
      instant: Number(fenToYuan(config.deliveryFeeInstant)),
      scheduled: Number(fenToYuan(config.deliveryFeeScheduled)),
      threshold: Number(fenToYuan(config.deliveryThreshold)),
      // 道哥 2026-09-17：闭店方式三选一，默认 24 小时营业（start==end 即不打烊）
      closeMode: config.manualClosed
        ? "now"
        : config.closeStart === config.closeEnd
          ? "always"
          : "on-time",
      closeStart: config.closeStart ?? "00:00",
      closeEnd: config.closeEnd ?? "00:00",
    };
  } catch {
    // 读取失败不阻塞表单，保存时以后端校验为准
  }
  openForm(
    {
      eyebrow: "DELIVERY PRICING",
      title: "配送费与起送门槛",
      submit: "保存配置",
      done: "配送配置已更新，用户端结算即时生效",
      fields: [
        { key: "instant", label: "即时达配送费（元）", type: "number", min: 0, step: 0.01 },
        { key: "scheduled", label: "预约达配送费（元）", type: "number", min: 0, step: 0.01 },
        { key: "threshold", label: "起送门槛（元）", type: "number", min: 0, step: 0.01 },
        {
          key: "closeMode",
          label: "闭店方式",
          type: "select",
          options: () => [
            { value: "always", label: "24小时营业（不打烊）" },
            { value: "on-time", label: "定时打烊（每日时间窗）" },
            { value: "now", label: "立即打烊" },
          ],
          hint: (d) =>
            d.closeMode === "now"
              ? "保存后立即停止接单；恢复营业请改回「24小时营业」或「定时打烊」再保存"
              : undefined,
        },
        {
          key: "closeStart",
          label: "打烊开始",
          type: "select",
          options: closeTimeOptions,
          visible: (d) => d.closeMode === "on-time",
        },
        {
          key: "closeEnd",
          label: "打烊结束",
          type: "select",
          options: closeTimeOptions,
          visible: (d) => d.closeMode === "on-time",
          hint: () => "跨零点合法，如 22:00–08:00；两值相同 = 不打烊",
        },
      ],
      save: async (d) => {
        if ([d.instant, d.scheduled, d.threshold].some((v) => Number(v) < 0))
          throw new Error("金额不能为负");
        // 立即打烊：不传时间字段（后端 undefined 不动原值），manualClosed 置真
        if (d.closeMode === "now") {
          closeState.value = await api.updateDeliveryConfig({
            deliveryFeeInstant: yuanToFen(d.instant),
            deliveryFeeScheduled: yuanToFen(d.scheduled),
            deliveryThreshold: yuanToFen(d.threshold),
            manualClosed: true,
          });
          return;
        }
        // 24小时营业：显式落 start=end（清掉可能存在的打烊窗）
        if (d.closeMode === "always") {
          closeState.value = await api.updateDeliveryConfig({
            deliveryFeeInstant: yuanToFen(d.instant),
            deliveryFeeScheduled: yuanToFen(d.scheduled),
            deliveryThreshold: yuanToFen(d.threshold),
            closeStart: "00:00",
            closeEnd: "00:00",
            manualClosed: false,
          });
          return;
        }
        // 定时打烊：时间窗 HH:mm 校验（IKGI1C）：start > end = 跨天窗，两值相同 = 不打烊
        const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!hhmm.test(String(d.closeStart ?? "")) || !hhmm.test(String(d.closeEnd ?? "")))
          throw new Error("打烊时间格式须为 HH:mm，如 22:00");
        // 表单输元，提交统一转分（IK8W5K）；返回值回填页头打烊徽标
        closeState.value = await api.updateDeliveryConfig({
          deliveryFeeInstant: yuanToFen(d.instant),
          deliveryFeeScheduled: yuanToFen(d.scheduled),
          deliveryThreshold: yuanToFen(d.threshold),
          closeStart: String(d.closeStart),
          closeEnd: String(d.closeEnd),
          manualClosed: false,
        });
      },
    },
    initial,
  );
}
/* ---------- 打烊停单状态徽标（IKGI1C）：手动闭店 > 时间窗，北京时间本地判定 ---------- */
const closeState = ref<{
  closeStart?: string;
  closeEnd?: string;
  manualClosed?: boolean;
} | null>(null);
async function loadCloseState() {
  try {
    closeState.value = await api.deliveryConfig();
  } catch {
    closeState.value = null; // 读取失败静默，徽标隐藏不阻塞列表
  }
}
/** 北京时间当前 HH:mm（h23 避免午夜显示 24:xx）。 */
function beijingHHmm(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}
const nowTick = ref(0);
let closeTicker: number | undefined;
onMounted(() => {
  closeTicker = window.setInterval(() => void nowTick.value++, 30_000);
});
onUnmounted(() => {
  if (closeTicker) window.clearInterval(closeTicker);
});
/** 徽标文案/配色：闭店类红色 danger，营业中绿色 success；start===end 不打烊。 */
const closeBadge = computed<{ text: string; tone: string } | null>(() => {
  void nowTick.value; // 每 30s 重算，跨过打烊点自动翻转
  const s = closeState.value;
  if (!s) return null;
  if (s.manualClosed) return { text: "已闭店（手动）", tone: "danger" };
  const start = s.closeStart ?? "22:00";
  const end = s.closeEnd ?? "08:00";
  if (start !== end) {
    const now = beijingHHmm();
    // HH:mm 零填充字符串可直接比较；start > end = 跨天窗
    const inWindow =
      start < end ? now >= start && now < end : now >= start || now < end;
    if (inWindow) return { text: "已打烊（时间窗）", tone: "danger" };
  }
  return { text: "营业中", tone: "success" };
});
function openBuildingEdit(row: Building) {
  selected.value = undefined;
  openForm(
    {
      eyebrow: "EDIT BUILDING",
      title: "编辑楼栋",
      submit: "保存修改",
      done: "楼栋信息已更新",
      fields: [
        { key: "name", label: "楼栋名称" },
        { key: "floors", label: "楼层数", type: "number", min: 1 },
        { key: "gender", label: "性别分区", type: "select", options: () => [
          { value: "male", label: "男生" },
          { value: "female", label: "女生" },
          { value: "mixed", label: "混合" },
        ] },
        { key: "hasElevator", label: "有电梯", type: "checkbox" },
      ],
      save: async (d) =>
        void (await api.updateBuilding(row.id, buildingPayload(d))),
    },
    {
      name: row.name,
      floors: row.floors,
      gender: row.gender ?? "mixed",
      hasElevator: !!row.hasElevator,
    },
  );
}
async function removeBuilding() {
  if (!selected.value) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.deleteBuilding(selected.value.id);
    notify("楼栋已删除");
    selected.value = undefined;
    await refreshBuildings();
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
/* 寝室管理抽屉 */
const roomsOpen = ref(false),
  roomsLoading = ref(false),
  rooms = ref<Room[]>([]),
  roomsBuilding = ref<Building>(),
  roomError = ref(""),
  roomConfirmId = ref(""),
  roomForm = ref({ floor: 1, roomNo: "" });
async function openRooms(building: Building) {
  selected.value = undefined;
  roomsBuilding.value = building;
  roomsOpen.value = true;
  roomError.value = "";
  roomConfirmId.value = "";
  roomForm.value = { floor: 1, roomNo: "" };
  await loadRooms();
}
async function loadRooms() {
  const building = roomsBuilding.value;
  if (!building) return;
  roomsLoading.value = true;
  roomError.value = "";
  try {
    rooms.value = await fetchAllPages((query) => api.rooms(building.id, query));
  } catch (error) {
    roomError.value = error instanceof Error ? error.message : "加载寝室失败";
  } finally {
    roomsLoading.value = false;
  }
}
async function addRoom() {
  if (!roomsBuilding.value) return;
  const roomNo = roomForm.value.roomNo.trim();
  if (!roomNo) {
    roomError.value = "请填写寝室号";
    return;
  }
  try {
    await api.createRoom(roomsBuilding.value.id, {
      floor: Number(roomForm.value.floor),
      roomNo,
    });
    notify("寝室已添加");
    roomForm.value = { floor: roomForm.value.floor, roomNo: "" };
    await loadRooms();
  } catch (error) {
    roomError.value = error instanceof Error ? error.message : "添加失败";
  }
}
async function removeRoom(roomId: string) {
  if (!roomsBuilding.value) return;
  if (roomConfirmId.value !== roomId) {
    roomConfirmId.value = roomId;
    return;
  }
  try {
    await api.deleteRoom(roomsBuilding.value.id, roomId);
    notify("寝室已删除");
    roomConfirmId.value = "";
    await loadRooms();
  } catch (error) {
    roomError.value = error instanceof Error ? error.message : "删除失败";
  }
}
/* 寝室批量导入（IKD6FH）：模板下载 + xlsx 上传，楼栋内重复寝室后端自动跳过 */
const roomsImporting = ref(false),
  roomsImportInput = ref<HTMLInputElement>();
async function downloadRoomsTemplate() {
  if (!roomsBuilding.value) return;
  try {
    await downloadRoomTemplate(roomsBuilding.value.id);
    notify("模板已下载，按「楼层 / 寝室号」两列填写");
  } catch (error) {
    notify(error instanceof Error ? error.message : "模板下载失败", true);
  }
}
function pickRoomsImportFile() {
  roomsImportInput.value?.click();
}
async function onRoomsImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 清空以便重复选择同一文件
  if (!roomsBuilding.value || !file) return;
  roomsImporting.value = true;
  roomError.value = "";
  try {
    const res = await api.importRooms(roomsBuilding.value.id, file);
    notify(`导入 ${res.imported} 条，跳过 ${res.skipped} 条`);
    // 行级错误不阻塞合法行入库，就地展示前几条
    if (res.errors.length)
      roomError.value = `部分行未导入：${res.errors.slice(0, 3).join("；")}`;
    await loadRooms();
  } catch (error) {
    roomError.value = error instanceof Error ? error.message : "导入失败";
  } finally {
    roomsImporting.value = false;
  }
}

/* ---------- 员工账号 ---------- */
// IKEAGE：实习楼长（招募审批自动创建，与楼长同权），排序跟在「楼长」后。
// 2026-09-14 道哥放开手建：新增表单与编辑同口径用 ROLE_OPTIONS，
// 后端 createStaff/updateStaff 已兼容 roleText 与楼栋绑定校验
const ROLE_OPTIONS = [
  { value: "building-manager", label: "楼长" },
  { value: "intern-building-manager", label: "实习楼长" },
  { value: "fulltime-rider", label: "全职配送员" },
  { value: "parttime-rider", label: "兼职配送员" },
];
function staffPayload(d: Record<string, FormValue>) {
  // IKBW0E：payload 需容纳显式 null（清空楼栋绑定），故放宽为 FormValue | null
  const payload: Record<string, FormValue | null> = {
    name: String(d.name || "").trim(),
    role: String(d.role || ""),
    staffNo: String(d.staffNo || "").trim(),
    status: String(d.status || "online"),
    // IKGVOO：服务范围（所属校区）随表单提交，后端校验真实运营校区
    campusId: String(d.campusId || "").trim(),
  };
  // IK9U3Y：楼栋仅楼长系角色（楼长/实习楼长）携带；骑手不绑楼栋（后端同样校验）。
  // IKBW0E：清空绑定必须显式传 null——省略字段会被后端视为「未修改」，
  // 造成保存假成功、原绑定实际未解除
  if (d.role === "building-manager" || d.role === "intern-building-manager")
    payload.buildingId = d.buildingId ? d.buildingId : null;
  return payload;
}
/** IK9U3Y：绑定楼栋仅楼长系（楼长/实习楼长）可见——配送员系统派单、不绑特定楼栋。
 *  IKBW0E：楼长可清空绑定解绑（后端置「待分配」；一楼一在职楼长仅约束正式楼长）。 */
const STAFF_BUILDING_FIELD: FieldDef = {
  key: "buildingId",
  label: "绑定楼栋（一楼一在职楼长、实习楼长可共存；清空保存=解绑为待分配）",
  type: "select",
  wide: true,
  optional: true,
  options: staffBuildingOptions,
  visible: (d) =>
    d.role === "building-manager" || d.role === "intern-building-manager",
};
/** IKGVOO 员工服务范围：所属校区下拉选项（运营校区全量） */
const staffCampusOptions = () =>
  campusOptionsData.value.map((c) => ({ value: c.id, label: c.name }));
/** 按校区缓存楼栋（跨校区选服务范围后联动重拉） */
const staffBuildingsByCampus = ref<Record<string, Building[]>>({});
async function ensureStaffBuildings(campus: string) {
  if (!campus || staffBuildingsByCampus.value[campus]) return;
  const rows = await fetchAllPages((query) =>
    api.buildings({ ...query, campusId: campus }),
  );
  staffBuildingsByCampus.value = {
    ...staffBuildingsByCampus.value,
    [campus]: rows,
  };
}
function staffBuildingOptions() {
  const rows =
    staffBuildingsByCampus.value[String(formData.value.campusId ?? "")] ?? [];
  return rows.map((b) => ({ value: b.id, label: b.name }));
}
/** 切换所属校区：联动拉楼栋并清空已选楼栋（改派=待分配重选，IKGVOO 拍板） */
watch(
  () => String(formData.value.campusId ?? ""),
  (campus) => {
    void ensureStaffBuildings(campus);
    formData.value.buildingId = "";
  },
);
function openStaffCreate() {
  void ensureBuildings();
  void ensureCampusOptions();
  // IKGVOO：默认服务范围=顶栏当前运营校区（切校区换 token，sessionUser.campusId 恒同步）
  const defaultCampus = sessionUser.value?.campusId ?? "";
  void ensureStaffBuildings(defaultCampus);
  openForm(
    {
      eyebrow: "NEW STAFF",
      title: "新增员工账号",
      submit: "创建账号",
      done: "员工账号已创建",
      fields: [
        {
          key: "campusId",
          label: "所属校区（服务范围）",
          type: "select",
          wide: true,
          options: staffCampusOptions,
        },
        { key: "name", label: "姓名", placeholder: "真实姓名" },
        { key: "staffNo", label: "工号", placeholder: "例如：BM-006" },
        { key: "role", label: "角色", type: "select", options: () => ROLE_OPTIONS },
        // IKD7TL：状态紧跟角色同行（绑定楼栋 wide 字段随后独占一行）
        { key: "status", label: "状态", type: "select", options: () => [
          { value: "online", label: "在职" },
          { value: "offline", label: "离线" },
        ] },
        STAFF_BUILDING_FIELD,
      ],
      save: async (d) => void (await api.createStaff(staffPayload(d))),
    },
    {
      name: "",
      staffNo: "",
      role: "building-manager",
      buildingId: "",
      status: "online",
      campusId: defaultCampus,
    },
  );
}
function openStaffEdit(row: Staff) {
  selected.value = undefined;
  void ensureBuildings();
  void ensureCampusOptions();
  void ensureStaffBuildings(row.campusId);
  openForm(
    {
      eyebrow: "EDIT STAFF",
      title: "编辑员工账号",
      submit: "保存修改",
      done: "员工账号已更新",
      fields: [
        { key: "name", label: "姓名" },
        { key: "staffNo", label: "工号" },
        { key: "role", label: "角色", type: "select", options: () => ROLE_OPTIONS },
        // IKD7TL：状态紧跟角色同行（绑定楼栋 wide 字段随后独占一行）
        { key: "status", label: "状态", type: "select", options: () => [
          { value: "online", label: "在职" },
          { value: "offline", label: "离线" },
        ] },
        STAFF_BUILDING_FIELD,
      ],
      save: async (d) => void (await api.updateStaff(row.id, staffPayload(d))),
    },
    {
      campusId: row.campusId,
      name: row.name,
      staffNo: row.staffNo,
      role: row.role ?? "building-manager",
      buildingId: row.buildingId ?? "",
      status: row.status ?? "online",
    },
  );
}
async function removeStaff() {
  if (!selected.value) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.deleteStaff(selected.value.id);
    notify("员工账号已删除");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}

/* ---------- 优惠券 ---------- */
function openCouponCreate() {
  const nextMonth = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  openForm(
    {
      eyebrow: "NEW COUPON",
      title: "新建优惠券",
      submit: "保存并启用",
      done: "优惠券已创建并启用",
      fields: [
        // IKDCVO：券品种 + 发放方式（kind × trigger）
        {
          key: "kind",
          label: "券品种",
          type: "select",
          options: () => [
            { value: "platform", label: "金额券（下单自动抵扣）" },
            { value: "partner", label: "异业券（到店出示，暂不核销）" },
          ],
        },
        { key: "name", label: "券名称", placeholder: "例如：满 20 减 5 寝室券", wide: true },
        {
          key: "trigger",
          label: "发放方式",
          type: "select",
          options: () => [
            { value: "manual", label: "手动领取（领券中心）" },
            { value: "lottery", label: "转盘抽奖发放" },
            { value: "signup", label: "新人注册自动发放" },
          ],
          hint: (d) =>
            d.trigger === "signup"
              ? "每个新注册用户自动发放一张（已持有不重复发）"
              : d.trigger === "lottery"
                ? "不进领券中心，转盘中奖自动入账（转盘奖位需选择此券）"
                : undefined,
        },
        {
          key: "amount",
          label: "面额（元）",
          type: "number",
          min: 0.01,
          step: 0.01,
          visible: (d) => d.kind === "platform",
          // IKB3K1：面额≥门槛的风险提醒（无门槛券恒触发，重点提示大面额）
          hint: (d) =>
            Number(d.amount) >= Number(d.threshold || 0)
              ? Number(d.threshold) > 0
                ? "面额≥使用门槛：小额订单可能被减到 0 元以下，这类订单将无法使用此券，请确认配置"
                : "无门槛券每单立减全额面额，面额过大易产生 0 元订单，请慎重配置"
              : undefined,
        },
        {
          key: "threshold",
          label: "使用门槛（元）",
          type: "number",
          min: 0,
          step: 0.01,
          visible: (d) => d.kind === "platform",
        },
        {
          key: "remark",
          label: "优惠说明（选填）",
          placeholder: "例如：到店出示享第二杯半价",
          wide: true,
        },
        // IKDEN2：发放总量可选不限量（total=null），与「长期有效」同款交互
        {
          key: "totalMode",
          label: "发放总量",
          type: "select",
          options: () => [
            { value: "limited", label: "限量" },
            { value: "unlimited", label: "不限量" },
          ],
        },
        {
          key: "total",
          label: "总量张数",
          type: "number",
          min: 1,
          visible: (d) => d.totalMode !== "unlimited",
        },
        {
          key: "expiryMode",
          label: "有效期",
          type: "select",
          options: () => [
            { value: "date", label: "固定日期" },
            { value: "forever", label: "长期有效" },
          ],
        },
        {
          key: "expiresAt",
          label: "有效期至",
          type: "date",
          visible: (d) => d.expiryMode !== "forever",
        },
        // 支付后推荐（道哥 2026-09-08）：支付成功页领券卡展示位
        {
          key: "featuredAfterPay",
          label: "支付后推荐（支付成功页展示，用户可一键领取）",
          type: "checkbox",
        },
      ],
      save: async (d) => {
        if (!String(d.name || "").trim()) throw new Error("请填写券名称");
        const partner = d.kind === "partner";
        if (!partner && !(Number(d.amount) > 0))
          throw new Error("请填写面额");
        if (d.expiryMode !== "forever" && !d.expiresAt)
          throw new Error("请选择有效期，或切换为长期有效");
        if (
          d.totalMode !== "unlimited" &&
          !(Number(d.total) >= 1)
        )
          throw new Error("请填写发放总量，或切换为不限量");
        // 面额/门槛表单输元，提交前统一转分；partner 券恒 0 不参与下单；
        // IKDEN2：不限量不传 total（后端记 null）
        await api.createCoupon({
          name: String(d.name).trim(),
          amount: partner ? 0 : yuanToFen(d.amount),
          threshold: partner ? 0 : yuanToFen(d.threshold),
          ...(d.totalMode === "unlimited"
            ? {}
            : { total: Number(d.total) }),
          ...(d.expiryMode === "forever"
            ? {}
            : { expiresAt: String(d.expiresAt) }),
          kind: partner ? "partner" : "platform",
          trigger: (d.trigger as "manual" | "lottery" | "signup") || "manual",
          remark: String(d.remark || "").trim(),
          featuredAfterPay: !!d.featuredAfterPay,
        });
      },
    },
    {
      kind: "platform",
      trigger: "manual",
      featuredAfterPay: false,
      name: "",
      amount: 5,
      threshold: 20,
      // IKDEN2：默认限量，总量输入框随开关显隐
      totalMode: "limited",
      total: 100,
      expiryMode: "date",
      expiresAt: nextMonth,
      remark: "",
    },
  );
}
/** 优惠券编辑（IKDERC）：已发放（claimed>0）锁面额/门槛；总量只能放大或
 *  转不限量；kind/trigger 展示但不可改。 */
function openCouponEdit(c: Coupon) {
  const locked = c.claimed > 0;
  const lockHint = locked
    ? `已发放 ${c.claimed} 张，面额/门槛锁定（资金口径），可调名称/总量/有效期`
    : undefined;
  openForm(
    {
      eyebrow: "EDIT COUPON",
      title: `编辑优惠券 · ${c.name}`,
      submit: "保存修改",
      done: "优惠券已更新",
      fields: [
        {
          key: "kind",
          label: "券品种",
          type: "select",
          options: () => [
            c.kind === "platform"
              ? { value: "platform", label: "金额券（下单自动抵扣）" }
              : { value: "partner", label: "异业券（到店出示，暂不核销）" },
          ],
          disabled: () => true,
        },
        {
          key: "trigger",
          label: "发放方式",
          type: "select",
          options: () => [
            {
              value: c.trigger,
              label:
                (
                  {
                    manual: "手动领取（领券中心）",
                    lottery: "转盘抽奖发放",
                    signup: "新人注册自动发放",
                  } as Record<string, string>
                )[c.trigger] ?? c.trigger,
            },
          ],
          disabled: () => true,
        },
        { key: "name", label: "券名称", wide: true },
        {
          key: "amount",
          label: "面额（元）",
          type: "number",
          min: 0.01,
          step: 0.01,
          visible: () => c.kind === "platform",
          disabled: () => locked,
          hint: () => lockHint,
        },
        {
          key: "threshold",
          label: "使用门槛（元）",
          type: "number",
          min: 0,
          step: 0.01,
          visible: () => c.kind === "platform",
          disabled: () => locked,
        },
        { key: "remark", label: "优惠说明（选填）", wide: true },
        {
          key: "totalMode",
          label: "发放总量",
          type: "select",
          options: () => [
            { value: "limited", label: "限量" },
            { value: "unlimited", label: "不限量" },
          ],
          hint: () =>
            locked && c.total !== null
              ? `当前已发 ${c.claimed} 张，新总量不能小于已发数`
              : undefined,
        },
        {
          key: "total",
          label: "总量张数",
          type: "number",
          min: 1,
          visible: (d) => d.totalMode !== "unlimited",
        },
        {
          key: "expiryMode",
          label: "有效期",
          type: "select",
          options: () => [
            { value: "date", label: "固定日期" },
            { value: "forever", label: "长期有效" },
          ],
        },
        {
          key: "expiresAt",
          label: "有效期至",
          type: "date",
          visible: (d) => d.expiryMode !== "forever",
        },
        // 支付后推荐（道哥 2026-09-08）：支付成功页领券卡展示位
        {
          key: "featuredAfterPay",
          label: "支付后推荐（支付成功页展示，用户可一键领取）",
          type: "checkbox",
        },
      ],
      save: async (d) => {
        if (!String(d.name || "").trim()) throw new Error("请填写券名称");
        await api.updateCoupon(c.id, {
          featuredAfterPay: !!d.featuredAfterPay,
          name: String(d.name).trim(),
          remark: String(d.remark || "").trim(),
          ...(c.kind === "platform" && !locked
            ? {
                amount: yuanToFen(d.amount),
                threshold: yuanToFen(d.threshold),
              }
            : {}),
          ...(d.totalMode === "unlimited"
            ? { total: null }
            : Number(d.total) >= 1
              ? { total: Number(d.total) }
              : {}),
          ...(d.expiryMode === "forever"
            ? { expiresAt: null }
            : d.expiresAt
              ? { expiresAt: String(d.expiresAt) }
              : {}),
        });
      },
    },
    {
      kind: c.kind,
      trigger: c.trigger,
      name: c.name,
      amount: Number(fenToYuan(c.amount)),
      threshold: Number(fenToYuan(c.threshold)),
      remark: c.remark || "",
      featuredAfterPay: !!c.featuredAfterPay,
      totalMode: c.total === null ? "unlimited" : "limited",
      total: c.total ?? 100,
      expiryMode: c.expiresAt ? "date" : "forever",
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : "",
    },
  );
}
async function toggleCoupon() {
  if (!selected.value) return;
  const coupon = selected.value as Coupon;
  const next = coupon.status === "paused" ? "active" : "paused";
  try {
    await api.updateCouponStatus(coupon.id, next);
    notify(next === "paused" ? "优惠券已暂停发放" : "优惠券已重新启用");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
/* 定向发放抽屉 */
const issueOpen = ref(false),
  issueCouponRow = ref<Coupon>(),
  users = ref<AdminUser[]>([]),
  usersLoading = ref(false),
  usersError = ref(""),
  issueChecked = ref<Record<string, boolean>>({}),
  manualUserIds = ref(""),
  // IKD6FI：定向方式——用户多选之外新增「按手机号」「按寝室」（楼栋+楼层+寝室号）
  issueMode = ref<"users" | "phones" | "rooms">("users"),
  issuePhones = ref(""),
  issueBuildingId = ref(""),
  issueFloor = ref<number | "">(""),
  issueRoomNos = ref("");
async function openIssue(coupon: Coupon) {
  selected.value = undefined;
  issueCouponRow.value = coupon;
  issueOpen.value = true;
  usersError.value = "";
  issueChecked.value = {};
  manualUserIds.value = "";
  // IKD6FI：寝室定向的楼栋下拉
  issueMode.value = "users";
  issuePhones.value = "";
  issueBuildingId.value = "";
  issueFloor.value = "";
  issueRoomNos.value = "";
  void ensureBuildings().catch(() => {});
  usersLoading.value = true;
  try {
    users.value = await fetchAllPages(api.adminUsers);
  } catch {
    usersError.value =
      "用户列表接口暂不可用（等待后端提供），可在下方手工粘贴用户 ID";
  } finally {
    usersLoading.value = false;
  }
}
const selectedUserIds = computed(() => {
  const checked = Object.keys(issueChecked.value).filter(
    (id) => issueChecked.value[id],
  );
  const manual = manualUserIds.value
    .split(/[\s,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...checked, ...manual])];
});
function userLabel(u: AdminUser) {
  // IKAJSW 起列表手机号脱敏（phoneMasked），原 phone 字段已下线
  return u.nickname || u.id;
}
function userSub(u: AdminUser) {
  return u.phoneMasked || u.id;
}
/* IKDG8V：点击打码手机号按需查看明文——后端单查 + 审计留痕，本地缓存
 * 到刷新（Map ref），再点收回打码；无号用户列渲染层已不可点。 */
const revealedPhones = ref(new Map<string, string>());
let phoneRevealBusy = false;
async function togglePhone(row: AdminRow) {
  const u = row as unknown as AdminUser;
  if (phoneRevealBusy) return;
  if (revealedPhones.value.has(u.id)) {
    revealedPhones.value.delete(u.id);
    return;
  }
  phoneRevealBusy = true;
  try {
    const { phone } = await api.revealUserPhone(u.id);
    if (phone) revealedPhones.value.set(u.id, phone);
    else notify("该用户未绑定手机号");
  } finally {
    phoneRevealBusy = false;
  }
}
/* IKD6FI：手机号/寝室号均按换行、逗号（中英文）、分号切分 */
function issueTokenList(text: string): string[] {
  return text
    .split(/[\s,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
const issuePhoneList = computed(() => issueTokenList(issuePhones.value));
const issueRoomNoList = computed(() => issueTokenList(issueRoomNos.value));
/** 提交就绪（IKD6FI）：按当前定向方式校验必填项。 */
const issueReady = computed(() => {
  if (issueMode.value === "users") return selectedUserIds.value.length > 0;
  if (issueMode.value === "phones") return issuePhoneList.value.length > 0;
  return !!issueBuildingId.value;
});
async function confirmIssue() {
  if (!issueCouponRow.value) return;
  usersError.value = "";
  // IKD6FI：三种定向方式组装 body，后端与显式 userIds 并集去重
  const body: {
    userIds?: string[];
    phones?: string[];
    buildingId?: string;
    floor?: number;
    roomNos?: string[];
  } = {};
  if (issueMode.value === "users") {
    const ids = selectedUserIds.value;
    if (!ids.length) {
      usersError.value = "请先勾选或输入至少一名用户";
      return;
    }
    body.userIds = ids;
  } else if (issueMode.value === "phones") {
    if (!issuePhoneList.value.length) {
      usersError.value = "请输入至少一个手机号";
      return;
    }
    body.phones = issuePhoneList.value;
  } else {
    if (!issueBuildingId.value) {
      usersError.value = "请选择楼栋";
      return;
    }
    body.buildingId = issueBuildingId.value;
    // 楼层/寝室号选填，用于收窄范围
    if (issueFloor.value !== "") body.floor = Number(issueFloor.value);
    if (issueRoomNoList.value.length) body.roomNos = issueRoomNoList.value;
  }
  try {
    const res = await api.issueCoupon(issueCouponRow.value.id, body);
    notify(`已定向发放 ${res.issued} 张券`);
    issueOpen.value = false;
    await load();
  } catch (error) {
    usersError.value = error instanceof Error ? error.message : "发放失败";
  }
}

/* ---------- 调配与请假：邀请楼长跨楼代管 ---------- */
const staffCache = ref<Staff[]>([]),
  inviteConfirmCancel = ref("");
async function ensureManagers() {
  if (!staffCache.value.length)
    staffCache.value = (await fetchAllPages(api.staff)).filter(
      (s) => s.role === "building-manager" && s.status !== "deleted",
    );
  return staffCache.value;
}
function managerOptions() {
  const buildingId = String(formData.value.buildingId ?? "");
  // 后端校验：目标必须是在职楼长，且不是该楼的绑定楼长，前端同步过滤
  return staffCache.value
    .filter((s) => !buildingId || s.buildingId !== buildingId)
    .map((s) => ({
      value: s.id,
      label: `${s.name} · ${s.building ?? "未绑定楼栋"}${
        s.status === "online" ? "" : "（离线）"
      }`,
    }));
}
function toDatetimeLocal(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function openInviteForm(prefill?: {
  buildingId?: string | null;
  startAt?: string;
  endAt?: string;
}) {
  void ensureManagers();
  void ensureBuildings();
  openForm(
    {
      eyebrow: "DISPATCH INVITE",
      title: "邀请调配",
      submit: "发出邀请",
      done: "调配邀请已发出，等待楼长接受",
      fields: [
        {
          key: "buildingId",
          label: "目标楼栋（请假楼长负责的楼）",
          type: "select",
          wide: true,
          options: buildingOptions,
        },
        {
          key: "targetStaffId",
          label: "目标楼长（在职，非该楼绑定楼长）",
          type: "select",
          wide: true,
          options: managerOptions,
        },
        { key: "startAt", label: "开始时间", type: "datetime" },
        { key: "endAt", label: "结束时间", type: "datetime" },
        { key: "reward", label: "调配奖励（元，可选）", type: "number", min: 0, step: 0.01 },
      ],
      save: async (d) => {
        if (!d.buildingId) throw new Error("请选择目标楼栋");
        if (!d.targetStaffId) throw new Error("请选择目标楼长");
        if (!d.startAt || !d.endAt) throw new Error("请选择起止时间");
        if (new Date(String(d.endAt)) <= new Date(String(d.startAt)))
          throw new Error("结束时间必须晚于开始时间");
        await api.createDispatchInvitation({
          buildingId: String(d.buildingId),
          targetStaffId: String(d.targetStaffId),
          startAt: String(d.startAt),
          endAt: String(d.endAt),
          ...(d.reward !== "" && d.reward !== undefined
            ? { reward: yuanToFen(d.reward) }
            : {}),
        });
      },
    },
    {
      buildingId: prefill?.buildingId ?? "",
      targetStaffId: "",
      startAt: toDatetimeLocal(prefill?.startAt),
      endAt: toDatetimeLocal(prefill?.endAt),
      reward: "",
    },
  );
}
function inviteFromSelected() {
  if (!selected.value) return;
  const leave = selected.value as unknown as LeaveRow;
  selected.value = undefined;
  openInviteForm({
    buildingId: leave.buildingId,
    startAt: leave.startAt,
    endAt: leave.endAt,
  });
}
async function cancelInvite() {
  if (!selected.value) return;
  const invite = selected.value as unknown as DispatchRow;
  if (inviteConfirmCancel.value !== invite.id) {
    inviteConfirmCancel.value = invite.id;
    return;
  }
  try {
    await api.cancelDispatchInvitation(invite.id);
    notify("调配邀请已取消");
    selected.value = undefined;
    inviteConfirmCancel.value = "";
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "取消失败", true);
  }
}

/* ---------- 提成规则：新建 + 启停 ---------- */
/* ---------- 后台账号（IK9KWO）：超管维护运营/仓储/财务账号 ---------- */
const ACCOUNT_ROLE_OPTIONS = [
  { value: "operations", label: "运营" },
  { value: "warehouse", label: "仓储" },
  { value: "finance", label: "财务" },
  { value: "admin", label: "管理员" },
];
/** IKBFJ4 滞后修正：admin 平台超管同 hq 可建总部角色（后端 2790 行已同权）。 */
function accountRoleOptions() {
  return isPlatformAdmin.value
    ? [...ACCOUNT_ROLE_OPTIONS, { value: "hq", label: "总部长" }]
    : ACCOUNT_ROLE_OPTIONS;
}
/* IKB3KG 方案A：可运营校区多选（FormValue 扩 string[]，模板勾选驱动） */
function campusMultiValue(key: string): string[] {
  const value = formData.value[key];
  return Array.isArray(value) ? value : [];
}
function toggleCampusMulti(key: string, campusId: string) {
  const current = campusMultiValue(key);
  formData.value[key] = current.includes(campusId)
    ? current.filter((x) => x !== campusId)
    : [...current, campusId];
}
function openAccountCreate() {
  void ensureCampusOptions().catch(() => {});
  openForm(
    {
      eyebrow: "NEW ADMIN ACCOUNT",
      title: "新建后台账号",
      submit: "创建账号",
      done: "后台账号已创建",
      fields: [
        { key: "username", label: "账号", placeholder: "3-20 位字母/数字/下划线" },
        { key: "password", label: "初始密码", type: "password", placeholder: "至少 8 位" },
        { key: "nickname", label: "昵称", placeholder: "如：仓储小王" },
        { key: "role", label: "角色", type: "select", options: accountRoleOptions },
        // IKBFJ4：平台账号（hq/admin）建号选归属（空 = 总部账号，角色须总部长）
        {
          key: "campusId",
          label: "所属校区",
          type: "select",
          visible: () => isPlatformAdmin.value,
          options: () => [
            { value: "", label: "总部（仅总部长角色）" },
            ...campusOptionsData.value.map((c) => ({
              value: c.id,
              label: c.shortName || c.name,
            })),
          ],
        },
        // IKB3KG 方案A：hq 授权多校区（登录后顶栏可切换）；所属校区始终在授权内
        {
          key: "campusIds",
          label: "可运营校区",
          type: "campus-multi",
          wide: true,
          visible: (d) =>
            isPlatformAdmin.value && String(d.role || "") !== "hq",
        },
      ],
      save: async (d) =>
        void (await api.createAccount({
          username: String(d.username || "").trim(),
          password: String(d.password || ""),
          nickname: String(d.nickname || "").trim(),
          role: String(d.role || ""),
          ...(isPlatformAdmin.value
            ? { campusId: String(d.campusId ?? "") }
            : {}),
          ...(isPlatformAdmin.value && String(d.role || "") !== "hq"
            ? { campusIds: campusMultiValue("campusIds") }
            : {}),
        })),
    },
    {
      username: "",
      password: "",
      nickname: "",
      role: "operations",
      campusId: "",
      campusIds: [] as string[],
    },
  );
}
function openAccountEdit(row: AdminRow) {
  const account = row as AccountRow;
  selected.value = undefined;
  void ensureCampusOptions().catch(() => {});
  openForm(
    {
      eyebrow: "EDIT ADMIN ACCOUNT",
      title: `编辑账号 ${account.username}`,
      submit: "保存修改",
      done: "账号已更新",
      fields: [
        { key: "nickname", label: "昵称" },
        { key: "role", label: "角色", type: "select", options: accountRoleOptions },
        // IKB3KG 方案A：hq 重设可运营校区（整体替换授权；至少保留一个）
        {
          key: "campusIds",
          label: "可运营校区",
          type: "campus-multi",
          wide: true,
          visible: () =>
            isPlatformAdmin.value &&
            account.role !== "hq" &&
            !!account.campusId,
        },
      ],
      save: async (d) =>
        void (await api.updateAccount(account.id, {
          nickname: String(d.nickname || "").trim(),
          role: String(d.role || ""),
          ...(isPlatformAdmin.value &&
          account.role !== "hq" &&
          account.campusId
            ? { campusIds: campusMultiValue("campusIds") }
            : {}),
        })),
    },
    {
      nickname: account.nickname,
      role: account.role,
      campusIds: (account.campusIds ?? []).slice(),
    },
  );
}
function openAccountResetPassword(row: AdminRow) {
  const account = row as AccountRow;
  selected.value = undefined;
  openForm(
    {
      eyebrow: "RESET PASSWORD",
      title: `重置密码 ${account.username}`,
      submit: "重置密码",
      done: "密码已重置",
      fields: [
        { key: "password", label: "新密码", type: "password", placeholder: "至少 8 位" },
      ],
      save: async (d) =>
        void (await api.updateAccount(account.id, {
          password: String(d.password || ""),
        })),
    },
    { password: "" },
  );
}
async function removeAccount() {
  if (!selected.value) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.deleteAccount(selected.value.id);
    notify("后台账号已删除");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
function openRuleCreate() {
  void ensureBuildings();
  openForm(
    {
      eyebrow: "NEW RULE",
      title: "新建提成规则",
      submit: "保存规则",
      done: "提成规则已创建",
      fields: [
        {
          key: "buildingId",
          label: "楼栋",
          type: "select",
          optional: true,
          optionalLabel: "通配（全部楼栋）",
          options: buildingOptions,
        },
        { key: "floor", label: "楼层（空=通配）", type: "number", min: 1, placeholder: "留空表示全部楼层" },
        { key: "weightFrom", label: "重量下限 kg（空=不限）", type: "number", min: 0, step: 0.01 },
        { key: "weightTo", label: "重量上限 kg（空=不限）", type: "number", min: 0, step: 0.01 },
        {
          key: "mode",
          label: "配送模式",
          type: "select",
          optional: true,
          optionalLabel: "通配（全部模式）",
          options: () => [
            { value: "instant", label: "即时达" },
            { value: "scheduled", label: "预约达" },
          ],
        },
        { key: "price", label: "提成单价（元/单）", type: "number", min: 0.01, step: 0.01 },
      ],
      save: async (d) => {
        // 单价表单输元，校验后转分提交
        const price = Number(d.price);
        if (!Number.isFinite(price) || price <= 0)
          throw new Error("提成单价必须大于 0");
        if (d.weightFrom !== "" && d.weightTo !== "" && d.weightFrom !== undefined && d.weightTo !== undefined) {
          if (Number(d.weightTo) < Number(d.weightFrom))
            throw new Error("重量上限不能小于下限");
        }
        await api.createCommissionRule({
          price: yuanToFen(price),
          ...(d.buildingId ? { buildingId: String(d.buildingId) } : {}),
          ...(d.floor !== "" && d.floor !== undefined ? { floor: Number(d.floor) } : {}),
          ...(d.weightFrom !== "" && d.weightFrom !== undefined ? { weightFrom: Number(d.weightFrom) } : {}),
          ...(d.weightTo !== "" && d.weightTo !== undefined ? { weightTo: Number(d.weightTo) } : {}),
          ...(d.mode ? { mode: String(d.mode) as "instant" | "scheduled" } : {}),
        });
      },
    },
    { buildingId: "", floor: "", weightFrom: "", weightTo: "", mode: "", price: 3 },
  );
}
async function toggleRule() {
  if (!selected.value) return;
  const rule = selected.value as unknown as RuleRow;
  const next = rule.status === "active" ? "disabled" : "active";
  try {
    await api.updateCommissionRule(rule.id, { status: next });
    notify(next === "active" ? "规则已启用（版本自增，在途提成不追溯）" : "规则已停用");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}

/* ---------- 库存：出入库操作 + 流水 ---------- */
const productsCache = ref<Product[]>([]);
async function ensureProducts() {
  // IKFOPY：选品上下文跟随库存板块选中的校区（hq 聚焦总部仓时即总部仓商品）；
  // 校区角色 campusScope 恒本校区，行为不变。按校区分别缓存，切换不串列
  const campus = campusScope() ?? "";
  if (!productsCache.value.length || productsCacheCampus.value !== campus) {
    // IKCHEW 追修：促销选品/库存入库/盘点都是校区上下文操作，固定本校区口径——
    // admin 裸调 /admin/products 现默认官方库，选品错位会导致后端按本校区校验必败
    productsCache.value = await fetchAllPages((query) =>
      api.products({ ...query, campusId: campus || undefined }, "campus"),
    );
    productsCacheCampus.value = campus;
  }
  return productsCache.value;
}
/** 选品缓存所属校区（IKFOPY）：切换校区筛选后强制重拉 */
const productsCacheCampus = ref("");
/** 促销选品专用（IKCJVS 续）：仅本校区在售商品——已下架不可建促销，
 *  与后端 createPromotion 的 status 校验同口径。库存入库/盘点仍用全量 ensureProducts。 */
const onSaleProductsCache = ref<Product[]>([]);
async function ensureOnSaleProducts() {
  if (!onSaleProductsCache.value.length)
    onSaleProductsCache.value = await fetchAllPages(
      (query) => api.products({ ...query, status: "on-sale" }, "campus"),
    );
  return onSaleProductsCache.value;
}
function productOptions() {
  return productsCache.value.map((p) => ({
    value: p.id,
    label: `${p.name}（可售 ${p.availableStock ?? p.stock ?? 0}）`,
  }));
}
/** 商品选择器（IKGQ6Q 组件化）：筛选/骨架逻辑全部内聚进 ProductPickerField
 *  组件，页面只管候选集加载与 loading 传递。 */
const ppLoading = ref(false);
/** 库存操作（IKD6FJ）：stock-in=采购入库（校区角色分流为采购申请）、
 *  stocktake=盘点（提交实际清点数量，替代原 delta 增量口径）。 */
function openStockForm(kind: "stock-in" | "stocktake", productId?: string) {
  // IKFOQ1 采购申请退役（grilling #1）：补货统一走 订货批次→采购单→验收，
  // 「采购入库」恢复全角色直入；采购单在独立「采购管理」菜单
  ppLoading.value = true;
  void ensureProducts().finally(() => {
    ppLoading.value = false;
  });
  const isStockIn = kind === "stock-in";
  openForm(
    {
      eyebrow: isStockIn ? "STOCK IN" : "STOCKTAKE",
      title: isStockIn ? "采购入库" : "盘点",
      submit: isStockIn ? "确认入库" : "提交盘点",
      done: isStockIn ? "入库成功，库存已更新" : "盘点已生效",
      fields: [
        { key: "productId", label: "商品", type: "product-picker", wide: true },
        {
          key: isStockIn ? "quantity" : "countedQty",
          label: isStockIn ? "入库数量" : "实际清点数量",
          type: "number",
          step: 1,
          min: isStockIn ? undefined : 0,
          placeholder: isStockIn
            ? "本次采购入库数量"
            : "仓库实盘数，系统自动与账面比对",
        },
        {
          key: "reason",
          label: "原因备注",
          placeholder: isStockIn ? "例如：8 月第二周采购" : "例如：月底盘点",
          wide: true,
        },
      ],
      save: async (d) => {
        if (!d.productId) throw new Error("请选择商品");
        const reason = String(d.reason || "").trim();
        if (isStockIn && !reason) throw new Error("请填写原因备注");
        const qty = Number(isStockIn ? d.quantity : d.countedQty);
        if (!Number.isFinite(qty) || (isStockIn ? qty <= 0 : qty < 0))
          throw new Error(
            isStockIn ? "入库数量必须大于 0" : "清点数量不能为负数",
          );
        if (isStockIn)
          await api.stockIn(
            { productId: String(d.productId), quantity: qty, reason },
            campusScope(),
          );
        else {
          const res = await api.stocktake(
            {
              productId: String(d.productId),
              countedQty: qty,
              ...(reason ? { reason } : {}),
            },
            campusScope(),
          );
          // 完成文案带回「账面→实际（差额）」结果（submitForm 持 meta 引用读 done）
          if (formMeta.value)
            formMeta.value.done = `账面 ${res.before} → 实际 ${
              res.countedQty
            }（差 ${res.delta > 0 ? "+" : ""}${res.delta}）${
              res.applied ? "" : "，账实相符未落流水"
            }`;
        }
      },
    },
    // IKD6FG：行内入口预填本行商品；顶部按钮走空初始值
    isStockIn
      ? { productId: productId ?? "", quantity: 1, reason: "" }
      : { productId: productId ?? "", countedQty: 0, reason: "" },
  );
}
/** 流水类型中文（IKA0UQ 出库类型随流水页新增）。 */
const TXN_TYPE_TEXT: Record<string, string> = {
  "stock-in": "采购入库",
  adjust: "盘点调整",
  out: "订单出库",
};
function toTxnRow(t: InventoryTxn): AdminRow {
  return { ...t, typeText: TXN_TYPE_TEXT[t.type] ?? t.type };
}
function resetStatusFilterAndLoad() {
  if (statusFilter.value === "all") resetAndLoad();
  else statusFilter.value = "all";
}
/* 财务结算：账期筛选（month=YYYY-MM，后端 B2 契约）。 */
const monthOptions = computed(() => {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
});
const month = ref(monthOptions.value[0]);
watch(month, () => {
  if (section.value === "finance") resetAndLoad();
});
/** IKDFIN：当月金额汇总（分）——列表加载时随当月全量账单算出，摘要行展示。 */
const financeTotals = ref({ payable: 0, paid: 0 });
/** 各板块表格统一返回：当前页行 + 服务端总数。 */
interface PageRows {
  rows: AdminRow[];
  total: number;
}
/** 分页响应拆包（items → rows + total）。 */
function unwrap<T extends AdminRow>(res: PagedResponse<T>): PageRows {
  return { rows: res.items, total: res.total };
}
/** 状态 Tab 组（IKAJSP）：把若干原始状态聚合为一个运营阶段（如「配送中」），statuses 空 = 全部。 */
interface StatusTab {
  key: string;
  label: string;
  statuses: string[];
}
interface SectionConfig {
  title: string;
  eyebrow: string;
  desc: string;
  loader: (query: ListQuery) => Promise<PageRows>;
  columns: [string, string][];
  /** 详情抽屉字段卡顺序（IKFSZJ：三列网格按运营优先级重排）；缺省沿用 columns，列表列序不受影响。 */
  detailOrder?: string[];
  /** 配置后工具栏下拉换成 Tab 行，过滤走服务端（逗号状态，页内不再二次筛）。 */
  statusTabs?: StatusTab[];
  /** Tab 角标计数来源（原始状态→数量，随 load() 刷新）。 */
  countsLoader?: () => Promise<Record<string, number>>;
}
/* ---------- 仓储板块拆分（IKA0V2）：流水/仓库订单独立菜单入口 ---------- */
const inventoryTxnsConfig: SectionConfig = {
  title: "出入库流水",
  eyebrow: "INVENTORY LEDGER",
  desc: "采购入库、盘点调整与订单出库的全部流水记录。",
  loader: (query) =>
    // IKFOPY：hq 视角按校区筛选聚焦（含总部仓）
    api
      .inventoryTxns(undefined, { ...query, campusId: campusScope() })
      .then((res) => ({
      rows: res.items.map(toTxnRow),
      total: res.total,
    })),
  columns: [
    ["createdAt", "时间"],
    ["typeText", "类型"],
    ["product", "商品"],
    ["quantity", "数量"],
    ["reason", "原因"],
    ["operatorName", "操作人"],
  ],
};
/* ---------- 营销地图（IKD6FI）：非表格视图，loader 置空防误拉列表 ---------- */
const marketingMapConfig: SectionConfig = {
  title: "营销地图",
  eyebrow: "MARKETING MAP",
  desc: "按楼栋×楼层×寝室透视近 N 天下单分布，定向发券选点参考。",
  loader: async () => ({ rows: [], total: 0 }),
  columns: [],
};
/**
 * 仓库订单（IKA0UQ，IK9U3Z 出库动作延续）：待出库订单（paid+picking 历史单）
 * 按库位指引拣货复核，确认出库后一步转「待配送」，库存不二次扣（支付已扣）。
 */
/** IKB5P5：拣货任务状态 Tab（待出库=paid 主链路，拣货中=picking 历史单）。 */
const PICKING_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: ["paid", "picking"] },
  { key: "paid", label: "待出库", statuses: ["paid"] },
  { key: "picking", label: "拣货中", statuses: ["picking"] },
];
const warehouseOrdersConfig: SectionConfig = {
  title: "拣货任务",
  eyebrow: "WAREHOUSE OUTBOUND",
  desc: "待出库订单按库位拣货复核，确认出库后转待配送，配送员即可接单。",
  loader: (query) => {
    // IKB5P5：Tab 即过滤条件（全部= paid+picking 合并逗号状态，服务端分页）
    const tab =
      PICKING_STATUS_TABS.find((t) => t.key === statusFilter.value) ??
      PICKING_STATUS_TABS[0];
    return api.orders(tab.statuses.join(","), query).then((res) => ({
      rows: res.items.map((o) => {
        const names = (o.items ?? [])
          .map((line) => line.product?.name ?? "")
          .filter(Boolean);
        // IKB5P5：库位列——各商品实时库位（后端按 productId 回查），去重列出；
        // 任一商品缺库位该商品不计，全部未配置显示「未配置」
        const locations = [
          ...new Set(
            (o.items ?? [])
              .map((line) =>
                [line.product?.location, line.product?.locationCode]
                  .filter(Boolean)
                  .join("-"),
              )
              .filter(Boolean),
          ),
        ];
        return {
          ...o,
          // IKBW0D：商品逐行，与订单列表口径一致
          itemsText: names.length ? names.join("\n") : "—",
          locationText: locations.length
            ? locations.slice(0, 2).join("、") +
              (locations.length > 2 ? " 等" : "")
            : "未配置",
        };
      }),
      total: res.total,
    }));
  },
  statusTabs: PICKING_STATUS_TABS,
  countsLoader: () => api.orderStatusCounts(campusScope()),
  columns: [
    ["orderNo", "订单编号"],
    ["itemsText", "商品"],
    ["locationText", "库位"],
    ["totalQuantity", "件数"],
    ["statusText", "状态"],
    ["payableAmount", "实付金额"],
    ["createdAt", "下单时间"],
  ],
  // IKFSZJ：详情三列——行1 编号/状态/件数，行2 库位/实付/时间；商品通栏
  detailOrder: [
    "orderNo",
    "statusText",
    "totalQuantity",
    "locationText",
    "payableAmount",
    "createdAt",
  ],
};

/* ---------- 调配与请假（IK8W5Y）：请假楼长 + 调配邀请 ---------- */
function toLeaveRow(l: LeaveRequest): LeaveRow {
  return {
    id: l.id,
    staffName: l.staff?.name ?? "—",
    staffNo: l.staff?.staffNo ?? "—",
    building: l.staff?.building ?? "—",
    buildingId: l.staff?.buildingId ?? null,
    startAt: l.startAt,
    endAt: l.endAt,
    reason: l.reason,
    // IK9U4B：调配方式供后台审核核对（self=自己联系代班，platform=平台派单）
    dispatchModeText:
      l.dispatchMode === "self" ? "自己联系代班" : "平台自动派单",
    // IKA57Y：自己调配时指定的代班楼长（姓名快照）
    substituteText: l.substituteName ?? "—",
    status: l.status,
    statusText: l.statusText,
  };
}
function toInviteRow(i: DispatchInvitation): DispatchRow {
  return {
    id: i.id,
    staffName: i.staff?.name ?? "—",
    roleText: i.staff?.roleText ?? "楼长",
    building: i.building ?? "—",
    startAt: i.startAt,
    endAt: i.endAt,
    reward: i.reward,
    status: i.status,
    statusText: i.statusText,
  };
}
const dispTab = ref<"leaves" | "invites">("leaves");
function switchDispTab(tab: "leaves" | "invites") {
  dispTab.value = tab;
  resetStatusFilterAndLoad();
}
/* ---------- Banner 管理（IK9RX2）：营销板块第二个 tab，校园维度 ---------- */
/* IKD6FI：营销板块新增「营销地图」tab（楼栋×楼层×寝室下单热力） */
/* IKDFIN：深链初值在声明处读取（原 immediate watcher 在 section 声明前
   执行回调，dev 模式 TDZ 崩掉所有板块首屏；深链响应改由下方非 immediate watch 承担） */
const MKT_TABS = ["coupons", "promotions", "map"] as const;
const mktTab = ref<"coupons" | "banners" | "promotions" | "map">(
  (MKT_TABS as readonly string[]).includes(String(route.query.tab))
    ? (String(route.query.tab) as "coupons" | "promotions" | "map")
    : "coupons",
);
function switchMktTab(tab: "coupons" | "banners" | "promotions" | "map") {
  mktTab.value = tab;
  // 地图视图不走表格 loader：切进来即备好楼栋下拉并拉聚合数据
  if (tab === "map") {
    void ensureBuildings().catch(() => {});
    void loadMarketingMap();
  }
  resetStatusFilterAndLoad();
}
/* ---------- 营销地图（IKD6FI）：楼栋×楼层×寝室下单热力 ---------- */
const mapBuildingId = ref(""),
  mapDays = ref(30),
  mapData = ref<MarketingMapData | null>(null),
  mapLoading = ref(false),
  mapError = ref("");
const isMktMapTab = computed(
  () => section.value === "marketing" && mktTab.value === "map",
);
async function loadMarketingMap() {
  if (!mapBuildingId.value) {
    mapData.value = null;
    mapError.value = "";
    return;
  }
  mapLoading.value = true;
  mapError.value = "";
  try {
    // hq 跨校区视角带 campus（campusScope 读顶栏校区筛选，校区角色 undefined）
    mapData.value = await api.marketingMap(
      mapBuildingId.value,
      mapDays.value,
      campusScope(),
    );
  } catch (error) {
    mapData.value = null;
    mapError.value = error instanceof Error ? error.message : "地图加载失败";
  } finally {
    mapLoading.value = false;
  }
}
watch(mapBuildingId, () => void loadMarketingMap());
watch(mapDays, () => void loadMarketingMap());
/** 格子热力分档（IKD6FI）：0=灰、1-2/3-5/6+ 绿色递进（纯 class 分档即可）。 */
function mapCellClass(orders: number): string {
  if (!orders) return "lv0";
  if (orders <= 2) return "lv1";
  if (orders <= 5) return "lv2";
  return "lv3";
}
/* ---------- 商品板块双视角（IKCHEW → IKCJ46 独立菜单化）----------
   官方商品库拆为独立菜单 /official-products，/products 恒为本校区商品：
   hq 恒官方库；admin 按路由分流（官方商品库菜单=official，商品管理=campus）；
   校区角色恒本校区。视角不再本地切换（道哥 2026-09-01 拍板防混淆）。 */
const isOfficialProducts = computed(
  () => section.value === "official-products",
);
/** 商品域统一判定（IKCJ46）：商品管理 + 官方商品库两个菜单共用品类逻辑 */
const isProductsSection = computed(
  () =>
    section.value === "products" || section.value === "official-products",
);
const productView = computed<"official" | "campus">(() => {
  if (role.value === "hq") return "official";
  if (role.value === "admin") return isOfficialProducts.value ? "official" : "campus";
  return "campus";
});
// IKAJSS 深链：/marketing?tab=promotions 直达指定 tab（工作台动态流跳转用）
// IKDFIN：去 immediate——初值已在 mktTab 声明处读取；immediate 会在 setup 期
// （section 尚未声明）触发回调，dev 模式直接 TDZ 崩掉整页
watch(
  () => route.query.tab,
  (tab) => {
    if (
      section.value === "marketing" &&
      (MKT_TABS as readonly string[]).includes(String(tab))
    )
      mktTab.value = String(tab) as "coupons" | "promotions" | "map";
  },
);
/** Banner 主题色展示：预置键转中文，自定义 hex 原样。 */
const BANNER_COLOR_TEXT: Record<string, string> = {
  green: "绿色",
  orange: "橙色",
  dark: "深色",
};
/** Banner 展示位置（IKA57F）：支付成功页广告位复用 Banner 基建。 */
const BANNER_PLACEMENT_TEXT: Record<string, string> = {
  home: "首页轮播",
  "pay-success": "支付成功页",
};
function bannerPayload(d: Record<string, FormValue>) {
  return {
    // IKBW0A：投放范围字段已废止——归属校区由后端按操作者本校区落库。
    // IKC1AD：标题/副标题/角标为内部字段（用户端不渲染），title 缺省给辨识名
    title: String(d.title || "").trim() || "未命名 Banner",
    subtitle: String(d.subtitle || "").trim(),
    badge: String(d.badge || "").trim(),
    color: String(d.color || "green").trim(),
    ...(d.image ? { image: String(d.image) } : {}),
    // IKC1AD：详情长图为主口径（空串语义清空 = Banner 回到不可点）；
    // 旧逐行文字 content 不再从表单进出（编辑保存即归零，统一新口径）
    detailImage: String(d.detailImage ?? "").trim(),
    content: "",
    placement: String(d.placement || "home"),
    // IKE9YC：自定义路径优先于常用页下拉；none 统一提交空串（编辑保存即清空）
    ...(String(d.linkType) === "page"
      ? {
          linkType: "page",
          linkUrl:
            String(d.linkUrl ?? "").trim() || String(d.linkPage ?? "").trim(),
        }
      : { linkType: "none", linkUrl: "" }),
    sort: Number(d.sort ?? 0),
  };
}
/** Banner 详情长图字段（IKC1AD）：替代原逐行文字 textarea，上传一张长图。 */
const BANNER_DETAIL_IMAGE_FIELD: FieldDef = {
  key: "detailImage",
  label: "详情长图（用户端点击 Banner 进入，选填；留空 = 不可点击）",
  type: "image",
  wide: true,
  folder: "app/banner-detail",
};
/** Banner 背景图（IK9VBI）：落 COS app/ 目录（小程序素材），商品图/类别图仍走 uploads/。 */
const BANNER_IMAGE_FIELD: FieldDef = {
  key: "image",
  label: "背景图（选填，存 app/ 目录供小程序直连）",
  type: "image",
  wide: true,
  folder: "app",
};
/** 展示位置（IKA57F）：首页轮播 / 支付成功页广告位。 */
const BANNER_PLACEMENT_FIELD: FieldDef = {
  key: "placement",
  label: "展示位置",
  type: "select",
  options: () => [
    { value: "home", label: "首页轮播" },
    { value: "pay-success", label: "支付成功页" },
  ],
};
/** IKE9YC 站内跳转常用页（运营零门槛；tab 页 C 端自动 switchTab）。 */
const BANNER_LINK_PAGES = [
  { value: "pages/coupons/index", label: "优惠券中心（领券）" },
  { value: "pages/orders/index", label: "我的订单" },
  { value: "pages/address/index", label: "寝室地址" },
  { value: "pages/category/index", label: "全部商品（分类）" },
  { value: "pages/cart/index", label: "购物车" },
  { value: "pages/profile/index", label: "我的" },
  { value: "pages/campus/index", label: "楼栋选择" },
];
/** IKE9YC 点击跳转：配置后 C 端点击优先跳转，不再走图文详情。 */
const BANNER_LINK_TYPE_FIELD: FieldDef = {
  key: "linkType",
  label: "点击跳转",
  type: "select",
  options: () => [
    { value: "none", label: "不跳转（默认，点击走图文详情）" },
    { value: "page", label: "跳转站内页面" },
  ],
};
const BANNER_LINK_PAGE_FIELD: FieldDef = {
  key: "linkPage",
  label: "常用页面",
  type: "select",
  options: () => BANNER_LINK_PAGES,
  visible: (d) => d.linkType === "page",
};
const BANNER_LINK_URL_FIELD: FieldDef = {
  key: "linkUrl",
  label: "自定义路径（选填，填了优先于常用页面）",
  placeholder: "支持带参，如 pages/product/detail?id=xxx",
  visible: (d) => d.linkType === "page",
};
/** IKB5PB：placement 默认值——支付广告位菜单新建默认 pay-success，其余默认 home。
 *  IKBW0A：投放范围选择已从表单移除，归属校区由后端按操作者本校区落库。 */
function openBannerCreate(defaultPlacement = "home") {
  openForm(
    {
      eyebrow: "NEW BANNER",
      title: "新建 Banner",
      submit: "保存并启用",
      done: "Banner 已创建",
      fields: [
        {
          key: "title",
          label: "标题（内部字段，用户端不显示）",
          placeholder: "供运营辨识，例如：今日爆款",
        },
        {
          key: "subtitle",
          label: "副标题（内部字段，用户端不显示）",
          placeholder: "选填",
        },
        {
          key: "badge",
          label: "角标（内部字段，用户端不显示）",
          placeholder: "选填",
        },
        {
          key: "color",
          label: "主题色",
          type: "select",
          options: () => [
            { value: "green", label: "绿色" },
            { value: "orange", label: "橙色" },
            { value: "dark", label: "深色" },
          ],
        },
        BANNER_PLACEMENT_FIELD,
        { key: "sort", label: "排序（越小越靠前）", type: "number" },
        BANNER_IMAGE_FIELD,
        BANNER_DETAIL_IMAGE_FIELD,
        BANNER_LINK_TYPE_FIELD,
        BANNER_LINK_PAGE_FIELD,
        BANNER_LINK_URL_FIELD,
      ],
      save: async (d) => {
        void (await api.createBanner(bannerPayload(d)));
      },
    },
    { title: "", subtitle: "", badge: "", color: "green", placement: defaultPlacement, sort: 0, image: "", detailImage: "", linkType: "none", linkPage: "", linkUrl: "" },
  );
}
function openBannerEdit(row: AdminRow) {
  selected.value = undefined;
  const record = row as unknown as Banner;
  openForm(
    {
      eyebrow: "EDIT BANNER",
      title: "编辑 Banner",
      submit: "保存修改",
      done: "Banner 已更新",
      fields: [
        { key: "title", label: "标题（内部字段，用户端不显示）" },
        { key: "subtitle", label: "副标题（内部字段，用户端不显示）" },
        { key: "badge", label: "角标（内部字段，用户端不显示）" },
        {
          key: "color",
          label: "主题色",
          type: "select",
          options: () => [
            { value: "green", label: "绿色" },
            { value: "orange", label: "橙色" },
            { value: "dark", label: "深色" },
          ],
        },
        BANNER_PLACEMENT_FIELD,
        { key: "sort", label: "排序（越小越靠前）", type: "number" },
        BANNER_IMAGE_FIELD,
        BANNER_DETAIL_IMAGE_FIELD,
        BANNER_LINK_TYPE_FIELD,
        BANNER_LINK_PAGE_FIELD,
        BANNER_LINK_URL_FIELD,
        {
          key: "status",
          label: "状态",
          type: "select",
          options: () => [
            { value: "active", label: "启用" },
            { value: "hidden", label: "隐藏" },
          ],
        },
      ],
      save: async (d) => {
        void (await api.updateBanner(record.id, {
          ...bannerPayload(d),
          status: String(d.status || "active"),
        }));
      },
    },
    {
      title: record.title,
      subtitle: record.subtitle,
      badge: record.badge,
      color: record.color,
      placement: record.placement ?? "home",
      sort: Number(record.sort ?? 0),
      image: record.image ?? "",
      detailImage: record.detailImage ?? "",
      // IKE9YC：linkUrl 恰为常用页之一 → 下拉预选；否则进自定义框
      linkType: record.linkType ?? "none",
      linkPage: BANNER_LINK_PAGES.some((p) => p.value === record.linkUrl)
        ? (record.linkUrl as string)
        : "",
      linkUrl: BANNER_LINK_PAGES.some((p) => p.value === record.linkUrl)
        ? ""
        : (record.linkUrl ?? ""),
      status: record.status,
    },
  );
}
async function removeBannerRow() {
  if (!selected.value) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.deleteBanner(selected.value.id);
    notify("Banner 已删除");
    selected.value = undefined;
    await load();
  } catch (error) {
    confirmDelete.value = false;
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
/* ---------- 楼长招募操作（IKEAGE）：补录 / 面试 / 审批 ---------- */
/** 抽屉补录编辑区（openDetail 回填；保存走 PATCH） */
const recruitEdit = ref({
  idCardNo: "",
  idCardImages: [] as string[],
  staffRemark: "",
});
/** 审批两击确认（同 confirmDelete 惯例：第一击亮确认文案，第二击执行） */
const recruitApproveArmed = ref(false);
/** 抽屉当前招募报名（模板免 (selected as unknown as …) 长 cast 链） */
const recruitApp = computed(
  () => selected.value as unknown as RecruitingApplication | undefined,
);
/** 审核资料可编辑：有写权限且未到终态（approved/rejected 只读展示已录内容） */
const recruitDocsEditable = computed(
  () =>
    canWriteSection.value &&
    ["pending", "interviewing"].includes(recruitApp.value?.status ?? ""),
);
/** 已落库的身份证照片（终态只读展示用，过滤空串占位） */
const recruitSavedImages = computed(() =>
  (recruitApp.value?.idCardImages ?? []).filter(Boolean),
);
function recruitRow(): RecruitingApplication | undefined {
  return selected.value as unknown as RecruitingApplication | undefined;
}
/** 身份证等资料补录（运营线下收集后台代录，C 端不采集） */
async function saveRecruitDocs() {
  const app = recruitRow();
  if (!app) return;
  try {
    const updated = await api.updateRecruitApplication(app.id, {
      idCardNo: recruitEdit.value.idCardNo.trim(),
      idCardImages: recruitEdit.value.idCardImages,
      staffRemark: recruitEdit.value.staffRemark.trim(),
    });
    selected.value = updated as unknown as AdminRow;
    notify("资料已保存");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  }
}
/** pending → interviewing：运营已联系、进入面试 */
async function recruitDoTransition() {
  const app = recruitRow();
  if (!app) return;
  try {
    const updated = await api.recruitTransition(app.id);
    selected.value = updated as unknown as AdminRow;
    notify("已标记面试中");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
/** 一键审批通过：自动创建实习楼长（工号 IBM-xxx），两击确认防误触 */
async function recruitDoApprove() {
  const app = recruitRow();
  if (!app) return;
  if (!recruitApproveArmed.value) {
    recruitApproveArmed.value = true;
    return;
  }
  try {
    const result = await api.approveRecruit(app.id);
    selected.value = result.application as unknown as AdminRow;
    recruitApproveArmed.value = false;
    notify(`已创建实习楼长：${result.staff.staffNo}（骑手小程序工号+姓名登录）`);
    await load();
  } catch (error) {
    recruitApproveArmed.value = false;
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
/** 拒绝报名：原因必填（C 端进度页展示，候选人可重新报名） */
function openRecruitRejectForm() {
  const app = recruitRow();
  if (!app) return;
  openForm(
    {
      eyebrow: "REJECT",
      title: "拒绝报名",
      submit: "确认拒绝",
      done: "已拒绝，候选人可重新报名",
      fields: [
        {
          key: "reason",
          label: "拒绝原因（候选人可见）",
          placeholder: "例如：该楼栋暂无空缺，感谢关注",
        },
      ],
      save: async (d) => {
        const reason = String(d.reason ?? "").trim();
        if (!reason) throw new Error("请填写拒绝原因");
        const updated = await api.rejectRecruit(app.id, reason);
        selected.value = updated as unknown as AdminRow;
        await load();
      },
    },
    { reason: "" },
  );
}
/* ---------- 促销活动管理（ADR-0006 / IKAHFF）：营销板块第三个 tab ---------- */
const PROMO_TYPE_TEXT: Record<string, string> = {
  seckill: "秒杀",
  clearance: "临期特惠",
};
/** 活动状态：停用/未开始/进行中/已结束（窗口读时判定，无 cron）。 */
function promoState(p: Promotion): string {
  if (p.status === "disabled") return "已停用";
  const now = Date.now();
  if (new Date(p.startsAt).getTime() > now) return "未开始";
  if (new Date(p.endsAt).getTime() <= now) return "已结束";
  return "进行中";
}
function promoWindowText(p: Promotion): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("zh-CN", { hour12: false });
  return `${fmt(p.startsAt)} ~ ${fmt(p.endsAt)}`;
}
/** 新建促销：选商品/类型/促销价/起止窗口；重叠与价格底线由后端把关。 */
function openPromotionCreate() {
  // IKGNQ：仅本校区在售商品作候选，加载态同款
  ppLoading.value = true;
  void ensureOnSaleProducts().finally(() => {
    ppLoading.value = false;
  });
  openForm(
    {
      eyebrow: "NEW PROMOTION",
      title: "新建促销活动",
      submit: "保存活动",
      done: "促销活动已创建",
      fields: [
        {
          key: "productId",
          label: "商品（在售）",
          type: "product-picker",
          wide: true,
          ppItems: () => onSaleProductsCache.value,
          // IKH15V：定促销价时对照进货价（毛利）——口径定版=批发价格（道哥 2026-09-19）
          ppShowCost: true,
        },
        {
          key: "type",
          label: "类型",
          type: "select",
          options: () => [
            { value: "seckill", label: "限时秒杀" },
            { value: "clearance", label: "临期特惠（详情页会注明临近保质期）" },
          ],
        },
        { key: "price", label: "促销价（元，须低于现价）", type: "number", min: 0.01, step: 0.01 },
        { key: "startsAt", label: "开始时间", type: "datetime" },
        { key: "endsAt", label: "结束时间", type: "datetime" },
      ],
      save: async (d) => {
        if (!d.productId) throw new Error("请选择商品");
        if (!d.price && d.price !== 0) throw new Error("请填写促销价");
        if (!d.startsAt || !d.endsAt) throw new Error("请选择起止时间");
        if (new Date(String(d.endsAt)) <= new Date(String(d.startsAt)))
          throw new Error("结束时间必须晚于开始时间");
        if (new Date(String(d.endsAt)).getTime() <= Date.now())
          throw new Error("结束时间必须晚于当前时间");
        const fen = yuanToFen(String(d.price));
        await api.createPromotion({
          productId: String(d.productId),
          type: String(d.type || "seckill") as "seckill" | "clearance",
          price: fen,
          startsAt: new Date(String(d.startsAt)).toISOString(),
          endsAt: new Date(String(d.endsAt)).toISOString(),
        });
      },
    },
    {
      productId: "",
      type: "seckill",
      price: "",
      startsAt: toDatetimeLocal(),
      endsAt: toDatetimeLocal(
        new Date(Date.now() + 2 * 3600_000).toISOString(),
      ),
    },
  );
}
/** 编辑促销：商品/类型不可改（要换就停用重建）；已结束由后端拒绝。 */
function openPromotionEdit(row: AdminRow) {
  selected.value = undefined;
  const record = row as unknown as Promotion;
  openForm(
    {
      eyebrow: "EDIT PROMOTION",
      title: "编辑促销活动",
      submit: "保存修改",
      done: "促销活动已更新",
      fields: [
        { key: "price", label: "促销价（元）", type: "number", min: 0.01, step: 0.01 },
        { key: "startsAt", label: "开始时间", type: "datetime" },
        { key: "endsAt", label: "结束时间", type: "datetime" },
      ],
      save: async (d) => {
        if (d.startsAt && d.endsAt && new Date(String(d.endsAt)) <= new Date(String(d.startsAt)))
          throw new Error("结束时间必须晚于开始时间");
        await api.updatePromotion(record.id, {
          ...(d.price !== "" && d.price !== undefined ? { price: yuanToFen(String(d.price)) } : {}),
          startsAt: d.startsAt ? new Date(String(d.startsAt)).toISOString() : undefined,
          endsAt: d.endsAt ? new Date(String(d.endsAt)).toISOString() : undefined,
        });
      },
    },
    {
      price: fenToYuan(record.price),
      startsAt: toDatetimeLocal(record.startsAt),
      endsAt: toDatetimeLocal(record.endsAt),
    },
  );
}
/** 停用/启用：进行中停用 C 端读时立即回落（ADR-0006）。 */
async function togglePromotion() {
  if (!selected.value) return;
  const record = selected.value as unknown as Promotion;
  const next = record.status === "active" ? "disabled" : "active";
  try {
    await api.updatePromotion(record.id, { status: next });
    notify(next === "disabled" ? "活动已停用，C 端立即回落原价" : "活动已启用");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
const bannerHidden = computed(
  () => (selected.value as Banner | undefined)?.status === "hidden",
);
async function toggleBanner() {
  if (!selected.value) return;
  const banner = selected.value as Banner;
  const next = banner.status === "hidden" ? "active" : "hidden";
  try {
    await api.updateBanner(banner.id, { status: next });
    notify(next === "hidden" ? "Banner 已隐藏" : "Banner 已重新启用");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}

/* ---------- 售后与退款（IK97FJ）：类型文案 / 图片 / 关联订单补全 ---------- */
/**
 * 售后类型中文映射：以用户端实际提交值为准
 * （buchuqin-user-weapp apply.vue：quality/missing/damaged），
 * 未命中值 fallback 展示原值。
 */
const AFTER_SALE_TYPE_TEXT: Record<string, string> = {
  quality: "质量问题",
  missing: "商品缺失",
  damaged: "包装破损",
  wrong: "错发",
  other: "其他",
};
function toAfterSaleRow(a: AfterSale): AfterSaleRow {
  return {
    id: a.id,
    userId: a.userId,
    orderId: a.orderId,
    type: a.type,
    typeText: AFTER_SALE_TYPE_TEXT[a.type] ?? (a.type || "—"),
    description: a.description,
    images: Array.isArray(a.images) ? a.images : [],
    status: a.status,
    // IKB5PA：状态列中文化（原始 pending/cancelled 不再外露）
    statusText:
      ({ pending: "待处理", cancelled: "已取消" } as Record<string, string>)[
        a.status
      ] ?? a.status,
    createdAt: a.createdAt,
    ...(a.order ? { order: a.order } : {}),
  };
}
const ordersCache = ref<Order[]>([]),
  afterSaleOrder = ref<Order | null>(null),
  orderLoading = ref(false),
  orderError = ref(""),
  previewImage = ref("");
/** 关联订单补全：列表行自带 order 时直接用，否则翻页查询订单列表匹配。 */
async function ensureAfterSaleOrder(row: AfterSaleRow) {
  afterSaleOrder.value = row.order ?? null;
  orderError.value = "";
  previewImage.value = "";
  if (afterSaleOrder.value) return;
  orderLoading.value = true;
  try {
    if (!ordersCache.value.length)
      ordersCache.value = await fetchAllPages((query) =>
        api.orders("all", query),
      );
    afterSaleOrder.value =
      ordersCache.value.find(
        (o) => o.id === row.orderId || o.orderNo === row.orderId,
      ) ?? null;
    if (!afterSaleOrder.value) orderError.value = "未查询到关联订单";
  } catch {
    orderError.value = "关联订单查询失败";
  } finally {
    orderLoading.value = false;
  }
}
const afterSaleOrderStatus = computed(() => {
  if (orderLoading.value) return "查询中...";
  if (afterSaleOrder.value)
    return afterSaleOrder.value.statusText || afterSaleOrder.value.status;
  return orderError.value || "—";
});
const afterSaleOrderAmount = computed(() =>
  afterSaleOrder.value ? `¥${fenToYuan(afterSaleOrder.value.payableAmount)}` : "—",
);

/* IKB5PA：调配两视图的状态 Tab（声明前置：dispatch 配置在此引用）。 */
const LEAVE_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending", label: "待审核", statuses: ["pending"] },
  { key: "approved", label: "已通过", statuses: ["approved"] },
  { key: "rejected", label: "已驳回", statuses: ["rejected"] },
  { key: "cancelled", label: "已撤销", statuses: ["cancelled"] },
];
const INVITE_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "invited", label: "待响应", statuses: ["invited"] },
  { key: "accepted", label: "已接受", statuses: ["accepted"] },
  { key: "rejected", label: "已拒绝", statuses: ["rejected"] },
  { key: "cancelled", label: "已取消", statuses: ["cancelled"] },
];
/** 促销 Tab（IKB5PA）：key 即后端 state 过滤值（时间窗读时判定）。 */
const PROMOTION_STATE_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "live", label: "进行中", statuses: ["live"] },
  { key: "upcoming", label: "未开始", statuses: ["upcoming"] },
  { key: "ended", label: "已结束", statuses: ["ended"] },
  { key: "disabled", label: "已停用", statuses: ["disabled"] },
];
const dispatchLeavesConfig: SectionConfig = {
  title: "调配与请假",
  eyebrow: "DISPATCH DESK",
  desc: "楼长请假与跨楼调配邀请，保障楼栋服务覆盖。",
  // IKB5PA：状态 Tab 化（审核状态），服务端过滤 + 角标
  loader: async (query) => {
    const res = await api.leaveRequests(query, tabStatusOf(LEAVE_STATUS_TABS));
    return { rows: res.items.map(toLeaveRow), total: res.total };
  },
  statusTabs: LEAVE_STATUS_TABS,
  countsLoader: () =>
    countByStatus(
      (s) => api.leaveRequests({ page: 1, pageSize: 1 }, s),
      ["pending", "approved", "rejected", "cancelled"],
    ),
  columns: [
    ["staffName", "楼长"],
    ["staffNo", "工号"],
    ["building", "负责楼栋"],
    ["startAt", "开始时间"],
    ["endAt", "结束时间"],
    ["dispatchModeText", "调配方式"],
    ["substituteText", "代班楼长"],
    ["statusText", "请假状态"],
  ],
};
const dispatchInvitesConfig: SectionConfig = {
  title: "调配与请假",
  eyebrow: "DISPATCH DESK",
  desc: "已发出的调配邀请与楼长接受状态，仅待接受可取消。",
  // IKB5PA：状态 Tab 化（响应状态），服务端过滤 + 角标
  loader: async (query) => {
    const res = await api.dispatchInvitations(
      query,
      tabStatusOf(INVITE_STATUS_TABS),
    );
    return { rows: res.items.map(toInviteRow), total: res.total };
  },
  statusTabs: INVITE_STATUS_TABS,
  countsLoader: () =>
    countByStatus(
      (s) => api.dispatchInvitations({ page: 1, pageSize: 1 }, s),
      ["invited", "accepted", "rejected", "cancelled"],
    ),
  columns: [
    ["staffName", "目标楼长"],
    ["roleText", "现任"],
    ["building", "目标楼栋"],
    ["startAt", "开始时间"],
    ["endAt", "结束时间"],
    ["reward", "奖励"],
    ["statusText", "状态"],
  ],
};

/* ---------- 提成规则（IK8W5Y）：维度通配 * 展示 ---------- */
function loadRules(query: ListQuery): Promise<PageRows> {
  return Promise.all([api.commissionRules(query), ensureBuildings()]).then(
    ([res, buildingList]) => ({
      rows: res.items.map(
        (r): RuleRow => ({
          ...r,
          buildingName: r.buildingId
            ? buildingList.find((b) => b.id === r.buildingId)?.name ??
              r.buildingId
            : null,
          weightRange: `${r.weightFrom ?? "*"} - ${r.weightTo ?? "*"} kg`,
          modeText:
            r.mode === "instant" ? "即时达" : r.mode === "scheduled" ? "预约达" : "*",
        }),
      ),
      total: res.total,
    }),
  );
}
/* ---------- C 端用户管理（IKAJSW）：聚合列表 + 统计 + 详情订单流水 ---------- */
const userBuildingFilter = ref(""),
  userStatsData = ref<UserStats | null>(null),
  userOrderRows = ref<UserOrderRow[]>([]),
  userOrdersLoading = ref(false);
watch(userBuildingFilter, () => resetAndLoad());
/* ---------- IKAJSL：hq 跨校区视角的校区筛选（订单/用户/审计；校区角色无此下拉） ---------- */
const campusFilter = ref("");
/* IKD6FG：列表分类/类型维度筛选（状态 Tab 之外的第二维度）——
   分类筛选商品库(official-products/products)与库存共用一个 ref，切换板块重置 */
const categoryFilter = ref("");
const staffRoleFilter = ref("");
const orderDeliveryFilter = ref("");
/* IKD6FG 反馈：分类筛选升级可搜索下拉（原生 select 无搜索能力）。
   blur 关菜单 + mousedown.prevent 选中，避免失焦先于点击的经典时序问题 */
const categorySearchOpen = ref(false);
const categorySearchText = ref("");
const selectedCategoryName = computed(
  () => categories.value.find((c) => c.id === categoryFilter.value)?.name ?? "",
);
const filteredCategoryOptions = computed(() => {
  const kw = categorySearchText.value.trim().toLowerCase();
  if (!kw) return categories.value;
  return categories.value.filter((c) => c.name.toLowerCase().includes(kw));
});
function openCategorySearch() {
  categorySearchOpen.value = true;
  categorySearchText.value = "";
}
function pickCategory(id: string) {
  categoryFilter.value = id;
  categorySearchOpen.value = false;
}
function clearCategoryFilter() {
  categoryFilter.value = "";
  categorySearchOpen.value = false;
}
const campusOptionsData = ref<Pick<Campus, "id" | "name" | "shortName">[]>([]);
const isHqRole = computed(() => role.value === "hq");
/** IKBFJ4：平台超管 admin 与 hq 同权（账号管理表单按此放开校区选择）。 */
const isPlatformAdmin = computed(
  () => role.value === "hq" || role.value === "admin",
);
/** 列渲染出口：costPrice（总部采购成本）列仅平台角色可见——
 *  校区视角进货价=批发价格（道哥 2026-09-19 定版），成本列不向校区暴露。 */
function cols(config: { columns: [string, string][] }): [string, string][] {
  const list = config.columns.filter((c) => c[0] !== "contactText"); // 详情专用列不进列表
  return isPlatformAdmin.value ? list : list.filter((c) => c[0] !== "costPrice");
}
/** IKCHEW：官方库视角 UI——hq 恒真；admin 随商品视角切换；校区角色恒假。
 *  商品列表/表单/三层价格/建档弹窗按此分流；校区上下文 UI 用 !isHqView。 */
const isHqView = computed(
  () =>
    isHqRole.value ||
    (role.value === "admin" && productView.value === "official"),
);
/** IKCRS8：campuses=纯校区管理（平台视图），楼栋独立 /buildings 板块——
 *  原 IKBWRT 双 tab（campusTab/campusPlatformView）拆除。 */
watch(campusFilter, () => {
  resetAndLoad();
  // IKD6FI：营销地图跟随校区筛选重新拉取
  if (isMktMapTab.value) void loadMarketingMap();
});
/* IKD6FG：分类/角色/配送方式筛选变化即回第 1 页重载 */
watch([categoryFilter, staffRoleFilter, orderDeliveryFilter], () =>
  resetAndLoad(),
);
async function ensureCampusOptions() {
  if (!campusOptionsData.value.length)
    campusOptionsData.value = await api.campuses();
  return campusOptionsData.value;
}
/** 平台视角选了校区就透传 campus 参数（IKCHEW：admin 同 hq 跨校区筛选） */
function campusQuery(query: ListQuery): ListQuery {
  return isPlatformAdmin.value && campusFilter.value
    ? { ...query, campusId: campusFilter.value }
    : query;
}
function campusScope(): string | undefined {
  return isPlatformAdmin.value ? campusFilter.value || undefined : undefined;
}
const usersConfig: SectionConfig = {
  title: "C 端用户",
  eyebrow: "CUSTOMER BASE",
  desc: "用户规模、消费聚合与订单流水；手机号/OpenID 脱敏展示。",
  loader: (query) =>
    api
      .adminUsers({
        ...campusQuery(query),
        ...(userBuildingFilter.value ? { buildingId: userBuildingFilter.value } : {}),
      })
      .then(unwrap),
  columns: [
    ["nickname", "昵称"],
    ["phoneMasked", "手机号"],
    ["openidMasked", "OpenID"],
    ["buildingName", "默认楼栋"],
    ["orderCount", "订单数"],
    ["totalSpend", "累计消费"],
    ["createdAt", "注册时间"],
  ],
};
/* ---------- 校区本体管理（IKAJSL）：hq 视角的 campuses 板块 ---------- */
const hqCampusesConfig: SectionConfig = {
  title: "校区管理",
  eyebrow: "CAMPUS NETWORK",
  desc: "校区信息、启停与配送配置；楼栋与寝室由各校区后台自行维护。",
  // 非分页端点：全量拉取后前端切片分页（与群码同模式）
  loader: async (query) => {
    const all = await api.campuses();
    // IKFOPY：标注校区类型——总部仓（type=hq）在列表可见可辨
    const rows = all.map((x) => ({
      ...x,
      typeText: (x as Campus & { type?: string }).type === "hq" ? "总部仓" : "校区",
    }));
    const start = (query.page - 1) * query.pageSize;
    return {
      rows: rows.slice(start, start + query.pageSize) as unknown as AdminRow[],
      total: rows.length,
    };
  },
  columns: [
    ["name", "校区"],
    ["shortName", "简称"],
    ["typeText", "类型"],
    ["warehouseName", "仓库"],
    ["status", "状态"],
    ["buildings", "楼栋数"],
    ["users", "用户数"],
  ],
};
/** 新建校区（仅 hq）：新校区接入后由总部在其后台建账号/楼栋。 */
function openCampusCreate() {
  openForm(
    {
      eyebrow: "NEW CAMPUS",
      title: "新建校区",
      submit: "创建校区",
      done: "校区已创建，可在账号管理为其开后台账号",
      fields: [
        { key: "name", label: "校区全称", placeholder: "例如：湖北工业大学" },
        { key: "shortName", label: "简称", placeholder: "例如：湖工大" },
        { key: "warehouseName", label: "仓库名", placeholder: "例如：湖工大校园仓" },
        { key: "address", label: "仓库地址（选填）" },
        {
          key: "instant",
          label: "即时达配送费（元）",
          type: "number",
          min: 0,
          step: 0.01,
        },
        {
          key: "scheduled",
          label: "预约达配送费（元）",
          type: "number",
          min: 0,
          step: 0.01,
        },
        { key: "threshold", label: "起送门槛（元）", type: "number", min: 0, step: 0.01 },
        { key: "baseSalary", label: "楼长月度底薪（元，0=无底薪）", type: "number", min: 0, step: 1 },
      ],
      save: async (d) => {
        if (!String(d.name || "").trim() || !String(d.shortName || "").trim())
          throw new Error("请填写校区全称与简称");
        void (await api.createCampus({
          name: String(d.name).trim(),
          shortName: String(d.shortName).trim(),
          warehouseName: String(d.warehouseName || "").trim() || String(d.shortName).trim() + "校园仓",
          address: String(d.address || "").trim(),
          // 表单输元，提交转分（IK8W5K）；三项与配送配置弹窗同口径
          deliveryFeeInstant: yuanToFen(d.instant ?? 4),
          deliveryFeeScheduled: yuanToFen(d.scheduled ?? 2),
          deliveryThreshold: yuanToFen(d.threshold ?? 10),
          buildingManagerBaseSalary: yuanToFen(d.baseSalary ?? 0),
        }));
      },
    },
    { name: "", shortName: "", warehouseName: "", address: "", instant: 4, scheduled: 2, threshold: 10 },
  );
}
/** 编辑校区（仅 hq）：信息/启停/配送费。 */
function openCampusEdit(row: AdminRow) {
  const campus = row as unknown as Campus & {
    deliveryFeeInstant?: number;
    deliveryFeeScheduled?: number;
    deliveryThreshold?: number;
    buildingManagerBaseSalary?: number;
  };
  selected.value = undefined;
  openForm(
    {
      eyebrow: "EDIT CAMPUS",
      title: `编辑校区 ${campus.shortName || campus.name}`,
      submit: "保存修改",
      done: "校区信息已更新",
      fields: [
        { key: "name", label: "校区全称" },
        { key: "shortName", label: "简称" },
        { key: "warehouseName", label: "仓库名" },
        { key: "address", label: "仓库地址" },
        {
          key: "status",
          label: "状态",
          type: "select",
          options: () => [
            { value: "active", label: "在营" },
            { value: "inactive", label: "停用" },
          ],
        },
        { key: "instant", label: "即时达配送费（元）", type: "number", min: 0, step: 0.01 },
        { key: "scheduled", label: "预约达配送费（元）", type: "number", min: 0, step: 0.01 },
        { key: "threshold", label: "起送门槛（元）", type: "number", min: 0, step: 0.01 },
        { key: "baseSalary", label: "楼长月度底薪（元，0=无底薪）", type: "number", min: 0, step: 1 },
      ],
      save: async (d) =>
        void (await api.updateCampus(campus.id, {
          name: String(d.name || "").trim(),
          shortName: String(d.shortName || "").trim(),
          warehouseName: String(d.warehouseName || "").trim(),
          address: String(d.address || "").trim(),
          status: String(d.status || "active") as "active" | "inactive",
          deliveryFeeInstant: yuanToFen(d.instant ?? 0),
          deliveryFeeScheduled: yuanToFen(d.scheduled ?? 0),
          buildingManagerBaseSalary: yuanToFen(d.baseSalary ?? 0),
          deliveryThreshold: yuanToFen(d.threshold ?? 0),
        })),
    },
    {
      name: campus.name,
      shortName: campus.shortName,
      warehouseName: campus.warehouseName,
      address: campus.address ?? "",
      status: campus.status,
      instant: Number(fenToYuan(campus.deliveryFeeInstant ?? 400)),
      scheduled: Number(fenToYuan(campus.deliveryFeeScheduled ?? 200)),
      threshold: Number(fenToYuan(campus.deliveryThreshold ?? 1000)),
      baseSalary: Number(fenToYuan(campus.buildingManagerBaseSalary ?? 0)),
    },
  );
}
/* ---------- 微信群二维码（IKAJSY）：楼栋群 + 校级大群 ---------- */
const wechatGroupsConfig: SectionConfig = {
  title: "微信群码",
  eyebrow: "WECHAT GROUPS",
  desc: "楼栋群与校级大群二维码；用户端进群入口按「楼栋群→校级大群」回落。",
  // 非分页端点：全量拉取后前端切片分页（与类别字典同模式）
  loader: async (query) => {
    const all = await api.wechatGroups();
    const start = (query.page - 1) * query.pageSize;
    return { rows: all.slice(start, start + query.pageSize), total: all.length };
  },
  columns: [
    ["buildingName", "群"],
    ["image", "二维码"],
    ["updatedAt", "更新时间"],
  ],
};
/* ---------- 抽奖大转盘（IKD6FC）：单例配置，8 奖位行展示 ---------- */
const WHEEL_TYPE_LABEL: Record<string, string> = {
  coupon: "平台券",
  partner: "异业券",
  none: "谢谢参与",
};
const wheelConfig: SectionConfig = {
  title: "抽奖转盘",
  eyebrow: "MARKETING WHEEL",
  desc: "配置小程序首页大转盘的奖品与概率；开启后首页显示抽奖入口，每日限抽 1 次。",
  // 单例配置：8 奖位固定 8 行；未配置时给占位行（保存经编辑弹框 upsert）
  loader: async (query) => {
    const cfg = await api.wheel();
    const rows = Array.from({ length: 8 }, (_, i) => {
      const p = cfg.prizes[i];
      return {
        id: `wheel-${i}`,
        index: i,
        typeText: p ? WHEEL_TYPE_LABEL[p.type] ?? p.type : "未配置",
        label: p?.label ?? "—",
        content: wheelContentText(p),
        weight: p?.weight ?? 0,
        weightPct: p?.weightPct ?? 0,
        active: cfg.active,
      };
    });
    const start = (query.page - 1) * query.pageSize;
    return {
      rows: rows.slice(start, start + query.pageSize) as unknown as AdminRow[],
      total: rows.length,
    };
  },
  columns: [
    ["index", "奖位"],
    ["typeText", "类型"],
    ["label", "扇区文案"],
    ["content", "内容"],
    ["weight", "权重"],
    ["weightPct", "概率"],
  ] as [string, string][],
};
function wheelContentText(p?: {
  type: string;
  couponName?: string;
  bizTitle?: string;
  bizImage?: string;
}): string {
  if (!p) return "—";
  if (p.type === "coupon") return p.couponName || "（券已删除）";
  // IKDCVO：partner 配券优先展示券名，未配券回落图文
  if (p.type === "partner")
    return p.couponName || p.bizTitle || "（图文）";
  return "—";
}
/** 奖位类型徽标配色（平台券绿/异业券橙/谢谢参与灰/未配置描边）。 */
function wheelTypeClass(row: AdminRow): string {
  const t = String((row as WheelRow).typeText ?? "");
  if (t === "平台券") return "is-coupon";
  if (t === "异业券") return "is-partner";
  if (t === "谢谢参与") return "is-none";
  return "is-unset";
}
/** 上传/替换群码：楼栋选空 = 校级大群；同楼栋重复保存即替换。 */
function openWechatGroupForm(row?: AdminRow) {
  selected.value = undefined;
  void ensureBuildings();
  const record = row as WechatGroup | undefined;
  openForm(
    {
      eyebrow: "WECHAT GROUP",
      title: record ? "替换群二维码" : "上传群二维码",
      submit: "保存",
      done: record ? "群二维码已替换" : "群二维码已保存",
      fields: [
        {
          key: "buildingId",
          label: "所属群",
          type: "select",
          wide: true,
          options: () => [
            { value: "", label: "校级大群（未设楼栋用户的回落入口）" },
            ...buildingOptions(),
          ],
        },
        { key: "image", label: "群二维码", type: "image", wide: true, folder: "app/wechat-group" },
      ],
      save: async (d) => {
        if (!d.image) throw new Error("请上传群二维码图片");
        await api.upsertWechatGroup({
          buildingId: String(d.buildingId || "") || undefined,
          image: String(d.image),
        });
      },
    },
    {
      buildingId: record?.buildingId ?? "",
      image: record?.image ?? "",
    },
  );
}
/** 删除群码（抽屉内二次确认；用户端对应入口随之隐藏/回落）。 */
async function removeWechatGroupRow() {
  if (!selected.value) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.deleteWechatGroup(selected.value.id);
    notify("群码已删除");
    selected.value = undefined;
    await load();
  } catch (error) {
    confirmDelete.value = false;
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
/**
 * 订单状态 Tab（IKAJSP）：按运营节奏分组，多个原始状态合并展示
 * （配送中 = 等首程/首程/末程），计数来自 orders/status-counts。
 */
const ORDER_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending-payment", label: "待支付", statuses: ["pending-payment"] },
  { key: "awaiting-outbound", label: "待出库", statuses: ["paid", "picking"] },
  {
    key: "delivering",
    label: "配送中",
    statuses: ["waiting-first-mile", "first-mile", "last-mile"],
  },
  {
    key: "waiting-handover",
    label: "楼下待交接",
    statuses: ["waiting-handover"],
  },
  { key: "delivered", label: "已送达", statuses: ["delivered"] },
  { key: "completed", label: "已完成", statuses: ["completed"] },
  {
    key: "closed",
    label: "取消/退款/异常",
    statuses: ["cancelled", "refunded", "exception"],
  },
];
/* IKB3K9：商品状态 Tab（口径含售罄映射——在售但库存 0 = 售罄）。 */
const PRODUCT_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "on-sale", label: "在售", statuses: ["on-sale"] },
  { key: "off-sale", label: "已下架", statuses: ["off-sale"] },
  { key: "sold-out", label: "售罄", statuses: ["sold-out"] },
];
/* 官方库 Tab 无售罄（库存归校区，官方行不参与售罄映射）。 */
const HQ_PRODUCT_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "on-sale", label: "在售", statuses: ["on-sale"] },
  { key: "off-sale", label: "已下架", statuses: ["off-sale"] },
];
/* IKAJSM：hq 商品板块 = 官方商品库（源头档案）——无库存/库位列（库存归校区），
   建档/改档经同一 products 端点（后端按角色落 campus-official）。 */
const hqProductsConfig: SectionConfig = {
  title: "官方商品库",
  eyebrow: "OFFICIAL CATALOG",
  desc: "总部维护统一商品档案，校区从这里导入落地；同码可与校区商品并存。",
  loader: (query) => {
    const tab =
      HQ_PRODUCT_STATUS_TABS.find((t) => t.key === statusFilter.value) ??
      HQ_PRODUCT_STATUS_TABS[0];
    return api
      .products(
        {
          ...query,
          status: tab.statuses.length ? tab.statuses.join(",") : undefined,
          // IKD6FG：分类筛选
          categoryId: categoryFilter.value || undefined,
        },
        // IKCHEW：admin 双视角透传（hq/校区角色后端忽略 view）
        productView.value,
      )
      .then((res) => ({
        rows: res.items.map((p) => ({
          ...p,
          locationText:
            [p.location, (p as Product & { locationCode?: string }).locationCode]
              .filter(Boolean)
              .join("-") || "",
        })),
        total: res.total,
      }));
  },
  statusTabs: HQ_PRODUCT_STATUS_TABS,
  // IKCHEW：admin 官方库视角透传 view（hq 后端忽略）
  countsLoader: () => api.productStatusCounts(productView.value),
  columns: [
    // IKDEP0：SKU 列（伪编号）换商品缩略图，点击看大图
    ["image", "图片"],
    ["name", "商品"],
    ["categoryId", "分类"],
    // IKC1AC：价格三层（进货价仅总部可见；官方售价更名批发价格）
    ["costPrice", "进货价"],
    ["price", "批发价格"],
    ["originalPrice", "建议零售价"],
    ["status", "状态"],
  ],
};

/* ---------- IKB5PA：各板块状态 Tab（服务端 status 过滤 + total 角标） ---------- */
const STAFF_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "online", label: "在线", statuses: ["online"] },
  { key: "paused", label: "暂停", statuses: ["paused"] },
  { key: "offline", label: "离线", statuses: ["offline"] },
];
const STAFF_STATUS_LABEL: Record<string, string> = {
  online: "在线",
  paused: "暂停接单",
  offline: "离线",
};
const AFTER_SALE_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending", label: "待处理", statuses: ["pending"] },
  { key: "cancelled", label: "已取消", statuses: ["cancelled"] },
];
const COUPON_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "active", label: "发放中", statuses: ["active"] },
  { key: "paused", label: "已暂停", statuses: ["paused"] },
];
const BANNER_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "active", label: "启用", statuses: ["active"] },
  { key: "hidden", label: "已隐藏", statuses: ["hidden"] },
];
const BILL_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending-review", label: "待确认", statuses: ["pending-review"] },
  { key: "confirmed", label: "已确认", statuses: ["confirmed"] },
  { key: "paid", label: "已打款", statuses: ["paid"] },
];
/* IKEAGE 楼长招募：报名状态 Tab（待联系→面试中→已通过/已拒绝） */
const RECRUIT_STATUS_TABS: StatusTab[] = [
  { key: "all", label: "全部", statuses: [] },
  { key: "pending", label: "待联系", statuses: ["pending"] },
  { key: "interviewing", label: "面试中", statuses: ["interviewing"] },
  { key: "approved", label: "已通过", statuses: ["approved"] },
  { key: "rejected", label: "已拒绝", statuses: ["rejected"] },
];
const RECRUIT_STATUS_LABEL: Record<string, string> = {
  pending: "待联系",
  interviewing: "面试中",
  approved: "已通过",
  rejected: "已拒绝",
};
/** 徽章配色：待联系橙 / 面试中蓝 / 已通过绿 / 已拒绝红（.status.info/.danger 新增于 style.css） */
const RECRUIT_STATUS_CLASS: Record<string, string> = {
  pending: "warning",
  interviewing: "info",
  approved: "success",
  rejected: "danger",
};

const configs: Record<string, SectionConfig> = {
  orders: {
    // IKB5P9：标题与侧边栏菜单统一为「订单配送」
    title: "订单配送",
    eyebrow: "ORDER CONTROL",
    desc: "监控订单全生命周期与两段配送进度。",
    // IKAJSP：Tab 即过滤条件（服务端逗号状态），statusFilter 存 Tab key
    loader: (query) => {
      const tab =
        ORDER_STATUS_TABS.find((t) => t.key === statusFilter.value) ??
        ORDER_STATUS_TABS[0];
      return api
        .orders(
          tab.statuses.length ? tab.statuses.join(",") : "all",
          campusQuery({
            ...query,
            // IKD6FG：配送方式筛选
            deliveryMode: orderDeliveryFilter.value || undefined,
          }),
        )
        .then((res) => ({
          // IKB1XM：列表补商品/用户两列（数据本就随行返回，前端派生展示）
          total: res.total,
          rows: res.items.map((o) => {
            const names = (o.items ?? [])
              .map((line) => line.product?.name ?? "")
              .filter(Boolean);
            const user = (o as Order & { user?: { nickname?: string } }).user;
            // 道哥 2026-09-16：用户列主显手机号——昵称清一色「微信用户」无辨识度，
            // 打码手机号才是客服/运营肉眼对人的标识；楼栋房号降为次行辅助定位
            // （\n 连接：列表拆两行主次展示，详情/CSV 内塌为分隔符，同 itemsText 口径）
            const address = o.address;
            const building = [address?.buildingName, address?.room]
              .filter(Boolean)
              .join("");
            const userMain = o.userPhone || user?.nickname?.trim() || "";
            // 2026-09-19 道哥定版：详情收货人一行=姓名+明文电话+楼栋房号
            //（脱敏手机号不再显示，下单账号标识从详情移除——列表口径不变）
            const contactMain =
              [address?.contactName, address?.phone].filter(Boolean).join(" / ");
            const contactText =
              contactMain
                ? building
                  ? `${contactMain}（${building}）`
                  : contactMain
                : "—";
            return {
              ...o,
              // IKBW0C：商品逐行（多商品每行一个），不再「前 2 个+等」平铺
              itemsText: names.length ? names.join("\n") : "—",
              // 2026-09-19 道哥：列表商品列单行摘要（首商品+等N件），悬停 title 显全部
              itemsBrief: names.length
                ? names[0] + (names.length > 1 ? ` 等${names.length}件` : "")
                : "—",
              userText: [userMain, building].filter(Boolean).join("\n") || "—",
              contactText,
              // IKBW0C：时效固定文案（立即配送/2小时送达），与履约端列表口径一致
              slaText:
                o.deliveryMode === "instant" ? "立即配送" : "2小时送达",
            };
          }),
        }));
    },
    statusTabs: ORDER_STATUS_TABS,
    countsLoader: () => api.orderStatusCounts(campusScope()),
    columns: [
      ["orderNo", "订单编号"],
      ["itemsText", "商品"],
      ["userText", "用户"],
      ["contactText", "收货人"],
      ["statusText", "当前状态"],
      ["payableAmount", "实付金额"],
      // IKFTZ9：毛利列（合计口径同详情，缺成本显示 —）
      ["marginTotal", "毛利"],
      // IKBW0C：时效列改固定文案（slaText 由 loader 按 deliveryMode 派生）
      ["slaText", "时效"],
      // IKC9M2：补下单时间列（格式化走 display 的 createdAt 统一分支）
      ["createdAt", "下单时间"],
    ],
    // IKFSZJ 第二轮：详情三列按道哥指定顺序——行1 编号/状态/时效，行2 用户/实付/时间；商品通栏
    detailOrder: [
      "orderNo",
      "statusText",
      "slaText",
      "contactText",
      "payableAmount",
      "createdAt",
    ],
  },
  users: usersConfig,
  "wechat-groups": wechatGroupsConfig,
  wheel: wheelConfig,
  products: {
    title: "商品管理",
    eyebrow: "PRODUCT CENTER",
    desc: "维护商品资料、校园售价与销售状态。",
    loader: (query) => {
      // IKB3K9：状态 Tab 服务端过滤（同订单页 Tab 机制）
      const tab =
        PRODUCT_STATUS_TABS.find((t) => t.key === statusFilter.value) ??
        PRODUCT_STATUS_TABS[0];
      return api
        .products(
          {
            ...query,
            status: tab.statuses.length ? tab.statuses.join(",") : undefined,
            // IKD6FG：分类筛选
            categoryId: categoryFilter.value || undefined,
          },
          // IKCHEW：admin 本校区视角透传 view（校区角色后端忽略）
          productView.value,
        )
        .then((res) => ({
          rows: res.items.map((p) => ({
            ...p,
            // 库位展示（IKA0VG）：区域-编号拼接，空 = 未配置
            locationText:
              [p.location, (p as Product & { locationCode?: string }).locationCode]
                .filter(Boolean)
                .join("-") || "",
          })),
          total: res.total,
        }));
    },
    statusTabs: PRODUCT_STATUS_TABS,
    // IKCHEW：admin 本校区视角透传 view（校区角色后端忽略）
    countsLoader: () => api.productStatusCounts(productView.value),
    columns: [
      // IKDEP0：SKU 列（伪编号）换商品缩略图，点击看大图
      ["image", "图片"],
      ["name", "商品"],
      ["categoryId", "分类"],
      ["price", "售价"],
      // IKC1AC：校区可见批发价快照与建议零售价。进货价口径定版=批发价格
      // （2026-09-19 道哥定版：定促销毛利基准），促销弹窗「进货¥」与该列同源同数
      ["wholesalePrice", "批发价格"],
      ["originalPrice", "建议零售价"],
      ["availableStock", "可售库存"],
      ["locationText", "库位"],
      ["status", "状态"],
    ],
  },
  /* 类别独立菜单（2026-08-19 grilling）：非分页字典端点，前端 keyword 过滤 + 切页包装 */
  categories: {
    title: "商品类别",
    eyebrow: "PRODUCT CATEGORIES",
    desc: "维护小程序分类 tab 的全局类别字典，sort 越小越靠前。",
    loader: async (query) => {
      const all = await api.adminCategories();
      const kw = query.keyword ?? "";
      const hit = kw ? all.filter((c) => c.name.includes(kw)) : all;
      const start = (query.page - 1) * query.pageSize;
      const pageRows: CategoryRow[] = hit
        .slice(start, start + query.pageSize)
        .map((c) => ({
          id: c.id,
          name: c.name,
          sort: c.sort,
          image: c.image ?? "",
          productCount: c.productCount ?? 0,
          hidden: c.hidden ?? false,
          // IKC9M4：类目开关状态列
          visibleText: (c.hidden ?? false) ? "已隐藏" : "显示中",
        }));
      return { rows: pageRows, total: hit.length };
    },
    columns: [
      ["image", "图片"],
      ["name", "类别名称"],
      ["sort", "排序"],
      ["productCount", "商品数"],
      // IKC9M4：类目可见性开关（隐藏后 C 端全链路不露出该类目及其商品）
      ["visibleText", "小程序显示"],
    ],
  },
  inventory: {
    // IKA0VB 去批次：批次/有效期列移除；IKA0V2 流水与拣货出库拆独立菜单。
    title: "库存总览",
    eyebrow: "WAREHOUSE INVENTORY",
    desc: "掌握实际、锁定和可售库存，提前处理临期预警。",
    loader: (query) =>
      api
        .inventory({
          ...query,
          // IKD6FG：分类筛选
          categoryId: categoryFilter.value || undefined,
          // IKFOPY：hq 视角按校区筛选聚焦（含总部仓）
          campusId: campusScope(),
        })
        .then((res) => ({
        rows: res.items.map((p) => ({
          ...p,
          locationText:
            [p.location, (p as Product & { locationCode?: string }).locationCode]
              .filter(Boolean)
              .join("-") || "",
        })),
        total: res.total,
      })),
    columns: [
      // IKD6FG：SKU 列换商品缩略图（拣货/盘点认图不认码）
      ["image", "商品图"],
      ["name", "商品"],
      ["locationText", "库位"],
      ["actualStock", "实际"],
      ["lockedStock", "锁定"],
      ["availableStock", "可售"],
    ],
  },
  "warehouse-orders": warehouseOrdersConfig,
  "inventory-txns": inventoryTxnsConfig,
  /* 库位管理（IKA0VG）：字典 CRUD，商品表单下拉消费 */
  locations: {
    title: "库位管理",
    eyebrow: "STORAGE LOCATIONS",
    desc: "维护仓库库位区域字典，商品编辑时下拉选择，拣货按库位找货。",
    loader: async () => {
      const all = await ensureLocations();
      return {
        rows: all.map((l) => ({ ...l }) as unknown as AdminRow),
        total: all.length,
      };
    },
    columns: [
      ["name", "库位名称"],
      ["note", "备注"],
      ["sort", "排序"],
      ["createdAt", "创建时间"],
    ],
  },
  /* IKB5PA：状态 Tab 化（在线/暂停/离线），服务端过滤 + 角标计数 */
  staff: {
    title: "履约人员",
    eyebrow: "TEAM PERFORMANCE",
    desc: "楼长与配送员账号状态、绩效和服务范围。",
    loader: (query) =>
      api
        .staff(
          {
            ...query,
            // IKD6FG：角色筛选
            role: staffRoleFilter.value || undefined,
          },
          tabStatusOf(STAFF_STATUS_TABS),
        )
        .then((res) => ({
          rows: res.items.map((x) => ({
            ...x,
            statusText: STAFF_STATUS_LABEL[x.status] ?? x.status,
          })),
          total: res.total,
        })),
    statusTabs: STAFF_STATUS_TABS,
    countsLoader: () =>
      countByStatus(
        (s) => api.staff({ page: 1, pageSize: 1 }, s),
        ["online", "paused", "offline"],
      ),
    columns: [
      ["staffNo", "工号"],
      ["name", "姓名"],
      ["roleText", "角色"],
      ["building", "服务范围"],
      ["completedToday", "今日完成"],
      ["onTimeRate", "准时率"],
      ["statusText", "状态"],
    ],
  },
  /* IKEAGE 楼长招募：C 端报名 → 联系面试 → 补录身份证 → 一键审批创建实习楼长。
   * 数据范围随 campusQuery（admin 平台视角可按校区筛，运营固定本校区）。 */
  recruit: {
    title: "楼长招募",
    eyebrow: "RECRUITING",
    desc: "小程序报名的楼长候选人：联系面试、补录资料、审批入职（通过即创建实习楼长账号）。",
    loader: (query) =>
      api
        .recruitApplications(campusQuery(query), tabStatusOf(RECRUIT_STATUS_TABS))
        .then((res) => ({
          rows: res.items.map((x) => ({
            ...x,
            statusText: RECRUIT_STATUS_LABEL[x.status] ?? x.status,
            // 身份证列：号或照片任一已录即「已录」
            idCardText:
              x.idCardNo || (x.idCardImages?.length ?? 0) > 0 ? "已录" : "—",
          })),
          total: res.total,
        })),
    statusTabs: RECRUIT_STATUS_TABS,
    countsLoader: () => api.recruitStatusCounts(campusScope()),
    columns: [
      ["name", "姓名"],
      ["phone", "手机号"],
      ["campusName", "校区"],
      ["buildingName", "报名楼栋"],
      ["statusText", "状态"],
      ["idCardText", "身份证"],
      ["createdAt", "报名时间"],
    ],
  },
  "after-sales": {
    title: "售后与退款",
    eyebrow: "AFTER-SALES DESK",
    desc: "集中审核质量投诉、退款与异常凭证。",
    // IKB5PA：状态 Tab 化（待处理/已取消），服务端过滤 + 角标
    loader: async (query) => {
      const res = await api.afterSales(
        query,
        tabStatusOf(AFTER_SALE_STATUS_TABS),
      );
      return { rows: res.items.map(toAfterSaleRow), total: res.total };
    },
    statusTabs: AFTER_SALE_STATUS_TABS,
    countsLoader: () =>
      countByStatus(
        (s) => api.afterSales({ page: 1, pageSize: 1 }, s),
        ["pending", "cancelled"],
      ),
    columns: [
      ["id", "售后单号"],
      ["userId", "用户"],
      ["orderId", "订单号"],
      ["typeText", "类型"],
      ["description", "问题描述"],
      ["createdAt", "申请时间"],
      ["statusText", "状态"],
    ],
  },
  finance: {
    title: "财务结算",
    eyebrow: "FINANCE SETTLEMENT",
    desc: "月度账单确认、打款与跨期调整（月份可筛选）。",
    // IKB5PA：账单状态 Tab（待确认/已确认/已打款），随当前账期计数。
    // IKDFIN：后端 GET /admin/settlements 只认 month/page/pageSize/keyword，
    // status 参数被 controller 丢弃（service 支持但未透传）——Tab 过滤与角标
    // 改前端做：拉当月全量后按状态过滤切片（同采购申请模式），角标直接数
    // 全量。修复：切 Tab 列表不过滤、三状态角标全等于当月总数、「全部」
    // 角标被三倍放大（如 8 条账单显示「全部 24 / 各状态 8」）。
    loader: async (query) => {
      const all = await fetchAllPages((q) =>
        api.settlements(month.value, { ...q, keyword: query.keyword }),
      );
      const status = tabStatusOf(BILL_STATUS_TABS);
      const hit = status ? all.filter((b) => b.status === status) : all;
      // 金额汇总随列表刷新（当月应结 / 其中已打款，单位分）
      financeTotals.value = {
        payable: all.reduce((n, b) => n + b.payable, 0),
        paid: all
          .filter((b) => b.status === "paid")
          .reduce((n, b) => n + b.payable, 0),
      };
      const start = (query.page - 1) * query.pageSize;
      return {
        rows: hit.slice(start, start + query.pageSize) as unknown as AdminRow[],
        total: hit.length,
      };
    },
    statusTabs: BILL_STATUS_TABS,
    countsLoader: async () => {
      const all = await fetchAllPages((q) => api.settlements(month.value, q));
      const counts: Record<string, number> = {};
      for (const s of ["pending-review", "confirmed", "paid"])
        counts[s] = all.filter((b) => b.status === s).length;
      return counts;
    },
    columns: [
      ["staffName", "人员"],
      ["roleText", "角色"],
      ["period", "账期"],
      ["baseSalary", "底薪"],
      ["commissionTotal", "提成"],
      ["adjustment", "调整"],
      ["payable", "应结"],
      ["status", "状态"],
    ],
  },
  rules: {
    title: "提成规则",
    eyebrow: "COMMISSION RULES",
    desc: "按楼栋/楼层/重量/模式配置提成单价，未命中走兜底。",
    loader: (query) => loadRules(query),
    columns: [
      ["buildingName", "楼栋"],
      ["floor", "楼层"],
      ["weightRange", "重量区间"],
      ["modeText", "模式"],
      ["price", "单价"],
      ["version", "版本"],
      ["status", "状态"],
      ["effectiveAt", "生效时间"],
    ],
  },
  // IKCRS8：楼栋管理独立板块（原「校园组织」tab 分支迁出）；校区上下文
  // 跟随顶栏切换的运营校区（后端 req.user.campusId）
  buildings: {
    title: "楼栋管理",
    eyebrow: "CAMPUS NETWORK",
    desc: "管理本校区楼栋、寝室与楼长派单范围。",
    loader: (query) => api.buildings(query).then(unwrap),
    columns: [
      ["name", "楼栋"],
      ["floors", "楼层"],
      ["hasElevator", "电梯"],
      ["gender", "性别分区"],
      ["roomsCount", "寝室数"],
      ["staffName", "楼长"],
    ],
  },
  marketing: {
    title: "营销活动",
    eyebrow: "GROWTH CAMPAIGNS",
    desc: "配置优惠券预算、领取门槛与核销效果。",
    // IKB5PA：状态 Tab 化（发放中/已暂停），服务端过滤 + 角标
    loader: (query) =>
      api.coupons(query, tabStatusOf(COUPON_STATUS_TABS)).then(unwrap),
    statusTabs: COUPON_STATUS_TABS,
    countsLoader: () =>
      countByStatus(
        (s) => api.coupons({ page: 1, pageSize: 1 }, s),
        ["active", "paused"],
      ),
    columns: [
      ["name", "优惠券"],
      ["kind", "类型"],
      ["trigger", "发放"],
      ["amount", "面额"],
      ["threshold", "门槛"],
      ["total", "总量"],
      ["remain", "剩余"],
      ["claimed", "领取"],
      ["used", "核销"],
      ["expiresAt", "有效期"],
      ["status", "状态"],
    ],
  },
  /* IKB5PB：优惠券独立菜单（营销板块 coupons tab 拆出），列与表单复用 marketing 口径 */
  coupons: {
    title: "优惠券配置",
    eyebrow: "COUPONS",
    desc: "配置优惠券预算、领取门槛与核销效果。",
    loader: (query) =>
      api.coupons(query, tabStatusOf(COUPON_STATUS_TABS)).then(unwrap),
    statusTabs: COUPON_STATUS_TABS,
    countsLoader: () =>
      countByStatus(
        (s) => api.coupons({ page: 1, pageSize: 1 }, s),
        ["active", "paused"],
      ),
    columns: [
      ["name", "优惠券"],
      ["kind", "类型"],
      ["trigger", "发放"],
      ["amount", "面额"],
      ["threshold", "门槛"],
      ["total", "总量"],
      ["remain", "剩余"],
      ["claimed", "领取"],
      ["used", "核销"],
      ["expiresAt", "有效期"],
      ["status", "状态"],
    ],
  },
  audit: {
    title: "审计日志",
    eyebrow: "AUDIT TRAIL",
    desc: "追踪关键状态、金额与权限变更。",
    // IKAJSL：hq 视角可按校区过滤（工具栏下拉）
    loader: (query) => api.audits(campusQuery(query)).then(unwrap),
    columns: [
      // IKB5P8：人话化字段（后端附 operatorName/actionText/entityText），原始代码只留 entityId 备查
      ["createdAt", "时间"],
      ["operatorName", "操作人"],
      ["actionText", "动作"],
      ["entityText", "对象"],
      ["entityId", "对象 ID"],
    ],
  },
  accounts: {
    title: "账号管理",
    eyebrow: "ADMIN ACCOUNTS",
    // IKAJSL：admin 管本校区职能账号；hq 管全部（含总部/各校区账号）
    desc: "后台账号的创建、角色分配与密码重置（平台超管 admin 与总部 hq 管全部账号）。",
    loader: (query) =>
      api.adminAccounts(query).then((res) => ({
        total: res.total,
        rows: res.items.map((x) => {
          const withNames = x as AccountRow & {
            campusName?: string;
            campusNames?: string[];
          };
          return {
            ...x,
            roleText: ROLE_LABELS[x.role as AdminRole] ?? x.role,
            // IKB5PC：hq 视角后端附 campusNames（多校区账号全量列出）；
            // 校区视角无该字段回落「本校区」
            campusNameText:
              x.campusId === ""
                ? "总部"
                : withNames.campusNames?.length
                  ? withNames.campusNames.join("、")
                  : withNames.campusName || "本校区",
          };
        }),
      })),
    columns: [
      ["username", "账号"],
      ["nickname", "昵称"],
      ["roleText", "角色"],
      ["campusNameText", "校区"],
      ["createdAt", "创建时间"],
    ],
  },
};
/** Banner 管理（IK9RX2）：营销板块 banners tab 的表格配置。
 *  IKBW0A：Banner 校区自管，投放范围概念废止（仅作用本校区）。 */
const bannerConfig: SectionConfig = {
  // IKB5PB：随菜单改名「Banner 配置」
  title: "Banner 配置",
  eyebrow: "CAMPUS BANNERS",
  desc: "管理本校区小程序首页轮播与支付成功页广告，内容仅作用于本校区。",
  loader: (query) =>
    // IKB5PA：状态 Tab（启用/已隐藏）服务端过滤 + 角标
    api.banners(query, undefined, tabStatusOf(BANNER_STATUS_TABS)).then((res) => ({
      rows: res.items.map((b) => ({
        ...b,
        // IKC1AD：详情改长图口径，列表显示配置状态
        detailText: b.detailImage ? "已配置" : "—",
        // IKE9YC：跳转目标（常用页显示中文名，自定义路径原样）
        linkText:
          b.linkType === "page" && b.linkUrl
            ? BANNER_LINK_PAGES.find((p) => p.value === b.linkUrl)?.label ??
              b.linkUrl
            : "—",
        placementText: BANNER_PLACEMENT_TEXT[b.placement ?? "home"] ?? b.placement,
      })),
      total: res.total,
    })),
  statusTabs: BANNER_STATUS_TABS,
  countsLoader: () =>
    countByStatus(
      (s) => api.banners({ page: 1, pageSize: 1 }, undefined, s),
      ["active", "hidden"],
    ),
  columns: [
    ["image", "图片"],
    ["title", "标题"],
    ["placementText", "展示位置"],
    ["badge", "角标"],
    ["color", "主题色"],
    ["detailText", "详情长图"],
    ["linkText", "点击跳转"],
    ["sort", "排序"],
    ["status", "状态"],
  ],
};
/** 支付广告位（IKB5PB）：Banner 配置的 pay-success 子视图（独立菜单），
 *  新建默认展示在支付成功页（openBannerCreate("pay-success")）。
 *  IKBW0A：校区自管，投放范围概念废止。 */
const payAdsConfig: SectionConfig = {
  ...bannerConfig,
  title: "支付广告位",
  eyebrow: "PAY-SUCCESS ADS",
  desc: "管理本校区支付成功页广告位素材，内容仅作用于本校区。",
  loader: (query) =>
    // IKB5PA：状态 Tab（启用/已隐藏）随 placement 一起服务端过滤
    api.banners(query, "pay-success", tabStatusOf(BANNER_STATUS_TABS)).then(
      (res) => ({
        rows: res.items.map((b) => ({
          ...b,
          // IKC1AD：详情改长图口径，列表显示配置状态
        detailText: b.detailImage ? "已配置" : "—",
        })),
        total: res.total,
      }),
    ),
  statusTabs: BANNER_STATUS_TABS,
  countsLoader: () =>
    countByStatus(
      (s) => api.banners({ page: 1, pageSize: 1 }, "pay-success", s),
      ["active", "hidden"],
    ),
  columns: [
    ["image", "图片"],
    ["title", "标题"],
    ["badge", "角标"],
    ["color", "主题色"],
    ["detailText", "详情长图"],
    ["sort", "排序"],
    ["status", "状态"],
  ],
};
/** 校区打印机（IKBW0Q）：一校区一台小票机，绑定/换绑/测试打印/解绑。 */
const printersConfig: SectionConfig = {
  title: "打印机",
  eyebrow: "RECEIPT PRINTER",
  desc: "绑定本校区小票打印机（芯烨云）：支付成功自动出票，订单抽屉可补打；绑定后先测试打印验证连通。",
  loader: async () => {
    const rows = await api.printers();
    return {
      rows: rows.map((r) => ({
        ...r,
        createdAtText: fmtDateTime(r.createdAt),
      })),
      total: rows.length,
    };
  },
  columns: [
    ["name", "名称"],
    ["sn", "终端号 (SN)"],
    ["status", "状态"],
    ["createdAtText", "绑定时间"],
  ],
};
/** 促销活动（IKAHFF/ADR-0006）：限时秒杀菜单（IKB5PB 拆分）的表格配置。
 *  IKB5PA：状态 Tab（时间窗判定，服务端 state 过滤 + 角标）。 */
const promotionConfig: SectionConfig = {
  title: "限时秒杀",
  eyebrow: "PROMOTIONS",
  desc: "限时秒杀 / 临期特惠统一管理；进行中停用立即生效，无删除留审计。",
  loader: (query) => {
    const tab =
      PROMOTION_STATE_TABS.find((t) => t.key === statusFilter.value) ??
      PROMOTION_STATE_TABS[0];
    return api
      .promotions(query, tab.statuses.length ? tab.key : undefined)
      .then((res) => ({
        rows: res.items.map((p) => ({
          ...p,
          productName: p.product?.name ?? "—",
          typeText: PROMO_TYPE_TEXT[p.type] ?? p.type,
          priceText: `¥${fenToYuan(p.price)}`,
          basePriceText: p.product ? `¥${fenToYuan(p.product.price)}` : "—",
          windowText: promoWindowText(p),
          stateText: promoState(p),
        })),
        total: res.total,
      }));
  },
  statusTabs: PROMOTION_STATE_TABS,
  countsLoader: () =>
    countByStatus(
      (s) => api.promotions({ page: 1, pageSize: 1 }, s),
      ["live", "upcoming", "ended", "disabled"],
    ),
  columns: [
    ["productName", "商品"],
    ["typeText", "类型"],
    ["priceText", "促销价"],
    ["basePriceText", "商品现价"],
    ["windowText", "时间窗"],
    ["stateText", "状态"],
  ],
};
const createLabels: Record<string, string> = {
  products: "＋ 新建记录",
  categories: "＋ 新建类别",
  locations: "＋ 新建库位",
  marketing: "＋ 新建优惠券",
  // IKB5PB：营销拆分独立菜单（券/秒杀/支付广告位）
  coupons: "＋ 新建优惠券",
  banners: "＋ 新建 Banner",
  promotions: "＋ 新建促销",
  "pay-ads": "＋ 新建广告",
  campuses: "＋ 新建校区",
  buildings: "＋ 新建楼栋",
  staff: "＋ 新建员工账号",
  dispatch: "＋ 邀请调配",
  rules: "＋ 新建提成规则",
  accounts: "＋ 新建后台账号",
  // IKBW0Q：打印机板块新建 = 绑定打印机
  printers: "＋ 绑定打印机",
  // IKAJSY：群码上传（users 为只读板块，无新建入口）
  "wechat-groups": "＋ 上传群码",
};
const section = computed(() => String(route.params.section)),
  config = computed<SectionConfig>(() => {
    if (section.value === "dispatch")
      return dispTab.value === "leaves"
        ? dispatchLeavesConfig
        : dispatchInvitesConfig;
    if (section.value === "marketing") {
      if (mktTab.value === "promotions") return promotionConfig;
      // IKD6FI：营销地图非表格视图，空 loader 防误拉券列表
      if (mktTab.value === "map") return marketingMapConfig;
    }
    // IKBDK7：/promotions 独立菜单（IKB5PB 拆分）——漏接会回落 orders 列表
    if (section.value === "promotions") return promotionConfig;
    // IKAJSL：Banner 独立板块（总部导航）；校区 hq 分流校区配置
    if (section.value === "banners") return bannerConfig;
    // IKB5PB：支付广告位 = Banner 的 pay-success 子视图（独立菜单）
    if (section.value === "pay-ads") return payAdsConfig;
    // IKBW0Q：校区打印机（系统域，校区自管）
    if (section.value === "printers") return printersConfig;
    // IKCRS8：campuses 板块=纯校区管理（菜单仅 admin 可见，hq 走总部组）
    if (section.value === "campuses") return hqCampusesConfig;
    // IKAJSM → IKCJ46：官方商品库独立菜单（/official-products）走官方库视图
    if (section.value === "official-products" && isHqView.value)
      return hqProductsConfig;
    return configs[section.value] || configs.orders;
  }),
  canWriteSection = computed(() => canWrite(section.value)),
  /** 当前生效的新建按钮文案（营销板块按 tab 分：优惠券/Banner/促销）。 */
  createLabel = computed(() => {
    if (section.value === "marketing") {
      // IKD6FI：营销地图视图无新建语义（返回空串隐藏主按钮）
      if (mktTab.value === "map") return "";
      if (mktTab.value === "promotions") return createLabels.promotions;
    }
    // IKCRS8：campuses 板块校区建档限平台管理员（operations 无菜单入口，
    // 直敲路由仅只读，无新建按钮）
    if (section.value === "campuses" && isPlatformAdmin.value)
      return "＋ 新建校区";
    // IKCJ46：官方商品库菜单建档；商品管理菜单从官方库导入
    if (section.value === "official-products")
      return isHqView.value ? "＋ 官方库建档" : "从官方库导入";
    if (section.value === "products")
      return "从官方库导入";
    return createLabels[section.value] ?? "";
  }),
  canCreate = computed(
    () =>
      Boolean(createLabel.value) &&
      canWriteSection.value &&
      // IKC1AF：打印机编辑页形态——已有绑定时不再提供「再绑一台」入口
      (section.value !== "printers" || !rows.value.length),
  ),
  filtered = computed(() =>
    // 服务端分页 + 服务端 keyword 过滤（IK8W5X 契约收尾）：rows 即命中当前页；
    // 前端仅保留状态 tab 的展示级筛选。
    // IKAJSP：statusTabs 板块过滤已在服务端完成（Tab key 不是原始状态值，
    // 走页内筛选反而会把表筛空），直接透出。
    config.value.statusTabs
      ? rows.value
      : rows.value.filter((row) => {
          const record = row as unknown as Record<string, unknown>;
          return (
            statusFilter.value === "all" ||
            [record.status, record.statusText, String(record.online ?? "")].some(
              (value) => String(value ?? "").includes(statusFilter.value),
            )
          );
        }),
  ),
  totalPages = computed(() =>
    Math.max(1, Math.ceil(total.value / pageSize.value)),
  );
/** 全量断链审计（2026-09-05）：校区下拉只在真正消费 campus 参数的视图渲染。
 *  orders/users/audit 全视图（loader 走 campusQuery）；inventory 仅采购申请
 *  tab；marketing 仅营销地图 tab。库存总览/
 *  优惠券/秒杀按操作者本校区固定（hq 无这些板块权限，admin 跨校区走顶栏
 *  切换运营校区）——下拉渲染在那儿是选了也不生效的死控件。 */
const campusFilterVisible = computed(() => {
  if (!isPlatformAdmin.value) return false;
  if (["orders", "users", "audit", "recruit"].includes(section.value))
    return true;
  // IKFOPY：库存板块全视图（总览/流水/采购申请）校区可筛选——聚焦总部仓复用仓储页
  if (section.value === "inventory") return true;
  if (section.value === "marketing") return mktTab.value === "map";
  return false;
});
/** 2026-09-05 道哥：多页时展开页码序列（全站分页器共用）。
 *  ≤7 页直接展示 1..N；>7 页展示「首页 + 当前页窗口 + 末页」：
 *  窗口默认取当前页±1，靠近首/末页时向边缘展开（收敛为 1..5…N / 1…N-4..N），
 *  保证省略号只出现在被跳过的一侧、永不连续、序列无重复页码。 */
const pageList = computed<(number | "…")[]>(() => {
  const pages = totalPages.value;
  const cur = page.value;
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  // 窗口左右端点（含端点）：中间形态 1 … cur-1 cur cur+1 … N
  const start = Math.max(2, Math.min(cur - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(cur + 1, 5));
  const list: (number | "…")[] = [1];
  if (start > 2) list.push("…");
  for (let p = start; p <= end; p++) list.push(p);
  if (end < pages - 1) list.push("…");
  list.push(pages);
  return list;
});
/** Tab 角标计数（IKAJSP）：原始状态→数量，随 load() 并行刷新。 */
const statusCounts = ref<Record<string, number>>({});
function statusTabCount(tab: StatusTab) {
  const counts = statusCounts.value;
  const sum = (keys: string[]) =>
    keys.reduce((n, k) => n + (counts[k] ?? 0), 0);
  return tab.statuses.length
    ? sum(tab.statuses)
    : Object.values(counts).reduce((a, b) => a + b, 0);
}
/** IKB5PA：小列表 Tab 角标——各状态并行拉 total（pageSize=1 只要计数），
 *  单次失败回落 0 不阻塞。适用于无专用 counts 端点的板块。 */
async function countByStatus(
  fetch: (status: string) => Promise<{ total: number }>,
  statuses: string[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    statuses.map(async (s) => {
      const res = await fetch(s).catch(() => ({ total: 0 }));
      return [s, res.total] as const;
    }),
  );
  return Object.fromEntries(entries);
}
/** IKB5PA：当前 Tab 的服务端状态过滤值（无 tab 或「全部」= undefined 不过滤）。 */
function tabStatusOf(tabs: StatusTab[]): string | undefined {
  const tab = tabs.find((t) => t.key === statusFilter.value) ?? tabs[0];
  return tab.statuses.length ? tab.statuses.join(",") : undefined;
}
async function load() {
  loading.value = true;
  loadError.value = "";
  // IKAJSW：用户板块统计与楼栋下拉随列表加载（失败静默不阻塞）
  if (section.value === "users") {
    // IKAJSL：hq 视角楼栋下拉无意义（跨校区），跳过
    if (!isHqRole.value) void ensureBuildings();
    api
      .userStats(campusScope())
      .then((s) => (userStatsData.value = s))
      .catch(() => {});
  }
  // IKGI1C：打烊停单徽标随楼栋板块拉取（失败静默徽标隐藏）
  if (section.value === "buildings" && canWriteSection.value) void loadCloseState();
  // IKAJSL：hq 的校区下拉供筛选与表单（订单/用户/审计/校区管理）；
  // IKBW0A：Banner/广告位表单已无投放校区下拉，不再预载
  if (
    isPlatformAdmin.value &&
    // IKD6FJ/IKD6FI：采购申请与营销地图的 hq 跨校区视角同样要校区下拉；
    // IKEAGE：招募（campusFilterVisible 已含，此处补加载白名单——漏了会导致
    // 下拉只剩「全校区」）
    [
      "orders",
      "users",
      "audit",
      "campuses",
      "inventory",
      "marketing",
      "recruit",
    ].includes(section.value)
  )
    void ensureCampusOptions().catch(() => {});
  try {
    // IKAJSP：Tab 角标随列表并行拉取，计数失败静默（角标回落 0，不阻塞列表）
    const [result, counts] = await Promise.all([
      config.value.loader({
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
      }),
      config.value.countsLoader?.().catch(() => undefined) ??
        Promise.resolve(undefined),
    ]);
    rows.value = result.rows;
    total.value = result.total;
    if (counts) statusCounts.value = counts;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    loadError.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
/**
 * 商品类别管理（2026-08-19 独立菜单 grilling）：全局字典 name 唯一 +
 * sort 升序；有关联商品拒绝删除（提示先转移）。商品表单的分类下拉从
 * 这里动态取（原硬编码 4 个 option，与小程序端实际类别割裂）。
 */
const categories = ref<Category[]>([]);
async function loadCategories() {
  try {
    categories.value = await api.adminCategories();
    // 商品表单/编辑里 categoryId 若已不在字典（历史数据），归一到第一项避免空选
    const ids = new Set(categories.value.map((c) => c.id));
    if (productForm.value.categoryId && !ids.has(productForm.value.categoryId))
      productForm.value.categoryId = categories.value[0]?.id ?? "";
  } catch {
    /* 类别加载失败不阻塞商品列表 */
  }
}
watch(
  section,
  (s) => {
    // IKD6FG：分类筛选覆盖官方商品库/商品管理/库存，进页时备好类别字典；
    // 切板块重置三个筛选 ref，防跨板块选项串入（IKB5PA 同教训）
    if (["products", "official-products", "inventory", "categories"].includes(s))
      void loadCategories();
    // 库位字典（IKA0VG）：商品表单/库位管理共用
    if (s === "products" || s === "locations") void ensureLocations();
    categoryFilter.value = "";
    staffRoleFilter.value = "";
    orderDeliveryFilter.value = "";
  },
  { immediate: true },
);
/* ---------- 库位管理（IKA0VG）：字典 CRUD + 商品表单下拉选项 ---------- */
interface LocationItem {
  id: string;
  name: string;
  note: string;
  sort: number;
  createdAt: string;
}
const locationsCache = ref<LocationItem[]>([]);
async function ensureLocations(): Promise<LocationItem[]> {
  try {
    locationsCache.value = await api.adminLocations();
  } catch {
    /* 库位加载失败不阻塞商品表单（下拉退化为手填值） */
  }
  return locationsCache.value;
}
/** 商品表单库位下拉：字典 + 当前值兜底（历史数据不在字典时保留可选）。 */
function locationOptions(current?: string) {
  const names = locationsCache.value.map((l) => l.name);
  if (current && !names.includes(current)) names.unshift(current);
  return names.map((n) => ({
    value: n,
    label: n,
  }));
}
function locationPayload(d: Record<string, FormValue>) {
  return {
    name: String(d.name || "").trim(),
    note: String(d.note ?? "").trim(),
    sort: Number(d.sort ?? 0),
  };
}
function openLocationCreate() {
  openForm(
    {
      eyebrow: "NEW LOCATION",
      title: "新建库位",
      submit: "保存库位",
      done: "库位已创建",
      fields: [
        { key: "name", label: "库位名称", placeholder: "如：冷藏A / 常温B" },
        { key: "sort", label: "排序（越小越靠前）", type: "number" },
        { key: "note", label: "备注（选填）", placeholder: "如：靠门冰柜第2层" },
      ],
      save: async (d) => {
        if (!String(d.name || "").trim()) throw new Error("请填写库位名称");
        void (await api.createLocation(locationPayload(d)));
      },
    },
    { name: "", sort: 0, note: "" },
  );
}
function openLocationEdit(row: AdminRow) {
  selected.value = undefined;
  const record = row as unknown as LocationItem;
  openForm(
    {
      eyebrow: "EDIT LOCATION",
      title: "编辑库位",
      submit: "保存修改",
      done: "库位已更新",
      fields: [
        { key: "name", label: "库位名称" },
        { key: "sort", label: "排序（越小越靠前）", type: "number" },
        { key: "note", label: "备注（选填）" },
      ],
      save: async (d) => {
        if (!String(d.name || "").trim()) throw new Error("请填写库位名称");
        void (await api.updateLocation(record.id, locationPayload(d)));
      },
    },
    { name: record.name, sort: Number(record.sort ?? 0), note: record.note ?? "" },
  );
}
async function removeLocationRow() {
  if (!selected.value) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.deleteLocation(selected.value.id);
    notify("库位已删除");
    selected.value = undefined;
    await load();
  } catch (error) {
    confirmDelete.value = false;
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
function openCategoryCreate() {
  openForm(
    {
      eyebrow: "NEW CATEGORY",
      title: "新建商品类别",
      submit: "保存类别",
      done: "类别已创建",
      fields: [
        { key: "name", label: "类别名称", placeholder: "如：饮料" },
        { key: "sort", label: "排序（越小越靠前）", type: "number" },
        // 类别头图（IK9RX0）：小程序分类 tab 图标，无图时前端回退文字样式；
        // 落 COS app/category/（IK9VBM）
        { key: "image", label: "类别图片（清空保存 = 恢复默认图标）", type: "image", wide: true, folder: "app/category" },
        {
          key: "visible",
          label: "在小程序显示该分类（IKC9M4 类目开关：隐藏后 C 端全链路不露出）",
          type: "checkbox",
        },
      ],
      save: async (d) =>
        void (await api.adminCreateCategory({
          name: String(d.name ?? "").trim(),
          sort: Number(d.sort ?? 0),
          ...(d.image ? { image: String(d.image) } : {}),
          hidden: !d.visible,
        })),
    },
    { name: "", sort: (categories.value.length + 1) * 10, image: "", visible: true },
  );
}
function openCategoryEdit(row: AdminRow) {
  selected.value = undefined;
  const record = row as unknown as {
    id: string;
    name: string;
    sort: number;
    image?: string;
  };
  openForm(
    {
      eyebrow: "EDIT CATEGORY",
      title: "编辑商品类别",
      submit: "保存修改",
      done: "类别信息已更新",
      fields: [
        { key: "name", label: "类别名称" },
        { key: "sort", label: "排序（越小越靠前）", type: "number" },
        { key: "image", label: "类别图片", type: "image", wide: true, folder: "app/category" },
        {
          key: "visible",
          label: "在小程序显示该分类（隐藏后用户端全链路不露出）",
          type: "checkbox",
        },
      ],
      save: async (d) =>
        void (await api.adminUpdateCategory(record.id, {
          name: String(d.name ?? "").trim(),
          sort: Number(d.sort ?? 0),
          // IKC1AA：总是带 image——空串=清除自定义图（恢复默认图标）
          image: String(d.image ?? "").trim(),
          hidden: !d.visible,
        })),
    },
    {
      name: record.name,
      sort: Number(record.sort ?? 0),
      image: record.image ?? "",
      visible: !(record as { hidden?: boolean }).hidden,
    },
  );
}
/** 类目显隐快捷开关（IKC9M4）：一键切换 C 端可见性，商品数据不动。
 *  场景：类目资质审核期间隐藏「酒系列」等敏感类目，过审后一键恢复。 */
async function toggleCategoryVisible(row: Category) {
  try {
    const next = !(row.hidden ?? false);
    await api.adminUpdateCategory(row.id, { hidden: next });
    notify(next ? "分类已隐藏（用户端全链路不露出）" : "分类已显示");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
async function removeCategoryRow() {
  if (!selected.value) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.adminDeleteCategory(selected.value.id);
    notify("类别已删除");
    selected.value = undefined;
    await Promise.all([load(), loadCategories()]);
  } catch (error) {
    confirmDelete.value = false;
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
/** 重置到第 1 页并加载（页码变化由 [page, pageSize] watcher 接管，避免重复请求）。 */
function resetAndLoad() {
  if (page.value === 1) void load();
  else page.value = 1;
}
/** 页码跳转：输入越界时收敛到 [1, totalPages]。 */
function goJump() {
  const target = Math.trunc(Number(jumpTo.value));
  jumpTo.value = "";
  if (!Number.isFinite(target) || target < 1) return;
  page.value = Math.min(target, totalPages.value);
}
onMounted(load);
watch([page, pageSize], ([nextPage, nextSize], [prevPage, prevSize]) => {
  // 每页条数变化时先回到第 1 页再请求（本回合仅触发一次加载）
  if (nextSize !== prevSize && nextPage !== 1) {
    page.value = 1;
    return;
  }
  void load();
});
watch(
  () => route.query.q,
  (value) => {
    keyword.value = String(value ?? "");
  },
  { immediate: true },
);
/* 关键词搜索：防抖后随请求发送（服务端分页下每次输入都要重新取数） */
let suppressKeywordLoad = false;
watch(keyword, () => {
  // IKB3KE：切板块清空搜索词时不触发防抖重载（由板块切换统一重载一次）
  if (suppressKeywordLoad) {
    suppressKeywordLoad = false;
    return;
  }
  if (keywordTimer.value) clearTimeout(keywordTimer.value);
  keywordTimer.value = setTimeout(resetAndLoad, 350);
});
watch(statusFilter, () => resetAndLoad());
watch(
  () => route.params.section,
  () => {
    selected.value = undefined;
    selectedProductIds.value = [];
    dispTab.value = "leaves";
    mktTab.value = "coupons";
    // IKB3KE：搜索词跨板块串扰——切板块清空，各板块条件相互独立
    if (keyword.value) {
      suppressKeywordLoad = true;
      keyword.value = "";
    }
    // IKAJSP：订单 Tab key 不是通用状态值，切板块必须归位 all（值变时由
    // statusFilter watcher 接管重载，避免双请求）
    resetStatusFilterAndLoad();
  },
);
const STATUS_TEXT: Record<string, string> = {
  // IKDFIN：与财务 Tab 文案对齐（原「待复核/已支付」，两值仅财务账单外露）
  "pending-review": "待确认",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  confirmed: "已确认",
  paid: "已打款",
  active: "启用",
  // inactive：校区停用值（UpdateCampusDto active|inactive）——此前表里漏了，
  // 校区管理列表停用行原样显示英文（道哥 2026-09-14 截图反馈）
  inactive: "已停用",
  paused: "已暂停",
  disabled: "已停用",
  hidden: "已隐藏",
  // IKB5PA：状态 Tab 化后新增的展示值
  cancelled: "已取消",
  invited: "待响应",
  accepted: "已接受",
  online: "在线",
  offline: "离线",
  completed: "已完成",
};
/** 金额字段（契约：整数分），统一经 fenToYuan 展示为 ¥xx.xx。 */
const MONEY_KEYS = [
  "price",
  "originalPrice",
  "costPrice",
  "wholesalePrice",
  "payableAmount",
  "productAmount",
  "deliveryFee",
  "discount",
  "baseSalary",
  "commissionTotal",
  "commission",
  "adjustment",
  "payable",
  "amount",
  // IKAJSW：用户累计消费（分）
  "totalSpend",
  "threshold",
  "reward",
];
/** IKDEP0：商品详情图列表（images[] 去掉与主图重复的首图，空数组不渲染） */
function detailImages(p: Product): string[] {
  const list = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const main = p.image || "";
  return list.filter((src) => src !== main);
}
/** IKFSZJ：详情字段卡按 detailOrder 重排（列表列序/CSV 导出不受影响）；
     order 未覆盖的字段（如通栏的 itemsText）保持原序垫在最后 */
function detailCols(cols: [string, string][], order?: string[]) {
  if (!order) return cols;
  const map = new Map(cols.map((c) => [c[0], c] as const));
  const head = order
    .map((k) => map.get(k))
    .filter((c): c is [string, string] => Boolean(c));
  const rest = cols.filter((c) => !order.includes(c[0]));
  return [...head, ...rest];
}
function display(row: AdminRow, key: string) {
  const record = row as unknown as Record<string, unknown>;
  const v = record[key];
  // 订单毛利列（IKFTZ9）：口径同详情合计（实付分摊 − 成本），缺成本显示 —
  if (key === "marginTotal") {
    const total = orderMarginTotalOf(row as unknown as Order);
    return total == null ? "—" : `¥${fenToYuan(total)}`;
  }
  if (
    key === "status" &&
    (section.value === "products" || section.value === "official-products")
  )
    // IKB3K9：商品状态列中文化（在售/已下架/售罄）
    return (
      (
        {
          "on-sale": "在售",
          "off-sale": "已下架",
          "sold-out": "售罄",
        } as Record<string, string>
      )[String(v)] ?? String(v ?? "—")
    );
  if (key === "categoryId")
    // 类别字典 id → 名称（商品列表/抽屉展示）
    return (
      categories.value.find((c) => c.id === v)?.name ?? String(v ?? "—")
    );
  if (key === "hasElevator") return record.hasElevator ? "有电梯" : "无电梯";
  if (
    key === "color" &&
    ["marketing", "banners", "pay-ads"].includes(section.value)
  )
    // Banner 主题色（IKBDK7：/banners 与 /pay-ads 同样翻译）：预置键转中文，自定义 hex 原样
    return BANNER_COLOR_TEXT[String(v)] ?? String(v ?? "—");
  if (key === "gender")
    return (
      ({ male: "男生", female: "女生", mixed: "混合" } as Record<string, string>)[
        String(v)
      ] ?? (v || "—")
    );
  if (key === "product") {
    const product = record.product as { name?: string } | undefined;
    return product?.name ?? "—";
  }
  if (key === "buildingName") return v ?? "*";
  // 库位（IK9U40）：空 = 未配置
  if (key === "location") return v ? String(v) : "—";
  // Banner 图文详情列（IK9SNO）
  if (key === "contentText") return v ? String(v) : "—";
  if (key === "floor")
    return v === null || v === undefined || v === "" ? "*" : String(v);
  if (key === "expiresAt")
    // IKDCVO：null = 长期有效
    return v == null || v === "" ? "长期有效" : fmtDate(String(v));
  // IKDEN2：发放总量 null = 不限量（总量/剩余列同口径）
  if (key === "total" || key === "remain")
    return v == null || v === "" ? "不限量" : String(v);
  // IKDCVO：券品种/发放方式中文化；异业券不参与下单，面额/门槛显示 —
  if (key === "kind")
    return (
      ({ platform: "金额券", partner: "异业券" } as Record<string, string>)[
        String(v)
      ] ?? String(v ?? "—")
    );
  if (key === "trigger")
    return (
      (
        { manual: "手动领取", lottery: "转盘", signup: "注册发" } as Record<
          string,
          string
        >
      )[String(v)] ?? String(v ?? "—")
    );
  if (
    (key === "amount" || key === "threshold") &&
    record.kind === "partner"
  )
    return "—";
  if (typeof v === "boolean") return v ? "在线" : "离线";
  if (typeof v === "number" && MONEY_KEYS.includes(key))
    return `¥${fenToYuan(v)}`;
  if (key === "onTimeRate") return `${v}%`;
  if (key === "status" && typeof v === "string" && STATUS_TEXT[v])
    return STATUS_TEXT[v];
  if (
    [
      "createdAt",
      "startAt",
      "endAt",
      "effectiveAt",
      "confirmedAt",
      "paidAt",
      // IKAJSY：群码更新时间
      "updatedAt",
    ].includes(key)
  )
    return fmtDateTime(String(v));
  return v ?? "—";
}
function txnQuantity(row: AdminRow) {
  const txn = row as InventoryTxn;
  const v = txn.quantity ?? txn.delta;
  if (v === undefined || v === null) return "—";
  return txn.type === "adjust" && Number(v) > 0 ? `+${v}` : String(v);
}
function isStockIn(row: AdminRow) {
  return (row as InventoryTxn).type === "stock-in";
}
/** 订单行的原始 status（display 会做文案映射，按钮条件要原始值）。 */
function rowStatusOf(row: AdminRow): string {
  return String((row as unknown as Record<string, unknown>).status ?? "");
}
function rowKey(row: AdminRow): string {
  const record = row as unknown as Record<string, unknown>;
  return String(row.id ?? record.orderNo ?? record.staffNo ?? record.period ?? "");
}
function notify(text: string, isError = false) {
  message.value = text;
  messageError.value = isError;
  setTimeout(() => (message.value = ""), 2600);
}
function openDetail(row: AdminRow) {
  confirmDelete.value = false;
  inviteConfirmCancel.value = "";
  selected.value = { ...row };
  // IKEAGE：招募抽屉打开即回填补录编辑区（身份证号/照片/备注）
  if (section.value === "recruit") {
    const app = row as unknown as RecruitingApplication;
    recruitEdit.value = {
      idCardNo: app.idCardNo ?? "",
      idCardImages: Array.isArray(app.idCardImages) ? [...app.idCardImages] : [],
      staffRemark: app.staffRemark ?? "",
    };
    recruitApproveArmed.value = false;
  }
  // IKAJSW：用户抽屉打开即拉该用户订单流水（失败静默，抽屉显示暂无）
  if (section.value === "users") {
    userOrderRows.value = [];
    userOrdersLoading.value = true;
    api
      .userOrders(row.id)
      .then((rows) => (userOrderRows.value = rows))
      .catch(() => {})
      .finally(() => (userOrdersLoading.value = false));
  }
  if (isProductsSection.value) {
    const product = row as Product;
    productEdit.value = {
      // 资料字段（IKAHAT）：原值回填，改什么提交什么
      name: product.name || "",
      subtitle: product.subtitle || "",
      categoryId: product.categoryId || "",
      originalPrice: Number(fenToYuan(Number(product.originalPrice ?? 0))),
      tag: product.tag || "",
      weight: Number(product.weight ?? 0),
      // 接口价格为分，编辑框以元展示
      price: Number(fenToYuan(product.price)),
      // IKC1AC 价格三层 + IKC1AB 状态回填
      costPrice: Number(fenToYuan(Number(product.costPrice ?? 0))),
      wholesalePrice: Number(fenToYuan(Number(product.wholesalePrice ?? 0))),
      status: product.status === "off-sale" ? "off-sale" : "on-sale",
      stock: Number(product.availableStock ?? product.stock ?? 0),
      // 头图（IK9RWX）：编辑抽屉可上传替换，留空 = 不改图
      image: product.image || "",
      // 库位（IK9U40/IKA0VG）/详情多图（IK9SNS）
      location: product.location ?? "",
      locationCode: (product as Product & { locationCode?: string }).locationCode ?? "",
      images: Array.isArray(product.images) ? [...product.images] : [],
      // 单位属性（IKFOPU）回填；含量为 0/空的存量行按 1 展示
      retailUnit: product.retailUnit ?? "",
      wholesaleUnit: product.wholesaleUnit || "件",
      unitsPerCase: Number(product.unitsPerCase ?? 1) || 1,
      description: product.description ?? "",
    };
  }
  if (section.value === "after-sales")
    void ensureAfterSaleOrder(row as AfterSaleRow);
}
async function act(action: string) {
  if (!selected.value) return;
  try {
    if (isProductsSection.value) {
      // 名称空白就地拦截（IKAHAT），与后端「商品名称不能为空」同口径
      if (!productEdit.value.name.trim())
        throw new Error("商品名称不能为空");
      await api.updateProduct(selected.value.id, {
        // 资料字段（IKAHAT）：副标题/标签可清空，重量/分类有值才提交
        name: productEdit.value.name.trim(),
        subtitle: productEdit.value.subtitle.trim(),
        tag: productEdit.value.tag.trim(),
        // IKCIAA：官方库同步行的建议零售价校区只读——不提交（自建行/官方视角照常）
        ...(isHqView.value ||
        !(selected.value as Product)?.sourceProductId
          ? { originalPrice: yuanToFen(productEdit.value.originalPrice) }
          : {}),
        ...(productEdit.value.weight > 0
          ? { weight: productEdit.value.weight }
          : {}),
        // 单位属性（IKFOPU）：校区同步行只读不提交（自建行/官方视角照常）
        ...(isHqView.value ||
        !(selected.value as Product)?.sourceProductId
          ? {
              retailUnit: productEdit.value.retailUnit.trim(),
              wholesaleUnit: productEdit.value.wholesaleUnit.trim() || "件",
              unitsPerCase: Number(productEdit.value.unitsPerCase) || 1,
            }
          : {}),
        ...(productEdit.value.categoryId
          ? { categoryId: productEdit.value.categoryId }
          : {}),
        price: yuanToFen(productEdit.value.price),
        // IKC1AB：上下架（hq 官方库放行/回收、校区自管本地上架）
        status: productEdit.value.status,
        // IKC1AC：进货价仅官方库行提交（后端对校区行二次剔除）
        // IKFOPQ：批发价格官方行 + 校区自建行提交（同步行后端仍剔除）
        ...(isHqView.value
          ? {
              costPrice: yuanToFen(productEdit.value.costPrice),
              wholesalePrice: yuanToFen(productEdit.value.wholesalePrice),
            }
          : !(selected.value as Product)?.sourceProductId
            ? {
                wholesalePrice: yuanToFen(productEdit.value.wholesalePrice),
              }
            : {}),
        // IKC1AB 修缺陷：官方库回填的 stock 是恒 0 的 availableStock，
        // 无条件提交会把官方行库存静默写 0——与库位同口径按视角排除
        ...(isHqView.value ? {} : { stock: Number(productEdit.value.stock) }),
        // 头图仅在填了 URL 时提交（DTO 校验 http(s)，空串跳过 = 保持原图）
        ...(productEdit.value.image.trim()
          ? { image: productEdit.value.image.trim() }
          : {}),
        // 库位（IK9U40/IKA0VG）：空串语义清空回退默认；官方库无库位概念（IKAJSM）
        ...(isHqView.value
          ? {}
          : {
              location: productEdit.value.location.trim(),
              locationCode: productEdit.value.locationCode.trim(),
            }),
        // 详情多图（IK9SNS）：整组提交覆盖，空数组清空回退头图
        images: productEdit.value.images.filter(Boolean),
        // 商品介绍（IKAHAU）：整段覆盖，空串清空；trim 只去首尾空白保内换行
        description: productEdit.value.description.trim(),
      }, productView.value);
    } else if (section.value === "orders")
      await api.orderAction(selected.value.id, action);
    else if (section.value === "finance") {
      // 账单状态机：pending-review → confirm → pay；条件流转由后端校验
      if (action === "confirm") await api.confirmSettlement(selected.value.id);
      else await api.paySettlement(selected.value.id);
    }
    messageError.value = false;
    message.value = "操作成功，数据已同步";
    selected.value = undefined;
    await load();
    setTimeout(() => (message.value = ""), 2200);
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
async function exportData() {
  // 翻页聚合全量导出：当前关键词命中的所有行（fetchAllPages 上限 50 页 × 100 行）
  exporting.value = true;
  try {
  const all = await fetchAllPages(
    (query) =>
      config.value
        .loader({
          ...query,
          keyword: keyword.value.trim() || undefined,
        })
        .then((r) => ({
          items: r.rows,
          total: r.total,
          page: query.page,
          pageSize: query.pageSize,
        })),
    100,
  );
  const csv = [
    config.value.columns.map((c) => c[1]),
    ...all.map((row) =>
      config.value.columns.map((c) =>
        c[0] === "quantity" && section.value === "inventory"
          ? txnQuantity(row)
          : String(display(row, c[0])),
      ),
    ),
  ]
    .map((line) => line.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
  a.download = `${config.value.title}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  notify(`已导出 ${all.length} 行（当前筛选条件）`);
  } catch (error) {
    notify(error instanceof Error ? error.message : "导出失败", true);
  } finally {
    exporting.value = false;
  }
}
/** 手动新建商品表单（IKB3K9 与官方库导入并存）：hq=官方库建档，校区=本校区自建。 */
function openProductCreate() {
  creating.value = true;
  scanError.value = "";
  productForm.value = {
    barcode: "",
    name: "",
    subtitle: "",
    categoryId: "snack",
    price: 0,
    originalPrice: 0,
    costPrice: 0,
    wholesalePrice: 0,
    stock: 0,
    tag: "新品",
    image: "",
    location: "",
    locationCode: "",
    images: [],
    weight: 0,
    retailUnit: "",
    wholesaleUnit: "件",
    unitsPerCase: 1,
    description: "",
  };
}
function openCreate() {
  if (isProductsSection.value) {
    // IKB3K9 → IKCJ46：本校区视角主按钮官方库导入；官方库视角建档
    if (!isHqView.value) {
      openImportModal();
      return;
    }
    openProductCreate();
  } else if (section.value === "categories") openCategoryCreate();
  else if (section.value === "locations") openLocationCreate();
  else if (section.value === "marketing") {
    // IKAJSL：Banner 已拆独立板块（/banners），营销板块只剩券/促销
    if (mktTab.value === "promotions") openPromotionCreate();
    else openCouponCreate();
  }
  // IKB5PB：营销拆分独立菜单
  else if (section.value === "coupons") openCouponCreate();
  else if (section.value === "promotions") openPromotionCreate();
  else if (section.value === "pay-ads") openBannerCreate("pay-success");
  else if (section.value === "banners") openBannerCreate();
  // IKCRS8：校区建档=平台管理员；楼栋建档走独立 buildings 板块
  else if (section.value === "campuses") openCampusCreate();
  else if (section.value === "buildings") openBuildingCreate();
  else if (section.value === "staff") openStaffCreate();
  // IKBW0Q：打印机板块新建 = 绑定（已绑定时走行内/抽屉「换绑」）
  else if (section.value === "printers") openPrinterBind();
  else if (section.value === "dispatch") openInviteForm();
  else if (section.value === "rules") openRuleCreate();
  else if (section.value === "accounts") openAccountCreate();
  // IKAJSY：群码上传/替换
  else if (section.value === "wechat-groups") openWechatGroupForm();
}
function closeCreate() {
  stopScan();
  creating.value = false;
}
/* ---------- 官方库导入弹窗（IKAJSO）：搜索 + 多选 → 批量落地本校区 ---------- */
const importOpen = ref(false),
  importKeyword = ref(""),
  importLoading = ref(false),
  importRows = ref<Product[]>([]),
  importTotal = ref(0),
  importPage = ref(1),
  importSelected = ref<string[]>([]),
  importing = ref(false),
  importResult = ref<{
    importedCount: number;
    skipped: { name: string; reason: string }[];
  } | null>(null);
async function loadImportRows() {
  importLoading.value = true;
  try {
    const res = await api.officialProducts({
      page: importPage.value,
      pageSize: 50,
      keyword: importKeyword.value.trim() || undefined,
    });
    importRows.value = res.items;
    importTotal.value = res.total;
  } catch (error) {
    notify(error instanceof Error ? error.message : "官方库加载失败", true);
  } finally {
    importLoading.value = false;
  }
}
function openImportModal() {
  importOpen.value = true;
  importKeyword.value = "";
  importPage.value = 1;
  importSelected.value = [];
  importResult.value = null;
  void loadImportRows();
}
function searchImport() {
  importPage.value = 1;
  void loadImportRows();
}
function toggleImportSel(id: string) {
  importSelected.value = importSelected.value.includes(id)
    ? importSelected.value.filter((x) => x !== id)
    : [...importSelected.value, id];
}
async function submitImport() {
  if (!importSelected.value.length || importing.value) return;
  importing.value = true;
  try {
    const res = await api.importProducts(importSelected.value);
    importResult.value = {
      importedCount: res.importedCount,
      skipped: res.skipped.map(({ name, reason }) => ({ name, reason })),
    };
    importSelected.value = [];
    notify(`已导入 ${res.importedCount} 个商品（初始下架零库存，备货后上架）`);
    // 道哥 2026-09-10：导入成功即刷新弹窗列表——后端已过滤本校区已导入商品，
    // 刷新后刚导入的自动消失，无需关弹窗重开。当前页被清空时回退一页。
    await loadImportRows();
    if (!importRows.value.length && importPage.value > 1) {
      importPage.value -= 1;
      await loadImportRows();
    }
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "导入失败", true);
  } finally {
    importing.value = false;
  }
}
/** 一键拉取上游资料（IKAJSO）：不动本地售价/上下架/库存，角标清零。 */
async function pullUpstreamRow(row: AdminRow) {
  try {
    await api.pullUpstream(row.id);
    notify("已同步官方库最新资料（本地售价/上下架/库存未动）");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "拉取失败", true);
  }
}
/* ---------- 抽奖转盘编辑弹窗（IKD6FC）：开关 + 8 奖位逐项配置 ---------- */
const wheelEditOpen = ref(false),
  wheelSaving = ref(false),
  wheelCoupons = ref<Coupon[]>([]),
  wheelForm = ref<{ active: boolean; prizes: WheelPrizeInput[] }>({
    active: false,
    prizes: [],
});
function blankPrize(): WheelPrizeInput {
  return { type: "none", label: "", weight: 0 };
}
async function openWheelEdit() {
  wheelEditOpen.value = true;
  try {
    const [cfg, coupons] = await Promise.all([
      api.wheel(),
      api.coupons({ page: 1, pageSize: 200 }, "active"),
    ]);
    wheelCoupons.value = coupons.items;
    wheelForm.value = {
      active: cfg.active,
      prizes: Array.from({ length: 8 }, (_, i) => ({
        ...blankPrize(),
        ...(cfg.prizes[i] ?? {}),
      })),
    };
  } catch (error) {
    notify(error instanceof Error ? error.message : "转盘配置加载失败", true);
    wheelEditOpen.value = false;
  }
}
/** 类型切换时清掉不属于新类型的残留字段，避免脏数据提交。 */
function onWheelTypeChange(i: number) {
  const p = wheelForm.value.prizes[i];
  p.couponId = undefined;
  p.bizTitle = undefined;
  p.bizImage = undefined;
  p.bizNote = undefined;
  if (p.type === "coupon" && !p.label) p.label = "优惠券";
  if (p.type === "partner" && !p.label) p.label = "异业券";
  if (p.type === "none") p.label = "谢谢参与";
}
async function submitWheel() {
  if (wheelSaving.value) return;
  const form = wheelForm.value;
  if (form.active && form.prizes.every((p) => !(p.weight > 0))) {
    notify("开启活动至少要有一个奖位权重大于 0", true);
    return;
  }
  wheelSaving.value = true;
  try {
    await api.upsertWheel({
      active: form.active,
      prizes: form.prizes.map((p) => ({
        ...p,
        label: p.label.trim() || (p.type === "none" ? "谢谢参与" : ""),
        // partner 未选券时不下发空串 couponId（避免后端误判为配券）
        ...(p.type === "partner" && !p.couponId
          ? { couponId: undefined }
          : {}),
      })),
    });
    notify("转盘配置已保存");
    wheelEditOpen.value = false;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  } finally {
    wheelSaving.value = false;
  }
}
async function lookup() {
  const code = productForm.value.barcode.trim();
  if (!/^\d{8,14}$/.test(code)) {
    scanError.value = "请输入 8—14 位商品条码";
    return;
  }
  try {
    const result: BarcodeLookup = await api.lookupBarcode(
      code,
      productView.value,
    );
    if (result.found && result.exists !== false) {
      scanError.value = "该商品已存在，可直接编辑库存与价格";
      selected.value = {
        ...result.product,
        availableStock: result.product.stock,
      } as Product;
      closeCreate();
      return;
    }
    const found = result.product;
    productForm.value = {
      ...productForm.value,
      barcode: found.barcode ?? productForm.value.barcode,
      name: found.name ?? productForm.value.name,
      subtitle: found.subtitle ?? productForm.value.subtitle,
      categoryId: found.categoryId ?? productForm.value.categoryId,
      // 条码库带出的价格为分，表单以元回填
      price:
        found.price !== undefined
          ? Number(fenToYuan(found.price))
          : productForm.value.price,
      originalPrice:
        found.originalPrice !== undefined
          ? Number(fenToYuan(found.originalPrice))
          : productForm.value.originalPrice,
      stock: found.stock ?? productForm.value.stock,
      tag: found.tag ?? productForm.value.tag,
      image: found.image ?? productForm.value.image,
      location: found.location ?? productForm.value.location,
      weight: found.weight ?? productForm.value.weight,
    };
    scanError.value = result.found
      ? "已从公共条码库带出基础资料，请核对价格和库存"
      : "未匹配到商品资料，请补全后保存";
  } catch (error) {
    scanError.value = error instanceof Error ? error.message : "条码查询失败";
  }
}
async function startScan() {
  scanError.value = "";
  const Detector = window.BarcodeDetector;
  if (!Detector) {
    scanError.value = "当前浏览器不支持摄像头条码识别，请手工输入条码";
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
    });
    scanning.value = true;
    await new Promise(requestAnimationFrame);
    if (video.value) {
      video.value.srcObject = cameraStream;
      await video.value.play();
    }
    const detector = new Detector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
    });
    const detect = async () => {
      if (!scanning.value || !video.value) return;
      const codes = await detector.detect(video.value);
      if (codes[0]?.rawValue) {
        productForm.value.barcode = codes[0].rawValue;
        stopScan();
        await lookup();
        return;
      }
      requestAnimationFrame(detect);
    };
    requestAnimationFrame(detect);
  } catch {
    scanError.value = "无法使用摄像头，请检查浏览器权限或手工输入";
    stopScan();
  }
}
function stopScan() {
  scanning.value = false;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
}
async function saveProduct() {
  if (!productForm.value.name.trim()) {
    scanError.value = "请填写商品名称";
    return;
  }
  // 条码选填（IKFQQ0）：填了才校验 8-14 位数字，空值以 undefined 提交
  // （axios 序列化丢弃该字段 → 后端落 null，同校区可多个无码商品）
  const barcode = productForm.value.barcode.trim();
  if (barcode && !/^\d{8,14}$/.test(barcode)) {
    scanError.value = "条码必须是 8-14 位数字，或留空";
    return;
  }
  // 单位属性（IKFOPU）：官方库建档零售单位必填；含量空值兜底 1
  const retailUnit = productForm.value.retailUnit.trim();
  if (isHqView.value && !retailUnit) {
    scanError.value = "请填写零售单位（如 听/瓶/包）";
    return;
  }
  try {
    // 价格表单输元，提交前统一转分（IKC1AC：三层价格一并转分）
    await api.createProduct({
      ...productForm.value,
      barcode: barcode || undefined,
      retailUnit,
      wholesaleUnit: productForm.value.wholesaleUnit.trim() || "件",
      unitsPerCase: Number(productForm.value.unitsPerCase) || 1,
      price: yuanToFen(productForm.value.price),
      originalPrice: yuanToFen(productForm.value.originalPrice),
      costPrice: yuanToFen(productForm.value.costPrice),
      wholesalePrice: yuanToFen(productForm.value.wholesalePrice),
    }, productView.value);
    notify("SKU 已录入，商品数据已同步");
    closeCreate();
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  }
}
const couponPaused = computed(
  () =>
    Boolean(selected.value) &&
    String((selected.value as unknown as Record<string, unknown>).status) ===
      "paused",
);
function selectedStatus(): string {
  if (!selected.value) return "";
  return String(
    (selected.value as unknown as Record<string, unknown>).status ?? "",
  );
}
const settlementStatus = computed(() =>
  section.value === "finance" ? selectedStatus() : "",
);
const afterSaleStatus = computed(() =>
  section.value === "after-sales" ? selectedStatus() : "",
);
const inviteStatus = computed(() =>
  section.value === "dispatch" && dispTab.value === "invites"
    ? selectedStatus()
    : "",
);
const ruleActive = computed(
  () => section.value === "rules" && selectedStatus() === "active",
);
/** 订单履约（IK9U3Z）：出库动作已移交「仓储中心 · 仓库订单」，本页仅跟踪状态。 */
const orderInPicking = computed(
  () =>
    section.value === "orders" &&
    ["paid", "picking"].includes(selectedStatus()),
);
/** 履约凭证（IKA57U）：交接拍照 + 送达凭证，订单/仓库订单抽屉就地展示。 */
const orderProofs = computed(() => {
  const order = selected.value as unknown as Order | undefined;
  if (
    !order ||
    (section.value !== "orders" && section.value !== "warehouse-orders")
  )
    return [];
  return [
    ...(order.package?.handoverProof?.images ?? []),
    ...(order.package?.deliveredProof?.images ?? []),
  ].filter(Boolean);
});
/** 仓库订单抽屉的拣货清单（含商品库位指引，IK9U40/IKA0VG 区域-编号）。 */
const pickingItems = computed(() => {
  const order = selected.value as unknown as Order | undefined;
  if (section.value !== "warehouse-orders" || !order?.items) return [];
  return order.items.map((line) => ({
    name: line.product?.name ?? "未知商品",
    quantity: line.quantity,
    location:
      [
        line.product?.location ?? "",
        (line.product as { locationCode?: string } | undefined)
          ?.locationCode ?? "",
      ]
        .filter(Boolean)
        .join("-"),
  }));
});
/** 订单毛利合计（IKFTZ9）：实付分摊 − 进货成本；任一行缺成本返回 null（列表显示 —）。
 *  详情合计与列表毛利列共用同一口径。 */
function orderMarginTotalOf(order: MarginSource | undefined | null): number | null {
  const items = order?.items;
  if (!order || !items?.length) return null;
  const productAmount = Number(order.productAmount ?? 0);
  const payable = Number(order.payableAmount ?? 0);
  const deliveryFee = Number(order.deliveryFee ?? 0);
  // 优惠券按行金额比例分摊（运费不计入商品收入）；无优惠时系数为 1
  const factor =
    productAmount > 0 ? (payable - deliveryFee) / productAmount : 1;
  let total = 0;
  for (const line of items) {
    const cost = line.product?.unitPurchaseCost ?? line.product?.currentUnitPurchaseCost;
    if (cost == null) return null;
    const price = line.product?.price ?? 0;
    total += Math.round(price * line.quantity * factor) - cost * line.quantity;
  }
  return total;
}
/** 毛利计算的松散结构（列表行/详情选中行共用，避免 Order 交叉类型强转）。
 *  IKFTK7 第三轮：成本口径 = 进货价（快照 unitPurchaseCost 优先，历史单估算兜底） */
interface MarginSource {
  items?: Array<{
    quantity: number;
    product?: {
      price?: number;
      unitPurchaseCost?: number;
      currentUnitPurchaseCost?: number;
    };
  }> | null;
  productAmount?: unknown;
  payableAmount?: unknown;
  deliveryFee?: unknown;
}
const orderMarginItems = computed(() => {
  const order = selected.value as unknown as Order | undefined;
  if (section.value !== "orders" || !order?.items) return [];
  // IKFTK7 第二轮（道哥口径）：毛利 = 用户实付 − 成本。优惠券按行金额比例
  // 分摊到行（运费不计入商品收入）；无优惠时系数为 1，退化为售价口径
  const orderRec = order as unknown as Record<string, unknown>;
  const productAmount = Number(orderRec.productAmount ?? 0);
  const payable = Number(orderRec.payableAmount ?? 0);
  const deliveryFee = Number(orderRec.deliveryFee ?? 0);
  const factor =
    productAmount > 0 ? (payable - deliveryFee) / productAmount : 1;
  return order.items.map((line) => {
    // 快照优先（精确）；快照前历史单回落当前进货价（标注「估算」）
    const snapshot = line.product?.unitPurchaseCost;
    const cost = snapshot ?? line.product?.currentUnitPurchaseCost;
    const estimated = snapshot == null && cost != null;
    const price = line.product?.price ?? 0;
    // 行实收（分，四舍五入）＝售价×数量×实收系数
    const netFen = Math.round(price * line.quantity * factor);
    const marginFen = cost == null ? null : netFen - cost * line.quantity;
    return {
      name: line.product?.name ?? "未知商品",
      quantity: line.quantity,
      priceText: `¥${fenToYuan(price)}`,
      marginText:
        marginFen == null
          ? "—"
          : `¥${fenToYuan(marginFen)}${estimated ? "（估算）" : ""}`,
      hasMargin: cost != null,
      estimated,
    };
  });
});
/** 订单毛利合计（IKFTK7）：全部行都有成本才算得出，缺成本行时不显示合计 */
const orderMarginTotal = computed(() =>
  orderMarginTotalOf(selected.value as unknown as Order | undefined),
);
/** 确认出库（IKA0UQ）：paid/picking → waiting-first-mile 一步到位 + 出库流水。 */
async function outbound() {
  if (!selected.value) return;
  try {
    await api.orderAction(selected.value.id, "outbound");
    // IKBT6N：小票已改支付成功时自动打印，出库不再重复出票
    notify("已出库，订单转待配送，配送员可接单");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "出库失败", true);
  }
}
/** 补打小票（IKBT6N）：订单/拣货抽屉重推芯烨云打印（缺纸/卡纸兜底）。 */
const printing = ref(false);
async function reprintReceipt() {
  if (!selected.value || printing.value) return;
  printing.value = true;
  try {
    await api.printReceipt(selected.value.id);
    notify("小票已发送打印机");
  } catch (error) {
    notify(error instanceof Error ? error.message : "打印失败", true);
  } finally {
    printing.value = false;
  }
}
/** 列表内联出库（IKA0UT）：不进抽屉，一键出库。 */
async function outboundRow(row: AdminRow) {
  try {
    await api.orderAction(row.id, "outbound");
    notify("已出库，订单转待配送");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "出库失败", true);
  }
}
/* ---------- 校区打印机（IKBW0Q）：绑定/测试打印/解绑 ---------- */
/** 绑定/换绑表单（IKBW0Q）：SN 见机身底部标签/自检页；换绑覆盖本校区原绑定。
 *  IKC3FF：芯烨云无按台密钥，绑定只凭 SN（归属校验在云端）。 */
function openPrinterBind(row?: Printer) {
  openForm(
    {
      eyebrow: row ? "REBIND PRINTER" : "BIND PRINTER",
      title: row ? "换绑 / 改名" : "绑定打印机",
      submit: row ? "保存绑定" : "绑定",
      done: "打印机已绑定",
      fields: [
        { key: "name", label: "名称", placeholder: "例如：仓内前台小票机" },
        {
          key: "sn",
          label: "终端号 (SN)",
          placeholder: "机身底部标签 / 自检页上的 SN",
        },
        // IKD6H4：小票联数（IKCZOX 初版联序已调整）——1=单联无联名；
        // 2=商家联+客户联；3=再加骑手联
        {
          key: "copies",
          label: "打印联数",
          type: "select",
          wide: true,
          optional: true,
          options: () => [
            { value: "1", label: "1 联（单张小票）" },
            { value: "2", label: "2 联（商家联 + 客户联）" },
            { value: "3", label: "3 联（商家联 + 客户联 + 骑手联）" },
          ],
        },
        // IKFFHO：多联时两联之间的发送间隔——0=连续出纸（单次推送拼联，
        // 现状）；1-10 秒逐联推送（上一联受理后等 N 秒，留手撕/取联时间）。
        // 仅 2/3 联显示（道哥 2026-09-14）：单联无联间概念
        {
          key: "copiesGapSeconds",
          label: "联间间隔",
          type: "select",
          wide: true,
          optional: true,
          visible: (d) => Number(d.copies || 1) >= 2,
          options: () => [
            { value: "0", label: "0 秒（连续出纸）" },
            { value: "1", label: "间隔 1 秒" },
            { value: "2", label: "间隔 2 秒" },
            { value: "3", label: "间隔 3 秒" },
            { value: "4", label: "间隔 4 秒" },
            { value: "5", label: "间隔 5 秒" },
            { value: "6", label: "间隔 6 秒" },
            { value: "7", label: "间隔 7 秒" },
            { value: "8", label: "间隔 8 秒" },
            { value: "9", label: "间隔 9 秒" },
            { value: "10", label: "间隔 10 秒" },
          ],
        },
      ],
      save: async (d) => {
        if (!String(d.name || "").trim()) throw new Error("请填写名称");
        if (!String(d.sn || "").trim()) throw new Error("请填写终端号 (SN)");
        await api.bindPrinter({
          name: String(d.name).trim(),
          sn: String(d.sn).trim(),
          copies: Number(d.copies || 1),
          copiesGapSeconds: Number(d.copiesGapSeconds || 0),
        });
      },
    },
    {
      name: row?.name ?? "",
      sn: row?.sn ?? "",
      copies: String(row?.copies ?? 1),
      copiesGapSeconds: String(row?.copiesGapSeconds ?? 0),
    },
  );
}
/** 联数展示文案（IKD6H4）：1/2/3 联含义与绑定表单一致。 */
function printerCopiesLabel(row: Printer) {
  const n = row.copies ?? 1;
  if (n === 3) return "3 联（商家 + 客户 + 骑手）";
  if (n === 2) return "2 联（商家 + 客户）";
  return "1 联（单张小票）";
}
/** 测试打印（IKBW0Q）：行内/抽屉一键验证连通，云端失败原样提示。 */
async function testPrintRow(row: Printer) {  try {
    await api.testPrintPrinter(row.id);
    notify("测试小票已发送，请在打印机旁确认出纸");
  } catch (error) {
    notify(error instanceof Error ? error.message : "测试打印失败", true);
  }
}
/** 解绑（IKBW0Q）：两步确认，仅删本校区绑定记录（芯烨云侧保留，重绑幂等）。 */
async function unbindPrinterRow(row: Printer) {
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  try {
    await api.unbindPrinter(row.id);
    notify("打印机已解绑");
    selected.value = undefined;
    confirmDelete.value = false;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "解绑失败", true);
  }
}
/* ---------- 手动改订单状态（IKA0UT）：12 态白名单 + 原因进审计日志 ---------- */
const ORDER_STATUS_OPTIONS: Array<[string, string]> = [
  ["pending-payment", "等待支付"],
  ["paid", "仓库正在接单"],
  ["picking", "仓库正在拣货"],
  ["waiting-first-mile", "已出库，待配送员接单"],
  ["first-mile", "配送中"],
  ["waiting-handover", "已到楼下，等待楼长交接"],
  ["last-mile", "楼长送往寝室"],
  ["delivered", "已送达寝室"],
  ["completed", "已确认收货"],
  ["cancelled", "订单已取消"],
  ["exception", "履约异常"],
  ["refunded", "已退款"],
];
const statusDialogOpen = ref(false),
  statusDialogRow = ref<AdminRow>(),
  statusDialogValue = ref("paid"),
  statusDialogReason = ref(""),
  statusDialogSaving = ref(false);
function openStatusDialog(row: AdminRow) {
  const record = row as unknown as Record<string, unknown>;
  statusDialogRow.value = row;
  statusDialogValue.value = String(record.status ?? "paid");
  statusDialogReason.value = "";
  statusDialogOpen.value = true;
}
async function submitStatusDialog() {
  if (!statusDialogRow.value || statusDialogSaving.value) return;
  statusDialogSaving.value = true;
  try {
    await api.updateOrderStatus(
      statusDialogRow.value.id,
      statusDialogValue.value,
      statusDialogReason.value.trim(),
    );
    statusDialogOpen.value = false;
    notify("订单状态已更新（操作已记录进审计日志）");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "修改失败", true);
  } finally {
    statusDialogSaving.value = false;
  }
}
/* ---------- IKCJ3M：操作列直达——常用操作平铺行内（不再 ••• 进抽屉再选），
   危险操作（删除类）行内两击确认，行级记忆互不干扰 ---------- */
const confirmRowId = ref("");
function rowStatusText(row: AdminRow): string {
  return (row as unknown as { status?: string }).status ?? "";
}
/** ••• 详情保留板块（IKCKHU 续）：行内已覆盖全部操作的板块（banner/促销/券/
 *  类别/校区/员工/账号/财务/规则/群码删除外的营销类）不再显示 •••；
 *  保留的都是有额外详情内容或低频操作的：订单履约、商品编辑表单、
 *  售后留档、群码大图预览、只读板块（用户/审计/库位/流水）。 */
const DETAIL_SECTIONS: readonly string[] = [
  "orders",
  "warehouse-orders",
  "products",
  "official-products",
  "after-sales",
  "users",
  "audit",
  "locations",
  "inventory-txns",
  "wechat-groups",
  "dispatch",
  // IKEAGE：报名详情抽屉（资料补录 + 面试/审批操作）
  "recruit",
];
function rowConfirmFirst(id: string): boolean {
  if (confirmRowId.value !== id) {
    confirmRowId.value = id;
    return false;
  }
  confirmRowId.value = "";
  return true;
}
function rowDone(msg: string) {
  notify(msg);
  return load();
}
async function toggleBannerRow(row: AdminRow) {
  const next = (row as Banner).status === "hidden" ? "active" : "hidden";
  try {
    await api.updateBanner(row.id, { status: next });
    await rowDone(next === "hidden" ? "Banner 已隐藏" : "Banner 已启用");
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
async function removeBannerInline(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.deleteBanner(row.id);
    await rowDone("Banner 已删除");
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
async function toggleCouponRow(row: AdminRow) {
  const next = (row as Coupon).status === "paused" ? "active" : "paused";
  try {
    await api.updateCouponStatus(row.id, next);
    await rowDone(next === "paused" ? "优惠券已暂停发放" : "优惠券已启用");
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
/** 优惠券删除（IKDES1）：从未发放（claimed=0）才显示；行内两击确认。 */
async function removeCouponInline(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.deleteCoupon(row.id);
    await rowDone("优惠券已删除");
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
async function togglePromotionRow(row: AdminRow) {
  const record = row as unknown as Promotion;
  const next = record.status === "active" ? "disabled" : "active";
  try {
    await api.updatePromotion(record.id, { status: next });
    await rowDone(
      next === "disabled" ? "活动已停用，C 端立即回落原价" : "活动已启用",
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
/** 商品上下架快捷 toggle（IKC1AB：官方库放行/回收、校区自管本地上架） */
async function toggleProductStatusRow(row: Product) {
  const next = row.status === "on-sale" ? "off-sale" : "on-sale";
  try {
    await api.updateProduct(row.id, { status: next }, productView.value);
    await rowDone(next === "on-sale" ? "商品已上架" : "商品已下架");
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
/** 批量上下架（IKCKX4）：商品域勾选 → 工具条批量按钮。
 *  官方库/本校区同口径（上架/下架）；跨页勾选保留，切板块清空。 */
const selectedProductIds = ref<string[]>([]);
const batchWorking = ref(false);
const productSelectable = computed(
  () => isProductsSection.value && canWriteSection.value,
);
const allPageChecked = computed(
  () =>
    filtered.value.length > 0 &&
    filtered.value.every((row) => selectedProductIds.value.includes(row.id)),
);
/** 勾选列占用后 loading/空态行的 colspan 随之 +1 */
const tableColspan = computed(
  () => config.value.columns.length + 1 + (productSelectable.value ? 1 : 0),
);
function toggleProductCheck(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedProductIds.value = checked
    ? [...selectedProductIds.value, id]
    : selectedProductIds.value.filter((x) => x !== id);
}
function toggleAllProductChecks(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const pageIds = filtered.value.map((row) => row.id);
  selectedProductIds.value = checked
    ? [...new Set([...selectedProductIds.value, ...pageIds])]
    : selectedProductIds.value.filter((id) => !pageIds.includes(id));
}
async function batchApplyProductStatus(status: "on-sale" | "off-sale") {
  if (!selectedProductIds.value.length || batchWorking.value) return;
  const verb = status === "on-sale" ? "上架" : "下架";
  batchWorking.value = true;
  try {
    const result = await api.batchUpdateProductStatus(
      selectedProductIds.value,
      status,
      productView.value,
    );
    const skipped = selectedProductIds.value.length - result.count;
    selectedProductIds.value = [];
    await rowDone(
      `已${verb} ${result.count} 件商品${skipped > 0 ? `，${skipped} 件不在当前视角已跳过` : ""}`,
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : "批量操作失败", true);
  } finally {
    batchWorking.value = false;
  }
}
async function toggleRuleRow(row: AdminRow) {
  const rule = row as unknown as RuleRow;
  const next = rule.status === "active" ? "disabled" : "active";
  try {
    await api.updateCommissionRule(rule.id, { status: next });
    await rowDone(next === "active" ? "规则已启用" : "规则已停用");
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
async function confirmSettlementRow(row: AdminRow) {
  try {
    await api.confirmSettlement(row.id);
    await rowDone("账单已确认");
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
async function paySettlementRow(row: AdminRow) {
  try {
    await api.paySettlement(row.id);
    await rowDone("账单已标记打款");
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
async function reprintReceiptRow(row: AdminRow) {
  try {
    await api.printReceipt(row.id);
    notify("小票已发送打印机");
  } catch (error) {
    notify(error instanceof Error ? error.message : "打印失败", true);
  }
}
async function removeCategoryInline(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.adminDeleteCategory(row.id);
    await rowDone("类别已删除");
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
async function removeBuildingInline(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.deleteBuilding(row.id);
    await rowDone("楼栋已删除");
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
async function removeStaffInline(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.deleteStaff(row.id);
    await rowDone("员工已删除");
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
async function removeAccountInline(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.deleteAccount(row.id);
    await rowDone("账号已删除");
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
async function removeWechatGroupInline(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.deleteWechatGroup(row.id);
    await rowDone("群码已删除");
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", true);
  }
}
async function cancelInviteRow(row: AdminRow) {
  if (!rowConfirmFirst(row.id)) return;
  try {
    await api.cancelDispatchInvitation(row.id);
    await rowDone("调配邀请已取消");
  } catch (error) {
    notify(error instanceof Error ? error.message : "取消失败", true);
  }
}
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <h1>{{ config.title }}</h1>
        <p>{{ config.desc }}</p>
      </div>
      <div class="head-actions">
        <!-- 配送费配置（IK9SO6 → IKCRS8）：楼栋管理页入口（本校区，admin/operations）；
             校区管理页的逐校配置在校区编辑表单里 -->
        <!-- 打烊停单状态徽标（IKGI1C）：手动闭店 > 时间窗 > 营业中，北京时间本地判定 -->
        <span
          v-if="section === 'buildings' && canWriteSection && closeBadge"
          class="status"
          :class="closeBadge.tone"
        >
          {{ closeBadge.text }}
        </span>
        <button
          v-if="section === 'buildings' && canWriteSection"
          class="btn ghost"
          @click="openDeliveryConfig"
        >
          配送费配置
        </button>
        <!-- IKD6FC：抽奖转盘单例配置入口 -->
        <button
          v-if="section === 'wheel' && canWriteSection"
          class="btn primary"
          @click="openWheelEdit"
        >
          编辑奖池
        </button>
        <button v-if="canCreate" class="btn primary" @click="openCreate">
          {{ createLabel || "＋ 新建记录" }}
        </button>
        <!-- IKB3K9：校区商品双入口——手动自建与官方库导入并存 -->
        <button
          v-if="section === 'products' && !isHqView && canWriteSection"
          class="btn ghost"
          @click="openProductCreate"
        >
          ＋ 手动新建
        </button>
      </div>
    </div>
    <div class="toolbar">
      <!-- IKA0V2：库存与批次页的流水/拣货 tab 已拆独立菜单（出入库流水、仓库订单） -->
      <div v-if="section === 'dispatch'" class="segmented inv-tabs">
        <button :class="{ active: dispTab === 'leaves' }" @click="switchDispTab('leaves')">
          请假记录
        </button>
        <button :class="{ active: dispTab === 'invites' }" @click="switchDispTab('invites')">
          调配邀请
        </button>
      </div>
      <div v-if="section === 'marketing'" class="segmented inv-tabs">
        <button :class="{ active: mktTab === 'coupons' }" @click="switchMktTab('coupons')">
          优惠券
        </button>
        <button :class="{ active: mktTab === 'promotions' }" @click="switchMktTab('promotions')">
          促销活动
        </button>
        <!-- IKD6FI：营销地图（楼栋×楼层×寝室下单热力） -->
        <button :class="{ active: mktTab === 'map' }" @click="switchMktTab('map')">
          营销地图
        </button>
      </div>
      <!-- IKD6FJ：库存板块子视图——库存总览 / 采购申请审核台 -->
      <!-- IKCRS8：campusTab 双视角切换拆除——校区管理/楼栋管理已拆独立菜单 -->
      <!-- IKCHEW → IKCJ46：商品双视角改为独立菜单（官方商品库/商品管理），页内切换已移除 -->
      <!-- IKAJSL：Banner 已归总部（/banners 独立板块） -->
      <!-- IKAJSP：状态 Tab+计数（SectionConfig 通用能力）；IKFTZ9：订单板块
           状态改工具栏下拉（平铺 8 个 Tab 占位太宽），其余板块保持平铺 -->
      <div
        v-if="config.statusTabs && section !== 'orders'"
        class="status-tabs"
        role="tablist"
      >
        <button
          v-for="tab in config.statusTabs"
          :key="tab.key"
          type="button"
          role="tab"
          :aria-selected="statusFilter === tab.key"
          :class="{ active: statusFilter === tab.key }"
          @click="statusFilter = tab.key"
        >
          {{ tab.label }}<em>{{ statusTabCount(tab) }}</em>
        </button>
      </div>
      <div class="filter-search">
        <span></span
        ><input
          v-model.trim="keyword"
          aria-label="搜索数据"
          placeholder="搜索当前列表..."
        />
      </div>
      <!-- IKB5PA：通用「全部状态」下拉已移除——各板块状态过滤统一走
           statusTabs（服务端过滤+角标），无状态语义的板块不再渲染筛选器，
           彻底消除跨板块选项串入（售后出现「在线/离线」等）。 -->
      <select
        v-if="section === 'finance'"
        v-model="month"
        class="filter-btn"
        aria-label="账期筛选"
      >
        <option v-for="m in monthOptions" :key="m" :value="m">
          {{ m }} 账期
        </option>
      </select>
      <!-- IKAJSW：用户板块楼栋筛选（后端按地址命中聚合） -->
      <select
        v-if="section === 'users' && !isHqRole"
        v-model="userBuildingFilter"
        class="filter-btn"
        aria-label="楼栋筛选"
      >
        <option value="">全部楼栋</option>
        <option v-for="b in buildings" :key="b.id" :value="b.id">
          {{ b.name }}
        </option>
      </select>
      <!-- IKD6FG：分类筛选升级可搜索下拉（官方商品库/商品管理/库存共用；
           输入即按名称模糊过滤，选中回填名称，blur 关菜单）。
           IKDCGI：选项 mousedown.prevent 后焦点滞留 input，再次点击不再触发
           focus → 菜单打不开；@click 每次按下都触发，连续切换无需移开光标。
           全量断链审计（2026-09-05）：库存板块仅「库存总览」tab 消费
           categoryId，采购申请 tab 的 loader 不认——原渲染为死控件 -->
      <div
        v-if="
          ['products', 'official-products'].includes(section) ||
          section === 'inventory'
        "
        class="category-combobox"
      >
        <input
          :value="
            categorySearchOpen
              ? categorySearchText
              : selectedCategoryName || '全部分类'
          "
          :placeholder="categorySearchOpen ? '输入关键字过滤分类...' : ''"
          aria-label="分类筛选"
          role="combobox"
          :aria-expanded="categorySearchOpen"
          @focus="openCategorySearch"
          @click="openCategorySearch"
          @keydown.esc="
            categorySearchOpen = false;
            ($event.target as HTMLInputElement).blur();
          "
          @input="
            categorySearchText = ($event.target as HTMLInputElement).value;
            categorySearchOpen = true;
          "
          @blur="categorySearchOpen = false"
        />
        <ul
          v-if="categorySearchOpen"
          class="category-combobox__menu"
          role="listbox"
        >
          <li
            :class="{ active: !categoryFilter }"
            @mousedown.prevent="clearCategoryFilter"
          >
            全部分类
          </li>
          <li
            v-for="c in filteredCategoryOptions"
            :key="c.id"
            :class="{ active: categoryFilter === c.id }"
            @mousedown.prevent="pickCategory(c.id)"
          >
            {{ c.name }}
          </li>
          <li v-if="!filteredCategoryOptions.length" class="empty">
            无匹配分类
          </li>
        </ul>
      </div>
      <!-- IKD6FG：履约人员角色筛选 -->
      <select
        v-if="section === 'staff'"
        v-model="staffRoleFilter"
        class="filter-btn"
        aria-label="角色筛选"
      >
        <option value="">全部角色</option>
        <option v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value">
          {{ r.label }}
        </option>
      </select>
      <!-- IKFTZ9：订单状态改下拉（原平铺 Tab 收纳），选项带角标计数 -->
      <select
        v-if="section === 'orders' && config.statusTabs"
        v-model="statusFilter"
        class="filter-btn"
        aria-label="订单状态筛选"
      >
        <option v-for="tab in config.statusTabs" :key="tab.key" :value="tab.key">
          {{ tab.label }}（{{ statusTabCount(tab) }}）
        </option>
      </select>
      <!-- IKD6FG：订单配送方式筛选 -->
      <select
        v-if="section === 'orders'"
        v-model="orderDeliveryFilter"
        class="filter-btn"
        aria-label="配送方式筛选"
      >
        <option value="">全部配送方式</option>
        <option value="instant">即时达</option>
        <option value="scheduled">预约达</option>
      </select>
      <!-- IKAJSL → IKCHEW：平台视角的校区筛选（admin 同 hq；订单/用户/审计；
           IKD6FJ/IKD6FI：采购申请与营销地图同样支持跨校区）。
           全量断链审计（2026-09-05）：收敛到真正消费 campus 的视图——
           库存总览/优惠券/秒杀 tab 后端按操作者本校区固定，下拉原为死控件 -->
      <select
        v-if="campusFilterVisible"
        v-model="campusFilter"
        class="filter-btn"
        aria-label="校区筛选"
      >
        <option value="">全校区</option>
        <option v-for="c in campusOptionsData" :key="c.id" :value="c.id">
          {{ c.shortName || c.name }}
        </option>
      </select>
      <div class="toolbar-spacer"></div>
      <!-- 批量上下架（IKCKX4）：勾选商品后出现，官方库/本校区同口径 -->
      <template v-if="productSelectable && selectedProductIds.length">
        <button
          class="btn primary"
          :disabled="batchWorking"
          @click="batchApplyProductStatus('on-sale')"
        >
          批量上架（{{ selectedProductIds.length }}）
        </button>
        <button
          class="btn ghost"
          :disabled="batchWorking"
          @click="batchApplyProductStatus('off-sale')"
        >
          批量下架
        </button>
      </template>
      <!-- IKA0V2：采购入库为日常主操作排前；IKD6FJ：盘点入口（原「校准」
           文案统一为「盘点」）、校区角色「采购入库」变「采购申请」（平台角色保留直接入库） -->
      <template
        v-if="section === 'inventory' && canWrite('inventory')"
      >
        <button class="btn primary" @click="openStockForm('stock-in')">
          采购入库
        </button>
        <button class="btn ghost" @click="openStockForm('stocktake')">
          盘点
        </button>
      </template>
      <button class="btn ghost" @click="exportData">导出数据</button>
    </div>
    <div v-if="loadError" class="load-error">
      <span>加载失败：{{ loadError }}</span>
      <button class="btn ghost" @click="load">重试</button>
    </div>
    <div class="data-panel">
      <div class="data-summary">
        <!-- IKD6FI：营销地图视图摘要改为单量/金额口径 -->
        <div v-if="isMktMapTab">
          <strong>{{ mapData?.totals.orders ?? 0 }}</strong
          ><span> 单 · 近 {{ mapDays }} 天 · ¥{{
            fenToYuan(mapData?.totals.amount ?? 0)
          }}</span>
        </div>
        <div v-else>
          <strong>{{ total }}</strong
          ><span> 条记录</span>
        </div>
        <!-- IKAJSW：用户板块统计条（企微绑定率接入后追加） -->
        <p v-if="section === 'users' && userStatsData">
          <span class="live-dot"></span>
          总用户 {{ userStatsData.total }} · 今日新增 {{ userStatsData.todayNew }}
          · 本月活跃 {{ userStatsData.monthActive }} · 人均订单
          {{ userStatsData.avgOrders }} 单
        </p>
        <!-- IKDFIN：财务摘要——当月应结/已打款合计（随列表全量算出，分→元） -->
        <p v-else-if="section === 'finance'">
          <span class="live-dot"></span>
          当月应结 ¥{{ fenToYuan(financeTotals.payable, true) }} · 已打款 ¥{{
            fenToYuan(financeTotals.paid, true)
          }}
        </p>
        <p v-else>
          <span class="live-dot"></span>
          {{ section === "inventory-txns" ? "流水已同步" : "数据已同步" }}
        </p>
      </div>
      <!-- IKBW0Q/IKC1AF：打印机=编辑页形态（一校区一台），归属校区/绑定信息/
           测试打印/换绑/解绑一页完成，不再走表格 -->
      <div v-if="section === 'printers'" class="table-wrap">
        <div v-if="loading" class="row-skeleton"></div>
        <div v-else-if="!filtered.length" class="printer-view card">
          <p class="printer-view__hint">
            本校区还未绑定小票打印机。绑定后支付成功自动出票，订单抽屉可补打。
          </p>
          <button
            v-if="canWriteSection"
            class="btn primary"
            @click="openPrinterBind()"
          >
            ＋ 绑定打印机
          </button>
        </div>
        <div v-else class="printer-view card">
          <div class="drawer-fields">
            <div>
              <span>归属校区</span
              ><strong>{{ (filtered[0] as Printer).campusName || "—" }}</strong>
            </div>
            <div>
              <span>名称</span
              ><strong>{{ (filtered[0] as Printer).name }}</strong>
            </div>
            <div>
              <span>终端号 (SN)</span
              ><strong>{{ (filtered[0] as Printer).sn }}</strong>
            </div>
            <div>
              <span>状态</span
              ><strong>{{
                (filtered[0] as Printer).status === "active"
                  ? "已启用"
                  : "已停用"
              }}</strong>
            </div>
            <!-- IKCZOX：当前小票联数（换绑表单可改） -->
            <div>
              <span>打印联数</span
              ><strong>{{ printerCopiesLabel(filtered[0] as Printer) }}</strong>
            </div>
            <!-- IKFFHO：联间发送间隔——仅多联打印机展示（单联无联间概念） -->
            <div v-if="(filtered[0] as Printer).copies >= 2">
              <span>联间间隔</span
              ><strong>{{
                (filtered[0] as Printer).copiesGapSeconds
                  ? `${(filtered[0] as Printer).copiesGapSeconds} 秒`
                  : "连续出纸"
              }}</strong>
            </div>
            <div>
              <span>绑定时间</span
              ><strong>{{
                fmtDateTime((filtered[0] as Printer).createdAt)
              }}</strong>
            </div>
          </div>
          <p class="printer-view__hint">
            与校区为一对一绑定（一校区一台）；多校区账号请用顶栏切换后分别管理。
          </p>
          <div v-if="canWriteSection" class="printer-view__actions">
            <button
              class="btn primary"
              @click="testPrintRow(filtered[0] as Printer)"
            >
              测试打印
            </button>
            <button
              class="btn ghost"
              @click="openPrinterBind(filtered[0] as Printer)"
            >
              换绑 / 改名
            </button>
            <button
              class="btn danger-btn"
              @click="unbindPrinterRow(filtered[0] as Printer)"
            >
              {{ confirmDelete ? "确认解绑" : "解绑打印机" }}
            </button>
          </div>
        </div>
      </div>
      <!-- IKD6FI：营销地图——楼层卡 × 寝室格热力，替代表格视图 -->
      <div v-else-if="isMktMapTab" class="table-wrap">
        <div class="marketing-map">
          <div class="map-controls">
            <select v-model="mapBuildingId" class="filter-btn" aria-label="楼栋">
              <option value="">选择楼栋</option>
              <option v-for="b in buildings" :key="b.id" :value="b.id">
                {{ b.name }}
              </option>
            </select>
            <select
              v-model.number="mapDays"
              class="filter-btn"
              aria-label="统计天数"
            >
              <option :value="7">近 7 天</option>
              <option :value="30">近 30 天</option>
              <option :value="90">近 90 天</option>
            </select>
          </div>
          <p v-if="mapError" class="form-hint">{{ mapError }}</p>
          <p v-else-if="mapLoading" class="form-hint plain">
            正在统计下单数据...
          </p>
          <p v-else-if="!mapBuildingId" class="form-hint plain">
            选择楼栋后查看各楼层寝室的下单分布（格子越绿单量越高）。
          </p>
          <template v-else-if="mapData">
            <p class="map-legend">
              {{ mapData.building.name }} · 近 {{ mapData.days }} 天共
              {{ mapData.totals.orders }} 单 · ¥{{
                fenToYuan(mapData.totals.amount)
              }}
            </p>
            <div v-if="!mapData.floors.length" class="form-hint plain">
              该楼栋暂无订单记录。
            </div>
            <div
              v-for="floor in mapData.floors"
              :key="floor.floor"
              class="map-floor"
            >
              <div class="map-floor-head">
                <strong>{{ floor.floor }} 层</strong>
                <span
                  >{{ floor.orders }} 单 · ¥{{
                    fenToYuan(floor.amount)
                  }}</span
                >
              </div>
              <div class="map-room-grid">
                <div
                  v-for="cell in floor.rooms"
                  :key="cell.room"
                  class="map-room"
                  :class="mapCellClass(cell.orders)"
                >
                  <strong>{{ cell.room }}</strong>
                  <span>{{ cell.orders }} 单 · ¥{{ fenToYuan(cell.amount) }}</span>
                  <small>{{ cell.users }} 人下单</small>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <!-- 批量上下架（IKCKX4）：商品域可写时出现勾选列（全选=当前页） -->
              <th v-if="productSelectable" class="check-cell">
                <input
                  type="checkbox"
                  :checked="allPageChecked"
                  aria-label="全选当前页"
                  @change="toggleAllProductChecks"
                />
              </th>
              <th v-for="col in cols(config)" :key="col[0]">{{ col[1] }}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 6" :key="i">
              <td :colspan="tableColspan">
                <div class="row-skeleton"></div>
              </td>
            </tr>
            <template v-else>
              <tr v-if="!filtered.length">
                <td :colspan="tableColspan" class="empty-cell">
                  {{ loadError ? "加载失败，请重试" : "暂无数据" }}
                </td>
              </tr>
              <tr v-for="row in filtered" :key="rowKey(row)">
                <td v-if="productSelectable" class="check-cell">
                  <input
                    type="checkbox"
                    :checked="selectedProductIds.includes(row.id)"
                    :aria-label="`选择 ${display(row, 'name')}`"
                    @change="toggleProductCheck(row.id, $event)"
                  />
                </td>
                <td v-for="col in cols(config)" :key="col[0]">
                  <span
                    v-if="col[0] === 'typeText' && section === 'wheel'"
                    class="wheel-type"
                    :class="wheelTypeClass(row)"
                    >{{ display(row, "typeText") }}</span
                  ><span
                    v-else-if="col[0] === 'typeText' && section === 'inventory-txns'"
                    class="status"
                    :class="{ success: isStockIn(row) }"
                    >{{ display(row, "typeText") }}</span
                  ><span
                    v-else-if="['status', 'statusText', 'online'].includes(col[0])"
                    class="status"
                    :class="{
                      success: String(display(row, col[0])).match(
                        /在线|完成|active|on-sale|confirmed|approved|启用|已确认|已支付|已接受|已通过|在售/,
                      ),
                      warning: String(display(row, col[0])).match(
                        /待|pending|paused|已暂停|复核|已下架|售罄/,
                      ),
                    }"
                    >{{ display(row, col[0]) }}</span
                  ><!-- IKDG8V：用户列表手机号列可点——按需单查明文（后端
                       审计留痕），本地缓存到刷新，再点收回打码 --><span
                    v-else-if="
                      col[0] === 'phoneMasked' &&
                      section === 'users' &&
                      String(display(row, 'phoneMasked')).includes('****')
                    "
                    class="phone-reveal"
                    :class="{
                      'phone-reveal--shown': revealedPhones.get(row.id),
                    }"
                    title="点击查看完整手机号"
                    @click="togglePhone(row)"
                    >{{
                      revealedPhones.get(row.id) ||
                      display(row, "phoneMasked")
                    }}</span
                  ><!-- IKAJSO：导入商品名旁亮「上游已更新」角标，抽屉/行内可一键拉取 -->
                  <template
                    v-else-if="col[0] === 'name' && isProductsSection"
                    ><strong>{{ display(row, "name") }}</strong
                    ><span
                      v-if="(row as Product).upstreamChanged"
                      class="status warning upstream-badge"
                      >上游已更新</span
                    ></template
                  ><!-- IKBW0C：订单号末 8 位（用户端可见部分）高亮，客服与客户可肉眼对读 -->
                  <strong
                    v-else-if="
                      col[0] === 'orderNo' &&
                      (section === 'orders' || section === 'warehouse-orders')
                    "
                    class="order-no"
                    :title="String(display(row, 'orderNo'))"
                    >…<span class="order-no__tail">{{
                      String(display(row, "orderNo")).slice(-8)
                    }}</span></strong
                  ><strong v-else-if="['name', 'orderNo', 'staffName'].includes(col[0])"
                    >{{ display(row, col[0]) }}</strong
                  ><!-- 2026-09-19 道哥：商品列单行摘要+悬停全部（IKBW0C/D 多行版退役） --><span
                    v-else-if="col[0] === 'itemsText'"
                    class="cell-ellipsis"
                    :title="String(display(row, 'itemsText')).split('\n').join('、')"
                    >{{ display(row, "itemsBrief") }}</span
                  ><!-- 订单用户列：主行手机号（tabular-nums 对读），次行楼栋房号 --><span
                    v-else-if="col[0] === 'userText'"
                    class="user-cell"
                    ><strong class="user-cell__phone">{{
                      String(display(row, "userText")).split("\n")[0]
                    }}</strong
                    ><span
                      v-if="String(display(row, 'userText')).includes('\n')"
                      class="user-cell__addr"
                      >{{ String(display(row, "userText")).split("\n")[1] }}</span
                    ></span
                  ><!-- 流水数量列（含 IKA0UQ 出库负数） --><span
                    v-else-if="col[0] === 'quantity' && section === 'inventory-txns'"
                    >{{ txnQuantity(row) }}</span
                  ><!-- 图片列（IK9RX0 类别图；IKDEP0 商品列复用）：有图缩略、点击看大图，无图占位 -->
                  <img
                    v-else-if="col[0] === 'image' && display(row, 'image') !== '—'"
                    class="cell-thumb cell-thumb--zoom"
                    :src="resolveImageUrl(String(display(row, 'image')))"
                    alt="图片"
                    loading="lazy"
                    @click="previewImage = resolveImageUrl(String(display(row, 'image')))"
                  /><span v-else>{{ display(row, col[0]) }}</span>
                </td>
                <td class="row-actions">
                  <!-- IKA0UT：订单类列表常用操作内联最右侧，一步可达 -->
                  <template
                    v-if="
                      (section === 'orders' || section === 'warehouse-orders') &&
                      canWriteSection
                    "
                  >
                    <button
                      v-if="['paid', 'picking'].includes(rowStatusOf(row))"
                      class="btn mini primary"
                      @click="outboundRow(row)"
                    >
                      出库
                    </button>
                    <button
                      v-if="section === 'orders'"
                      class="btn mini ghost"
                      @click="openStatusDialog(row)"
                    >
                      改状态
                    </button>
                    <!-- IKCJ3M：补打小票行内直达（缺纸/卡纸兜底高频） -->
                    <button
                      v-if="section === 'orders'"
                      class="btn mini ghost"
                      @click="reprintReceiptRow(row)"
                    >
                      补打
                    </button>
                  </template>
                  <!-- IKCJ3M：Banner/广告位——编辑/显隐/删除行内直达 -->
                  <template
                    v-else-if="
                      (section === 'banners' || section === 'pay-ads') &&
                      canWriteSection
                    "
                  >
                    <button
                      class="btn mini primary"
                      @click="openBannerEdit(row)"
                    >
                      编辑
                    </button>
                    <button class="btn mini ghost" @click="toggleBannerRow(row)">
                      {{ (row as Banner).status === "hidden" ? "启用" : "隐藏" }}
                    </button>
                    <button
                      class="btn mini danger-btn"
                      @click="removeBannerInline(row)"
                    >
                      {{ confirmRowId === row.id ? "确认删除" : "删除" }}
                    </button>
                  </template>
                  <!-- IKCJ3M：商品——上下架快捷 toggle（官方库放行/回收同口径） -->
                  <template
                    v-else-if="
                      (section === 'products' ||
                        section === 'official-products') &&
                      canWriteSection
                    "
                  >
                    <button
                      class="btn mini ghost"
                      @click="toggleProductStatusRow(row as Product)"
                    >
                      {{ (row as Product).status === "on-sale" ? "下架" : "上架" }}
                    </button>
                    <button
                      v-if="
                        !isHqView && (row as Product).upstreamChanged
                      "
                      class="btn mini primary"
                      @click="pullUpstreamRow(row)"
                    >
                      拉取更新
                    </button>
                  </template>
                  <!-- IKD6FG → IKFOQ1：库存行内直达（预填本行商品）；
                       采购申请退役，「申请」恢复「入库」，补货走采购管理 -->
                  <template
                    v-else-if="section === 'inventory' && canWriteSection"
                  >
                    <button
                      class="btn mini primary"
                      @click="openStockForm('stock-in', (row as Product).id)"
                    >
                      入库
                    </button>
                    <button
                      class="btn mini ghost"
                      @click="openStockForm('stocktake', (row as Product).id)"
                    >
                      盘点
                    </button>
                  </template>
                  <!-- IKCJ3M：促销——编辑/停启行内直达（独立菜单 + marketing tab 双入口） -->
                  <template
                    v-else-if="
                      (section === 'promotions' ||
                        (section === 'marketing' && mktTab === 'promotions')) &&
                      canWriteSection
                    "
                  >
                    <button
                      class="btn mini primary"
                      @click="openPromotionEdit(row)"
                    >
                      编辑
                    </button>
                    <button
                      class="btn mini ghost"
                      @click="togglePromotionRow(row)"
                    >
                      {{
                        (row as unknown as Promotion).status === "active"
                          ? "停用"
                          : "启用"
                      }}
                    </button>
                  </template>
                  <!-- IKCJ3M：优惠券——暂停/启用 + 定向发放行内直达 -->
                  <template
                    v-else-if="
                      (section === 'coupons' ||
                        (section === 'marketing' && mktTab === 'coupons')) &&
                      canWriteSection
                    "
                  >
                    <button class="btn mini ghost" @click="toggleCouponRow(row)">
                      {{
                        (row as Coupon).status === "paused" ? "启用" : "暂停"
                      }}
                    </button>
                    <!-- IKDERC 跟进：编辑入口暂隐藏（道哥 2026-09-04），恢复 = 删除 v-if="false" -->
                    <button
                      v-if="false"
                      class="btn mini ghost"
                      @click="openCouponEdit(row as Coupon)"
                    >
                      编辑
                    </button>
                    <button
                      class="btn mini primary"
                      @click="openIssue(row as Coupon)"
                    >
                      定向发放
                    </button>
                    <button
                      v-if="!(row as Coupon).claimed"
                      class="btn mini danger-btn"
                      @click="removeCouponInline(row)"
                    >
                      {{ confirmRowId === row.id ? "确认删除？" : "删除" }}
                    </button>
                  </template>
                  <!-- IKC9M4 + IKCJ3M：类别显隐开关 + 编辑/删除直达 -->
                  <template
                    v-else-if="section === 'categories' && canWriteSection"
                  >
                    <button
                      class="btn mini ghost"
                      @click="toggleCategoryVisible(row as Category)"
                    >
                      {{ (row as Category).hidden ? "显示" : "隐藏" }}
                    </button>
                    <button
                      class="btn mini primary"
                      @click="openCategoryEdit(row)"
                    >
                      编辑
                    </button>
                    <button
                      class="btn mini danger-btn"
                      @click="removeCategoryInline(row)"
                    >
                      {{ confirmRowId === row.id ? "确认删除" : "删除" }}
                    </button>
                  </template>
                  <!-- IKCJ3M/IKCRS8：校区管理与楼栋管理拆独立板块；
                       校区写操作限平台管理员（后端 controller 同口径） -->
                  <template
                    v-else-if="
                      section === 'campuses' && isPlatformAdmin && canWriteSection
                    "
                  >
                    <button
                      class="btn mini primary"
                      @click="openCampusEdit(row)"
                    >
                      编辑
                    </button>
                  </template>
                  <template
                    v-else-if="section === 'buildings' && canWriteSection"
                  >
                    <button
                      class="btn mini primary"
                      @click="openBuildingEdit(row as Building)"
                    >
                      编辑
                    </button>
                    <button
                      class="btn mini ghost"
                      @click="openRooms(row as Building)"
                    >
                      寝室
                    </button>
                    <button
                      class="btn mini danger-btn"
                      @click="removeBuildingInline(row)"
                    >
                      {{ confirmRowId === row.id ? "确认删除" : "删除" }}
                    </button>
                  </template>
                  <!-- IKCJ3M：员工——编辑/删除行内直达（实现为软删除，对用户只说删除） -->
                  <template v-else-if="section === 'staff' && canWriteSection">
                    <button
                      class="btn mini primary"
                      @click="openStaffEdit(row as Staff)"
                    >
                      编辑
                    </button>
                    <button
                      class="btn mini danger-btn"
                      @click="removeStaffInline(row)"
                    >
                      {{ confirmRowId === row.id ? "确认删除" : "删除" }}
                    </button>
                  </template>
                  <!-- IKCJ3M：账号——编辑/改密/删除行内直达 -->
                  <template
                    v-else-if="section === 'accounts' && canWriteSection"
                  >
                    <button
                      class="btn mini primary"
                      @click="openAccountEdit(row)"
                    >
                      编辑
                    </button>
                    <button
                      class="btn mini ghost"
                      @click="openAccountResetPassword(row)"
                    >
                      改密
                    </button>
                    <button
                      class="btn mini danger-btn"
                      @click="removeAccountInline(row)"
                    >
                      {{ confirmRowId === row.id ? "确认删除" : "删除" }}
                    </button>
                  </template>
                  <!-- IKCJ3M：财务账单——确认/打款状态机直达（未到状态禁用） -->
                  <template v-else-if="section === 'finance' && canWriteSection">
                    <button
                      class="btn mini primary"
                      :disabled="rowStatusText(row) !== 'pending-review'"
                      @click="confirmSettlementRow(row)"
                    >
                      确认
                    </button>
                    <button
                      class="btn mini ghost"
                      :disabled="rowStatusText(row) !== 'confirmed'"
                      @click="paySettlementRow(row)"
                    >
                      打款
                    </button>
                  </template>
                  <!-- IKCJ3M：提成规则停启直达 -->
                  <template v-else-if="section === 'rules' && canWriteSection">
                    <button class="btn mini ghost" @click="toggleRuleRow(row)">
                      {{
                        (row as unknown as RuleRow).status === "active"
                          ? "停用"
                          : "启用"
                      }}
                    </button>
                  </template>
                  <!-- IKCJ3M：微信群码删除直达 -->
                  <template
                    v-else-if="section === 'wechat-groups' && canWriteSection"
                  >
                    <button
                      class="btn mini danger-btn"
                      @click="removeWechatGroupInline(row)"
                    >
                      {{ confirmRowId === row.id ? "确认删除" : "删除" }}
                    </button>
                  </template>
                  <!-- IKCJ3M：调配邀请取消直达（两击确认） -->
                  <button
                    v-else-if="
                      section === 'dispatch' &&
                      dispTab === 'invites' &&
                      canWriteSection &&
                      (row as unknown as DispatchRow).status === 'invited'
                    "
                    class="btn mini danger-btn"
                    @click="cancelInviteRow(row)"
                  >
                    {{ confirmRowId === row.id ? "确认取消" : "取消邀请" }}
                  </button>
                  <button
                    v-if="DETAIL_SECTIONS.includes(section)"
                    class="btn mini ghost"
                    aria-label="查看详情"
                    title="查看详情"
                    @click="openDetail(row)"
                  >
                    详情
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <!-- IKD6FI：营销地图视图无分页语义 -->
      <div v-if="!isMktMapTab" class="pagination">
        <span
          >第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span
        >
        <div class="pager-right">
          <label class="page-mode"
            >每页
            <select
              v-model.number="pageSize"
              aria-label="每页条数"
              @change="page = 1"
            >
              <option v-for="size in PAGE_SIZES" :key="size" :value="size">
                {{ size }} 条
              </option>
            </select>
          </label>
          <div>
            <button :disabled="page === 1" @click="page--">←</button
            ><!-- 2026-09-05 道哥：多页时展开页码序列（pageList：≤7 全展示，
                 >7 首末页+当前页窗口，边界收敛规则见 script 注释）；
                 页码可点、当前页高亮，'…' 为不可点占位 --><template
              v-for="(p, i) in pageList"
              :key="`${i}-${p}`"
              ><button
                v-if="p !== '…'"
                :class="{ active: p === page }"
                @click="page = p"
              >
                {{ p }}
              </button>
              <span v-else class="pager-ellipsis">…</span></template
            ><button :disabled="page === totalPages" @click="page++">→</button>
          </div>
          <label class="page-mode"
            >跳至
            <input
              v-model.number="jumpTo"
              class="page-jump"
              type="number"
              min="1"
              :max="totalPages"
              aria-label="页码跳转"
              @keyup.enter="goJump"
            />
            页<button @click="goJump">GO</button>
          </label>
        </div>
      </div>
    </div>
    <div v-if="selected" class="drawer-mask" @click.self="selected = undefined">
      <!-- IKFOQ4（道哥反馈「订单详情弹框窄不大方」）：订单/仓储订单详情加宽至 640 -->
      <aside
        class="drawer"
        :class="{
          'product-create': section === 'after-sales',
          'order-detail': section === 'orders' || section === 'warehouse-orders',
          'product-detail':
            section === 'inventory' ||
            section === 'products' ||
            section === 'official-products',
        }"
      >
        <div class="drawer-head">
          <div>
            <h2>记录详情与操作</h2>
          </div>
          <button aria-label="关闭" @click="selected = undefined">×</button>
        </div>
        <!-- 售后详情（IK97FJ）：类型文案 + 凭证图片 + 关联订单 -->
        <template v-if="section === 'after-sales'">
          <div class="drawer-fields">
            <div>
              <span>售后单号</span><strong>{{ selected.id }}</strong>
            </div>
            <div>
              <span>处理状态</span
              ><strong
                ><span
                  class="status"
                  :class="{
                    success: afterSaleStatus === 'approved',
                    warning: afterSaleStatus === 'pending',
                  }"
                  >{{ display(selected, "status") }}</span
                ></strong
              >
            </div>
            <div>
              <span>售后类型</span
              ><strong>{{ (selected as AfterSaleRow).typeText }}</strong>
            </div>
            <div>
              <span>申请时间</span
              ><strong>{{ display(selected, "createdAt") }}</strong>
            </div>
            <div>
              <span>用户</span
              ><strong>{{ (selected as AfterSaleRow).userId }}</strong>
            </div>
            <div>
              <span>关联订单号</span
              ><strong>{{
                afterSaleOrder?.orderNo || (selected as AfterSaleRow).orderId
              }}</strong>
            </div>
            <div>
              <span>订单状态</span><strong>{{ afterSaleOrderStatus }}</strong>
            </div>
            <div>
              <span>实付金额</span><strong>{{ afterSaleOrderAmount }}</strong>
            </div>
            <div class="wide">
              <span>问题描述</span
              ><strong class="desc-full">{{
                (selected as AfterSaleRow).description || "—"
              }}</strong>
            </div>
          </div>
          <div
            v-if="(selected as AfterSaleRow).images?.length"
            class="proof-block"
          >
            <span class="proof-label">问题凭证</span>
            <div class="proof-grid">
              <img
                v-for="(src, i) in (selected as AfterSaleRow).images"
                :key="i"
                :src="resolveImageUrl(src)"
                :alt="`凭证 ${i + 1}`"
                loading="lazy"
                @click="previewImage = resolveImageUrl(src)"
              />
            </div>
          </div>
        </template>
        <!-- 用户详情（IKAJSW）：聚合信息 + 该用户订单流水 -->
        <template v-else-if="section === 'users'">
          <div class="drawer-fields">
            <div>
              <span>昵称</span><strong>{{ (selected as AdminUser).nickname }}</strong>
            </div>
            <div>
              <span>手机号</span
              ><strong>{{ (selected as AdminUser).phoneMasked }}</strong>
            </div>
            <div>
              <span>OpenID</span
              ><strong>{{ (selected as AdminUser).openidMasked || "—" }}</strong>
            </div>
            <div>
              <span>默认地址</span
              ><strong>{{
                (selected as AdminUser).buildingName
                  ? `${(selected as AdminUser).buildingName} ${(selected as AdminUser).room}`
                  : "未设置"
              }}</strong>
            </div>
            <div>
              <span>订单数 / 累计消费</span
              ><strong
                >{{ (selected as AdminUser).orderCount }} 单 · ¥{{
                  fenToYuan((selected as AdminUser).totalSpend)
                }}</strong
              >
            </div>
            <div>
              <span>注册时间</span
              ><strong>{{ display(selected, "createdAt") }}</strong>
            </div>
          </div>
          <div class="user-orders">
            <p class="proof-label">订单流水（近 50 单）</p>
            <p v-if="userOrdersLoading" class="empty-cell">加载中…</p>
            <p v-else-if="!userOrderRows.length" class="empty-cell">
              暂无订单
            </p>
            <table v-else>
              <thead>
                <tr><th>订单号</th><th>状态</th><th>实付</th><th>时间</th></tr>
              </thead>
              <tbody>
                <tr v-for="o in userOrderRows" :key="o.id">
                  <td>{{ o.orderNo }}</td>
                  <td>
                    <span class="status">{{ o.statusText }}</span>
                  </td>
                  <td>¥{{ fenToYuan(o.payableAmount) }}</td>
                  <td>{{ fmtDateTime(o.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <!-- 楼长招募详情（IKEAGE）：报名信息 / 审核资料 / 审核操作 三段分区 -->
        <template v-else-if="section === 'recruit'">
          <p class="drawer-sec">报名信息</p>
          <div class="drawer-fields drawer-fields--three">
            <div>
              <span>姓名</span><strong>{{ recruitApp?.name }}</strong>
            </div>
            <div>
              <span>手机号</span
              ><strong
                ><a :href="`tel:${recruitApp?.phone}`">{{
                  recruitApp?.phone
                }}</a></strong
              >
            </div>
            <div>
              <span>校区</span
              ><strong>{{ recruitApp?.campusName || "—" }}</strong>
            </div>
            <div>
              <span>报名楼栋</span><strong>{{ recruitApp?.buildingName }}</strong>
            </div>
            <div>
              <span>状态</span
              ><strong
                ><span
                  class="status"
                  :class="RECRUIT_STATUS_CLASS[recruitApp?.status ?? '']"
                  >{{ RECRUIT_STATUS_LABEL[recruitApp?.status ?? ""] }}</span
                ></strong
              >
            </div>
            <div>
              <span>报名时间</span
              ><strong>{{ display(selected, "createdAt") }}</strong>
            </div>
            <div class="wide">
              <span>自我介绍 / 备注</span
              ><strong class="desc-full">{{ recruitApp?.note || "—" }}</strong>
            </div>
          </div>
          <p class="drawer-sec">审核资料</p>
          <!-- 编辑态（待联系/面试中 + 运营可写）：证件号/备注整行表单 + 双槽位照片 -->
          <template v-if="recruitDocsEditable">
            <div class="drawer-fields">
              <label class="wide">
                身份证号（线下收集后代录，选填）
                <input
                  v-model="recruitEdit.idCardNo"
                  maxlength="18"
                  placeholder="18 位身份证号"
                />
              </label>
              <label class="wide">
                运营备注（面试评价等，选填）
                <input
                  v-model="recruitEdit.staffRemark"
                  maxlength="200"
                  placeholder="面试评价、跟进记录"
                />
              </label>
            </div>
            <div class="recruit-idcards">
              <span class="proof-label">身份证照片（人像面 / 国徽面）</span>
              <IdCardImagesField
                v-model="recruitEdit.idCardImages"
                folder="recruit"
              />
            </div>
            <div class="recruit-save-row">
              <button
                class="btn primary"
                type="button"
                @click="saveRecruitDocs"
              >
                保存资料
              </button>
            </div>
          </template>
          <!-- 只读态（终态或查看视角）：仅展示已录内容 -->
          <template v-else>
            <div class="drawer-fields">
              <div class="wide">
                <span>身份证号</span
                ><strong>{{ recruitApp?.idCardNo || "未录入" }}</strong>
              </div>
            </div>
            <div v-if="recruitSavedImages.length" class="proof-block">
              <span class="proof-label">身份证照片（人像面 / 国徽面）</span>
              <div class="proof-grid">
                <img
                  v-for="(src, i) in recruitSavedImages"
                  :key="`${i}-${src}`"
                  :src="resolveImageUrl(src)"
                  :alt="`身份证照片 ${i + 1}`"
                  loading="lazy"
                  @click="previewImage = resolveImageUrl(src)"
                />
              </div>
            </div>
            <p v-else class="recruit-empty">尚未录入身份证资料</p>
          </template>
          <p class="drawer-sec">审核操作</p>
          <!-- 可写且未终态：主操作通栏（两击确认防误创建账号），次要操作白底描边 -->
          <div v-if="recruitDocsEditable" class="recruit-actions">
            <button
              class="btn primary recruit-actions__primary"
              :class="{ 'recruit-actions__primary--armed': recruitApproveArmed }"
              type="button"
              @click="recruitDoApprove"
            >
              {{
                recruitApproveArmed
                  ? "确认创建实习楼长账号？"
                  : "通过并创建实习楼长"
              }}
            </button>
            <div class="recruit-actions__row">
              <button
                v-if="recruitApp?.status === 'pending'"
                class="btn ghost"
                type="button"
                @click="recruitDoTransition"
              >
                标记面试中
              </button>
              <button
                class="btn danger"
                type="button"
                @click="openRecruitRejectForm"
              >
                拒绝
              </button>
            </div>
          </div>
          <!-- 终态/查看视角：只读状态条 -->
          <div
            v-else-if="recruitApp?.status === 'approved'"
            class="recruit-readonly-bar is-ok"
          >
            已通过 · 实习楼长工号 {{ recruitApp?.staffNo || "—" }}（骑手小程序工号 +
            姓名登录）
          </div>
          <div
            v-else-if="recruitApp?.status === 'rejected'"
            class="recruit-readonly-bar is-bad"
          >
            已拒绝：{{ recruitApp?.rejectReason || "—" }}（候选人可重新报名）
          </div>
          <div v-else class="recruit-readonly-bar">
            {{
              recruitApp?.status === "interviewing"
                ? "面试中，审核操作需运营权限"
                : "待联系，审核操作需运营权限"
            }}
          </div>
        </template>
        <!-- 群码详情（IKAJSY）：大图预览 + 替换/删除 -->
        <template v-else-if="section === 'wechat-groups'">
          <div class="drawer-fields">
            <div class="wide">
              <span>所属群</span
              ><strong>{{ (selected as WechatGroup).buildingName }}</strong>
            </div>
            <div>
              <span>更新时间</span
              ><strong>{{ display(selected, "updatedAt") }}</strong>
            </div>
          </div>
          <div class="proof-block">
            <span class="proof-label">群二维码（点击放大）</span>
            <div class="proof-grid">
              <img
                :src="resolveImageUrl((selected as WechatGroup).image)"
                :alt="`${(selected as WechatGroup).buildingName}二维码`"
                loading="lazy"
                @click="previewImage = resolveImageUrl((selected as WechatGroup).image)"
              />
            </div>
          </div>
          <div v-if="canWriteSection" class="drawer-actions wrap">
            <button class="btn primary" @click="openWechatGroupForm(selected!)">
              替换二维码
            </button>
            <button class="btn danger" @click="removeWechatGroupRow">
              {{ confirmDelete ? "确认删除？" : "删除" }}
            </button>
          </div>
        </template>
        <div
          v-else
          class="drawer-fields"
          :class="{ 'drawer-fields--three': section === 'orders' || section === 'warehouse-orders' }"
        >
          <template v-if="isProductsSection && canWriteSection"
            ><!-- IKDEP0：商品图区——主图+详情多图，点击看大图；未配图给占位 -->
            <div class="product-hero">
              <img
                v-if="(selected as Product).image"
                class="product-hero__main"
                :src="resolveImageUrl(String((selected as Product).image))"
                alt="商品主图"
                loading="lazy"
                @click="
                  previewImage = resolveImageUrl(
                    String((selected as Product).image),
                  )
                "
              /><span
                v-else
                class="product-hero__main product-hero__blank"
                >暂无图片</span
              >
              <div
                v-if="detailImages(selected as Product).length"
                class="product-hero__more"
              >
                <img
                  v-for="(src, i) in detailImages(selected as Product)"
                  :key="i"
                  :src="resolveImageUrl(src)"
                  alt="详情图"
                  loading="lazy"
                  @click="previewImage = resolveImageUrl(src)"
                />
              </div>
              <!-- IKA0UW：原信息摘要移入图卡右侧（IKGQ6Q 弹框优化：横排省高度） -->
              <div class="origin-summary origin-summary--inline">
                <div>
                  <span>商品名</span
                  ><strong>{{ display(selected, "name") }}</strong>
                </div>
                <div>
                  <span>分类 / 状态</span
                  ><strong
                    >{{ display(selected, "categoryId") }} ·
                    {{ display(selected, "status") }}</strong
                  >
                </div>
                <div>
                  <span>当前售价</span
                  ><strong>¥{{ fenToYuan(Number((selected as unknown as Record<string, unknown>)?.price ?? 0)) }}</strong>
                </div>
                <!-- 库存/库位归校区（IKAJSM），官方库视角不展示 -->
                <div v-if="!isHqView">
                  <span>当前可售库存</span
                  ><strong>{{ display(selected, "availableStock") }}</strong>
                </div>
                <div v-if="!isHqView">
                  <span>当前库位</span
                  ><strong>{{ display(selected, "locationText") || "未配置" }}</strong>
                </div>
                <div>
                  <span>建议零售价</span
                  ><strong
                    >¥{{
                      fenToYuan(
                        Number(
                          (selected as unknown as Record<string, unknown>)
                            ?.originalPrice ?? 0,
                        ),
                      )
                    }}</strong
                  >
                </div>
              </div>
            </div>
            <div class="form-sec">基本信息</div>
            <!-- 资料字段（IKAHAT）：名称/副标题/分类/原价/标签/重量可编辑，改完小程序即见 -->
            <label
              >商品名称<input
                v-model.trim="productEdit.name"
                type="text"
                maxlength="80" /></label
            ><label
              >副标题<input
                v-model.trim="productEdit.subtitle"
                type="text"
                maxlength="120" /></label
            ><label
              >分类<select v-model="productEdit.categoryId">
                <option v-for="c in categories" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option></select></label
            ><label
              >建议零售价（元）<input
                v-model.number="productEdit.originalPrice"
                type="number"
                min="0"
                :disabled="!isHqView && Boolean((selected as Product).sourceProductId)"
                title="官方库同步行的建议零售价由总部维护" /></label
            ><!-- IKC1AC：进货价仅官方库行可编辑（校区不可见） --><div class="form-sec">
              价格
            </div><label v-if="isHqView"
              >进货价（元，仅总部可见）<input
                v-model.number="productEdit.costPrice"
                type="number"
                min="0" /></label
            ><!-- IKFOPQ：批发价格官方行可编辑；校区自建行（无来源）放开自报，
                 行内毛利=售价−自报批发价；同步行仍只读 --><label
              v-if="isHqView || !(selected as Product)?.sourceProductId"
              >批发价格（元）<input
                v-model.number="productEdit.wholesalePrice"
                type="number"
                min="0"
                :title="
                  isHqView
                    ? undefined
                    : '自建商品自报批发价，用于订单毛利计算'
                " /></label
            ><label
              >标签<input
                v-model.trim="productEdit.tag"
                type="text"
                maxlength="20"
                placeholder="如：新品" /></label
            ><label
              >重量（kg）<input
                v-model.number="productEdit.weight"
                type="number"
                min="0"
                step="0.001" /></label
            >
            <!-- 单位属性（IKFOPU）：官方资料——校区同步行（有来源）灰显只读 -->
            <div class="form-sec">规格与库存</div>
            <label
              >零售单位<input
                v-model.trim="productEdit.retailUnit"
                type="text"
                maxlength="6"
                placeholder="听/瓶/包"
                :disabled="!isHqView && !!(selected as Product)?.sourceProductId"
            /></label
            ><label
              >批发单位<input
                v-model.trim="productEdit.wholesaleUnit"
                type="text"
                maxlength="6"
                placeholder="件"
                :disabled="!isHqView && !!(selected as Product)?.sourceProductId"
            /></label
            ><label
              >每件含量<input
                v-model.number="productEdit.unitsPerCase"
                type="number"
                min="1"
                max="999"
                step="1"
                :disabled="!isHqView && !!(selected as Product)?.sourceProductId"
            /></label>
            <label
              >{{ isHqView ? "批发价格（元）" : "校园售价（元）" }}<input
                v-model.number="productEdit.price"
                type="number"
                min="0" /></label
            ><!-- IKC1AB：上下架（hq 官方库放行/回收，校区自管本地上架） -->
            <label
              >状态<select v-model="productEdit.status">
                <option value="on-sale">在售</option>
                <option value="off-sale">已下架</option></select></label
            ><label v-if="!isHqView"
              >可售库存<input
                v-model.number="productEdit.stock"
                type="number"
                min="0" /></label
            ><!-- 库位（IKA0VG）：字典下拉选区域 + 编号手填 -->
            <div v-if="!isHqView" class="form-sec">库位</div>
            <label v-if="!isHqView"
              >库位（字典选择）<select v-model="productEdit.location">
                <option value="">未配置</option>
                <option
                  v-for="opt in locationOptions(productEdit.location)"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option></select></label
            ><label v-if="!isHqView"
              >库位编号（选填）<input
                v-model.trim="productEdit.locationCode"
                type="text"
                maxlength="20"
                placeholder="如：03（区域内具体位置）" /></label
            ><div class="form-sec">图片与介绍</div>
            <div class="wide product-image-edit">
              <span class="field-label">商品头图（换新图后小程序即见）</span>
              <ImageUploadField v-model="productEdit.image" folder="app/product" />
            </div>
            <!-- 详情多图（IK9SNS）：小程序商品详情页轮播，可排序，与头图同目录 -->
            <div class="wide product-image-edit">
              <span class="field-label">详情多图（用户端详情页轮播，可排序）</span>
              <ProductImagesField v-model="productEdit.images" folder="app/product" />
            </div>
            <!-- 商品介绍（IKAHAU）：纯文本多行，小程序详情页展示，空 = 不渲染 -->
            <div class="wide product-desc-edit">
              <span class="field-label"
                >商品介绍（小程序详情页展示，{{ productEdit.description.length }}/2000）</span
              >
              <textarea
                v-model="productEdit.description"
                rows="5"
                maxlength="2000"
                placeholder="多行纯文本，换行在小程序详情页保留；留空则不展示介绍区块"
              />
            </div></template
          >
          <!-- IKCIAC：products 编辑形态已含完整表单，不再重复渲染 columns 只读卡；
               其余板块（orders/库存流水等无表单板块）保持只读卡详情 -->
          <template v-else
            ><div
              v-for="col in detailCols(config.columns, config.detailOrder).filter(
                (c) =>
                  c[0] !== 'marginTotal' &&
                  !(section === 'orders' && c[0] === 'userText'),
              )"
              :key="col[0]"
              :class="{
                wide:
                  (section === 'orders' || section === 'warehouse-orders') &&
                  col[0] === 'itemsText',
              }"
            >
              <span>{{ col[1] }}</span
              ><strong
                v-if="col[0] === 'quantity' && section === 'inventory-txns'"
                >{{ txnQuantity(selected) }}</strong
              ><strong v-else>{{ display(selected, col[0]) }}</strong>
            </div></template
          >
          <!-- 订单明细毛利（IKFOPQ）：校区账=售价−批发快照；快照前历史单显示 — -->
          <div
            v-if="section === 'orders' && orderMarginItems.length"
            class="wide pick-list-wrap"
          >
            <span class="field-label"
              >订单明细毛利（实付按行分摊 − 支付时进货价快照；快照前历史单按当前进货价估算）</span
            >
            <ul class="margin-list">
              <li v-for="(line, i) in orderMarginItems" :key="i">
                <span class="margin-name"
                  >{{ line.name }} × {{ line.quantity }}</span
                >
                <span
                  class="margin-amount"
                  :class="{ muted: !line.hasMargin || line.estimated }"
                >
                  售价 {{ line.priceText }} · 毛利
                  <strong>{{ line.marginText }}</strong></span
                >
              </li>
              <li v-if="orderMarginTotal != null" class="margin-total-row">
                <span class="margin-name">订单毛利合计</span>
                <span class="margin-amount">
                  <strong>¥{{ fenToYuan(orderMarginTotal) }}</strong></span
                >
              </li>
            </ul>
          </div>
          <!-- 拣货清单（IK9U40）：库位指引找货；IKB5P5 起订单接口回查实时库位，历史单同样有指引 -->
          <div
            v-if="section === 'warehouse-orders' && pickingItems.length"
            class="wide pick-list-wrap"
          >
            <span class="field-label">拣货清单（按库位找货）</span>
            <ul class="pick-list">
              <li v-for="(line, i) in pickingItems" :key="i">
                <em v-if="line.location" class="pick-loc">{{ line.location }}</em>
                <span>{{ line.name }} ×{{ line.quantity }}</span>
              </li>
            </ul>
          </div>
          <!-- 履约凭证（IKA57U）：交接拍照/送达凭证此前只落库不展示，PM 无法核对 -->
          <div
            v-if="orderProofs.length"
            class="wide proof-block drawer-proofs"
          >
            <span class="proof-label">履约凭证（交接/送达，点击放大）</span>
            <div class="proof-grid">
              <img
                v-for="(src, i) in orderProofs"
                :key="i"
                :src="resolveImageUrl(src)"
                :alt="`凭证 ${i + 1}`"
                loading="lazy"
                @click="previewImage = resolveImageUrl(src)"
              />
            </div>
          </div>
        </div>
        <!-- IKEAGE 招募详情不用底部按钮条：操作已按层级入「审核操作」分区，
             关闭走右上角 ×（道哥反馈：关闭详情宽条与三按钮无主次） -->
        <div
          v-if="
            section !== 'recruit' && !(section === 'orders' && orderInPicking)
          "
          class="drawer-actions wrap"
        >
          <template v-if="isProductsSection && canWriteSection">
            <button class="btn primary" @click="act('save')">
              {{ isHqView ? "保存官方库资料" : "保存商品调整" }}</button
            ><!-- IKAJSO：上游有更新，抽屉内也可一键拉取 -->
            <button
              v-if="!isHqView && (selected as Product).upstreamChanged"
              class="btn ghost"
              @click="pullUpstreamRow(selected!)"
            >
              拉取官方库更新</button
          ></template>
          <!-- IK9U3Z：拣货中的订单出库动作移交「商品仓储 · 拣货出库」，
               本页不显示操作按钮（IKFSZJ：提示文案去掉，静默即可） -->
          <template
            v-else-if="
              section === 'orders' && canWriteSection && !orderInPicking
            "
            ><button class="btn primary" @click="act('advance')">
              推进履约</button
            ><button class="btn danger-btn" @click="act('mark-exception')">
              标记异常</button
            ><!-- 补打小票（IKBT6N）：芯烨云重推，缺纸/卡纸兜底 -->
            <button class="btn ghost" :disabled="printing" @click="reprintReceipt">
              {{ printing ? "打印中..." : "补打小票" }}
            </button></template
          >
          <!-- 确认出库（IKA0UQ）：一步转待配送 + 出库流水 -->
          <template
            v-else-if="
              section === 'warehouse-orders' && canWriteSection
            "
          >
            <button class="btn primary" @click="outbound">确认出库</button>
            <!-- 补打小票（IKBT6N） -->
            <button class="btn ghost" :disabled="printing" @click="reprintReceipt">
              {{ printing ? "打印中..." : "补打小票" }}
            </button>
          </template>
          <template v-else-if="section === 'after-sales'">
            <p class="form-hint plain processed-hint">
              试点期售后由客服人工处理（不退款），本页仅留档查看。
            </p>
          </template>
          <template
            v-else-if="
              (section === 'banners' || section === 'pay-ads') && canWriteSection
            "
          >
            <!-- IKAJSL：Banner 独立板块；IKB5PB：支付广告位同入口（pay-success 子视图） -->
            <button class="btn primary" @click="openBannerEdit(selected)">
              编辑 Banner
            </button>
            <button class="btn ghost" @click="toggleBanner">
              {{ bannerHidden ? "启用 Banner" : "隐藏 Banner" }}
            </button>
            <button class="btn danger-btn" @click="removeBannerRow">
              {{ confirmDelete ? "确认删除" : "删除 Banner" }}
            </button>
          </template>
          <!-- 打印机详情（IKBW0Q）：绑定信息 + 测试打印/换绑/解绑 -->
          <template v-else-if="section === 'printers'">
            <div class="drawer-fields">
              <div>
                <span>名称</span
                ><strong>{{ (selected as Printer).name }}</strong>
              </div>
              <div>
                <span>终端号 (SN)</span
                ><strong>{{ (selected as Printer).sn }}</strong>
              </div>
              <div>
                <span>状态</span
                ><strong>{{
                  (selected as Printer).status === "active" ? "已启用" : "已停用"
                }}</strong>
              </div>
              <div>
                <span>绑定时间</span
                ><strong>{{
                  fmtDateTime((selected as Printer).createdAt)
                }}</strong>
              </div>
            </div>
            <div v-if="canWriteSection" class="drawer-actions wrap">
              <button class="btn primary" @click="testPrintRow(selected as Printer)">
                测试打印
              </button>
              <button class="btn ghost" @click="openPrinterBind(selected as Printer)">
                换绑 / 改名
              </button>
              <button
                class="btn danger-btn"
                @click="unbindPrinterRow(selected as Printer)"
              >
                {{ confirmDelete ? "确认解绑" : "解绑打印机" }}
              </button>
            </div>
          </template>
          <template
            v-else-if="
              (section === 'marketing' ||
                section === 'coupons' ||
                section === 'promotions') &&
              canWriteSection
            "
          >
            <!-- 优惠券（marketing coupons tab / IKB5PB 优惠券配置菜单） -->
            <template
              v-if="section === 'coupons' || mktTab === 'coupons'"
            >
              <button class="btn primary" @click="toggleCoupon">
                {{ couponPaused ? "启用优惠券" : "暂停发放" }}
              </button>
              <button class="btn ghost" @click="openIssue(selected as Coupon)">
                定向发放
              </button>
            </template>
            <!-- 促销（marketing promotions tab / IKB5PB 限时秒杀菜单）：
                 无删除留审计，停用立即回落原价 -->
            <template v-else>
              <button class="btn primary" @click="openPromotionEdit(selected)">
                编辑促销
              </button>
              <button class="btn ghost" @click="togglePromotion">
                {{ (selected as unknown as Promotion).status === 'active'
                  ? '停用（立即回落原价）'
                  : '启用活动' }}
              </button>
            </template>
          </template>
          <template v-else-if="section === 'categories' && canWriteSection"
            ><button class="btn primary" @click="openCategoryEdit(selected)">
              编辑类别</button
            ><button class="btn danger-btn" @click="removeCategoryRow">
              {{ confirmDelete ? "确认删除" : "删除类别" }}
            </button></template
          >
          <template
            v-else-if="
              section === 'campuses' && isPlatformAdmin && canWriteSection
            "
          >
            <!-- IKAJSL/IKCRS8：校区本体管理（信息/启停/配送费逐校配置），
                 写操作限平台管理员（后端 controller 同口径） -->
            <button class="btn primary" @click="openCampusEdit(selected)">
              编辑校区</button
            >
          </template>
          <template v-else-if="section === 'buildings' && canWriteSection">
            <button
              class="btn primary"
              @click="openBuildingEdit(selected as Building)"
            >
              编辑楼栋</button
            ><button class="btn ghost" @click="openRooms(selected as Building)">
              寝室管理
            </button
            ><button class="btn danger-btn" @click="removeBuilding">
              {{ confirmDelete ? "确认删除" : "删除楼栋" }}
            </button>
          </template>
          <template v-else-if="section === 'staff' && canWriteSection">
            <button class="btn primary" @click="openStaffEdit(selected as Staff)">
              编辑员工</button
            ><button class="btn danger-btn" @click="removeStaff">
              {{ confirmDelete ? "确认删除" : "删除账号" }}
            </button>
          </template>
          <template v-else-if="section === 'accounts' && canWriteSection">
            <button class="btn primary" @click="openAccountEdit(selected)">
              编辑账号</button
            ><button class="btn ghost" @click="openAccountResetPassword(selected)">
              重置密码</button
            ><button class="btn danger-btn" @click="removeAccount">
              {{ confirmDelete ? "确认删除" : "删除账号" }}
            </button>
          </template>
          <template v-else-if="section === 'finance' && canWriteSection">
            <button
              class="btn primary"
              :disabled="settlementStatus !== 'pending-review'"
              @click="act('confirm')"
            >
              确认账单</button
            ><button
              class="btn ghost"
              :disabled="settlementStatus !== 'confirmed'"
              @click="act('pay')"
            >
              标记打款
            </button>
          </template>
          <template
            v-else-if="section === 'dispatch' && dispTab === 'leaves' && canWriteSection"
          >
            <button class="btn primary" @click="inviteFromSelected">
              邀请调配（代管该楼）
            </button>
          </template>
          <template
            v-else-if="section === 'dispatch' && dispTab === 'invites' && canWriteSection"
          >
            <button
              class="btn danger-btn"
              :disabled="inviteStatus !== 'invited'"
              @click="cancelInvite"
            >
              {{ inviteConfirmCancel ? "确认取消" : "取消邀请" }}
            </button>
          </template>
          <template v-else-if="section === 'rules' && canWriteSection">
            <button class="btn primary" @click="toggleRule">
              {{ ruleActive ? "停用规则" : "启用规则" }}
            </button>
          </template>
          <button class="btn ghost" @click="selected = undefined">
            关闭详情
          </button>
        </div>
      </aside>
    </div>
    <!-- 通用表单抽屉：优惠券 / 楼栋 / 员工 / 库存操作 -->
    <div v-if="formOpen" class="drawer-mask" @click.self="formOpen = false">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <h2>{{ formMeta?.title }}</h2>
          </div>
          <button aria-label="关闭" @click="formOpen = false">×</button>
        </div>
        <div class="product-form">
          <template v-for="field in visibleFields" :key="field.key">
            <label
              v-if="field.type === 'checkbox'"
              class="check-field"
              :class="{ wide: field.wide }"
            >
              <span class="checkbox-row">
                <input
                  v-model="formData[field.key]"
                  type="checkbox"
                  class="raw-checkbox"
                />{{ field.label }}
              </span>
            </label>
            <label v-else-if="field.type === 'select'" :class="{ wide: field.wide }"
              >{{ field.label
              }}<select
                v-model="formData[field.key]"
                :disabled="field.disabled?.(formData)"
              >
                <option v-if="field.optional" value="">
                  {{ field.optionalLabel ?? "不绑定" }}
                </option>
                <option
                  v-for="option in fieldOptions(field)"
                  :key="String(option.value)"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select></label
            >
            <!-- 图片字段（IK9RWX 上传基建）：COS 上传 + URL 兜底，类别图/Banner 图复用 -->
            <div v-else-if="field.type === 'image'" :class="{ wide: field.wide }">
              <span class="field-label">{{ field.label }}</span>
              <ImageUploadField
                :model-value="String(formData[field.key] ?? '')"
                :folder="field.folder"
                @update:model-value="formData[field.key] = $event"
              />
            </div>
            <!-- 长文本（IK9SNN Banner 图文）：每行一段，https 行渲染为图 -->
            <div v-else-if="field.type === 'textarea'" :class="{ wide: field.wide }">
              <span class="field-label">{{ field.label }}</span>
              <textarea
                :value="String(formData[field.key] ?? '')"
                rows="6"
                :placeholder="field.placeholder"
                @input="
                  formData[field.key] = ($event.target as HTMLTextAreaElement).value
                "
              ></textarea>
            </div>
            <!-- 可运营校区多选（IKB3KG 方案A）：账号授权范围勾选 -->
            <div
              v-else-if="field.type === 'campus-multi'"
              :class="{ wide: field.wide }"
            >
              <span class="field-label">{{ field.label }}</span>
              <div class="campus-checks">
                <label v-for="c in campusOptionsData" :key="c.id">
                  <input
                    type="checkbox"
                    :checked="campusMultiValue(field.key).includes(c.id)"
                    @change="toggleCampusMulti(field.key, c.id)"
                  />{{ c.shortName || c.name }}
                </label>
              </div>
            </div>
            <!-- 商品选择器（IKGQ6Q 组件化）：交互内聚 ProductPickerField -->
            <div
              v-else-if="field.type === 'product-picker'"
              :class="{ wide: field.wide }"
            >
              <span class="field-label">{{ field.label }}</span>
              <ProductPickerField
                :items="field.ppItems ? field.ppItems() : productsCache"
                :loading="ppLoading"
                :show-cost="field.ppShowCost ?? false"
                :model-value="String(formData[field.key] ?? '')"
                @update:model-value="formData[field.key] = $event as string"
              />
            </div>
            <label v-else :class="{ wide: field.wide }"
              >{{ field.label
              }}<input
                v-model="formData[field.key]"
                :type="fieldInputType(field)"
                :min="field.min"
                :step="field.step"
                :placeholder="field.placeholder"
                :disabled="field.disabled?.(formData)"
            />
              <!-- IKB3K1：字段级动态风险提醒（券面额≥门槛等） -->
              <p v-if="field.hint?.(formData)" class="form-hint">
                {{ field.hint(formData) }}
              </p></label
            >
          </template>
        </div>
        <p v-if="formError" class="form-hint">{{ formError }}</p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="formOpen = false">取消</button
          ><button class="btn primary" :disabled="formSaving" @click="submitForm">
            {{ formSaving ? "保存中..." : (formMeta?.submit ?? "保存") }}
          </button>
        </div>
      </aside>
    </div>
    <!-- 寝室管理抽屉 -->
    <div v-if="roomsOpen" class="drawer-mask" @click.self="roomsOpen = false">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <h2>寝室管理 · {{ roomsBuilding?.name }}</h2>
          </div>
          <button aria-label="关闭" @click="roomsOpen = false">×</button>
        </div>
        <div class="room-add-form">
          <label
            >楼层<input
              v-model.number="roomForm.floor"
              type="number"
              min="1" /></label
          ><label
            >寝室号<input
              v-model.trim="roomForm.roomNo"
              placeholder="例如：612"
              @keyup.enter="addRoom" /></label
          ><button class="btn primary" @click="addRoom">添加寝室</button>
        </div>
        <!-- IKD6FH：批量导入——模板下载 + xlsx 上传（楼栋内重复寝室自动跳过） -->
        <div class="room-import">
          <button
            class="btn ghost"
            :disabled="roomsImporting"
            @click="downloadRoomsTemplate"
          >
            下载模板
          </button>
          <button
            class="btn primary"
            :disabled="roomsImporting"
            @click="pickRoomsImportFile"
          >
            {{ roomsImporting ? "导入中..." : "批量导入" }}
          </button>
          <input
            ref="roomsImportInput"
            type="file"
            accept=".xlsx"
            hidden
            @change="onRoomsImportFile"
          />
        </div>
        <p v-if="roomError" class="form-hint">{{ roomError }}</p>
        <p v-if="roomsLoading" class="form-hint plain">正在加载寝室列表...</p>
        <div v-else class="room-list">
          <div v-if="!rooms.length" class="form-hint plain">
            该楼栋还没有寝室记录，先在上方添加。
          </div>
          <!-- 2026-09-08 道哥：二维码令牌为死字段（扫码交接已下线），不再展示 -->
          <div v-for="room in rooms" :key="room.id" class="room-row">
            <strong :data-floor="room.floor">{{ room.roomNo }} 寝</strong>
            <button class="text-btn danger-text" @click="removeRoom(room.id)">
              {{ roomConfirmId === room.id ? "确认删除" : "删除" }}
            </button>
          </div>
        </div>
      </aside>
    </div>
    <!-- 定向发放抽屉 -->
    <div v-if="issueOpen" class="drawer-mask" @click.self="issueOpen = false">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <h2>定向发放 · {{ issueCouponRow?.name }}</h2>
          </div>
          <button aria-label="关闭" @click="issueOpen = false">×</button>
        </div>
        <p class="form-hint plain">
          勾选目标用户后发放，同一用户不会重复获得未使用的券。
        </p>
        <!-- IKD6FI：定向方式——按用户勾选 / 按手机号 / 按寝室（楼栋+楼层+寝室号） -->
        <div class="segmented inv-tabs issue-modes">
          <button
            :class="{ active: issueMode === 'users' }"
            @click="issueMode = 'users'"
          >
            按用户
          </button>
          <button
            :class="{ active: issueMode === 'phones' }"
            @click="issueMode = 'phones'"
          >
            按手机号
          </button>
          <button
            :class="{ active: issueMode === 'rooms' }"
            @click="issueMode = 'rooms'"
          >
            按寝室
          </button>
        </div>
        <template v-if="issueMode === 'users'">
          <p v-if="usersLoading" class="form-hint plain">
            正在加载用户列表...
          </p>
          <div v-else class="user-check-list">
            <label v-for="user in users" :key="user.id" class="user-check">
              <input v-model="issueChecked[user.id]" type="checkbox" />
              <div>
                <strong>{{ userLabel(user) }}</strong>
                <small>{{ userSub(user) }}</small>
              </div>
            </label>
            <div v-if="!users.length" class="form-hint plain">
              暂无可选用户列表。
            </div>
          </div>
          <label class="manual-ids"
            >手工指定用户 ID（换行或逗号分隔，可选）
            <textarea
              v-model.trim="manualUserIds"
              rows="3"
              placeholder="user-001&#10;user-002"
            ></textarea>
          </label>
        </template>
        <!-- IKD6FI：按手机号定向（用户绑定手机号，后端最多 500 个） -->
        <label v-else-if="issueMode === 'phones'" class="manual-ids"
          >按手机号发放（每行一个或逗号分隔，最多 500 个）
          <textarea
            v-model.trim="issuePhones"
            rows="6"
            placeholder="13800000001&#10;13800000002"
          ></textarea>
        </label>
        <!-- IKD6FI：按寝室定向——楼栋必填，楼层/寝室号选填收窄范围 -->
        <template v-else>
          <label class="manual-ids">楼栋
            <select v-model="issueBuildingId" class="issue-select">
              <option value="">选择楼栋</option>
              <option v-for="b in buildings" :key="b.id" :value="b.id">
                {{ b.name }}
              </option>
            </select>
          </label>
          <label class="manual-ids"
            >楼层（选填，收窄范围）
            <input
              v-model.number="issueFloor"
              class="issue-select"
              type="number"
              min="1"
              placeholder="例如：6"
            />
          </label>
          <label class="manual-ids"
            >寝室号（选填，逗号或换行分隔）
            <textarea
              v-model.trim="issueRoomNos"
              rows="3"
              placeholder="612, 613&#10;701"
            ></textarea>
          </label>
          <p class="form-hint plain">
            按用户填过的收货地址匹配，未填地址的用户无法按寝室触达。
          </p>
        </template>
        <p v-if="usersError" class="form-hint">{{ usersError }}</p>
        <p v-if="issueMode === 'users'" class="form-hint plain">
          已选择 {{ selectedUserIds.length }} 名用户
        </p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="issueOpen = false">取消</button
          ><button
            class="btn primary"
            :disabled="!issueReady"
            @click="confirmIssue"
          >
            确认发放
          </button>
        </div>
      </aside>
    </div>
    <!-- 手动改订单状态（IKA0UT）：12 态白名单 + 原因必填进审计日志 -->
    <div
      v-if="statusDialogOpen"
      class="drawer-mask"
      @click.self="statusDialogOpen = false"
    >
      <aside class="drawer status-dialog">
        <div class="drawer-head">
          <div>
            <h2>修改订单状态</h2>
          </div>
          <button aria-label="关闭" @click="statusDialogOpen = false">×</button>
        </div>
        <div class="drawer-fields">
          <div>
            <span>订单编号</span
            ><strong>{{
              (statusDialogRow as unknown as Record<string, unknown>)?.orderNo
            }}</strong>
          </div>
          <div>
            <span>当前状态</span
            ><strong>{{
              (statusDialogRow as unknown as Record<string, unknown>)
                ?.statusText
            }}</strong>
          </div>
          <label class="wide"
            >目标状态
            <select v-model="statusDialogValue">
              <option
                v-for="[value, label] in ORDER_STATUS_OPTIONS"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select></label
          >
          <label class="wide"
            >操作原因（必填，写入审计日志）
            <input
              v-model.trim="statusDialogReason"
              type="text"
              maxlength="200"
              placeholder="例如：测试链路 / 客服兜底改状态"
          /></label>
          <p class="form-hint">
            绕过流程改状态会留下操作人/时间/原因记录（审计日志），仅用于测试与上线初期兜底。
          </p>
        </div>
        <div class="drawer-actions">
          <button class="btn ghost" @click="statusDialogOpen = false">
            取消</button
          ><button
            class="btn primary"
            :disabled="statusDialogSaving || !statusDialogReason"
            @click="submitStatusDialog"
          >
            确认修改
          </button>
        </div>
      </aside>
    </div>
    <div v-if="creating" class="drawer-mask" @click.self="closeCreate">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <!-- IKAJSM → IKCHEW：官方库视角建档；本校区视角扫码录入 SKU -->
            <h2>{{ isHqView ? "官方库建档" : "扫码录入 SKU" }}</h2>
          </div>
          <button aria-label="关闭" @click="closeCreate">×</button>
        </div>
        <div class="scan-panel">
          <video v-if="scanning" ref="video" playsinline muted></video>
          <div v-else class="scan-placeholder">
            <span class="scan-icon"></span><strong>扫描商品包装条形码</strong
            ><small>支持 EAN-13、EAN-8、UPC、Code 128</small>
          </div>
          <button v-if="!scanning" class="btn scan-btn" @click="startScan">
            打开摄像头扫码</button
          ><button v-else class="btn ghost" @click="stopScan">停止扫描</button>
        </div>
        <div class="barcode-row">
          <input
            v-model.trim="productForm.barcode"
            inputmode="numeric"
            maxlength="14"
            placeholder="条码选填；扫码枪/手工输入 8-14 位数字"
            @keyup.enter="lookup"
          /><button class="btn ghost" @click="lookup">查询</button>
        </div>
        <p v-if="scanError" class="form-hint">{{ scanError }}</p>
        <div class="product-form">
          <label class="wide"
            >商品名称<input
              v-model.trim="productForm.name"
              placeholder="例如：农夫山泉 550ml"
          /></label>
          <label class="wide"
            >商品卖点<input
              v-model.trim="productForm.subtitle"
              placeholder="一句话描述"
          /></label>
          <label
            >分类<select v-model="productForm.categoryId">
              <!-- 类别字典动态拉取（2026-08-19 类别管理），原 4 个硬编码 option 已废 -->
              <option v-for="c in categories" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select></label
          >
          <label>标签<input v-model.trim="productForm.tag" /></label>
          <!-- IKC1AC：官方库建档价格三层（进货价仅总部；官方售价已更名批发价格） -->
          <label v-if="isHqView"
            >进货价（元，仅总部可见）<input
              v-model.number="productForm.costPrice"
              type="number"
              min="0"
              step="0.01"
          /></label>
          <label
            >{{ isHqView ? "批发价格（元）" : "校园售价（元）" }}<input
              v-model.number="productForm.price"
              type="number"
              min="0"
              step="0.01"
          /></label>
          <label
            >建议零售价（元）<input
              v-model.number="productForm.originalPrice"
              type="number"
              min="0"
              step="0.01"
          /></label>
          <!-- 初始库存/库位归校区（IKAJSM），官方库建档不展示 -->
          <label v-if="!isHqView"
            >初始库存<input
              v-model.number="productForm.stock"
              type="number"
              min="0"
          /></label>
          <label
            >重量（kg）<input
              v-model.number="productForm.weight"
              type="number"
              min="0"
              step="0.001"
          /></label>
          <!-- 单位属性（IKFOPU）：零售按听/瓶卖、订货按件批发，含量=件含零售数 -->
          <label
            >零售单位（必填）<input
              v-model.trim="productForm.retailUnit"
              maxlength="6"
              placeholder="听/瓶/包"
          /></label>
          <label
            >批发单位<input
              v-model.trim="productForm.wholesaleUnit"
              maxlength="6"
              placeholder="件"
          /></label>
          <label
            >每件含量<input
              v-model.number="productForm.unitsPerCase"
              type="number"
              min="1"
              max="999"
              step="1"
              placeholder="1 件 = 24 听"
          /></label>
          <!-- 库位（IKA0VG）：字典下拉选区域 + 编号手填 -->
          <label v-if="!isHqView"
            >库位（字典选择）<select v-model="productForm.location">
              <option value="">未配置</option>
              <option
                v-for="opt in locationOptions(productForm.location)"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option></select></label
          >
          <label v-if="!isHqView"
            >库位编号（选填）<input
              v-model.trim="productForm.locationCode"
              maxlength="20"
              placeholder="如：03"
          /></label>
          <div class="wide product-image-edit">
            <span class="field-label">商品头图（上传到 COS app/product，小程序即见）</span>
            <ImageUploadField v-model="productForm.image" folder="app/product" />
          </div>
          <!-- 详情多图（IK9SNS / IKA0UW）：新增与编辑能力一致，选填 -->
          <div class="wide product-image-edit">
            <span class="field-label">详情多图（用户端详情页轮播，可排序，选填）</span>
            <ProductImagesField v-model="productForm.images" folder="app/product" />
          </div>
          <!-- 商品介绍（IKAHAU）：与编辑能力一致，选填 -->
          <div class="wide product-desc-edit">
            <span class="field-label"
              >商品介绍（小程序详情页展示，{{ productForm.description.length }}/2000，选填）</span
            >
            <textarea
              v-model="productForm.description"
              rows="5"
              maxlength="2000"
              placeholder="多行纯文本，换行在小程序详情页保留；留空则不展示介绍区块"
            />
          </div>
        </div>
        <div class="drawer-actions">
          <button class="btn ghost" @click="closeCreate">取消</button
          ><button class="btn primary" @click="saveProduct">保存</button>
        </div>
      </aside>
    </div>
    <!-- 官方库导入弹窗（IKAJSO）：搜索 + 多选，批量落地本校区 -->
    <div v-if="importOpen" class="drawer-mask" @click.self="importOpen = false">
      <aside class="drawer import-drawer">
        <div class="drawer-head">
          <div>
            <h2>从官方库导入</h2>
          </div>
          <button aria-label="关闭" @click="importOpen = false">×</button>
        </div>
        <div class="import-search">
          <input
            v-model.trim="importKeyword"
            aria-label="搜索官方库商品"
            placeholder="搜索商品名 / 条码..."
            @keyup.enter="searchImport"
          /><button class="btn ghost" @click="searchImport">搜索</button>
        </div>
        <p v-if="importResult" class="form-hint import-result">
          成功导入 {{ importResult.importedCount }} 个（初始下架零库存，定价备货后自行上架）<template
            v-if="importResult.skipped.length"
            >；跳过 {{ importResult.skipped.length }} 个：</template
          >
        </p>
        <ul v-if="importResult?.skipped.length" class="import-skips">
          <li v-for="(skip, i) in importResult.skipped" :key="i">
            {{ skip.name }}：{{ skip.reason }}
          </li>
        </ul>
        <div v-if="importLoading" class="import-list-empty">官方库加载中...</div>
        <ul v-else-if="importRows.length" class="import-list">
          <li
            v-for="item in importRows"
            :key="item.id"
            :class="{ picked: importSelected.includes(item.id) }"
            @click="toggleImportSel(item.id)"
          >
            <img
              v-if="item.image"
              class="cell-thumb"
              :src="resolveImageUrl(item.image)"
              alt=""
              loading="lazy"
            /><span v-else class="cell-thumb import-thumb-blank"></span>
            <div class="import-item-copy">
              <strong>{{ item.name }}</strong>
              <small
                >{{
                  categories.find((c) => c.id === item.categoryId)?.name ??
                  item.categoryId
                }}
                · ¥{{ fenToYuan(item.price)
                }}<!-- 单位（IKFOPU）：含量>1 时括注换算，导入前可核对 --><template
                  v-if="(item.unitsPerCase ?? 1) > 1"
                >
                  · {{ item.unitsPerCase ?? 1
                  }}{{ item.wholesaleUnit }}/{{ item.retailUnit || "个" }}</template
                ></small
              >
            </div>
            <input
              type="checkbox"
              :checked="importSelected.includes(item.id)"
              aria-label="选择商品"
              tabindex="-1"
              @click.stop="toggleImportSel(item.id)"
            />
          </li>
        </ul>
        <div v-else class="import-list-empty">
          官方库暂无匹配商品；可联系总部在官方库建档
        </div>
        <div class="import-pager">
          <button :disabled="importPage === 1" @click="importPage--; loadImportRows()">
            ←
          </button>
          <span>第 {{ importPage }} 页 / 共 {{ Math.max(1, Math.ceil(importTotal / 50)) }} 页</span>
          <button
            :disabled="importPage >= Math.ceil(importTotal / 50)"
            @click="importPage++; loadImportRows()"
          >
            →
          </button>
        </div>
        <div class="drawer-actions">
          <button class="btn ghost" @click="importOpen = false">关闭</button
          ><button
            class="btn primary"
            :disabled="!importSelected.length || importing"
            @click="submitImport"
          >
            {{ importing ? "导入中..." : `导入所选（${importSelected.length}）` }}
          </button>
        </div>
      </aside>
    </div>
    <!-- 抽奖转盘编辑（IKD6FC）：开关 + 8 奖位逐项配置 -->
    <div v-if="wheelEditOpen" class="drawer-mask" @click.self="wheelEditOpen = false">
      <aside class="drawer wheel-drawer">
        <div class="drawer-head">
          <div>
            <h2>编辑奖池</h2>
          </div>
          <button aria-label="关闭" @click="wheelEditOpen = false">×</button>
        </div>
        <div class="wheel-active">
          <label class="checkbox-row">
            <input
              v-model="wheelForm.active"
              type="checkbox"
              class="raw-checkbox"
            />
            活动开启（关闭后小程序首页隐藏抽奖入口）
          </label>
        </div>
        <div class="wheel-grid">
          <div
            v-for="(prize, i) in wheelForm.prizes"
            :key="i"
            class="wheel-row"
          >
            <div class="wheel-row__head">
              <span class="wheel-row__no">奖位 {{ i + 1 }}</span>
              <select
                v-model="prize.type"
                class="wheel-row__type"
                :aria-label="`奖位 ${i + 1} 类型`"
                @change="onWheelTypeChange(i)"
              >
                <option value="coupon">平台券</option>
                <option value="partner">异业券</option>
                <option value="none">谢谢参与</option>
              </select>
            </div>
            <label v-if="prize.type !== 'none'" class="wheel-row__field">
              <span>扇区文案</span>
              <input
                v-model.trim="prize.label"
                maxlength="12"
                :placeholder="prize.type === 'coupon' ? '如：5元券' : '如：奶茶券'"
              />
            </label>
            <label v-if="prize.type === 'coupon'" class="wheel-row__field">
              <span>优惠券</span>
              <select v-model="prize.couponId">
                <option value="" disabled>选择发放中的金额券</option>
                <option
                  v-for="c in wheelCoupons.filter((c) => c.kind === 'platform')"
                  :key="c.id"
                  :value="c.id"
                >
                  {{ c.name }}（{{ c.remain == null ? "不限量" : `剩 ${c.remain} 张` }}）
                </option>
              </select>
            </label>
            <template v-if="prize.type === 'partner'">
              <!-- IKDCVO：配异业券则抽中直接发券入账（我的优惠券可见，暂不核销）；
                   未配券回落图文展示。配券后图片可不传。 -->
              <label class="wheel-row__field">
                <span>异业券（选填，选中即抽中发券）</span>
                <select v-model="prize.couponId">
                  <option value="">不配券，用下方图文展示</option>
                  <option
                    v-for="c in wheelCoupons.filter((c) => c.kind === 'partner')"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.name }}（{{ c.remain == null ? "不限量" : `剩 ${c.remain} 张` }}）
                  </option>
                </select>
              </label>
              <label v-if="!prize.couponId" class="wheel-row__field">
                <span>福利标题</span>
                <input
                  v-model.trim="prize.bizTitle"
                  maxlength="40"
                  placeholder="如：茶百道 · 买一送一"
                />
              </label>
              <div class="wheel-row__field">
                <span>
                  图文图片（可含商家二维码{{ prize.couponId ? "，选填" : "" }}）
                </span>
                <ImageUploadField
                  :model-value="prize.bizImage ?? ''"
                  folder="app/wheel"
                  @update:model-value="prize.bizImage = $event"
                />
              </div>
              <label v-if="!prize.couponId" class="wheel-row__field">
                <span>说明（选填）</span>
                <input
                  v-model.trim="prize.bizNote"
                  maxlength="120"
                  placeholder="如：到店出示该页面即可享受优惠"
                />
              </label>
            </template>
            <label class="wheel-row__field wheel-row__weight">
              <span>权重（0 = 永不命中）</span>
              <input
                v-model.number="prize.weight"
                type="number"
                min="0"
                max="1000"
              />
            </label>
          </div>
        </div>
        <p class="form-hint plain">
          概率按权重占比随机，与历史抽奖无关；平台券发完后该奖位自动按「谢谢参与」处理，异业券发完后自动回落到图文展示，均不超发。
        </p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="wheelEditOpen = false">取消</button
          ><button class="btn primary" :disabled="wheelSaving" @click="submitWheel">
            {{ wheelSaving ? "保存中..." : "保存配置" }}
          </button>
        </div>
      </aside>
    </div>
    <!-- 凭证大图预览（IK97FJ） -->
    <div
      v-if="previewImage"
      class="image-lightbox"
      @click="previewImage = ''"
    >
      <img :src="previewImage" alt="凭证大图" />
    </div>
    <div
      v-if="message"
      class="toast"
      :class="{ error: messageError }"
      role="status"
    >
      {{ message }}
    </div>
  </div>
</template>
