<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, ensureLogin } from "../api";
const route = useRoute(),
  rows = ref<any[]>([]),
  loading = ref(true),
  keyword = ref(""),
  selected = ref<any>(),
  message = ref(""),
  messageError = ref(false),
  creating = ref(false),
  scanning = ref(false),
  video = ref<HTMLVideoElement>(),
  scanError = ref(""),
  confirmDelete = ref(false),
  productForm = ref({
    barcode: "",
    name: "",
    subtitle: "",
    categoryId: "snack",
    price: 0,
    originalPrice: 0,
    stock: 0,
    tag: "新品",
    image: "",
    weight: 0,
  });
const statusFilter = ref("all"),
  page = ref(1),
  pageSize = 10;
let cameraStream: MediaStream | undefined;

/* ---------- 通用表单抽屉（新建/编辑：优惠券、楼栋、员工、库存操作） ---------- */
interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "checkbox";
  options?: () => { value: string | number; label: string }[];
  placeholder?: string;
  wide?: boolean;
  min?: number;
  step?: number;
  optional?: boolean;
}
interface FormMeta {
  eyebrow: string;
  title: string;
  submit: string;
  fields: FieldDef[];
  done: string;
  save: (data: Record<string, any>) => Promise<void>;
}
const formOpen = ref(false),
  formError = ref(""),
  formSaving = ref(false),
  formData = ref<Record<string, any>>({}),
  formMeta = ref<FormMeta>();
function openForm(meta: FormMeta, initial: Record<string, any>) {
  formMeta.value = meta;
  formData.value = { ...initial };
  formError.value = "";
  formOpen.value = true;
}
function fieldOptions(field: FieldDef) {
  const options = [...(field.options?.() ?? [])];
  const current = formData.value[field.key];
  if (
    current !== undefined &&
    current !== "" &&
    !options.some((o) => String(o.value) === String(current))
  )
    options.push({ value: current, label: `当前值：${current}` });
  return options;
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
const buildings = ref<any[]>([]);
async function ensureBuildings() {
  if (!buildings.value.length) buildings.value = await api.buildings();
  return buildings.value;
}
function buildingOptions() {
  return buildings.value.map((b) => ({ value: b.id, label: b.name }));
}
async function refreshBuildings() {
  buildings.value = await api.buildings();
}
function buildingPayload(d: Record<string, any>) {
  const payload: Record<string, any> = {
    name: String(d.name || "").trim(),
    floors: Number(d.floors),
    hasElevator: !!d.hasElevator,
    gender: String(d.gender || "").trim(),
  };
  return payload;
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
    { name: "", floors: 6, gender: "mixed", hasElevator: true },
  );
}
function openBuildingEdit(row: any) {
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
  rooms = ref<any[]>([]),
  roomsBuilding = ref<any>(),
  roomError = ref(""),
  roomConfirmId = ref(""),
  roomForm = ref({ floor: 1, roomNo: "" });
async function openRooms(building: any) {
  selected.value = undefined;
  roomsBuilding.value = building;
  roomsOpen.value = true;
  roomError.value = "";
  roomConfirmId.value = "";
  roomForm.value = { floor: 1, roomNo: "" };
  await loadRooms();
}
async function loadRooms() {
  if (!roomsBuilding.value) return;
  roomsLoading.value = true;
  roomError.value = "";
  try {
    rooms.value = await api.rooms(roomsBuilding.value.id);
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

/* ---------- 员工账号 ---------- */
const ROLE_OPTIONS = [
  { value: "building-manager", label: "楼长" },
  { value: "fulltime-rider", label: "全职配送员" },
  { value: "parttime-rider", label: "兼职配送员" },
];
function staffPayload(d: Record<string, any>) {
  const payload: Record<string, any> = {
    name: String(d.name || "").trim(),
    role: d.role,
    staffNo: String(d.staffNo || "").trim(),
    status: d.status,
  };
  if (d.buildingId) payload.buildingId = d.buildingId;
  return payload;
}
function openStaffCreate() {
  void ensureBuildings();
  openForm(
    {
      eyebrow: "NEW STAFF",
      title: "新增员工账号",
      submit: "创建账号",
      done: "员工账号已创建",
      fields: [
        { key: "name", label: "姓名", placeholder: "真实姓名" },
        { key: "staffNo", label: "工号", placeholder: "例如：BM-006" },
        { key: "role", label: "角色", type: "select", options: () => ROLE_OPTIONS },
        { key: "buildingId", label: "绑定楼栋（配送员可不绑）", type: "select", wide: true, optional: true, options: buildingOptions },
        { key: "status", label: "状态", type: "select", options: () => [
          { value: "online", label: "在职" },
          { value: "offline", label: "离线" },
        ] },
      ],
      save: async (d) => void (await api.createStaff(staffPayload(d))),
    },
    { name: "", staffNo: "", role: "building-manager", buildingId: "", status: "online" },
  );
}
function openStaffEdit(row: any) {
  selected.value = undefined;
  void ensureBuildings();
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
        { key: "buildingId", label: "绑定楼栋（配送员可不绑）", type: "select", wide: true, optional: true, options: buildingOptions },
        { key: "status", label: "状态", type: "select", options: () => [
          { value: "online", label: "在职" },
          { value: "offline", label: "离线" },
        ] },
      ],
      save: async (d) => void (await api.updateStaff(row.id, staffPayload(d))),
    },
    {
      name: row.name,
      staffNo: row.staffNo,
      role: row.role ?? row.roleText,
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
    notify("员工账号已软删除");
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
        { key: "name", label: "券名称", placeholder: "例如：满 20 减 5 寝室券", wide: true },
        { key: "amount", label: "面额（元）", type: "number", min: 0.01, step: 0.01 },
        { key: "threshold", label: "使用门槛（元）", type: "number", min: 0, step: 0.01 },
        { key: "total", label: "发放总量", type: "number", min: 1 },
        { key: "expiresAt", label: "有效期至", type: "date" },
      ],
      save: async (d) => {
        if (!String(d.name || "").trim()) throw new Error("请填写券名称");
        if (!d.expiresAt) throw new Error("请选择有效期");
        await api.createCoupon({
          name: String(d.name).trim(),
          amount: Number(d.amount),
          threshold: Number(d.threshold),
          total: Number(d.total),
          expiresAt: d.expiresAt,
        });
      },
    },
    { name: "", amount: 5, threshold: 20, total: 100, expiresAt: nextMonth },
  );
}
async function toggleCoupon() {
  if (!selected.value) return;
  const next = selected.value.status === "paused" ? "active" : "paused";
  try {
    await api.updateCouponStatus(selected.value.id, next);
    notify(next === "paused" ? "优惠券已暂停发放" : "优惠券已重新启用");
    selected.value = undefined;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
/* 定向发放抽屉 */
const issueOpen = ref(false),
  issueCouponRow = ref<any>(),
  users = ref<any[]>([]),
  usersLoading = ref(false),
  usersError = ref(""),
  issueChecked = ref<Record<string, boolean>>({}),
  manualUserIds = ref("");
async function openIssue(coupon: any) {
  selected.value = undefined;
  issueCouponRow.value = coupon;
  issueOpen.value = true;
  usersError.value = "";
  issueChecked.value = {};
  manualUserIds.value = "";
  usersLoading.value = true;
  try {
    users.value = await api.adminUsers();
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
function userLabel(u: any) {
  return u.name || u.nickname || u.phone || u.id;
}
function userSub(u: any) {
  return u.phone || u.id;
}
async function confirmIssue() {
  if (!issueCouponRow.value) return;
  const ids = selectedUserIds.value;
  if (!ids.length) {
    usersError.value = "请先勾选或输入至少一名用户";
    return;
  }
  usersError.value = "";
  try {
    await api.issueCoupon(issueCouponRow.value.id, ids);
    notify(`已向 ${ids.length} 名用户定向发放`);
    issueOpen.value = false;
    await load();
  } catch (error) {
    usersError.value = error instanceof Error ? error.message : "发放失败";
  }
}

/* ---------- 库存：出入库操作 + 流水 ---------- */
const productsCache = ref<any[]>([]);
async function ensureProducts() {
  if (!productsCache.value.length) productsCache.value = await api.products();
  return productsCache.value;
}
function productOptions() {
  return productsCache.value.map((p) => ({
    value: p.id,
    label: `${p.name}（可售 ${p.availableStock ?? p.stock ?? 0}）`,
  }));
}
function openStockForm(kind: "stock-in" | "adjust") {
  void ensureProducts();
  const isStockIn = kind === "stock-in";
  openForm(
    {
      eyebrow: isStockIn ? "STOCK IN" : "STOCK ADJUST",
      title: isStockIn ? "采购入库" : "盘点调整",
      submit: isStockIn ? "确认入库" : "确认调整",
      done: isStockIn ? "入库成功，库存已更新" : "盘点调整已生效",
      fields: [
        { key: "productId", label: "商品", type: "select", wide: true, options: productOptions },
        {
          key: isStockIn ? "quantity" : "delta",
          label: isStockIn ? "入库数量" : "调整数量（正加负减）",
          type: "number",
          step: 1,
          placeholder: isStockIn ? "本次采购入库数量" : "例如 -3 表示盘亏 3 件",
        },
        { key: "reason", label: "原因备注", placeholder: isStockIn ? "例如：8 月第二周采购" : "例如：月底盘点盘亏", wide: true },
      ],
      save: async (d) => {
        if (!d.productId) throw new Error("请选择商品");
        const reason = String(d.reason || "").trim();
        if (!reason) throw new Error("请填写原因备注");
        const qty = Number(isStockIn ? d.quantity : d.delta);
        if (!Number.isFinite(qty) || (isStockIn ? qty <= 0 : qty === 0))
          throw new Error(
            isStockIn ? "入库数量必须大于 0" : "调整数量不能为 0",
          );
        if (isStockIn)
          await api.stockIn({ productId: d.productId, quantity: qty, reason });
        else
          await api.adjustInventory({ productId: d.productId, delta: qty, reason });
      },
    },
    isStockIn
      ? { productId: "", quantity: 1, reason: "" }
      : { productId: "", delta: 1, reason: "" },
  );
}
const invTab = ref("stock");
function switchInvTab(tab: string) {
  invTab.value = tab;
  statusFilter.value = "all";
  page.value = 1;
}
const inventoryTxnsConfig = {
  title: "库存与批次",
  eyebrow: "WAREHOUSE INVENTORY",
  desc: "掌握实际、锁定和可售库存，提前处理临期预警。",
  loader: () => api.inventoryTxns(),
  columns: [
    ["createdAt", "时间"],
    ["type", "类型"],
    ["name", "商品"],
    ["quantity", "数量"],
    ["reason", "原因"],
    ["operator", "操作人"],
  ],
};

const configs: Record<string, any> = {
  orders: {
    title: "订单与履约",
    eyebrow: "ORDER CONTROL",
    desc: "监控订单全生命周期与两段配送进度。",
    loader: api.orders,
    columns: [
      ["orderNo", "订单编号"],
      ["statusText", "当前状态"],
      ["payableAmount", "实付金额"],
      ["estimatedArrival", "时效"],
      ["packageNo", "包裹"],
    ],
  },
  products: {
    title: "商品管理",
    eyebrow: "PRODUCT CENTER",
    desc: "维护商品资料、校园售价与销售状态。",
    loader: api.products,
    columns: [
      ["skuNo", "SKU"],
      ["name", "商品"],
      ["categoryId", "分类"],
      ["price", "售价"],
      ["availableStock", "可售库存"],
      ["status", "状态"],
    ],
  },
  inventory: {
    title: "库存与批次",
    eyebrow: "WAREHOUSE INVENTORY",
    desc: "掌握实际、锁定和可售库存，提前处理临期预警。",
    loader: api.inventory,
    columns: [
      ["skuNo", "SKU"],
      ["name", "商品"],
      ["batchNo", "批次"],
      ["actualStock", "实际"],
      ["lockedStock", "锁定"],
      ["availableStock", "可售"],
      ["expiryDate", "有效期"],
    ],
  },
  staff: {
    title: "履约人员",
    eyebrow: "TEAM PERFORMANCE",
    desc: "楼长与配送员账号状态、绩效和服务范围。",
    loader: api.staff,
    columns: [
      ["staffNo", "工号"],
      ["name", "姓名"],
      ["roleText", "角色"],
      ["building", "服务范围"],
      ["completedToday", "今日完成"],
      ["onTimeRate", "准时率"],
      ["online", "状态"],
    ],
  },
  "after-sales": {
    title: "售后与退款",
    eyebrow: "AFTER-SALES DESK",
    desc: "集中审核质量投诉、退款与异常凭证。",
    loader: api.afterSales,
    columns: [
      ["id", "售后单"],
      ["type", "类型"],
      ["description", "问题描述"],
      ["status", "状态"],
      ["createdAt", "申请时间"],
    ],
  },
  finance: {
    title: "财务结算",
    eyebrow: "FINANCE SETTLEMENT",
    desc: "月度账单、配送提成和跨期调整。",
    loader: api.settlements,
    columns: [
      ["staffName", "人员"],
      ["roleText", "角色"],
      ["period", "账期"],
      ["baseSalary", "底薪"],
      ["commission", "提成"],
      ["adjustment", "调整"],
      ["payable", "应结"],
      ["status", "状态"],
    ],
  },
  campuses: {
    title: "校园与组织",
    eyebrow: "CAMPUS NETWORK",
    desc: "管理楼栋、寝室与员工账号的组织服务网络。",
    loader: api.buildings,
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
    loader: api.coupons,
    columns: [
      ["name", "优惠券"],
      ["amount", "面额"],
      ["threshold", "门槛"],
      ["total", "总量"],
      ["remain", "剩余"],
      ["claimed", "领取"],
      ["used", "核销"],
      ["status", "状态"],
    ],
  },
  audit: {
    title: "审计日志",
    eyebrow: "AUDIT TRAIL",
    desc: "追踪关键状态、金额与权限变更。",
    loader: api.audits,
    columns: [
      ["createdAt", "时间"],
      ["operator", "操作人"],
      ["action", "动作"],
      ["entityType", "对象"],
      ["entityId", "对象 ID"],
    ],
  },
};
const createLabels: Record<string, string> = {
  products: "＋ 新建记录",
  marketing: "＋ 新建优惠券",
  campuses: "＋ 新建楼栋",
  staff: "＋ 新建员工账号",
};
const section = computed(() => String(route.params.section)),
  config = computed(() => {
    if (section.value === "inventory" && invTab.value === "txns")
      return inventoryTxnsConfig;
    return configs[section.value] || configs.orders;
  }),
  canCreate = computed(() => Boolean(createLabels[section.value])),
  filtered = computed(() =>
    rows.value.filter(
      (row) =>
        JSON.stringify(row)
          .toLowerCase()
          .includes(keyword.value.toLowerCase()) &&
        (statusFilter.value === "all" ||
          [row.status, row.statusText, String(row.online)].some((value) =>
            String(value ?? "").includes(statusFilter.value),
          )),
    ),
  ),
  totalPages = computed(() =>
    Math.max(1, Math.ceil(filtered.value.length / pageSize)),
  ),
  paged = computed(() =>
    filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize),
  );
async function load() {
  loading.value = true;
  await ensureLogin();
  rows.value = await config.value.loader();
  loading.value = false;
}
onMounted(load);
watch(
  () => route.query.q,
  (value) => {
    keyword.value = String(value ?? "");
    page.value = 1;
  },
  { immediate: true },
);
watch([keyword, statusFilter], () => (page.value = 1));
watch(
  () => route.params.section,
  () => {
    selected.value = undefined;
    invTab.value = "stock";
    load();
  },
);
function display(row: any, key: string) {
  const v = row[key];
  if (key === "hasElevator") return row.hasElevator ? "有电梯" : "无电梯";
  if (key === "gender")
    return (
      ({ male: "男生", female: "女生", mixed: "混合" } as Record<string, string>)[
        String(v)
      ] ?? (v || "—")
    );
  if (key === "expiresAt")
    return v ? String(v).replace("T", " ").slice(0, 10) : "—";
  if (typeof v === "boolean") return v ? "在线" : "离线";
  if (
    typeof v === "number" &&
    [
      "price",
      "payableAmount",
      "baseSalary",
      "commission",
      "adjustment",
      "payable",
      "amount",
      "threshold",
    ].includes(key)
  )
    return `¥${v}`;
  if (key === "onTimeRate") return `${v}%`;
  if (key === "createdAt") return String(v).replace("T", " ").slice(0, 16);
  return v ?? "—";
}
function txnQuantity(row: any) {
  const v = row.quantity ?? row.delta;
  if (v === undefined || v === null) return "—";
  return row.type === "adjust" && Number(v) > 0 ? `+${v}` : String(v);
}
function notify(text: string, isError = false) {
  message.value = text;
  messageError.value = isError;
  setTimeout(() => (message.value = ""), 2600);
}
function openDetail(row: any) {
  confirmDelete.value = false;
  selected.value = { ...row };
}
async function act(action: string) {
  if (!selected.value) return;
  try {
    if (section.value === "products")
      await api.updateProduct(selected.value.id, {
        price: Number(selected.value.price),
        stock: Number(selected.value.availableStock),
      });
    else if (section.value === "orders")
      await api.orderAction(selected.value.id, action);
    else if (section.value === "after-sales")
      await api.reviewAfterSale(selected.value.id, action === "approve");
    messageError.value = false;
    message.value = "操作成功，数据已同步";
    selected.value = undefined;
    await load();
    setTimeout(() => (message.value = ""), 2200);
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", true);
  }
}
function exportData() {
  const csv = [
    config.value.columns.map((c: any) => c[1]),
    ...filtered.value.map((row) =>
      config.value.columns.map((c: any) =>
        c[0] === "quantity" && section.value === "inventory"
          ? txnQuantity(row)
          : display(row, c[0]),
      ),
    ),
  ]
    .map((line) =>
      line.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv" }),
  );
  a.download = `${config.value.title}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function openCreate() {
  if (section.value === "products") {
    creating.value = true;
    scanError.value = "";
    productForm.value = {
      barcode: "",
      name: "",
      subtitle: "",
      categoryId: "snack",
      price: 0,
      originalPrice: 0,
      stock: 0,
      tag: "新品",
      image: "",
      weight: 0,
    };
  } else if (section.value === "marketing") openCouponCreate();
  else if (section.value === "campuses") openBuildingCreate();
  else if (section.value === "staff") openStaffCreate();
}
function closeCreate() {
  stopScan();
  creating.value = false;
}
async function lookup() {
  const code = productForm.value.barcode.trim();
  if (!/^\d{8,14}$/.test(code)) {
    scanError.value = "请输入 8—14 位商品条码";
    return;
  }
  const result = await api.lookupBarcode(code);
  if (result.found && result.exists !== false) {
    scanError.value = "该商品已存在，可直接编辑库存与价格";
    selected.value = {
      ...result.product,
      availableStock: result.product.stock,
    };
    closeCreate();
    return;
  }
  productForm.value = { ...productForm.value, ...result.product };
  scanError.value = result.found
    ? "已从公共条码库带出基础资料，请核对价格和库存"
    : "未匹配到商品资料，请补全后保存";
}
async function startScan() {
  scanError.value = "";
  const Detector = (window as any).BarcodeDetector;
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
  await api.createProduct(productForm.value);
  notify("SKU 已录入，商品数据已同步");
  closeCreate();
  await load();
}
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <p class="eyebrow">{{ config.eyebrow }}</p>
        <h1>{{ config.title }}</h1>
        <p>{{ config.desc }}</p>
      </div>
      <button
        class="btn primary"
        :disabled="!canCreate"
        @click="openCreate"
      >
        {{ createLabels[section] || "＋ 新建记录" }}
      </button>
    </div>
    <div class="toolbar">
      <div
        v-if="section === 'inventory'"
        class="segmented inv-tabs"
      >
        <button :class="{ active: invTab === 'stock' }" @click="switchInvTab('stock')">
          当前库存
        </button>
        <button :class="{ active: invTab === 'txns' }" @click="switchInvTab('txns')">
          出入库流水
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
      <select
        v-if="!(section === 'inventory' && invTab === 'txns')"
        v-model="statusFilter"
        class="filter-btn"
        aria-label="状态筛选"
      >
        <option value="all">全部状态</option>
        <option value="on-sale">销售中</option>
        <option value="pending">待处理</option>
        <option value="completed">已完成</option>
        <option value="true">在线</option>
        <option value="false">离线</option>
      </select>
      <div class="toolbar-spacer"></div>
      <template v-if="section === 'inventory' && invTab === 'stock'">
        <button class="btn ghost" @click="openStockForm('adjust')">
          盘点调整
        </button>
        <button class="btn primary" @click="openStockForm('stock-in')">
          采购入库
        </button>
      </template>
      <button class="btn ghost" @click="exportData">导出数据</button>
    </div>
    <div class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ filtered.length }}</strong
          ><span> 条记录</span>
        </div>
        <p>
          <span class="live-dot"></span>
          {{ section === "inventory" && invTab === "txns" ? "流水已同步" : "数据已同步" }}
        </p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="col in config.columns" :key="col[0]">{{ col[1] }}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 6" :key="i">
              <td :colspan="config.columns.length + 1">
                <div class="row-skeleton"></div>
              </td>
            </tr>
            <tr v-for="row in paged" :key="row.id || row.orderNo">
              <td v-for="col in config.columns" :key="col[0]">
                <span
                  v-if="col[0] === 'type' && section === 'inventory' && invTab === 'txns'"
                  class="status"
                  :class="{ success: row.type === 'stock-in' }"
                  >{{ row.type === "stock-in" ? "采购入库" : "盘点调整" }}</span
                ><span
                  v-else-if="['status', 'statusText', 'online'].includes(col[0])"
                  class="status"
                  :class="{
                    success: String(display(row, col[0])).match(
                      /在线|完成|active|on-sale|confirmed|approved/,
                    ),
                    warning: String(display(row, col[0])).match(/待|pending|paused/),
                  }"
                  >{{ display(row, col[0]) }}</span
                ><strong
                  v-else-if="['name', 'orderNo', 'staffName'].includes(col[0])"
                  >{{ display(row, col[0]) }}</strong
                ><span v-else-if="col[0] === 'quantity' && section === 'inventory' && invTab === 'txns'">{{
                  txnQuantity(row)
                }}</span
                ><span v-else>{{ display(row, col[0]) }}</span>
              </td>
              <td>
                <button
                  class="more"
                  aria-label="更多操作"
                  @click="openDetail(row)"
                >
                  •••
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span
          >第 {{ page }} / {{ totalPages }} 页，共
          {{ filtered.length }} 条</span
        >
        <div>
          <button :disabled="page === 1" @click="page--">←</button
          ><button class="active">{{ page }}</button
          ><button :disabled="page === totalPages" @click="page++">→</button>
        </div>
      </div>
    </div>
    <div v-if="selected" class="drawer-mask" @click.self="selected = undefined">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">RECORD DETAIL</p>
            <h2>记录详情与操作</h2>
          </div>
          <button aria-label="关闭" @click="selected = undefined">×</button>
        </div>
        <div class="drawer-fields">
          <template v-if="section === 'products'"
            ><label
              >校园售价<input
                v-model.number="selected.price"
                type="number"
                min="0" /></label
            ><label
              >可售库存<input
                v-model.number="selected.availableStock"
                type="number"
                min="0" /></label
          ></template>
          <div v-for="col in config.columns" :key="col[0]">
            <span>{{ col[1] }}</span
            ><strong v-if="col[0] === 'quantity' && section === 'inventory' && invTab === 'txns'">{{
              txnQuantity(selected)
            }}</strong
            ><strong v-else>{{ display(selected, col[0]) }}</strong>
          </div>
        </div>
        <div class="drawer-actions wrap">
          <template v-if="section === 'products'">
            <button class="btn primary" @click="act('save')">
              保存商品调整</button
          ></template>
          <template v-else-if="section === 'orders'"
            ><button class="btn primary" @click="act('advance')">
              推进履约</button
            ><button class="btn danger-btn" @click="act('mark-exception')">
              标记异常
            </button></template
          >
          <template v-else-if="section === 'after-sales'"
            ><button class="btn primary" @click="act('approve')">
              审核通过</button
            ><button class="btn danger-btn" @click="act('reject')">
              驳回申请
            </button></template
          >
          <template v-else-if="section === 'marketing'">
            <button class="btn primary" @click="toggleCoupon">
              {{ selected.status === "paused" ? "启用优惠券" : "暂停发放" }}
            </button>
            <button class="btn ghost" @click="openIssue(selected)">
              定向发放
            </button>
          </template>
          <template v-else-if="section === 'campuses'">
            <button class="btn primary" @click="openBuildingEdit(selected)">
              编辑楼栋</button
            ><button class="btn ghost" @click="openRooms(selected)">
              寝室管理
            </button
            ><button class="btn danger-btn" @click="removeBuilding">
              {{ confirmDelete ? "确认删除" : "删除楼栋" }}
            </button>
          </template>
          <template v-else-if="section === 'staff'">
            <button class="btn primary" @click="openStaffEdit(selected)">
              编辑员工</button
            ><button class="btn danger-btn" @click="removeStaff">
              {{ confirmDelete ? "确认软删除" : "软删除账号" }}
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
            <p class="eyebrow">{{ formMeta?.eyebrow }}</p>
            <h2>{{ formMeta?.title }}</h2>
          </div>
          <button aria-label="关闭" @click="formOpen = false">×</button>
        </div>
        <div class="product-form">
          <template v-for="field in formMeta?.fields" :key="field.key">
            <label v-if="field.type === 'checkbox'" :class="{ wide: field.wide }">
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
              }}<select v-model="formData[field.key]">
                <option v-if="field.optional" value="">不绑定</option>
                <option
                  v-for="option in fieldOptions(field)"
                  :key="String(option.value)"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select></label
            >
            <label v-else :class="{ wide: field.wide }"
              >{{ field.label
              }}<input
                v-model="formData[field.key]"
                :type="field.type || 'text'"
                :min="field.min"
                :step="field.step"
                :placeholder="field.placeholder"
            /></label>
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
            <p class="eyebrow">ROOM MANAGEMENT</p>
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
        <p v-if="roomError" class="form-hint">{{ roomError }}</p>
        <p v-if="roomsLoading" class="form-hint plain">正在加载寝室列表...</p>
        <div v-else class="room-list">
          <div v-if="!rooms.length" class="form-hint plain">
            该楼栋还没有寝室记录，先在上方添加。
          </div>
          <div v-for="room in rooms" :key="room.id" class="room-row">
            <strong>{{ room.floor }} 层 · {{ room.roomNo }} 寝</strong>
            <small>二维码令牌 {{ room.qrToken }}</small>
            <button
              class="text-btn danger-text"
              @click="removeRoom(room.id)"
            >
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
            <p class="eyebrow">TARGETED ISSUE</p>
            <h2>定向发放 · {{ issueCouponRow?.name }}</h2>
          </div>
          <button aria-label="关闭" @click="issueOpen = false">×</button>
        </div>
        <p class="form-hint plain">
          勾选目标用户后发放，同一用户不会重复获得未使用的券。
        </p>
        <p v-if="usersLoading" class="form-hint plain">正在加载用户列表...</p>
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
        <p v-if="usersError" class="form-hint">{{ usersError }}</p>
        <p class="form-hint plain">
          已选择 {{ selectedUserIds.length }} 名用户
        </p>
        <div class="drawer-actions">
          <button class="btn ghost" @click="issueOpen = false">取消</button
          ><button
            class="btn primary"
            :disabled="!selectedUserIds.length"
            @click="confirmIssue"
          >
            确认发放
          </button>
        </div>
      </aside>
    </div>
    <div v-if="creating" class="drawer-mask" @click.self="closeCreate">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">BARCODE ENTRY</p>
            <h2>扫码录入 SKU</h2>
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
            placeholder="也可以使用扫码枪或手工输入条码"
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
              <option value="snack">零食饮料</option>
              <option value="daily">日用品</option>
              <option value="instant">方便速食</option>
              <option value="fruit">水果</option>
            </select></label
          >
          <label>标签<input v-model.trim="productForm.tag" /></label>
          <label
            >校园售价<input
              v-model.number="productForm.price"
              type="number"
              min="0"
              step="0.01"
          /></label>
          <label
            >建议零售价<input
              v-model.number="productForm.originalPrice"
              type="number"
              min="0"
              step="0.01"
          /></label>
          <label
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
          <label class="wide"
            >商品图片 URL<input
              v-model.trim="productForm.image"
              placeholder="后续可替换为对象存储上传"
          /></label>
        </div>
        <div class="drawer-actions">
          <button class="btn ghost" @click="closeCreate">取消</button
          ><button class="btn primary" @click="saveProduct">保存并上架</button>
        </div>
      </aside>
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
