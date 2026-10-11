<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import {
  accountOrgLevel,
  activeCampus,
  hasPerm,
  sessionUser,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { AdminUser, UserOrderRow, UserStats } from "../../../../types";
import { fmtDateTime } from "../../../../utils/datetime";
import { fenToYuan } from "../../../../utils/money";
const rows = ref<AdminUser[]>([]),
  orders = ref<UserOrderRow[]>([]),
  stats = ref<UserStats | null>(null),
  loading = ref(false),
  detailOpen = ref(false),
  selected = ref<AdminUser | null>(null),
  revealedPhone = ref(""),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref("");
let timer: number | undefined,
  generation = 0;
const campusId = computed(() =>
  accountOrgLevel.value === "platform" || accountOrgLevel.value === "org"
    ? activeCampus.value
    : (sessionUser.value?.campusId ?? ""),
);
function asUser(row: unknown) {
  return row as AdminUser;
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
async function load() {
  if (!campusId.value) {
    generation++;
    rows.value = [];
    total.value = 0;
    stats.value = null;
    return;
  }
  const request = ++generation;
  loading.value = true;
  try {
    const [result, summary] = await Promise.all([
      api.adminUsers({
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
        campusId: campusId.value,
      }),
      api.userStats(campusId.value),
    ]);
    if (request === generation) {
      rows.value = result.items;
      total.value = result.total;
      stats.value = summary;
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : "用户加载失败", "error");
  } finally {
    if (request === generation) loading.value = false;
  }
}
async function openDetail(row: AdminUser) {
  selected.value = row;
  orders.value = [];
  revealedPhone.value = "";
  detailOpen.value = true;
  try {
    orders.value = await api.userOrders(row.id);
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "订单流水加载失败",
      "error",
    );
  }
}
async function reveal() {
  if (!selected.value) return;
  try {
    revealedPhone.value = (await api.revealUserPhone(selected.value.id)).phone;
  } catch (error) {
    notify(error instanceof Error ? error.message : "手机号查看失败", "error");
  }
}
watch([page, pageSize, campusId], load);
watch(keyword, () => {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 280);
});
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="C 端用户"
    eyebrow="CUSTOMER BASE"
    description="查看当前顶部校区的用户规模、消费和订单流水。"
    ><div v-if="stats" class="stats">
      <span
        >总用户 <b>{{ stats.total }}</b></span
      ><span
        >今日新增 <b>{{ stats.todayNew }}</b></span
      ><span
        >本月活跃 <b>{{ stats.monthActive }}</b></span
      ><span
        >人均订单 <b>{{ stats.avgOrders }}</b></span
      >
    </div>
    <div class="toolbar">
      <ElInput
        v-model="keyword"
        clearable
        placeholder="搜索昵称、手机号或寝室"
        class="search"
      />
      <div class="toolbar-spacer" />
      <ElButton :loading="loading" @click="load">刷新</ElButton>
    </div>
    <ElTable
      v-loading="loading"
      :data="rows"
      row-key="id"
      :empty-text="campusId ? '暂无用户' : '请先在顶部选择校区'"
      @row-click="(row) => openDetail(asUser(row))"
      ><ElTableColumn
        prop="nickname"
        label="用户"
        min-width="140"
      /><ElTableColumn
        prop="phoneMasked"
        label="手机号"
        width="140"
      /><ElTableColumn label="寝室" width="150"
        ><template #default="{ row }">{{
          [row.buildingName, row.room].filter(Boolean).join(" ") || "—"
        }}</template></ElTableColumn
      ><ElTableColumn
        prop="orderCount"
        label="订单数"
        width="100"
      /><ElTableColumn label="累计消费" width="130"
        ><template #default="{ row }"
          >¥{{ fenToYuan(row.totalSpend) }}</template
        ></ElTableColumn
      ><ElTableColumn label="注册时间" width="175"
        ><template #default="{ row }">{{
          fmtDateTime(row.createdAt)
        }}</template></ElTableColumn
      ><ElTableColumn label="操作" width="100"
        ><template #default="{ row }"
          ><ElButton
            size="small"
            type="primary"
            @click.stop="openDetail(asUser(row))"
            >详情</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    ><AdminPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
    /><ElDialog
      v-model="detailOpen"
      title="用户详情"
      width="min(760px, calc(100vw - 32px))"
      align-center
      ><template v-if="selected"
        ><ElDescriptions :column="2" border
          ><ElDescriptionsItem label="昵称">{{
            selected.nickname
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="手机号"
            ><span>{{ revealedPhone || selected.phoneMasked }}</span
            ><ElButton
              v-if="!revealedPhone && hasPerm('GET /admin/users/:id/phone')"
              link
              type="primary"
              @click="reveal"
              >查看明文</ElButton
            ></ElDescriptionsItem
          ><ElDescriptionsItem label="寝室">{{
            [selected.buildingName, selected.room].filter(Boolean).join(" ") ||
            "—"
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="OpenID">{{
            selected.openidMasked
          }}</ElDescriptionsItem></ElDescriptions
        >
        <h3>订单流水</h3>
        <ElTable :data="orders" max-height="360"
          ><ElTableColumn
            prop="orderNo"
            label="订单号"
            min-width="180"
          /><ElTableColumn
            prop="statusText"
            label="状态"
            width="120"
          /><ElTableColumn label="实付" width="110"
            ><template #default="{ row }"
              >¥{{ fenToYuan(row.payableAmount) }}</template
            ></ElTableColumn
          ><ElTableColumn label="时间" width="170"
            ><template #default="{ row }">{{
              fmtDateTime(row.createdAt)
            }}</template></ElTableColumn
          ></ElTable
        ></template
      ><template #footer
        ><ElButton @click="detailOpen = false">关闭</ElButton></template
      ></ElDialog
    ></AdminPageShell
  >
</template>
<style scoped>
.stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.stats span {
  padding: 10px 14px;
  background: var(--el-fill-color-light);
  border-radius: 10px;
}
.search {
  width: min(360px, 100%);
}
h3 {
  margin: 18px 0 10px;
}
</style>
