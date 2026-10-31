<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import * as XLSX from "xlsx";
import { api } from "../../../../api";
import { ORDER_STATUS_TABS } from "../../../../dicts";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Order, OrderDeliveryMember } from "../../../../types";
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
/** 「配送中」分组补 arrived（已到店：骑手扫码/按钮确认取货后的态，位于
 *  已接单 waiting-first-mile 与首公里 first-mile 之间）。dicts 的
 *  ORDER_STATUS_TABS 为多页共享字典，此处本地展开注入，不动共享常量。 */
const ORDER_TABS: typeof ORDER_STATUS_TABS = ORDER_STATUS_TABS.map((tab) => {
  if (tab.key !== "delivering") return tab;
  const statuses = [...tab.statuses];
  statuses.splice(statuses.indexOf("waiting-first-mile") + 1, 0, "arrived");
  return { ...tab, statuses };
});
const currentTab = computed(
  () => ORDER_TABS.find((tab) => tab.key === statusKey.value) ?? ORDER_TABS[0],
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

/** 配送方式（IKP0AP 顺带，道哥 2026-10-20）：即时达/预约达，预约带送达时段 */
function modeText(order: Order) {
  if (order.deliveryMode === "scheduled")
    return order.deliverySlot ? `预约达 · ${order.deliverySlot}` : "预约达";
  return "即时达";
}

function statusText(order: Order) {
  return order.status === "delivered" ? "待用户确认" : order.statusText || order.status;
}

/** IKP0AP：配送链路人员展示（姓名 · 电话），未接单/自提等场景为空显示 —。
 *  PC 端不挂 tel 链接，号码文本可直接选中复制。 */
function chainText(member: OrderDeliveryMember | null | undefined) {
  if (!member?.name) return "—";
  return member.phone ? `${member.name} · ${member.phone}` : member.name;
}

function tabCount(key: string) {
  const tab = ORDER_TABS.find((item) => item.key === key);
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

/** 订单导出 Excel（道哥 2026-10-23，A 方案全量列）：按当前筛选（页签/
 *  关键字/配送方式/日期）分页拉全（后端 pageSize 封顶 100，循环翻页）。
 *  配送链（骑手/楼长）只在单查端点开启——逐单拉详情补齐，并发 5 控制节奏；
 *  成本/毛利走行内成本快照（服务端 RBAC 裁剪后无权限自然为空）。 */
const exporting = ref(false);
async function exportOrders() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const all: Order[] = [];
    const pageSize = 100;
    const statuses = currentTab.value.statuses.length
      ? currentTab.value.statuses.join(",")
      : "all";
    for (let p = 1; ; p++) {
      const r = await api.orders(statuses, {
        page: p,
        pageSize,
        keyword: keyword.value.trim() || undefined,
        campusId: campusId.value,
        deliveryMode: deliveryMode.value || undefined,
        start: dateRange.value?.[0],
        end: dateRange.value?.[1],
      });
      all.push(...r.items);
      if (all.length >= r.total || !r.items.length) break;
    }
    // 逐单补配送链：并发 5（详情请求含骑手/楼长反查，量大全跑会打爆）
    const details = new Map<string, Order>();
    const queue = [...all];
    async function worker() {
      for (;;) {
        const row = queue.shift();
        if (!row) return;
        try {
          details.set(row.id, await api.orderDetail(row.id));
        } catch {
          /* 单单失败不影响整体，导出该单配送链列显示 — */
        }
      }
    }
    await Promise.all(Array.from({ length: 5 }, worker));
    const money = (v?: number | null) => (v == null ? "" : `¥${fenToYuan(v)}`);
    const costOf = (o: Order): number | null => {
      const lines = (o.items ?? []) as Array<{
        product?: { unitGrossCost?: number };
        quantity: number;
      }>;
      let total = 0;
      for (const line of lines) {
        const unit = line.product?.unitGrossCost;
        if (unit == null) return null; // 任一行成本缺失（无权限/老快照）→ 整单不算
        total += unit * line.quantity;
      }
      return lines.length ? total : null;
    };
    const chain = (m?: OrderDeliveryMember | null) =>
      m?.name ? (m.phone ? `${m.name} ${m.phone}` : m.name) : "—";
    const header = [
      "订单号", "状态", "下单时间", "支付时间", "配送方式",
      "收货人", "电话", "寝室", "商品明细",
      "商品额", "配送费", "优惠", "实付", "成本", "毛利",
      "骑手", "楼长",
    ];
    const rows = all.map((o) => {
      const d = details.get(o.id);
      const cost = costOf(o);
      return [
        o.orderNo,
        statusText(o),
        fmtDateTime(o.createdAt),
        o.paidAt ? fmtDateTime(o.paidAt) : "",
        modeText(o),
        o.address?.contactName || "",
        o.address?.phone || o.userPhone || "",
        addressText(o),
        itemNames(o),
        money(o.productAmount),
        money(o.deliveryFee),
        o.discount ? `¥${fenToYuan(o.discount)}` : "",
        money(o.payableAmount),
        cost == null ? "" : money(cost),
        cost == null ? "" : money(o.payableAmount - cost),
        chain(d?.deliveryChain?.rider),
        chain(d?.deliveryChain?.manager),
      ];
    });
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet["!cols"] = header.map(() => ({ wch: 16 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "订单列表");
    XLSX.writeFile(
      book,
      `订单列表-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    notify(`已导出 ${all.length} 笔订单`);
  } catch (e) {
    notify(e instanceof Error ? e.message : "导出失败", "error");
  } finally {
    exporting.value = false;
  }
}

/** IKP0AP：列表行无配送链（deliveryChain 只在单查端点开启）——先以列表行
 *  秒开弹窗，异步拉详情替换补齐骑手/楼长；拉取失败静默保留列表行展示。 */
async function openDetail(row: Order) {
  selected.value = row;
  detailOpen.value = true;
  try {
    const detail = await api.orderDetail(row.id);
    if (selected.value?.id === row.id) selected.value = detail;
  } catch {
    /* 详情拉取失败不打断弹窗，链路人员显示列表行口径（—） */
  }
}

/** 道哥 2026-10-15：待出库单在订单配送页直出库（与拣货页同动作——
 *  paid 一步转待配送 + 出库流水 + 末端路线 lastMileMode 固化）。
 *  免去跳拣货页的往返；拣货复核流照旧可用。 */
async function outbound(row: Order) {
  working.value = true;
  try {
    await api.orderAction(row.id, "outbound");
    notify("出库成功，订单已进入配送流程");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "出库失败", "error");
  } finally {
    working.value = false;
  }
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

/* ---------- 行操作「退款」（#88/#89）：发起后进售后退款列表人工审核 ----------
 * 复用按商品退款端点（POST /admin/orders/:id/refunds，source 由服务端按
 * 订单状态判定）；整单一笔金额按行上限比例分摊到商品行上送。 */
/** 已退/占用金额口径同后端预检：pending/approved/refunding/refunded 之和 */
const REFUND_RESERVED_STATUSES = ["pending", "approved", "refunding", "refunded"];
const refundOpen = ref(false);
const refundOrder = ref<Order | null>(null);
const refundReserved = ref(0);
const refundReservedLoading = ref(false);
const refundForm = reactive({ amount: 0, reason: "" });

/** 未进入终态（待用户确认/已完成/已退款/已取消）才可发起退款 */
function refundable(order: Order) {
  return !["delivered", "completed", "refunded", "cancelled"].includes(order.status);
}

/** 商品额（分）：行快照优先，缺快照回落 实付−配送费 */
function goodsAmountOf(order: Order) {
  return order.productAmount ?? order.payableAmount - (order.deliveryFee ?? 0);
}

/** 当前可退余额（元）= 商品额 − 已退（含处理中） */
const refundAvailableYuan = computed(() =>
  refundOrder.value
    ? Math.max(0, (goodsAmountOf(refundOrder.value) - refundReserved.value) / 100)
    : 0,
);

async function openRefund(row: Order) {
  refundOrder.value = row;
  refundReserved.value = 0;
  refundForm.amount = 0;
  refundForm.reason = "";
  refundOpen.value = true;
  refundReservedLoading.value = true;
  try {
    const res = await api.refunds({
      page: 1,
      pageSize: 50,
      keyword: row.orderNo,
      campusId: campusId.value || undefined,
    });
    if (refundOrder.value?.id === row.id) {
      refundReserved.value = res.items
        .filter(
          (r) => r.orderId === row.id && REFUND_RESERVED_STATUSES.includes(r.status),
        )
        .reduce((sum, r) => sum + r.amount, 0);
    }
  } catch {
    /* 已退金额拉取失败按 0 展示，可退上限由后端兜底校验 */
  } finally {
    refundReservedLoading.value = false;
  }
  if (refundOrder.value?.id === row.id)
    refundForm.amount = Number(refundAvailableYuan.value.toFixed(2));
}

/** 单笔总额按各行上限比例分摊（最大余数法）：Σ=总额且每行不超上限 */
function allocateRefundAmounts(totalFen: number, caps: number[]) {
  const capSum = caps.reduce((sum, cap) => sum + cap, 0);
  const total = Math.min(totalFen, capSum);
  const amounts = caps.map((cap) => Math.floor((total * cap) / capSum));
  let left = total - amounts.reduce((sum, a) => sum + a, 0);
  const byFrac = caps
    .map((cap, i) => ({ i, frac: (total * cap) / capSum - amounts[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of byFrac) {
    if (left <= 0) break;
    if (amounts[i] + 1 <= caps[i]) {
      amounts[i] += 1;
      left -= 1;
    }
  }
  for (let i = 0; left > 0 && i < amounts.length; i++) {
    while (left > 0 && amounts[i] < caps[i]) {
      amounts[i] += 1;
      left -= 1;
    }
  }
  return amounts;
}

async function submitRefund() {
  const order = refundOrder.value;
  if (!order || working.value) return;
  if (!refundForm.reason.trim()) {
    notify("请填写退款原因", "error");
    return;
  }
  const totalFen = Math.round(refundForm.amount * 100);
  if (!(totalFen >= 1)) {
    notify("退款金额必须至少 0.01 元", "error");
    return;
  }
  // 已出库未送达单（道哥 2026-10-31 方案 A）：整单退款申请——不带商品行，
  // 金额=商品额，进售后审核队列（批准才原路退，配送费按审核开关）
  const unshipped = [
    "waiting-first-mile",
    "arrived",
    "first-mile",
    "waiting-handover",
    "last-mile",
  ].includes(order.status);
  const lines = (order.items ?? [])
    .map((item) => ({
      productId: item.product.id ?? "",
      cap: (item.product.price ?? 0) * item.quantity,
    }))
    .filter((line) => line.productId && line.cap > 0);
  if (!unshipped && !lines.length) {
    notify("订单商品快照缺失，请到售后退款页操作", "error");
    return;
  }
  working.value = true;
  try {
    if (unshipped) {
      await api.createOrderRefund(order.id, {
        remark: refundForm.reason.trim(),
      });
      refundOpen.value = false;
      notify("已提交整单退款申请，请到售后退款页审核");
      await load();
      return;
    }
    const amounts = allocateRefundAmounts(
      totalFen,
      lines.map((line) => line.cap),
    );
    await api.createOrderRefund(order.id, {
      productIds: lines.map((line) => line.productId),
      amounts: lines.map((line, i) => ({
        productId: line.productId,
        amount: amounts[i],
      })),
      remark: refundForm.reason.trim(),
    });
    refundOpen.value = false;
    notify("已提交退款申请，请到售后退款页审核");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "退款提交失败", "error");
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
      <ElButton :loading="exporting" @click="exportOrders">导出</ElButton>
      <ElButton :loading="loading" @click="load">刷新</ElButton>
    </template>

    <section class="order-filter-panel" aria-label="订单筛选">
      <div class="status-tabs single-line-tabs" role="tablist" aria-label="订单状态">
        <button
          v-for="tab in ORDER_TABS"
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
        <!-- IKRSIV #87：当日分拣序号（小票票头同款 dailySeq），历史单无值为 — -->
        <ElTableColumn label="当日序号" width="90">
          <template #default="{ row }">{{
            asOrder(row).dailySeq ?? "—"
          }}</template>
        </ElTableColumn>
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
            <ElTag>{{ statusText(asOrder(row)) }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="下单时间" width="175">
          <template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="210">
          <template #default="{ row }">
            <div class="order-actions" @click.stop>
              <!-- 道哥 2026-10-15：查看/推进已删——点行即开详情；推进与改状态职责重叠且与自提路线不兼容 -->
              <ElButton
                v-if="hasPerm('POST /admin/orders/:id/actions/outbound') && asOrder(row).status === 'paid'"
                size="small"
                type="primary"
                @click="outbound(asOrder(row))"
              >
                出库
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
              <!-- #88/#89：行内发起退款（未进终态且有退款审核权），提交后进售后退款列表 -->
              <ElButton
                v-if="
                  hasPerm('POST /admin/refunds/:id/audit') &&
                  refundable(asOrder(row))
                "
                size="small"
                type="danger"
                plain
                @click="openRefund(asOrder(row))"
              >
                退款
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
          <ElDescriptionsItem label="状态">{{ statusText(selected) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="实付">¥{{ fenToYuan(selected.payableAmount) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="收货人">{{ selected.address?.contactName || "—" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="电话">{{ selected.address?.phone || selected.userPhone || "—" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="寝室">{{ addressText(selected) }}</ElDescriptionsItem>
          <!-- 配送方式（道哥 2026-10-20）：即时达/预约达，预约单带送达时段 -->
          <ElDescriptionsItem label="配送方式">{{ modeText(selected) }}</ElDescriptionsItem>
          <ElDescriptionsItem label="备注" :span="3">{{ selected.remark || "—" }}</ElDescriptionsItem>
        </ElDescriptions>
        <!-- IKP0AP：配送链路（接单骑手/楼长），无数据显示 — -->
        <section class="delivery-chain" aria-label="配送信息">
          <strong>配送信息</strong>
          <ElDescriptions :column="2" border>
            <ElDescriptionsItem label="骑手">
              {{ chainText(selected.deliveryChain?.rider) }}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="楼长">
              {{ chainText(selected.deliveryChain?.manager) }}
            </ElDescriptionsItem>
          </ElDescriptions>
        </section>
        <!-- IKRQR7：转单留痕（谁在何时从何状态转出），无记录不渲染 -->
        <section
          v-if="selected.transferLogs?.length"
          class="delivery-chain"
          aria-label="转单记录"
        >
          <strong>转单记录</strong>
          <ElTable
            :data="selected.transferLogs"
            size="small"
            class="transfer-table"
          >
            <ElTableColumn label="转单骑手" min-width="120">
              <template #default="{ row }"
                >{{ row.staffName }}（{{ row.staffNo }}）</template
              >
            </ElTableColumn>
            <ElTableColumn
              prop="fromStatus"
              label="转出时状态"
              min-width="160"
            />
            <ElTableColumn label="转单时间" min-width="150">
              <template #default="{ row }">{{
                row.createdAt.replace("T", " ").slice(0, 16)
              }}</template>
            </ElTableColumn>
          </ElTable>
        </section>
        <ElTable :data="selected.items || []" class="items-table">
          <ElTableColumn label="商品">
            <template #default="{ row }">{{ row.product?.name || "未知商品" }}</template>
          </ElTableColumn>
          <ElTableColumn prop="quantity" label="数量" width="100" />
        </ElTable>
        <div
          v-for="group in [
            { label: '骑手交接', images: selected.package?.handoverProof?.images || [] },
            {
              label: '送达凭证',
              images: selected.package?.proof?.images || selected.package?.deliveredProof?.images || [],
            },
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
                <!-- 2026-10-16 道哥拍板：补录通道（线下送达兜底）——原因必填，
                     后端同事务补提成快照+推用户收货通知 -->
                <ElOption label="已送达（待用户确认）" value="delivered" />
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

    <!-- #88/#89 行内退款弹窗：金额默认可退余额（可改）+原因必填 -->
    <ElDialog
      v-model="refundOpen"
      title="发起退款"
      width="min(560px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <template v-if="refundOrder">
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem label="订单编号" :span="2">
            {{ refundOrder.orderNo }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="实付">
            ¥{{ fenToYuan(refundOrder.payableAmount) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="商品额">
            ¥{{ fenToYuan(goodsAmountOf(refundOrder)) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="配送费">
            ¥{{ fenToYuan(refundOrder.deliveryFee ?? 0) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="已退金额">
            {{ refundReservedLoading ? "查询中…" : `¥${fenToYuan(refundReserved)}` }}
          </ElDescriptionsItem>
        </ElDescriptions>
        <ElForm label-position="top" class="refund-form">
          <ElFormItem label="退款金额（元）">
            <ElInputNumber
              v-model="refundForm.amount"
              :min="0"
              :max="refundAvailableYuan"
              :precision="2"
              :step="1"
              :disabled="refundReservedLoading"
            />
          </ElFormItem>
          <ElFormItem label="退款原因（必填）">
            <ElInput
              v-model="refundForm.reason"
              type="textarea"
              :rows="2"
              maxlength="120"
              show-word-limit
              placeholder="随退款申请展示给审核人"
            />
          </ElFormItem>
        </ElForm>
      </template>
      <template #footer>
        <ElButton @click="refundOpen = false">取消</ElButton>
        <ElButton
          type="danger"
          :loading="working"
          :disabled="refundReservedLoading"
          @click="submitRefund"
        >
          提交退款申请
        </ElButton>
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

.transfer-table {
  margin-top: 8px;
  width: 100%;
}
.delivery-chain {
  margin-top: 16px;
}

.delivery-chain > strong {
  display: block;
  margin-bottom: 10px;
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

/* #88/#89 退款弹窗 */
.refund-form {
  margin-top: 16px;
}

.refund-form :deep(.el-input-number) {
  width: 200px;
}

.refund-tip {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
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
