<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, fetchAllPages } from "../../../../api";
import { COUPON_STATUS_TABS } from "../../../../dicts/status-tab";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { AdminUser, Building, Coupon } from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
const rows = ref<Coupon[]>([]),
  loading = ref(false),
  saving = ref(false),
  open = ref(false),
  editing = ref<Coupon | null>(null),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref(""),
  status = ref("all");
const form = reactive({
  kind: "platform" as "platform" | "partner",
  trigger: "manual" as "manual" | "lottery" | "signup",
  name: "",
  remark: "",
  amount: 5,
  threshold: 20,
  totalMode: "limited",
  total: 100,
  expiryMode: "forever",
  expiresAt: "",
  featuredAfterPay: false,
  perUserLimit: 1,
  targetedOnly: false,
});
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function asCoupon(row: unknown) {
  return row as Coupon;
}
async function load() {
  if (!effectiveCampusId.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const r = await api.coupons(
      {
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
        campusId: effectiveCampusId.value,
      },
      status.value === "all" ? undefined : status.value,
    );
    rows.value = r.items;
    total.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "优惠券加载失败", "error");
  } finally {
    loading.value = false;
  }
}
function edit(row?: Coupon) {
  editing.value = row ?? null;
  Object.assign(form, {
    kind: row?.kind ?? "platform",
    trigger: row?.trigger ?? "manual",
    name: row?.name ?? "",
    remark: row?.remark ?? "",
    amount: Number(fenToYuan(row?.amount ?? 500)),
    threshold: Number(fenToYuan(row?.threshold ?? 2000)),
    totalMode: row?.total === null ? "unlimited" : "limited",
    total: row?.total ?? 100,
    expiryMode: row?.expiresAt ? "date" : "forever",
    expiresAt: row?.expiresAt?.slice(0, 10) ?? "",
    featuredAfterPay: !!row?.featuredAfterPay,
    perUserLimit: Number(
      (row as Coupon & { perUserLimit?: number })?.perUserLimit ?? 1,
    ),
    targetedOnly: !!(row as Coupon & { targetedOnly?: boolean })?.targetedOnly,
  });
  open.value = true;
}
async function save() {
  if (!form.name.trim()) return notify("请填写券名称", "error");
  if (form.kind === "platform" && form.amount <= 0)
    return notify("金额券面额必须大于 0", "error");
  if (form.totalMode === "limited" && form.total < 1)
    return notify("限量券总量至少为 1", "error");
  if (form.expiryMode === "date" && !form.expiresAt)
    return notify("请选择有效期", "error");
  saving.value = true;
  try {
    const common = {
      name: form.name.trim(),
      remark: form.remark.trim(),
      featuredAfterPay: form.featuredAfterPay,
      perUserLimit: Math.max(0, form.perUserLimit),
      targetedOnly: form.targetedOnly,
    };
    if (editing.value) {
      await api.updateCoupon(editing.value.id, {
        ...common,
        ...(editing.value.kind === "platform" && !editing.value.claimed
          ? {
              amount: yuanToFen(form.amount),
              threshold: yuanToFen(form.threshold),
            }
          : {}),
        total: form.totalMode === "unlimited" ? null : form.total,
        expiresAt: form.expiryMode === "forever" ? null : form.expiresAt,
      });
    } else {
      await api.createCoupon({
        ...common,
        kind: form.kind,
        trigger: form.trigger,
        amount: form.kind === "partner" ? 0 : yuanToFen(form.amount),
        threshold: form.kind === "partner" ? 0 : yuanToFen(form.threshold),
        ...(form.totalMode === "limited" ? { total: form.total } : {}),
        ...(form.expiryMode === "date" ? { expiresAt: form.expiresAt } : {}),
      });
    }
    open.value = false;
    notify(editing.value ? "优惠券已更新" : "优惠券已创建");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function toggle(row: Coupon) {
  try {
    await api.updateCouponStatus(
      row.id,
      row.status === "active" ? "paused" : "active",
    );
    notify(row.status === "active" ? "优惠券已暂停" : "优惠券已启用");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", "error");
  }
}
async function remove(row: Coupon) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.name}」？`, `删除优惠券`, {
      type: "warning",
    });
    await api.deleteCoupon(row.id);
    notify("优惠券已删除");
    await load();
  } catch (e) {
    if (e !== "cancel" && e !== "close")
      notify(e instanceof Error ? e.message : "删除失败", "error");
  }
}
/* ---------- 定向发放抽屉（自旧版 DataPage 回迁，模块化重构时丢失） ---------- */
const issueOpen = ref(false),
  issueCouponRow = ref<Coupon | null>(null),
  issueCountInput = ref<number | null>(null),
  issueUserSearch = ref(""),
  users = ref<AdminUser[]>([]),
  usersLoading = ref(false),
  usersError = ref(""),
  issueChecked = ref<Record<string, boolean>>({}),
  // IKD6FI：定向方式——用户多选之外新增「按手机号」「按寝室」（楼栋+楼层+寝室号）
  issueMode = ref<"users" | "phones" | "rooms">("users"),
  issuePhones = ref(""),
  issueBuildingId = ref(""),
  issueFloor = ref<number | null>(null),
  issueRoomNos = ref(""),
  buildings = ref<Building[]>([]);
async function openIssue(row: Coupon) {
  issueCouponRow.value = row;
  issueOpen.value = true;
  usersError.value = "";
  issueChecked.value = {};
  issueMode.value = "users";
  issuePhones.value = "";
  issueUserSearch.value = "";
  issueCountInput.value = null;
  issueBuildingId.value = "";
  issueFloor.value = null;
  issueRoomNos.value = "";
  // 寝室定向的楼栋下拉（懒加载一次，失败不阻断用户模式）
  if (!buildings.value.length)
    fetchAllPages(api.buildings)
      .then((list) => (buildings.value = list))
      .catch(() => {});
  usersLoading.value = true;
  try {
    // IKKKC2：定向发券场景明文优先（plainPhone=1 下发），列表页仍走脱敏
    users.value = await fetchAllPages((query) => api.adminUsers(query, true));
  } catch {
    usersError.value = "用户列表加载失败，可改用「按手机号」或「按寝室」方式发放";
  } finally {
    usersLoading.value = false;
  }
}
const selectedUserIds = computed(() =>
  Object.keys(issueChecked.value).filter((id) => issueChecked.value[id]),
);
/** 搜索框过滤已加载用户（昵称 / 手机号包含匹配，勾选状态不受过滤影响）。 */
const issueUserFiltered = computed(() => {
  const kw = issueUserSearch.value.trim();
  if (!kw) return users.value;
  return users.value.filter(
    (u) =>
      u.nickname.includes(kw) ||
      (u.phone || u.phoneMasked || "").includes(kw) ||
      u.id.includes(kw),
  );
});
function userLabel(u: AdminUser) {
  return u.nickname || u.id;
}
function userSub(u: AdminUser) {
  // IKKKC2：定向发券场景明文优先（plainPhone=1 下发）
  return u.phone || u.phoneMasked || u.id;
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
    count?: number;
  } = {};
  if (issueMode.value === "users") {
    const ids = selectedUserIds.value;
    if (!ids.length) {
      usersError.value = "请先勾选至少一名用户";
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
    if (issueFloor.value != null) body.floor = Math.round(issueFloor.value);
    if (issueRoomNoList.value.length) body.roomNos = issueRoomNoList.value;
  }
  // IKKEWS 修复（随迁移保留）：发放张数随 body 提交，缺省后端恒按 1 张发
  if (issueCountInput.value != null && issueCountInput.value >= 1)
    body.count = Math.round(issueCountInput.value);
  try {
    const res = await api.issueCoupon(issueCouponRow.value.id, body);
    notify(`已定向发放 ${res.issued} 张券`);
    issueOpen.value = false;
    await load();
  } catch (e) {
    usersError.value = e instanceof Error ? e.message : "发放失败";
  }
}
watch([page, pageSize, status, effectiveCampusId], load);
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="优惠券配置"
    eyebrow="COUPONS"
    description="配置当前顶部校区的优惠券预算、领取门槛与核销效果。"
    ><template #actions
      ><ElButton
        v-if="effectiveCampusId && hasPerm('POST /admin/coupons')"
        type="primary"
        @click="edit()"
        >新建优惠券</ElButton
      ></template
    >
    <div v-if="!effectiveCampusId" class="empty-hint">请先在顶部选择校区。</div>
    <template v-else>
      <section
        class="admin-filter-panel admin-filter-panel--split"
        aria-label="优惠券筛选"
      >
        <ElTabs v-model="status" class="marketing-tabs"
          ><ElTabPane
            v-for="tab in COUPON_STATUS_TABS"
            :key="tab.key"
            :label="tab.label"
            :name="tab.key"
        /></ElTabs>
        <div class="admin-filter-form marketing-search">
          <ElInput
            v-model="keyword"
            clearable
            placeholder="搜索优惠券"
            @keyup.enter="
              page = 1;
              load();
            "
          /><ElButton
            @click="
              page = 1;
              load();
            "
            >查询</ElButton
          >
        </div>
      </section>
      <section class="admin-table-panel" aria-label="优惠券列表">
        <ElTable v-loading="loading" :data="rows" row-key="id"
          ><ElTableColumn
            prop="name"
            label="优惠券"
            min-width="180"
          /><ElTableColumn label="类型"
            ><template #default="{ row }">{{
              row.kind === "platform" ? "金额券" : "异业券"
            }}</template></ElTableColumn
          ><ElTableColumn label="面额"
            ><template #default="{ row }">{{
              row.kind === "platform" ? `¥${fenToYuan(row.amount)}` : "权益券"
            }}</template></ElTableColumn
          ><ElTableColumn label="门槛"
            ><template #default="{ row }">{{
              row.threshold ? `¥${fenToYuan(row.threshold)}` : "无门槛"
            }}</template></ElTableColumn
          ><ElTableColumn label="总量"
            ><template #default="{ row }">{{
              row.total ?? "不限量"
            }}</template></ElTableColumn
          ><ElTableColumn label="剩余"
            ><template #default="{ row }">{{
              row.remain ?? "不限量"
            }}</template></ElTableColumn
          ><ElTableColumn prop="claimed" label="领取" /><ElTableColumn
            prop="used"
            label="核销"
          /><ElTableColumn label="有效期" min-width="150"
            ><template #default="{ row }">{{
              row.expiresAt?.slice(0, 10) || "长期"
            }}</template></ElTableColumn
          ><ElTableColumn label="操作" width="300" fixed="right"
            ><template #default="{ row }"
              ><ElButton
                v-if="hasPerm('PATCH /admin/coupons/:id')"
                link
                type="primary"
                @click="edit(asCoupon(row))"
                >编辑</ElButton
              ><ElButton
                v-if="hasPerm('PATCH /admin/coupons/:id')"
                link
                @click="toggle(asCoupon(row))"
                >{{ row.status === "active" ? "暂停" : "启用" }}</ElButton
              ><ElButton
                v-if="hasPerm('POST /admin/coupons/:id/issue')"
                link
                type="primary"
                @click="openIssue(asCoupon(row))"
                >定向发放</ElButton
              ><ElButton
                v-if="!row.claimed && hasPerm('DELETE /admin/coupons/:id')"
                link
                type="danger"
                @click="remove(asCoupon(row))"
                >删除</ElButton
              ></template
            ></ElTableColumn
          ></ElTable
        ><AdminPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="total"
        /></section></template
    ><ElDialog
      v-model="open"
      :title="editing ? '编辑优惠券' : '新建优惠券'"
      width="min(760px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="券品种"
              ><ElSelect v-model="form.kind" :disabled="!!editing"
                ><ElOption label="金额券" value="platform" /><ElOption
                  label="异业券"
                  value="partner" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="发放方式"
              ><ElSelect v-model="form.trigger" :disabled="!!editing"
                ><ElOption label="手动领取" value="manual" /><ElOption
                  label="转盘抽奖"
                  value="lottery" /><ElOption
                  label="新人注册"
                  value="signup" /></ElSelect></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="券名称"
              ><ElInput v-model="form.name" /></ElFormItem></ElCol
          ><ElCol v-if="form.kind === 'platform'" :xs="24" :sm="12"
            ><ElFormItem label="面额（元）"
              ><ElInputNumber
                v-model="form.amount"
                :min="0.01"
                :precision="2"
                :disabled="!!editing?.claimed" /></ElFormItem></ElCol
          ><ElCol v-if="form.kind === 'platform'" :xs="24" :sm="12"
            ><ElFormItem label="使用门槛（元）"
              ><ElInputNumber
                v-model="form.threshold"
                :min="0"
                :precision="2"
                :disabled="!!editing?.claimed" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="发放总量"
              ><ElSelect v-model="form.totalMode"
                ><ElOption label="限量" value="limited" /><ElOption
                  label="不限量"
                  value="unlimited" /></ElSelect></ElFormItem></ElCol
          ><ElCol v-if="form.totalMode === 'limited'" :xs="24" :sm="12"
            ><ElFormItem label="总量张数"
              ><ElInputNumber
                v-model="form.total"
                :min="1" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="有效期"
              ><ElSelect v-model="form.expiryMode"
                ><ElOption label="长期有效" value="forever" /><ElOption
                  label="固定日期"
                  value="date" /></ElSelect></ElFormItem></ElCol
          ><ElCol v-if="form.expiryMode === 'date'" :xs="24" :sm="12"
            ><ElFormItem label="有效期至"
              ><ElDatePicker
                v-model="form.expiresAt"
                type="date"
                value-format="YYYY-MM-DD" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="每人限领"
              ><ElInputNumber
                v-model="form.perUserLimit"
                :min="0" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="展示设置"
              ><ElCheckbox v-model="form.featuredAfterPay"
                >支付后推荐</ElCheckbox
              ><ElCheckbox v-model="form.targetedOnly"
                >仅定向发放</ElCheckbox
              ></ElFormItem
            ></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="优惠说明"
              ><ElInput
                v-model="form.remark"
                type="textarea" /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="open = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      ></ElDialog
    ><ElDialog
      v-model="issueOpen"
      title="定向发放"
      width="min(600px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><template v-if="issueCouponRow"
        ><p class="issue-coupon-name">{{ issueCouponRow.name }}</p
        ><ElForm label-position="top"
          ><ElFormItem label="① 选择发放方式"
            ><ElSegmented
              v-model="issueMode"
              :options="[
                { label: '按用户', value: 'users' },
                { label: '按手机号', value: 'phones' },
                { label: '按寝室', value: 'rooms' },
              ]" /></ElFormItem
          ><ElFormItem label="② 圈定目标"
            ><template v-if="issueMode === 'users'"
              ><ElInput
                v-model="issueUserSearch"
                clearable
                placeholder="搜索昵称 / 手机号"
              />
              <p v-if="usersLoading" class="issue-empty">
                正在加载用户列表…
              </p>
              <template v-else
                ><div v-if="issueUserFiltered.length" class="issue-user-list">
                  <ElCheckbox
                    v-for="user in issueUserFiltered"
                    :key="user.id"
                    v-model="issueChecked[user.id]"
                  >
                    <span class="issue-user-name">{{ userLabel(user) }}</span>
                    <span class="issue-user-sub">{{ userSub(user) }}</span>
                  </ElCheckbox>
                </div>
                <p v-else class="issue-empty">
                  {{
                    issueUserSearch
                      ? "没有匹配的用户，换个关键词试试。"
                      : "暂无可选用户。"
                  }}
                </p>
              </template>
              <p class="issue-step-meta">
                已选 {{ selectedUserIds.length }} 人
              </p></template
            >
            <template v-else-if="issueMode === 'phones'"
              ><ElInput
                v-model="issuePhones"
                type="textarea"
                :rows="5"
                placeholder="每行一个或逗号分隔&#10;13800000001&#10;13800000002"
              />
              <p class="issue-step-meta">
                按用户绑定的手机号匹配，最多 500 个
              </p></template
            >
            <template v-else
              ><div class="issue-room-row">
                <ElSelect
                  v-model="issueBuildingId"
                  clearable
                  placeholder="选择楼栋"
                  ><ElOption
                    v-for="b in buildings"
                    :key="b.id"
                    :label="b.name"
                    :value="b.id"
                  /> </ElSelect
                ><ElInputNumber
                  v-model="issueFloor"
                  :min="1"
                  placeholder="楼层（选填，如 6）"
                />
              </div>
              <ElInput
                v-model="issueRoomNos"
                type="textarea"
                :rows="2"
                placeholder="寝室号（选填，收窄范围）&#10;612, 613&#10;701"
              />
              <p class="issue-step-meta">
                按收货地址匹配；未填过收货地址的用户无法按寝室触达。
              </p></template
            ></ElFormItem
          ><ElFormItem label="③ 发放张数（每人）"
            ><div class="issue-count-row">
              <ElInputNumber
                v-model="issueCountInput"
                :min="1"
                placeholder="默认 1"
              />
              <span class="issue-step-meta">
                张 / 每人 · 上限受「每人限领」约束
              </span>
            </div></ElFormItem
          >
          <p v-if="usersError" class="issue-error">{{ usersError }}</p></ElForm
        ></template
      ><template #footer
        ><ElButton @click="issueOpen = false">取消</ElButton
        ><ElButton
          v-if="hasPerm('POST /admin/coupons/:id/issue')"
          type="primary"
          :disabled="!issueReady"
          @click="confirmIssue"
          >确认发放</ElButton
        ></template
      ></ElDialog
    ></AdminPageShell
  >
</template>
<style scoped>
.marketing-tabs {
  flex: 1 1 auto;
  min-width: 0;
}
.marketing-search {
  display: flex;
  align-items: center;
  gap: 10px;
}
.marketing-search :deep(.el-input) {
  flex: 1 1 280px;
}
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.el-select,
.el-input-number,
.el-date-editor {
  width: 100%;
}
@media (max-width: 760px) {
  .marketing-search {
    align-items: stretch;
    flex-direction: column;
  }
  .marketing-search :deep(.el-button) {
    min-height: 44px;
    margin: 0;
  }
}
/* ---------- 定向发放抽屉 ---------- */
.issue-coupon-name {
  margin: 0 0 12px;
  color: var(--muted);
  font-weight: 600;
}
.issue-user-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  max-height: 264px;
  margin-top: 8px;
  padding: 8px 12px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.issue-user-list :deep(.el-checkbox) {
  height: auto;
  align-items: center;
  margin-right: 0;
}
.issue-user-name {
  font-weight: 600;
}
.issue-user-sub {
  margin-left: 8px;
  color: var(--muted);
  font-size: 12px;
}
.issue-empty,
.issue-step-meta {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.issue-room-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.issue-room-row :deep(.el-select) {
  flex: 1 1 auto;
}
.issue-room-row :deep(.el-input-number) {
  flex: 0 0 150px;
  width: 150px;
}
.issue-count-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.issue-count-row :deep(.el-input-number) {
  flex: 0 0 150px;
  width: 150px;
}
.issue-count-row .issue-step-meta {
  margin: 0;
}
.issue-error {
  margin: 4px 0 0;
  color: var(--el-color-danger, #f56c6c);
  font-size: 12px;
}
</style>
