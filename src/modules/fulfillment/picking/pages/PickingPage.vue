<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { PICKING_STATUS_TABS } from "../../../../dicts";
import {
  effectiveCampusId,
  hasPerm,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Order } from "../../../../types";
import { fmtDateTime } from "../../../../utils/datetime";
import { fenToYuan } from "../../../../utils/money";
import PickingChecklist from "../components/PickingChecklist.vue";
import { buildPickingLines } from "../model";

const rows = ref<Order[]>([]),
  loading = ref(false),
  working = ref(false),
  dialogOpen = ref(false),
  selected = ref<Order | null>(null),
  picked = ref<number[]>([]),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  statusKey = ref("all"),
  keyword = ref("");
let timer: number | undefined,
  generation = 0;
const campusId = effectiveCampusId;
const tab = computed(
  () =>
    PICKING_STATUS_TABS.find((t) => t.key === statusKey.value) ??
    PICKING_STATUS_TABS[0],
);
const lines = computed(() => buildPickingLines(selected.value?.items ?? []));
const complete = computed(
  () => lines.value.length > 0 && picked.value.length === lines.value.length,
);
function asOrder(row: unknown) {
  return row as Order;
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function items(order: Order) {
  return (
    (order.items ?? [])
      .map((i) => `${i.product?.name ?? "未知商品"} ×${i.quantity}`)
      .join("、") || "—"
  );
}
function locations(order: Order) {
  const values = [
    ...new Set(
      (order.items ?? [])
        .map((i) =>
          [
            i.product?.location,
            (i.product as { locationCode?: string })?.locationCode,
          ]
            .filter(Boolean)
            .join("-"),
        )
        .filter(Boolean),
    ),
  ];
  return values.length ? values.join("、") : "未配置";
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
    const result = await api.orders(tab.value.statuses.join(","), {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      campusId: campusId.value,
    });
    if (request === generation) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "拣货任务加载失败",
      "error",
    );
  } finally {
    if (request === generation) loading.value = false;
  }
}
function open(row: Order) {
  selected.value = row;
  picked.value = [];
  dialogOpen.value = true;
}
async function close(done?: () => void) {
  if (picked.value.length) {
    try {
      await ElMessageBox.confirm(
        "当前勾选进度尚未提交，确认关闭？",
        "拣货进度",
        { type: "warning" },
      );
    } catch {
      return;
    }
  }
  dialogOpen.value = false;
  picked.value = [];
  done?.();
}
async function outbound() {
  if (!selected.value || !complete.value) return;
  working.value = true;
  try {
    await api.orderAction(selected.value.id, "outbound");
    notify("出库成功，订单已进入配送流程");
    dialogOpen.value = false;
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "出库失败", "error");
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
watch([page, pageSize, statusKey, campusId], load);
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
    title="拣货任务"
    eyebrow="WAREHOUSE OUTBOUND"
    description="按库位完成商品复核，确认出库后订单进入配送流程。"
  >
    <section
      class="admin-filter-panel admin-filter-panel--split"
      aria-label="拣货任务筛选"
    >
      <div
        class="picking-tabs single-line-tabs"
        role="tablist"
        aria-label="拣货状态"
      >
        <button
          v-for="item in PICKING_STATUS_TABS"
          :key="item.key"
          type="button"
          role="tab"
          class="picking-tab"
          :class="{ active: statusKey === item.key }"
          :aria-selected="statusKey === item.key"
          @click="statusKey = item.key"
        >
          {{ item.label }}
        </button>
      </div>
      <ElForm class="admin-filter-form" label-position="top"
        ><ElRow :gutter="12" align="bottom"
          ><ElCol :xs="24" :sm="18"
            ><ElInput
              v-model="keyword"
              clearable
              placeholder="搜索订单或商品" /></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElFormItem label=" "
              ><ElButton :loading="loading" @click="load"
                >刷新</ElButton
              ></ElFormItem
            ></ElCol
          ></ElRow
        ></ElForm
      >
    </section>
    <section class="admin-table-panel" aria-label="拣货任务列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        :empty-text="campusId ? '暂无拣货任务' : '请先在顶部选择校区'"
        ><ElTableColumn
          prop="orderNo"
          label="订单编号"
          min-width="190"
        /><ElTableColumn label="商品" min-width="240" show-overflow-tooltip
          ><template #default="{ row }">{{
            items(asOrder(row))
          }}</template></ElTableColumn
        ><ElTableColumn label="库位" min-width="160"
          ><template #default="{ row }">{{
            locations(asOrder(row))
          }}</template></ElTableColumn
        ><ElTableColumn
          prop="totalQuantity"
          label="件数"
          width="90"
        /><ElTableColumn
          prop="statusText"
          label="状态"
          width="110"
        /><ElTableColumn label="实付" width="110"
          ><template #default="{ row }"
            >¥{{ fenToYuan(row.payableAmount) }}</template
          ></ElTableColumn
        ><ElTableColumn label="下单时间" width="175"
          ><template #default="{ row }">{{
            fmtDateTime(row.createdAt)
          }}</template></ElTableColumn
        ><ElTableColumn label="操作" width="180" fixed="right"
          ><template #default="{ row }"
            ><ElButton type="primary" size="small" @click="open(asOrder(row))"
              >开始拣货</ElButton
            ><ElButton
              v-if="hasPerm('POST /admin/orders/:id/print-receipt')"
              size="small"
              @click="print(asOrder(row))"
              >补打</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      >
      <AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>
    <ElDialog
      v-model="dialogOpen"
      title="拣货复核"
      width="min(760px, calc(100vw - 32px))"
      align-center
      :before-close="close"
      :close-on-click-modal="false"
      ><template v-if="selected"
        ><ElDescriptions :column="2" border
          ><ElDescriptionsItem label="订单">{{
            selected.orderNo
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="件数">{{
            selected.totalQuantity
          }}</ElDescriptionsItem></ElDescriptions
        ><PickingChecklist v-model="picked" :lines="lines" /></template
      ><template #footer
        ><ElButton @click="close()">关闭</ElButton
        ><ElButton
          v-if="hasPerm('POST /admin/orders/:id/actions/outbound')"
          type="primary"
          :loading="working"
          :disabled="!complete"
          @click="outbound"
          >{{
            complete ? "确认出库" : `待确认 ${lines.length - picked.length} 项`
          }}</ElButton
        ></template
      ></ElDialog
    >
  </AdminPageShell>
</template>
<style scoped>
.picking-tabs {
  flex: 1 1 auto;
  gap: 6px;
  padding-bottom: 4px;
}
.picking-tab {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition:
    color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}
.picking-tab:hover {
  color: var(--green);
  background: #f0f7f3;
}
.picking-tab:focus-visible {
  outline: 3px solid rgb(22 163 74 / 18%);
  outline-offset: 2px;
}
.picking-tab.active {
  color: #fff;
  background: var(--green);
  box-shadow: 0 5px 14px rgb(17 91 61 / 18%);
}
@media (max-width: 760px) {
  .picking-tabs {
    width: calc(100% + 24px);
    margin: 0 -12px;
    padding: 0 12px 4px;
  }
  .picking-tab {
    min-width: max-content;
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .picking-tab {
    transition: none;
  }
}
</style>
