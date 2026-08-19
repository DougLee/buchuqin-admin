<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, fetchAllPages } from "../api";
import { canWrite, ROLE_LABELS, type AdminRole } from "../session";
import { fenToYuan, yuanToFen } from "../utils/money";
import type {
  AccountRow,
  AdminRow,
  AdminUser,
  AfterSale,
  AfterSaleRow,
  BarcodeLookup,
  Building,
  CommissionRule,
  Coupon,
  DispatchInvitation,
  DispatchRow,
  InventoryTxn,
  LeaveRequest,
  LeaveRow,
  ListQuery,
  Order,
  PagedResponse,
  Product,
  Room,
  RuleRow,
  Settlement,
  Staff,
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
  productEdit = ref({ price: 0, stock: 0 }),
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
  exporting = ref(false),
  page = ref(1),
  pageSize = ref(10),
  total = ref(0),
  jumpTo = ref<number | "">(""),
  keywordTimer = ref<ReturnType<typeof setTimeout>>();
const PAGE_SIZES = [10, 20, 50];
let cameraStream: MediaStream | undefined;

/* ---------- 通用表单抽屉（新建/编辑：优惠券、楼栋、员工、库存操作） ---------- */
type FormValue = string | number | boolean;
interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime" | "select" | "checkbox" | "password";
  options?: () => { value: string | number; label: string }[];
  placeholder?: string;
  wide?: boolean;
  min?: number;
  step?: number;
  optional?: boolean;
  optionalLabel?: string;
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
    { name: "", floors: 6, gender: "mixed", hasElevator: true },
  );
}
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

/* ---------- 员工账号 ---------- */
const ROLE_OPTIONS = [
  { value: "building-manager", label: "楼长" },
  { value: "fulltime-rider", label: "全职配送员" },
  { value: "parttime-rider", label: "兼职配送员" },
];
function staffPayload(d: Record<string, FormValue>) {
  const payload: Record<string, FormValue> = {
    name: String(d.name || "").trim(),
    role: String(d.role || ""),
    staffNo: String(d.staffNo || "").trim(),
    status: String(d.status || "online"),
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
function openStaffEdit(row: Staff) {
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
        // 面额/门槛表单输元，提交前统一转分
        await api.createCoupon({
          name: String(d.name).trim(),
          amount: yuanToFen(d.amount),
          threshold: yuanToFen(d.threshold),
          total: Number(d.total),
          expiresAt: String(d.expiresAt),
        });
      },
    },
    { name: "", amount: 5, threshold: 20, total: 100, expiresAt: nextMonth },
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
  manualUserIds = ref("");
async function openIssue(coupon: Coupon) {
  selected.value = undefined;
  issueCouponRow.value = coupon;
  issueOpen.value = true;
  usersError.value = "";
  issueChecked.value = {};
  manualUserIds.value = "";
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
  return u.nickname || u.phone || u.id;
}
function userSub(u: AdminUser) {
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
function openAccountCreate() {
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
        { key: "role", label: "角色", type: "select", options: () => ACCOUNT_ROLE_OPTIONS },
      ],
      save: async (d) =>
        void (await api.createAccount({
          username: String(d.username || "").trim(),
          password: String(d.password || ""),
          nickname: String(d.nickname || "").trim(),
          role: String(d.role || ""),
        })),
    },
    { username: "", password: "", nickname: "", role: "operations" },
  );
}
function openAccountEdit(row: AdminRow) {
  const account = row as AccountRow;
  selected.value = undefined;
  openForm(
    {
      eyebrow: "EDIT ADMIN ACCOUNT",
      title: `编辑账号 ${account.username}`,
      submit: "保存修改",
      done: "账号已更新",
      fields: [
        { key: "nickname", label: "昵称" },
        { key: "role", label: "角色", type: "select", options: () => ACCOUNT_ROLE_OPTIONS },
      ],
      save: async (d) =>
        void (await api.updateAccount(account.id, {
          nickname: String(d.nickname || "").trim(),
          role: String(d.role || ""),
        })),
    },
    { nickname: account.nickname, role: account.role },
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
  if (!productsCache.value.length)
    productsCache.value = await fetchAllPages(api.products);
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
          await api.stockIn({ productId: String(d.productId), quantity: qty, reason });
        else
          await api.adjustInventory({ productId: String(d.productId), delta: qty, reason });
      },
    },
    isStockIn
      ? { productId: "", quantity: 1, reason: "" }
      : { productId: "", delta: 1, reason: "" },
  );
}
const invTab = ref("stock");
/** 状态筛选重置为 all；值有变化时由 statusFilter watcher 接管重载，避免重复请求。 */
function resetStatusFilterAndLoad() {
  if (statusFilter.value === "all") resetAndLoad();
  else statusFilter.value = "all";
}
function switchInvTab(tab: string) {
  invTab.value = tab;
  resetStatusFilterAndLoad();
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
/** 各板块表格统一返回：当前页行 + 服务端总数。 */
interface PageRows {
  rows: AdminRow[];
  total: number;
}
/** 分页响应拆包（items → rows + total）。 */
function unwrap<T extends AdminRow>(res: PagedResponse<T>): PageRows {
  return { rows: res.items, total: res.total };
}
interface SectionConfig {
  title: string;
  eyebrow: string;
  desc: string;
  loader: (query: ListQuery) => Promise<PageRows>;
  columns: [string, string][];
}
const inventoryTxnsConfig: SectionConfig = {
  title: "库存与批次",
  eyebrow: "WAREHOUSE INVENTORY",
  desc: "掌握实际、锁定和可售库存，提前处理临期预警。",
  loader: (query) => api.inventoryTxns(undefined, query).then(unwrap),
  columns: [
    ["createdAt", "时间"],
    ["type", "类型"],
    ["product", "商品"],
    ["quantity", "数量"],
    ["reason", "原因"],
    ["operator", "操作人"],
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
    createdAt: a.createdAt,
    ...(a.order ? { order: a.order } : {}),
  };
}
/**
 * 凭证图片地址归一化：COS 绝对地址（http/https/协议相对）原样使用；
 * 相对路径拼当前源（与 /api 同域，生产环境后台与 API 同站部署）。
 */
function resolveImageUrl(src: string): string {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;
  const origin = window.location.origin;
  return `${origin}${src.startsWith("/") ? "" : "/"}${src}`;
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

const dispatchLeavesConfig: SectionConfig = {
  title: "调配与请假",
  eyebrow: "DISPATCH DESK",
  desc: "楼长请假与跨楼调配邀请，保障楼栋服务覆盖。",
  loader: async (query) => {
    const res = await api.leaveRequests(query);
    return { rows: res.items.map(toLeaveRow), total: res.total };
  },
  columns: [
    ["staffName", "楼长"],
    ["staffNo", "工号"],
    ["building", "负责楼栋"],
    ["startAt", "开始时间"],
    ["endAt", "结束时间"],
    ["statusText", "请假状态"],
  ],
};
const dispatchInvitesConfig: SectionConfig = {
  title: "调配与请假",
  eyebrow: "DISPATCH DESK",
  desc: "已发出的调配邀请与楼长接受状态，仅待接受可取消。",
  loader: async (query) => {
    const res = await api.dispatchInvitations(query);
    return { rows: res.items.map(toInviteRow), total: res.total };
  },
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
const configs: Record<string, SectionConfig> = {
  orders: {
    title: "订单与履约",
    eyebrow: "ORDER CONTROL",
    desc: "监控订单全生命周期与两段配送进度。",
    loader: (query) => api.orders("all", query).then(unwrap),
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
    loader: (query) => api.products(query).then(unwrap),
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
    loader: (query) => api.inventory(query).then(unwrap),
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
    loader: (query) => api.staff(query).then(unwrap),
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
    loader: async (query) => {
      const res = await api.afterSales(query);
      return { rows: res.items.map(toAfterSaleRow), total: res.total };
    },
    columns: [
      ["id", "售后单号"],
      ["userId", "用户"],
      ["orderId", "订单号"],
      ["typeText", "类型"],
      ["description", "问题描述"],
      ["createdAt", "申请时间"],
      ["status", "状态"],
    ],
  },
  finance: {
    title: "财务结算",
    eyebrow: "FINANCE SETTLEMENT",
    desc: "月度账单确认、打款与跨期调整（月份可筛选）。",
    loader: (query) => api.settlements(month.value, query).then(unwrap),
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
  campuses: {
    title: "校园与组织",
    eyebrow: "CAMPUS NETWORK",
    desc: "管理楼栋、寝室与员工账号的组织服务网络。",
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
    loader: (query) => api.coupons(query).then(unwrap),
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
    loader: (query) => api.audits(query).then(unwrap),
    columns: [
      ["createdAt", "时间"],
      ["operator", "操作人"],
      ["action", "动作"],
      ["entityType", "对象"],
      ["entityId", "对象 ID"],
    ],
  },
  accounts: {
    title: "账号管理",
    eyebrow: "ADMIN ACCOUNTS",
    desc: "后台账号的创建、角色分配与密码重置（仅超管）。",
    loader: (query) =>
      api.adminAccounts(query).then((res) => ({
        total: res.total,
        rows: res.items.map((x) => ({
          ...x,
          roleText: ROLE_LABELS[x.role as AdminRole] ?? x.role,
        })),
      })),
    columns: [
      ["username", "账号"],
      ["nickname", "昵称"],
      ["roleText", "角色"],
      ["createdAt", "创建时间"],
    ],
  },
};
const createLabels: Record<string, string> = {
  products: "＋ 新建记录",
  marketing: "＋ 新建优惠券",
  campuses: "＋ 新建楼栋",
  staff: "＋ 新建员工账号",
  dispatch: "＋ 邀请调配",
  rules: "＋ 新建提成规则",
  accounts: "＋ 新建后台账号",
};
const section = computed(() => String(route.params.section)),
  config = computed<SectionConfig>(() => {
    if (section.value === "inventory" && invTab.value === "txns")
      return inventoryTxnsConfig;
    if (section.value === "dispatch")
      return dispTab.value === "leaves"
        ? dispatchLeavesConfig
        : dispatchInvitesConfig;
    return configs[section.value] || configs.orders;
  }),
  canWriteSection = computed(() => canWrite(section.value)),
  canCreate = computed(
    () => Boolean(createLabels[section.value]) && canWriteSection.value,
  ),
  filtered = computed(() =>
    // 服务端分页 + 服务端 keyword 过滤（IK8W5X 契约收尾）：rows 即命中当前页；
    // 前端仅保留状态 tab 的展示级筛选。
    rows.value.filter((row) => {
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
async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await config.value.loader({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
    });
    rows.value = result.rows;
    total.value = result.total;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    loadError.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
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
watch(keyword, () => {
  if (keywordTimer.value) clearTimeout(keywordTimer.value);
  keywordTimer.value = setTimeout(resetAndLoad, 350);
});
watch(statusFilter, () => resetAndLoad());
watch(
  () => route.params.section,
  () => {
    selected.value = undefined;
    invTab.value = "stock";
    dispTab.value = "leaves";
    resetAndLoad();
  },
);
const STATUS_TEXT: Record<string, string> = {
  "pending-review": "待复核",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  confirmed: "已确认",
  paid: "已支付",
  active: "启用",
  paused: "已暂停",
  disabled: "已停用",
};
/** 金额字段（契约：整数分），统一经 fenToYuan 展示为 ¥xx.xx。 */
const MONEY_KEYS = [
  "price",
  "originalPrice",
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
  "threshold",
  "reward",
];
function display(row: AdminRow, key: string) {
  const record = row as unknown as Record<string, unknown>;
  const v = record[key];
  if (key === "hasElevator") return record.hasElevator ? "有电梯" : "无电梯";
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
  if (key === "floor")
    return v === null || v === undefined || v === "" ? "*" : String(v);
  if (key === "expiresAt")
    return v ? String(v).replace("T", " ").slice(0, 10) : "—";
  if (typeof v === "boolean") return v ? "在线" : "离线";
  if (typeof v === "number" && MONEY_KEYS.includes(key))
    return `¥${fenToYuan(v)}`;
  if (key === "onTimeRate") return `${v}%`;
  if (key === "status" && typeof v === "string" && STATUS_TEXT[v])
    return STATUS_TEXT[v];
  if (
    ["createdAt", "startAt", "endAt", "effectiveAt", "confirmedAt", "paidAt"].includes(
      key,
    )
  )
    return v ? String(v).replace("T", " ").slice(0, 16) : "—";
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
function txnTypeText(row: AdminRow) {
  return (row as InventoryTxn).type === "stock-in" ? "采购入库" : "盘点调整";
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
  if (section.value === "products") {
    const product = row as Product;
    productEdit.value = {
      // 接口价格为分，编辑框以元展示
      price: Number(fenToYuan(product.price)),
      stock: Number(product.availableStock ?? product.stock ?? 0),
    };
  }
  if (section.value === "after-sales")
    void ensureAfterSaleOrder(row as AfterSaleRow);
}
async function act(action: string) {
  if (!selected.value) return;
  try {
    if (section.value === "products")
      await api.updateProduct(selected.value.id, {
        price: yuanToFen(productEdit.value.price),
        stock: Number(productEdit.value.stock),
      });
    else if (section.value === "orders")
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
  else if (section.value === "dispatch") openInviteForm();
  else if (section.value === "rules") openRuleCreate();
  else if (section.value === "accounts") openAccountCreate();
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
  try {
    const result: BarcodeLookup = await api.lookupBarcode(code);
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
  try {
    // 价格表单输元，提交前统一转分
    await api.createProduct({
      ...productForm.value,
      price: yuanToFen(productForm.value.price),
      originalPrice: yuanToFen(productForm.value.originalPrice),
    });
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
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <p class="eyebrow">{{ config.eyebrow }}</p>
        <h1>{{ config.title }}</h1>
        <p>{{ config.desc }}</p>
      </div>
      <button v-if="canCreate" class="btn primary" @click="openCreate">
        {{ createLabels[section] || "＋ 新建记录" }}
      </button>
    </div>
    <div class="toolbar">
      <div v-if="section === 'inventory'" class="segmented inv-tabs">
        <button :class="{ active: invTab === 'stock' }" @click="switchInvTab('stock')">
          当前库存
        </button>
        <button :class="{ active: invTab === 'txns' }" @click="switchInvTab('txns')">
          出入库流水
        </button>
      </div>
      <div v-if="section === 'dispatch'" class="segmented inv-tabs">
        <button :class="{ active: dispTab === 'leaves' }" @click="switchDispTab('leaves')">
          请假记录
        </button>
        <button :class="{ active: dispTab === 'invites' }" @click="switchDispTab('invites')">
          调配邀请
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
      <div class="toolbar-spacer"></div>
      <template v-if="section === 'inventory' && invTab === 'stock' && canWrite('inventory')">
        <button class="btn ghost" @click="openStockForm('adjust')">
          盘点调整
        </button>
        <button class="btn primary" @click="openStockForm('stock-in')">
          采购入库
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
        <div>
          <strong>{{ total }}</strong
          ><span> 条记录</span>
        </div>
        <p>
          <span class="live-dot"></span>
          {{
            section === "inventory" && invTab === "txns" ? "流水已同步" : "数据已同步"
          }}
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
            <template v-else>
              <tr v-if="!filtered.length">
                <td :colspan="config.columns.length + 1" class="empty-cell">
                  {{ loadError ? "加载失败，请重试" : "暂无数据" }}
                </td>
              </tr>
              <tr v-for="row in filtered" :key="rowKey(row)">
                <td v-for="col in config.columns" :key="col[0]">
                  <span
                    v-if="col[0] === 'type' && section === 'inventory' && invTab === 'txns'"
                    class="status"
                    :class="{ success: isStockIn(row) }"
                    >{{ txnTypeText(row) }}</span
                  ><span
                    v-else-if="['status', 'statusText', 'online'].includes(col[0])"
                    class="status"
                    :class="{
                      success: String(display(row, col[0])).match(
                        /在线|完成|active|on-sale|confirmed|approved|启用|已确认|已支付|已接受|已通过/,
                      ),
                      warning: String(display(row, col[0])).match(
                        /待|pending|paused|已暂停|复核/,
                      ),
                    }"
                    >{{ display(row, col[0]) }}</span
                  ><strong v-else-if="['name', 'orderNo', 'staffName'].includes(col[0])"
                    >{{ display(row, col[0]) }}</strong
                  ><span
                    v-else-if="col[0] === 'quantity' && section === 'inventory' && invTab === 'txns'"
                    >{{ txnQuantity(row) }}</span
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
            </template>
          </tbody>
        </table>
      </div>
      <div class="pagination">
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
            ><button class="active">{{ page }}</button
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
      <aside class="drawer" :class="{ 'product-create': section === 'after-sales' }">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">RECORD DETAIL</p>
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
        <div v-else class="drawer-fields">
          <template v-if="section === 'products' && canWriteSection"
            ><label
              >校园售价<input
                v-model.number="productEdit.price"
                type="number"
                min="0" /></label
            ><label
              >可售库存<input
                v-model.number="productEdit.stock"
                type="number"
                min="0" /></label
          ></template>
          <div v-for="col in config.columns" :key="col[0]">
            <span>{{ col[1] }}</span
            ><strong
              v-if="col[0] === 'quantity' && section === 'inventory' && invTab === 'txns'"
              >{{ txnQuantity(selected) }}</strong
            ><strong v-else>{{ display(selected, col[0]) }}</strong>
          </div>
        </div>
        <div class="drawer-actions wrap">
          <template v-if="section === 'products' && canWriteSection">
            <button class="btn primary" @click="act('save')">
              保存商品调整</button
          ></template>
          <template v-else-if="section === 'orders' && canWriteSection"
            ><button class="btn primary" @click="act('advance')">
              推进履约</button
            ><button class="btn danger-btn" @click="act('mark-exception')">
              标记异常
            </button></template
          >
          <template v-else-if="section === 'after-sales'">
            <p class="form-hint plain processed-hint">
              试点期售后由客服人工处理（不退款），本页仅留档查看。
            </p>
          </template>
          <template v-else-if="section === 'marketing' && canWriteSection">
            <button class="btn primary" @click="toggleCoupon">
              {{ couponPaused ? "启用优惠券" : "暂停发放" }}
            </button>
            <button class="btn ghost" @click="openIssue(selected as Coupon)">
              定向发放
            </button>
          </template>
          <template v-else-if="section === 'campuses' && canWriteSection">
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
              {{ confirmDelete ? "确认软删除" : "软删除账号" }}
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
            <label v-else :class="{ wide: field.wide }"
              >{{ field.label
              }}<input
                v-model="formData[field.key]"
                :type="fieldInputType(field)"
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
