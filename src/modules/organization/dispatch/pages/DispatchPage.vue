<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import {
  INVITE_STATUS_TABS,
  LEAVE_STATUS_TABS,
} from "../../../../dicts/status-tab";
import { activeCampus, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type {
  Building,
  DispatchInvitation,
  LeaveRequest,
  Staff,
} from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
type Mode = "leaves" | "invites";
const mode = ref<Mode>("leaves"),
  status = ref("all"),
  rows = ref<Array<LeaveRequest | DispatchInvitation>>([]),
  loading = ref(false),
  open = ref(false),
  saving = ref(false),
  staff = ref<Staff[]>([]),
  buildings = ref<Building[]>([]),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref("");
const form = reactive({
  targetStaffId: "",
  buildingId: "",
  startAt: "",
  endAt: "",
  reward: 0,
});
const tabs = () =>
  mode.value === "leaves" ? LEAVE_STATUS_TABS : INVITE_STATUS_TABS;
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
async function load() {
  if (!activeCampus.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const q = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      campusId: activeCampus.value,
    };
    const r =
      mode.value === "leaves"
        ? await api.leaveRequests(
            q,
            status.value === "all" ? undefined : status.value,
          )
        : await api.dispatchInvitations(
            q,
            status.value === "all" ? undefined : status.value,
          );
    rows.value = r.items;
    total.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "调配数据加载失败", "error");
  } finally {
    loading.value = false;
  }
}
async function prepare() {
  try {
    const [s, b] = await Promise.all([
      api.staff({ page: 1, pageSize: 1000, campusId: activeCampus.value }),
      api.buildings({ page: 1, pageSize: 1000, campusId: activeCampus.value }),
    ]);
    staff.value = s.items.filter((x) =>
      ["building-manager", "intern-building-manager"].includes(x.role),
    );
    buildings.value = b.items;
    Object.assign(form, {
      targetStaffId: "",
      buildingId: "",
      startAt: "",
      endAt: "",
      reward: 0,
    });
    open.value = true;
  } catch (e) {
    notify(e instanceof Error ? e.message : "候选人员加载失败", "error");
  }
}
async function save() {
  if (!form.targetStaffId || !form.buildingId || !form.startAt || !form.endAt)
    return notify("请完整填写目标楼长、楼栋和调配时间", "error");
  saving.value = true;
  try {
    await api.createDispatchInvitation({
      targetStaffId: form.targetStaffId,
      buildingId: form.buildingId,
      startAt: form.startAt,
      endAt: form.endAt,
      reward: yuanToFen(form.reward),
    });
    open.value = false;
    notify("调配邀请已发出");
    mode.value = "invites";
    status.value = "all";
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "邀请创建失败", "error");
  } finally {
    saving.value = false;
  }
}
async function cancel(row: DispatchInvitation) {
  try {
    await ElMessageBox.confirm("确认取消这条待响应邀请？", "取消邀请", {
      type: "warning",
    });
    await api.cancelDispatchInvitation(row.id);
    notify("邀请已取消");
    await load();
  } catch (e) {
    if (e !== "cancel" && e !== "close")
      notify(e instanceof Error ? e.message : "取消失败", "error");
  }
}
function leave(row: unknown) {
  return row as LeaveRequest;
}
function invite(row: unknown) {
  return row as DispatchInvitation;
}
watch([mode, status, page, pageSize, activeCampus], () => {
  page.value = Math.max(1, page.value);
  void load();
});
watch(mode, () => {
  status.value = "all";
  page.value = 1;
});
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="调配与请假"
    eyebrow="DISPATCH DESK"
    description="按顶部校区查看楼长请假和跨楼调配邀请。"
    ><template #actions
      ><ElButton
        v-if="activeCampus && hasPerm('POST /admin/dispatch-invitations')"
        type="primary"
        @click="prepare"
        >发起调配邀请</ElButton
      ></template
    >
    <div v-if="!activeCampus" class="empty-hint">请先在顶部选择校区。</div>
    <template v-else>
      <section class="admin-filter-panel" aria-label="调配与请假筛选">
        <div class="dispatch-filter-head">
          <ElSegmented
            v-model="mode"
            :options="[
              { label: '请假申请', value: 'leaves' },
              { label: '调配邀请', value: 'invites' },
            ]"
          /><ElTabs v-model="status" class="organization-tabs"
            ><ElTabPane
              v-for="tab in tabs()"
              :key="tab.key"
              :label="tab.label"
              :name="tab.key"
          /></ElTabs>
        </div>
        <div class="admin-filter-form organization-search">
          <ElInput
            v-model="keyword"
            class="search"
            clearable
            placeholder="搜索当前列表"
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
      <section class="admin-table-panel" aria-label="调配与请假列表">
        <ElTable
          v-if="mode === 'leaves'"
          v-loading="loading"
          :data="rows"
          row-key="id"
          ><ElTableColumn label="楼长"
            ><template #default="{ row }">{{
              leave(row).staff?.name || "—"
            }}</template></ElTableColumn
          ><ElTableColumn label="工号"
            ><template #default="{ row }">{{
              leave(row).staff?.staffNo || "—"
            }}</template></ElTableColumn
          ><ElTableColumn label="负责楼栋"
            ><template #default="{ row }">{{
              leave(row).staff?.building || "—"
            }}</template></ElTableColumn
          ><ElTableColumn
            prop="startAt"
            label="开始时间"
            min-width="170" /><ElTableColumn
            prop="endAt"
            label="结束时间"
            min-width="170" /><ElTableColumn
            prop="reason"
            label="原因"
            min-width="180" /><ElTableColumn label="调配方式"
            ><template #default="{ row }">{{
              leave(row).dispatchMode === "self"
                ? "自己联系代班"
                : "平台自动派单"
            }}</template></ElTableColumn
          ><ElTableColumn label="代班楼长"
            ><template #default="{ row }">{{
              leave(row).substituteName || "—"
            }}</template></ElTableColumn
          ><ElTableColumn prop="statusText" label="状态" /></ElTable
        ><ElTable v-else v-loading="loading" :data="rows" row-key="id"
          ><ElTableColumn label="目标楼长"
            ><template #default="{ row }">{{
              invite(row).staff?.name || "—"
            }}</template></ElTableColumn
          ><ElTableColumn label="角色"
            ><template #default="{ row }">{{
              invite(row).staff?.roleText || "—"
            }}</template></ElTableColumn
          ><ElTableColumn prop="building" label="目标楼栋" /><ElTableColumn
            prop="startAt"
            label="开始时间"
            min-width="170"
          /><ElTableColumn
            prop="endAt"
            label="结束时间"
            min-width="170"
          /><ElTableColumn label="奖励"
            ><template #default="{ row }"
              >¥{{ fenToYuan(invite(row).reward) }}</template
            ></ElTableColumn
          ><ElTableColumn prop="statusText" label="状态" /><ElTableColumn
            label="操作"
            width="100"
            ><template #default="{ row }"
              ><ElButton
                v-if="
                  invite(row).status === 'invited' &&
                  hasPerm('POST /admin/dispatch-invitations/:id/cancel')
                "
                link
                type="danger"
                @click="cancel(invite(row))"
                >取消</ElButton
              ></template
            ></ElTableColumn
          ></ElTable
        ><AdminPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="total"
        />
      </section> </template
    ><ElDialog
      v-model="open"
      title="发起调配邀请"
      width="min(640px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="目标楼长"
              ><ElSelect v-model="form.targetStaffId" filterable
                ><ElOption
                  v-for="item in staff"
                  :key="item.id"
                  :label="`${item.name} · ${item.building || '待分配'}`"
                  :value="item.id" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="目标楼栋"
              ><ElSelect v-model="form.buildingId" filterable
                ><ElOption
                  v-for="item in buildings"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="开始时间"
              ><ElDatePicker
                v-model="form.startAt"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="结束时间"
              ><ElDatePicker
                v-model="form.endAt"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="奖励（元）"
              ><ElInputNumber
                v-model="form.reward"
                :min="0"
                :precision="2" /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="open = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >发送邀请</ElButton
        ></template
      ></ElDialog
    ></AdminPageShell
  >
</template>
<style scoped>
.dispatch-filter-head {
  display: flex;
  align-items: center;
  gap: 24px;
  min-width: 0;
}
.organization-tabs {
  flex: 1 1 auto;
  min-width: 0;
}
.organization-search {
  display: grid;
  grid-template-columns: minmax(220px, 360px) auto;
  gap: 12px;
  align-items: center;
  margin-top: 14px;
}
.organization-search .el-button {
  justify-self: start;
}
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.el-select,
.el-date-editor,
.el-input-number {
  width: 100%;
}
@media (max-width: 760px) {
  .dispatch-filter-head {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }
  .organization-search {
    grid-template-columns: 1fr;
  }
}
</style>
