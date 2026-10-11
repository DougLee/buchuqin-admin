<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import { ORDER_STATUS_TABS } from "../../../../dicts";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Order } from "../../../../types";
import { fmtDateTime } from "../../../../utils/datetime";
import { resolveImageUrl } from "../../../../utils/image";
import { fenToYuan } from "../../../../utils/money";

const rows = ref<Order[]>([]);
const loading = ref(false);
const detailOpen = ref(false);
const statusOpen = ref(false);
const working = ref(false);
const selected = ref<Order | null>(null);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const keyword = ref("");
const statusKey = ref("all");
const deliveryMode = ref("");
const dateRange = ref<[string, string] | null>(null);
const counts = ref<Record<string, number>>({});
const statusForm = reactive({ status: "", reason: "" });

let generation = 0;
let timer: number | undefined;

const campusId = effectiveCampusId;
const currentTab = computed(
  () => ORDER_STATUS_TABS.find((tab) => tab.key === statusKey.value) ?? ORDER_STATUS_TABS[0],
);

function asOrder(row: unknown) {
  return row as Order;
}

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

function itemNames(order: Order) {
  return (order.items ?? [])
    .map((item) => `${item.product?.name ?? "未知商品"} ×${item.quantity}`)
    .join("、") || "—";
}

function addressText(order: Order) {
  return [order.address?.buildingName, order.address?.room].filter(Boolean).join("") || "—";
}

function tabCount(key: string) {
  const tab = ORDER_STATUS_TABS.find((item) => item.key === key);
  return tab?.statuses.length
    ? tab.statuses.reduce((sum, status) => sum + (counts.value[status] ?? 0), 0)
    : Object.values(counts.value).reduce((sum, count) => sum + count, 0);
}

async function load() {
  if (!campusId.value) {
    generation++;
    rows.value = [];
    total.value = 0;
    loading.value = false;
    return;
  }

  const request = ++generation;
  loading.value = true;
  try {
    const result = await api.orders(
      currentTab.value.statuses.length ? currentTab.value.statuses.join(",") : "all",
      {
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
        campusId: campusId.value,
        deliveryMode: deliveryMode.value || undefined,
        start: dateRange.value?.[0],
        end: dateRange.value?.[1],
      },
    );
    if (request === generation) {
      rows.value = result.items;
      total.value = result.total;
      counts.value = await api.orderStatusCounts(campusId.value);
    }
  } catch (error) {
    if (request === generation) {
      notify(error instanceof Error ? error.message : "订单加载失败", "error");
    }
  } finally {
    if (request === generation) loading.value = false;
  }
}

function openDetail(row: Order) {
  selected.value = row;
  detailOpen.value = true;
}

function openStatus(row: Order, target = "") {
  selected.value = row;
  statusForm.status = target;
  statusForm.reason = "";
  statusOpen.value = true;
}

async function submitStatus() {
  if (!selected.value || !statusForm.status) {
    notify("请选择目标状态", "error");
    return;
  }
  if (!statusForm.reason.trim()) {
    notify("请填写变更原因", "error");
    return;
  }
  working.value = true;
  try {
    await api.updateOrderStatus(selected.value.id, statusForm.status, statusForm.reason.trim());
    statusOpen.value = false;
    detailOpen.value = false;
    notify("订单状态已更新");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "更新失败", "error");
  } finally {
    working.value = false;
  }
}

async function advance(row: Order) {
  working.value = true;
  try {
    await api.orderAction(row.id, "advance");
    notify("订单履约已推进");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "推进失败", "error");
  } finally {
    working.value = false;
  }
}

async function print(row: Order) {
  working.value = true;
  try {
    await api.printReceipt(row.id);
    notify("小票已提交打印");
  } catch (error) {
    notify(error instanceof Error ? error.message : "打印失败", "error");
  } finally {
    working.value = false;
  }
}

watch([page, pageSize, statusKey, deliveryMode, dateRange, campusId], load);
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
    title="订单配送"
    eyebrow="ORDER CONTROL"
    description="监控当前顶部校区的订单生命周期与配送进度。"
  >
    <template #actions>
      <ElButton :loading="loading" @click="load">刷新</ElButton>
    </template>

    <section class="order-filter-panel" aria-label="订单筛选">
      <div class="status-tabs single-line-tabs" role="tablist" aria-label="订单状态">
        <button
          v-for="tab in ORDER_STATUS_TABS"
          :key="tab.key"
          type="button"
          role="tab"
          class="status-tab"
          :class="{ active: statusKey === tab.key }"
          :aria-selected="statusKey === tab.key"
          @click="statusKey = tab.key"
        >
          <span>{{ tab.label }}</span>
          <small>{{ tabCount(tab.key) }}</small>
        </button>
      </div>

      <ElForm class="order-filters" aria-label="订单查询条件">
        <ElRow :gutter="10" align="middle">
          <ElCol :xs="24" :sm="12" :lg="7">
            <ElFormItem>
              <ElInput v-model="keyword" clearable placeholder="搜索订单号、手机号或商品" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12" :lg="5">
            <ElFormItem>
              <ElSelect v-model="deliveryMode" clearable placeholder="全部配送方式">
                <ElOption label="即时达" value="instant" />
                <ElOption label="预约达" value="scheduled" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="18" :lg="9">
            <ElFormItem>
              <ElDatePicker
                v-model="dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="6" :lg="3">
            <ElFormItem>
              <ElButton class="search-button" type="primary" :loading="loading" @click="load">
                搜索
              </ElButton>
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>
    </section>

    <section class="order-table-panel" aria-label="订单列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        :empty-text="campusId ? '暂无订单' : '请先在顶部选择校区'"
        @row-click="(row) => openDetail(asOrder(row))"
      >
        <ElTableColumn prop="orderNo" label="订单编号" min-width="190" />
        <ElTableColumn label="商品" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ itemNames(asOrder(row)) }}</template>
        </ElTableColumn>
        <ElTableColumn label="用户/寝室" min-width="150">
          <template #default="{ row }">
            {{ row.userPhone || "—" }}
            <div class="cell-sub">{{ addressText(asOrder(row)) }}</div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="实付" width="110">
          <template #default="{ row }">¥{{ fenToYuan(row.payableAmount) }}</template>
        </ElTableColumn>
        <ElTableColumn prop="statusText" label="状态" width="140">
          <template #default="{ row }">
            <ElTag>{{ row.statusText || row.status }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="下单时间" width="175">
          <template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="204">
          <template #default="{ row }">
            <div class="order-actions" @click.stop>
              <ElButton size="small" type="primary" @click="openDetail(asOrder(row))">查看</ElButton>
              <ElButton
                v-if="hasPerm('POST /admin/orders/:id/actions/advance')"
                size="small"
                @click="advance(asOrder(row))"
              >
                推进
              </ElButton>
              <ElButton
                v-if="hasPerm('POST /admin/orders/:id/status')"
                size="small"
                @click="openStatus(asOrder(row))"
              >
                改状态
              </ElButton>
              <ElButton
                v-if="hasPerm('POST /admin/orders/:id/print-receipt')"
                size="small"
                @click="print(asOrder(row))"
              >
                补打
              </ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
      <AdminPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </section>

    <ElDialog
      v-model="detailOpen"
      title="订单详情"
      width="min(860px, calc(100vw - 32px))"
      align-center
    >
      <template v-if="selected">
        <ElDescriptions :column="3" border>
          <ElDescriptionsItem label="订单编号">{{ selected.orderNo }}</ElDescriptionsItem>
          <ElDescriptionsItem label="状态">{{ selected.statusText || selected.status }}</ElDescriptionsItem>
          <ElDescriptionsItem label="实付">¥{{ fenToYuan(selected.payableAmount) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="收货人">{{ selected.address?.contactName || "—" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="电话">{{ selected.address?.phone || selected.userPhone || "—" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="寝室">{{ addressText(selected) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="备注" :span="3">{{ selected.remark || "—" }}</ElDescriptionsItem>
        </ElDescriptions>
        <ElTable :data="selected.items || []" class="items-table">
          <ElTableColumn label="商品">
            <template #default="{ row }">{{ row.product?.name || "未知商品" }}</template>
          </ElTableColumn>
          <ElTableColumn prop="quantity" label="数量" width="100" />
        </ElTable>
        <div
          v-for="group in [
            { label: '骑手交接', images: selected.package?.handoverProof?.images || [] },
            { label: '楼长送达', images: selected.package?.deliveredProof?.images || [] },
          ]"
          :key="group.label"
          v-show="group.images.length"
          class="proof"
        >
          <strong>{{ group.label }}</strong>
          <ElImage
            v-for="image in group.images"
            :key="image"
            :src="resolveImageUrl(image)"
            :preview-src-list="group.images.map(resolveImageUrl)"
            class="proof-image"
          />
        </div>
      </template>
      <template #footer>
        <ElButton
          v-if="selected && hasPerm('POST /admin/orders/:id/status')"
          type="danger"
          plain
          @click="openStatus(selected, 'exception')"
        >
          标记异常
        </ElButton>
        <ElButton @click="detailOpen = false">关闭</ElButton>
      </template>
    </ElDialog>

    <ElDialog
      v-model="statusOpen"
      title="修改订单状态"
      width="min(520px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm label-position="top">
        <ElRow>
          <ElCol :span="24">
            <ElFormItem label="目标状态">
              <ElSelect v-model="statusForm.status">
                <ElOption label="待出库" value="paid" />
                <ElOption label="拣货中" value="picking" />
                <ElOption label="配送中" value="last-mile" />
                <ElOption label="已送达" value="delivered" />
                <ElOption label="已完成" value="completed" />
                <ElOption label="异常" value="exception" />
                <ElOption label="已取消" value="cancelled" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :span="24">
            <ElFormItem label="变更原因">
              <ElInput v-model="statusForm.reason" type="textarea" :rows="3" />
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>
      <template #footer>
        <ElButton @click="statusOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="working" @click="submitStatus">确认修改</ElButton>
      </template>
    </ElDialog>
  </AdminPageShell>
</template>

<style scoped>
.order-filter-panel,
.order-table-panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 8px 24px #163f2b08;
}

.order-filter-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  margin-bottom: 18px;
}

.status-tabs {
  display: flex;
  flex: 1 1 720px;
  gap: 6px;
  padding-bottom: 4px;
}

.status-tab {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 15px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
}

.status-tab:hover {
  color: var(--green);
  background: #f0f7f3;
}

.status-tab:focus-visible {
  outline: 3px solid rgb(22 163 74 / 18%);
  outline-offset: 2px;
}

.status-tab.active {
  color: #fff;
  background: var(--green);
  box-shadow: 0 5px 14px rgb(17 91 61 / 18%);
}

.status-tab small {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.78;
}

.order-filters {
  flex: 0 1 780px;
  min-width: 560px;
}

.order-filters :deep(.el-form-item) {
  margin-bottom: 0;
}

.order-filters :deep(.el-input),
.order-filters :deep(.el-select),
.order-filters :deep(.el-date-editor) {
  width: 100%;
}

.search-button {
  width: 100%;
}

.order-table-panel {
  overflow: hidden;
}

.order-table-panel :deep(.el-table__row) {
  cursor: pointer;
}

.order-table-panel :deep(.el-table__row:hover > td.el-table__cell) {
  background: #f6faf8;
}

.order-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
}

.order-actions :deep(.el-button) {
  width: 100%;
  min-width: 0;
  min-height: 32px;
  margin: 0;
  padding-inline: 8px;
}

.cell-sub {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
}

.items-table {
  margin-top: 16px;
}

.proof {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.proof-image {
  width: 72px;
  height: 72px;
  border-radius: 8px;
}

.el-dialog .el-select {
  width: 100%;
}

@media (max-width: 1500px) {
  .order-filter-panel {
    align-items: stretch;
    flex-direction: column;
  }

  .status-tabs,
  .order-filters {
    flex-basis: auto;
    width: 100%;
  }

  .order-filters {
    min-width: 0;
  }
}

@media (max-width: 760px) {
  .order-filter-panel {
    padding: 12px;
    border-radius: 14px;
  }

  .status-tabs {
    flex-wrap: nowrap;
    margin: 0 -12px;
    padding: 0 12px 4px;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .status-tab {
    min-width: max-content;
    min-height: 44px;
  }

  .order-filters :deep(.el-form-item) {
    margin-bottom: 10px;
  }

  .order-filters :deep(.el-col:last-child .el-form-item) {
    margin-bottom: 0;
  }

  .order-table-panel {
    border-radius: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-tab {
    transition: none;
  }
}
</style>
