<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import NightLoadError from '../../NightLoadError.vue';
import { fmtDateTime } from '../../../../utils/datetime';
import { ElMessage, ElMessageBox } from "element-plus";
import { api, fetchAllPages } from "../../../../api";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import { effectiveCampusId, hasPerm } from "../../../../session";
import { fenToYuan } from "../../../../utils/money";
import type {
  NightStockRequest,
  NightInventoryReport,
  NightStoreRow,
} from "../../../../types";
const props = defineProps<{ kind: "stock" | "reports"; storeId?: string }>();
const stock = ref<NightStockRequest[]>([]),
  reports = ref<NightInventoryReport[]>([]);
const loading = ref(false),
  busy = ref(false),
  status = ref("");
const loadError = ref('');
const stockDetail = ref<NightStockRequest | null>(null),
  reportDetail = ref<NightInventoryReport | null>(null);
const stockOpen = ref(false),
  reportOpen = ref(false);
const keyword = ref(""),
  storeFilter = ref(""),
  reportKind = ref("");
const dateRange = ref<string[] | null>(null);
const stores = ref<NightStoreRow[]>([]);
const page = ref(1),
  pageSize = ref(20);
const total = computed(() =>
  props.kind === "stock" ? stock.value.length : reports.value.length,
);
const visibleStock = computed(() =>
  stock.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
const visibleReports = computed(() =>
  reports.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
async function loadStores() {
  if (!effectiveCampusId.value) {
    stores.value = [];
    return;
  }
  const campus = effectiveCampusId.value;
  try {
    const rows = await fetchAllPages(
      (q) => api.nightStores(undefined, q.page, q.pageSize),
      100,
    );
    if (campus === effectiveCampusId.value) stores.value = rows;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "楼栋选项加载失败");
  }
}
function search() {
  page.value = 1;
  void load();
}
function resetFilters() {
  keyword.value = "";
  storeFilter.value = "";
  reportKind.value = "";
  dateRange.value = null;
  status.value = "";
  search();
}
const stockLabels: Record<string, string> = {
  requested: "待审核",
  approved: "已审核待出库",
  shipped: "已出库待收货",
  received: "已收货",
  rejected: "已驳回",
  cancelled: "已取消",
  completed: "历史已入库",
};
const reportLabels: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};
const kinds: Record<string, string> = {
  loss: "店内报损",
  stocktake: "库存盘点",
  "receipt-shortage": "收货差异报损",
  "order-loss": "退款未回库报损",
};
const date = (v: string | null) => fmtDateTime(v);
let generation = 0;
async function load() {
  const current = ++generation;
  loadError.value = '';
  if (!effectiveCampusId.value && !props.storeId) {
    stock.value = [];
    reports.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    if (props.kind === "stock") {
      const r = await api.nightStockRequests(
        status.value,
        props.storeId || storeFilter.value,
        {
          keyword: keyword.value.trim(),
          from: dateRange.value?.[0],
          to: dateRange.value?.[1],
        },
      );
      if (current === generation) {
        stock.value = r;
        page.value = Math.min(
          page.value,
          Math.max(1, Math.ceil(r.length / pageSize.value)),
        );
      }
    } else {
      const r = await api.nightInventoryReports(
        status.value,
        props.storeId || storeFilter.value,
        {
          keyword: keyword.value.trim(),
          from: dateRange.value?.[0],
          to: dateRange.value?.[1],
          kind: reportKind.value,
        },
      );
      if (current === generation) {
        reports.value = r;
        page.value = Math.min(
          page.value,
          Math.max(1, Math.ceil(r.length / pageSize.value)),
        );
      }
    }
  } catch (e) {
    if (current === generation) loadError.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch([() => props.kind, () => props.storeId], () => {
  resetFilters();
  stockOpen.value = false;
  reportOpen.value = false;
});
watch(effectiveCampusId, () => {
  stockOpen.value = false;
  reportOpen.value = false;
  storeFilter.value = "";
  stores.value = [];
  resetFilters();
  void loadStores();
});
onMounted(() => {
  void load();
  void loadStores();
});
function showStock(row: NightStockRequest) {
  stockDetail.value = row;
  stockOpen.value = true;
}
function showReport(row: NightInventoryReport) {
  reportDetail.value = row;
  reportOpen.value = true;
}
async function explanation(title: string) {
  try {
    const r = await ElMessageBox.prompt(
      "请填写处理说明（将对楼长可见）",
      title,
      {
        inputType: "textarea",
        inputValidator: (v) => Boolean(v?.trim()) || "请填写说明",
        confirmButtonText: "确认",
        cancelButtonText: "取消",
      },
    );
    return r.value.trim();
  } catch {
    return null;
  }
}
async function act(
  action: "approve" | "reject" | "ship" | "cancel",
  row: NightStockRequest,
) {
  if (busy.value) return;
  const label = {
    approve: "通过备货审核",
    reject: "驳回备货申请",
    ship: "确认整单出库",
    cancel: "取消备货单",
  }[action];
  const campus = effectiveCampusId.value;
  let reason = "";
  if (action === "ship") {
    try {
      await ElMessageBox.confirm(
        "确认本单全部货物已交付线下运输？出库后不可取消，也不支持分批发货。",
        label,
        { type: "warning" },
      );
    } catch {
      return;
    }
  } else {
    const value = await explanation(label);
    if (value === null) return;
    reason = value;
  }
  if (campus !== effectiveCampusId.value) return;
  busy.value = true;
  try {
    if (action === "ship") await api.shipNightStock(row.id);
    else if (action === "cancel") await api.cancelNightStock(row.id, reason);
    else await api.reviewNightStock(row.id, action === "approve", reason);
    ElMessage.success("处理成功");
    stockOpen.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "处理失败");
    await load();
  } finally {
    busy.value = false;
  }
}
async function review(row: NightInventoryReport, approved: boolean) {
  if (busy.value) return;
  const campus = effectiveCampusId.value;
  const reason = await explanation(
    approved ? "通过盘点/报损审核" : "驳回盘点/报损",
  );
  if (reason === null || campus !== effectiveCampusId.value) return;
  busy.value = true;
  try {
    await api.reviewNightInventory(row.id, approved, reason);
    reportOpen.value = false;
    ElMessage.success("处理成功");
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "处理失败");
    await load();
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <NightLoadError :message="loadError" :loading="loading" @retry="load" />
    <section class="admin-filter-panel inventory-filter">
      <ElInput
        v-model="keyword"
        style="width: 260px"
        placeholder="单号 / 商品 / 楼栋 / 楼长 / 原因"
        clearable
        @keyup.enter="search"
      />
      <ElSelect
        v-if="!props.storeId"
        v-model="storeFilter"
        placeholder="全部楼栋 / 楼长"
        clearable
        filterable
        style="width: 210px"
        @change="search"
        ><ElOption
          v-for="s in stores"
          :key="s.id"
          :label="`${s.buildingName} · ${s.manager?.name || '未绑定楼长'}`"
          :value="s.id"
      /></ElSelect>
      <ElSelect
        v-model="status"
        @change="search"
        placeholder="全部状态"
        style="width: 200px"
        clearable
        ><ElOption label="全部状态" value="" /><ElOption
          v-for="(label, key) in kind === 'stock' ? stockLabels : reportLabels"
          :key="key"
          :label="label"
          :value="key"
      /></ElSelect>
      <ElSelect
        v-if="kind === 'reports'"
        v-model="reportKind"
        placeholder="全部申报类型"
        clearable
        style="width: 180px"
        @change="search"
        ><ElOption
          v-for="(label, key) in kinds"
          :key="key"
          :label="label"
          :value="key"
      /></ElSelect>
      <ElDatePicker
        v-model="dateRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="申请开始日期"
        end-placeholder="申请结束日期"
        range-separator="至"
        style="width: 280px; flex-grow: 0"
        @change="search"
      />
      <ElButton type="primary" :loading="loading" @click="search">查询</ElButton
      ><ElButton @click="resetFilters">重置</ElButton>
      <span class="muted">{{
        kind === "stock"
          ? "审核通过将整单预留共享仓库库存；出库后由楼长确认实收。"
          : "盘亏/报损先冻结，审核通过才释放额度；盘盈通过才入库。"
      }}</span>
    </section>
    <section v-loading="loading" class="admin-table-panel">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>时间 / 单号</th>
              <th>楼栋 / 楼长</th>
              <th>{{ kind === "stock" ? "商品 / 货值" : "申报类型" }}</th>
              <th>状态</th>
              <th>占用额度</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody v-if="kind === 'stock'">
            <tr v-for="row in visibleStock" :key="row.id">
              <td>
                {{ date(row.createdAt)
                }}<small>{{ row.id.slice(-10).toUpperCase() }}</small>
              </td>
              <td>
                {{ row.buildingName }}<small>{{ row.managerName }}</small>
              </td>
              <td>
                {{ row.items.length }} 种商品<small
                  >¥{{ fenToYuan(row.totalValue) }}</small
                >
              </td>
              <td>
                <ElTag>{{ stockLabels[row.status] || row.status }}</ElTag>
              </td>
              <td>¥{{ fenToYuan(row.heldValue) }}</td>
              <td>
                <ElButton link type="primary" @click="showStock(row)"
                  >查看 / 处理</ElButton
                >
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="row in visibleReports" :key="row.id">
              <td>
                {{ date(row.createdAt)
                }}<small>{{ row.id.slice(-10).toUpperCase() }}</small>
              </td>
              <td>
                {{ row.buildingName }}<small>{{ row.managerName }}</small>
              </td>
              <td>{{ kinds[row.kind] || row.kind }}</td>
              <td>
                <ElTag>{{ reportLabels[row.status] || row.status }}</ElTag>
              </td>
              <td>¥{{ fenToYuan(row.heldValue) }}</td>
              <td>
                <ElButton link type="primary" @click="showReport(row)"
                  >查看 / 审核</ElButton
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ElEmpty
        v-if="!loading && !(kind === 'stock' ? stock.length : reports.length)"
        description="暂无记录"
      />
      <AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
      <p class="muted">
        共
        {{
          total
        }}
        条匹配记录，按当前筛选完整分页展示。日期按北京时间申请日期筛选。
      </p>
    </section>
    <ElDialog
      v-model="stockOpen"
      title="备货单详情"
      width="min(820px, calc(100vw - 32px))"
      :close-on-click-modal="false"
    >
      <template v-if="stockDetail">
        <ElDescriptions :column="2" border
          ><ElDescriptionsItem label="楼栋 / 楼长"
            >{{ stockDetail.buildingName }} /
            {{ stockDetail.managerName }}</ElDescriptionsItem
          ><ElDescriptionsItem label="状态">{{
            stockLabels[stockDetail.status] || stockDetail.status
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="申请时间">{{
            date(stockDetail.createdAt)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="申请货值"
            >¥{{ fenToYuan(stockDetail.totalValue) }}</ElDescriptionsItem
          ><ElDescriptionsItem label="审核时间">{{
            date(stockDetail.reviewedAt)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="出库时间">{{
            date(stockDetail.shippedAt)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="收货时间">{{
            date(stockDetail.receivedAt)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="预占额度"
            >¥{{ fenToYuan(stockDetail.heldValue) }}</ElDescriptionsItem
          ></ElDescriptions
        >
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>申请单价</th>
                <th>申请数量</th>
                <th>实收数量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in stockDetail.items" :key="i.catalogProductId">
                <td>{{ i.name }}</td>
                <td>¥{{ fenToYuan(i.price) }}</td>
                <td>{{ i.quantity }}</td>
                <td>{{ i.receivedQuantity ?? "待收货" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>处理说明：{{ stockDetail.reason || "—" }}</p>
        <ElAlert
          title="整单审核、一次出库、一次收货。审核时仓库库存不足将整单失败；少收自动报损，批准后释放差额。"
          :closable="false"
          type="info"
        />
      </template>
      <template #footer
        ><template v-if="stockDetail"
          ><ElButton @click="stockOpen = false">关闭</ElButton
          ><template
            v-if="
              stockDetail.status === 'requested' &&
              hasPerm('POST /admin/night/stock-orders/:id/review')
            "
            ><ElButton
              type="danger"
              :disabled="busy"
              @click="act('reject', stockDetail)"
              >驳回</ElButton
            ><ElButton
              type="primary"
              :disabled="busy"
              @click="act('approve', stockDetail)"
              >通过并预留库存</ElButton
            ></template
          ><ElButton
            v-if="
              stockDetail.status === 'approved' &&
              hasPerm('POST /admin/night/stock-orders/:id/ship')
            "
            type="primary"
            :disabled="busy"
            @click="act('ship', stockDetail)"
            >确认整单出库</ElButton
          ><ElButton
            v-if="
              ['requested', 'approved'].includes(stockDetail.status) &&
              hasPerm('POST /admin/night/stock-orders/:id/cancel')
            "
            :disabled="busy"
            @click="act('cancel', stockDetail)"
            >取消备货单</ElButton
          ></template
        ></template
      >
    </ElDialog>
    <ElDialog
      v-model="reportOpen"
      title="盘点 / 报损审核"
      width="min(820px, calc(100vw - 32px))"
      :close-on-click-modal="false"
    >
      <template v-if="reportDetail">
        <ElDescriptions :column="2" border
          ><ElDescriptionsItem label="楼栋 / 楼长"
            >{{ reportDetail.buildingName }} /
            {{ reportDetail.managerName }}</ElDescriptionsItem
          ><ElDescriptionsItem label="类型">{{
            kinds[reportDetail.kind] || reportDetail.kind
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="状态">{{
            reportLabels[reportDetail.status]
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="占用额度"
            >¥{{ fenToYuan(reportDetail.heldValue) }}</ElDescriptionsItem
          ></ElDescriptions
        >
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th>账面 / 实数</th>
                <th>差异 / 报损数量</th>
                <th>历史货值</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in reportDetail.items" :key="i.nightProductId">
                <td>{{ i.name }}</td>
                <td>{{ i.bookQuantity }} / {{ i.countedQuantity ?? "—" }}</td>
                <td>
                  {{
                    i.delta ? (i.delta > 0 ? "+" : "") + i.delta : i.quantity
                  }}
                </td>
                <td>¥{{ fenToYuan(i.value) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>申报说明：{{ reportDetail.reason }}</p>
        <p>审核说明：{{ reportDetail.reviewReason || "—" }}</p>
        <div class="photos">
          <ElImage
            v-for="url in reportDetail.photos || []"
            :key="url"
            :src="url"
            :preview-src-list="reportDetail.photos || []"
            fit="cover"
            preview-teleported
          />
        </div>
        <ElAlert
          v-if="['receipt-shortage', 'order-loss'].includes(reportDetail.kind)"
          title="本单不重复扣减仓库或楼栋库存。通过释放占用，驳回继续占用额度，楼长可补充说明重报。"
          type="warning"
          :closable="false"
        />
      </template>
      <template #footer
        ><ElButton @click="reportOpen = false">关闭</ElButton
        ><template
          v-if="
            reportDetail?.status === 'pending' &&
            hasPerm('POST /admin/night/inventory-reports/:id/review')
          "
          ><ElButton
            type="danger"
            :disabled="busy"
            @click="review(reportDetail, false)"
            >驳回</ElButton
          ><ElButton
            type="primary"
            :disabled="busy"
            @click="review(reportDetail, true)"
            >审核通过</ElButton
          ></template
        ></template
      >
    </ElDialog>
  </div>
</template>
<style scoped>
.inventory-filter {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.muted,
small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
small {
  display: block;
  margin-top: 6px;
}
.table-scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  margin: 18px 0;
}
th {
  color: var(--el-text-color-secondary);
  font-weight: 500;
  background: var(--el-fill-color-light);
}
th,
td {
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  white-space: nowrap;
}
.photos {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 18px 0;
}
.photos .el-image {
  width: 100px;
  height: 100px;
  border-radius: 10px;
}
</style>
