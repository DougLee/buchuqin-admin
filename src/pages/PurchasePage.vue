<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import * as XLSX from "xlsx";
import { api } from "../api";
import { accountOrgLevel, hasPerm } from "../session";
import type { Campus, PurchaseRecordRow, RestockOrder } from "../types";
import { RESTOCK_ORDER_STATUS_CLASS, RESTOCK_ORDER_STATUS_TEXT } from "../dicts";
import type {
  PurchaseOrderDetail,
  PurchaseOrderRow,
} from "../types";
import { fenToYuan, yuanToFen } from "../utils/money";
import { fmtDate, fmtDateTime } from "../utils/datetime";
import AdminPagination from "../shared/ui/AdminPagination.vue";
const notify = (message: string, error = false) => ElMessage({ message, type: error ? "error" : "success", showClose: true });

/**
 * 采购管理（IKFOQ1，2026-09-15 grilling 定版）：
 * - 独立一级菜单（道哥拍板与订货管理平级），全链总部动作 hq/admin
 * - 生成入口在订货管理批次详情（一键聚合），本页专注验收闭环：
 *   快捷全收（预填欠收可改小）→ 部分到货/收齐推导；坏品入库再出库
 * - 关闭使欠收作废禁验收、可重开；金额=行单价×数量（IQ7）
 */


const loading = ref(true);
const error = ref("");
const orders = ref<PurchaseOrderRow[]>([]);
/** IKJCJF：校区级账号进本页=看自己校区的订货单进度（采购单是总部动作） */
const isCampusView = computed(() => !hasPerm("GET /admin/purchase/orders"));
const myOrders = ref<RestockOrder[]>([]);
const myDetail = ref<RestockOrder | null>(null);
const myDrawerOpen = ref(false);
const asRestockOrder = (row: unknown) => row as RestockOrder;
const asPurchaseOrder = (row: unknown) => row as PurchaseOrderRow;

// 采购阶段字典见 src/dicts/inventory（PURCHASE_PHASE_TEXT/CLASS，IKIYMM 集中化）
import { PURCHASE_PHASE_CLASS, PURCHASE_PHASE_TEXT } from "../dicts";

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (isCampusView.value) {
      // 校区视角：本校区全部订货单（跨批次，含待审/通过/发货/到货）
      myOrders.value = await api.restockOrders();
    } else {
      orders.value = await api.purchaseOrders();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
/** 删除待审核订货单（IKJCJF：总部审核前可删）。 */
const deleting = ref("");
async function deleteMyOrder(id: string) {
  try { await ElMessageBox.confirm("确认删除这张待审核订货单？", "删除订货单", { type: "warning", confirmButtonText: "确认删除", cancelButtonText: "取消" }); }
  catch { return; }
  deleting.value = id;
  try {
    await api.deleteRestockOrder(id);
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  } finally {
    deleting.value = "";
  }
}
/** 校区确认到货：按发货数全额入账（grilling #3 不登记差异）。 */
const receiptBusy = ref(false);
async function confirmReceipt() {
  const target = myDetail.value;
  if (!target) return;
  try { await ElMessageBox.confirm("确认到货后库存按发货数全额入账（差异请线下核对登记），订货单随即完结。", "确认到货", { type: "warning", confirmButtonText: "确认入账", cancelButtonText: "取消" }); }
  catch { return; }
  receiptBusy.value = true;
  try {
    await api.confirmRestockReceipt(target.id);
    myDetail.value = await api.restockOrderDetail(target.id);
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  } finally {
    receiptBusy.value = false;
  }
}
async function openMyOrder(id: string) {
  myDrawerOpen.value = true;
  myDetail.value = null;
  try {
    myDetail.value = await api.restockOrderDetail(id);
  } catch (e) {
    myDrawerOpen.value = false;
    error.value = e instanceof Error ? e.message : "加载失败";
  }
}
onMounted(load);

/* ---------- 采购台账（#97）：纯登记台账，不动库存不落流水 ---------- */
const activeTab = ref<"orders" | "ledger">("orders");
/** 台账能力按 RBAC fail-closed：无 GET /admin/purchases 授权的账号不出现该 Tab。 */
const canLedger = computed(() => hasPerm("GET /admin/purchases"));
/** 校区筛选只给平台/组织角色（campus 账号后端本就锁定本校区）。 */
const canPickLedgerCampus = computed(() => accountOrgLevel.value !== "campus");
const ledgerRows = ref<PurchaseRecordRow[]>([]);
const ledgerLoading = ref(false);
const ledgerError = ref("");
const ledgerPage = ref(1);
const ledgerPageSize = ref(20);
const ledgerTotal = ref(0);
const ledgerKeyword = ref("");
const ledgerCampus = ref("");
const ledgerCampuses = ref<Campus[]>([]);
const ledgerLoaded = ref(false);
/** 本地日期 → YYYY-MM-DD（purchasedAt 缺省本月范围）。 */
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const ledgerRange = ref<[string, string] | null>([
  isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  isoDate(new Date()),
]);
const asPurchaseRecord = (row: unknown) => row as PurchaseRecordRow;
/** #97：后端暂无排序参数——sortable="custom" 只对当前页内存排序（翻页/重查还原）。 */
const ledgerSortProp = ref<"purchasedAt" | "price" | "">("");
const ledgerSortOrder = ref<"ascending" | "descending" | null>(null);
const ledgerDisplayRows = computed(() => {
  const rows = [...ledgerRows.value];
  const prop = ledgerSortProp.value;
  const order = ledgerSortOrder.value;
  if (!prop || !order) return rows;
  const dir = order === "ascending" ? 1 : -1;
  return rows.sort((a, b) =>
    a[prop] === b[prop] ? 0 : a[prop] > b[prop] ? dir : -dir,
  );
});
/** 到期预警汇总（只统计当前页返回行）。 */
const ledgerExpiringCount = computed(
  () => ledgerRows.value.filter((row) => row.expiring && !row.expired).length,
);
const ledgerExpiredCount = computed(
  () => ledgerRows.value.filter((row) => row.expired).length,
);
async function loadLedger() {
  ledgerLoading.value = true;
  ledgerError.value = "";
  try {
    const result = await api.purchases({
      start: ledgerRange.value?.[0],
      end: ledgerRange.value?.[1],
      campus: ledgerCampus.value || undefined,
      keyword: ledgerKeyword.value.trim() || undefined,
      page: ledgerPage.value,
      pageSize: ledgerPageSize.value,
    });
    ledgerRows.value = result.items;
    ledgerTotal.value = result.total;
  } catch (e) {
    ledgerRows.value = [];
    ledgerTotal.value = 0;
    ledgerError.value = e instanceof Error ? e.message : "台账加载失败";
  } finally {
    ledgerLoading.value = false;
  }
}
function searchLedger() {
  if (ledgerPage.value === 1) void loadLedger();
  else ledgerPage.value = 1; // 翻页 watch 会触发加载
}
function onLedgerSortChange({
  prop,
  order,
}: {
  prop: string | null;
  order: "ascending" | "descending" | null;
}) {
  ledgerSortProp.value =
    prop === "purchasedAt" || prop === "price" ? prop : "";
  ledgerSortOrder.value = order;
}
async function loadLedgerCampuses() {
  if (!canPickLedgerCampus.value || ledgerCampuses.value.length) return;
  try {
    ledgerCampuses.value = await api.campuses();
  } catch {
    ledgerCampuses.value = [];
  }
}
watch(activeTab, (tab) => {
  if (tab === "ledger" && !ledgerLoaded.value) {
    ledgerLoaded.value = true;
    void loadLedger();
    void loadLedgerCampuses();
  }
});
watch([ledgerPage, ledgerPageSize, ledgerCampus], () => void loadLedger());
let ledgerKeywordTimer: number | undefined;
watch(ledgerKeyword, () => {
  if (ledgerKeywordTimer) clearTimeout(ledgerKeywordTimer);
  ledgerKeywordTimer = window.setTimeout(() => {
    ledgerPage.value = 1;
    void loadLedger();
  }, 280);
});

/** 手动新增弹窗（price 存元、提交 yuanToFen；expiresAt 可空）。 */
const createOpen = ref(false);
const creating = ref(false);
const createForm = reactive({
  productName: "",
  qty: 1,
  price: null as number | null,
  expiresAt: "",
  purchasedAt: isoDate(new Date()),
  remark: "",
});
function openCreate() {
  Object.assign(createForm, {
    productName: "",
    qty: 1,
    price: null,
    expiresAt: "",
    purchasedAt: isoDate(new Date()),
    remark: "",
  });
  createOpen.value = true;
}
async function submitCreate() {
  const productName = createForm.productName.trim();
  if (!productName) return notify("请填写商品名称", true);
  if (!Number.isInteger(createForm.qty) || createForm.qty <= 0)
    return notify("入库数量必须为正整数", true);
  const price = createForm.price;
  if (price == null || !Number.isFinite(price) || price < 0)
    return notify("请填写采购价", true);
  if (!createForm.purchasedAt) return notify("请选择入库日期", true);
  creating.value = true;
  try {
    await api.createPurchase(
      {
        productName,
        qty: createForm.qty,
        price: yuanToFen(price),
        expiresAt: createForm.expiresAt || null,
        purchasedAt: createForm.purchasedAt,
        remark: createForm.remark.trim(),
      },
      ledgerCampus.value || undefined,
    );
    notify("台账已登记");
    createOpen.value = false;
    searchLedger();
  } catch (e) {
    notify(e instanceof Error ? e.message : "登记失败", true);
  } finally {
    creating.value = false;
  }
}

/** 导出 xlsx：照商品管理模式按当前筛选翻页取全量（pageSize 100，防失控封顶 50 页）。 */
const exporting = ref(false);
async function exportLedger() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const all: PurchaseRecordRow[] = [];
    for (let p = 1; p <= 50; p++) {
      const result = await api.purchases({
        start: ledgerRange.value?.[0],
        end: ledgerRange.value?.[1],
        campus: ledgerCampus.value || undefined,
        keyword: ledgerKeyword.value.trim() || undefined,
        page: p,
        pageSize: 100,
      });
      all.push(...result.items);
      if (all.length >= result.total || !result.items.length) break;
    }
    const statusText = (row: PurchaseRecordRow) =>
      row.expired ? "已过期" : row.expiring ? "30 天内到期" : "正常";
    const header = [
      "商品名称",
      "入库数量",
      "采购价(元)",
      "入库日期",
      "到期时间",
      "状态",
      "备注",
      "登记人",
      "登记时间",
    ];
    const rows = all.map((row) => [
      row.productName,
      row.qty,
      Number(fenToYuan(row.price)),
      row.purchasedAt,
      row.expiresAt ? fmtDate(row.expiresAt) : "",
      statusText(row),
      row.remark || "",
      row.createdByName || "",
      fmtDateTime(row.createdAt),
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet["!cols"] = header.map((h) => ({ wch: Math.max(10, h.length * 2 + 2) }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "采购台账");
    XLSX.writeFile(book, `采购台账-${isoDate(new Date())}.xlsx`);
    notify(`已导出 ${all.length} 条台账`);
  } catch (e) {
    notify(e instanceof Error ? e.message : "导出失败", true);
  } finally {
    exporting.value = false;
  }
}

/* ---------- 详情 + 验收 ---------- */
const detailDrawer = ref(false);
const detail = ref<PurchaseOrderDetail | null>(null);
/** 本次验收行编辑态：productId → { receive, bad, note }，预填欠收（快捷全收） */
type RxLine = { productId: string; receive: number; bad: number; note: string };
const rxLines = ref<RxLine[]>([]);
const rxBusy = ref(false);
async function openDetail(row: PurchaseOrderRow) {
  detailDrawer.value = true;
  detail.value = null;
  detail.value = await api.purchaseOrderDetail(row.id);
}
/** 打开验收弹框：逐行预填欠收（IQ3 快捷全收），收齐行预填 0 */
function openReceive() {
  const d = detail.value;
  if (!d) return;
  rxLines.value = d.items.map((i) => ({
    productId: i.productId,
    receive: Math.max(0, i.requiredCases - i.receivedCases),
    bad: 0,
    note: "",
  }));
}
async function submitReceive() {
  if (!detail.value) return;
  const lines = rxLines.value
    .map((l) => ({
      productId: l.productId,
      receiveCases: Math.max(0, Math.round(l.receive) || 0),
      badCases: Math.max(0, Math.round(l.bad) || 0),
      note: l.note.trim(),
    }))
    .filter((l) => l.receiveCases > 0 || l.badCases > 0);
  if (!lines.length) return notify("请至少为一行填写本次到货件数", true);
  rxBusy.value = true;
  try {
    await api.receivePurchaseOrder(detail.value.id, lines);
    notify("验收完成，总部仓库存已更新");
    await refreshDetail();
  } catch (e) {
    notify(e instanceof Error ? e.message : "验收失败", true);
  } finally {
    rxBusy.value = false;
  }
}
async function closeOrder() {
  if (!detail.value) return;
  let note = "";
  try {
    const result = await ElMessageBox.prompt("欠收将作废，可留空。", "关闭采购单", { inputPlaceholder: "关闭原因", confirmButtonText: "确认关闭", cancelButtonText: "取消" });
    note = result.value ?? "";
  } catch { return; }
  try {
    await api.closePurchaseOrder(detail.value.id, note);
    await refreshDetail();
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  }
}
async function reopenOrder() {
  if (!detail.value) return;
  try {
    await api.reopenPurchaseOrder(detail.value.id);
    await refreshDetail();
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", true);
  }
}
async function refreshDetail() {
  const fresh = await api.purchaseOrderDetail(detail.value!.id);
  detail.value = fresh;
  await load();
}
</script>

<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器，header 标签会误命中变白卡 -->
    <div class="page-head">
      <div>
        <h1>采购管理</h1>
        <p v-if="isCampusView">本校区全部订货单的进度跟踪：提交 → 总部确认 → 发货 → 到货确认。</p>
        <p v-else>批次订货汇总生成供应商采购单，验收入总部仓；坏品登记自动出库，支持部分到货。</p>
      </div>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>

    <!-- IKJCJF：校区视角=我的订货单（跨批次进度跟踪） -->
    <div v-if="isCampusView" class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ myOrders.length }}</strong><span> 张订货单</span>
        </div>
        <p><span class="live-dot"></span>数据已同步 · 全部批次</p>
      </div>
      <ElTable v-loading="loading" :data="myOrders" row-key="id" empty-text="还没有订货单。到「订货单」选开放批次填写提交。">
        <ElTableColumn label="批次" min-width="160"><template #default="{ row }"><strong>{{ row.batchName || row.batchId }}</strong></template></ElTableColumn>
        <ElTableColumn label="提交时间" min-width="170"><template #default="{ row }">{{ fmtDateTime(row.submittedAt) }}</template></ElTableColumn>
        <ElTableColumn label="提交人" min-width="120"><template #default="{ row }">{{ row.submitByName || "—" }}</template></ElTableColumn>
        <ElTableColumn label="商品" width="90"><template #default="{ row }">{{ row.itemCount ?? row.items?.length ?? "—" }}</template></ElTableColumn>
        <ElTableColumn label="件数" width="90"><template #default="{ row }">{{ row.totalCases ?? "—" }}</template></ElTableColumn>
        <ElTableColumn label="状态" width="120"><template #default="{ row }"><ElTag>{{ RESTOCK_ORDER_STATUS_TEXT[row.status] }}</ElTag></template></ElTableColumn>
        <ElTableColumn label="操作" fixed="right" width="160"><template #default="{ row }"><ElButton size="small" type="primary" @click="openMyOrder(row.id)">详情</ElButton><ElButton v-if="row.status === 'submitted' && hasPerm('DELETE /admin/restock/orders/:id')" size="small" type="danger" plain :loading="deleting === row.id" @click="deleteMyOrder(row.id)">删除</ElButton></template></ElTableColumn>
      </ElTable>
    </div>

    <!-- #97：总部视角加 Tab——订货批次（原批次流）+ 采购台账（纯登记） -->
    <ElTabs v-else v-model="activeTab" class="purchase-tabs">
      <ElTabPane label="订货批次" name="orders">
        <div class="data-panel">
          <div class="data-summary">
            <div>
              <strong>{{ orders.length }}</strong><span> 张采购单</span>
            </div>
            <p><span class="live-dot"></span>数据已同步</p>
          </div>
          <ElTable v-loading="loading" :data="orders" row-key="id" empty-text="还没有采购单。到「订货单」打开批次详情，一键聚合生成。">
            <ElTableColumn prop="batchName" label="采购批次" min-width="160" />
            <ElTableColumn prop="supplierName" label="供应商" min-width="140" />
            <ElTableColumn label="状态" width="110"><template #default="{ row }"><ElTag>{{ PURCHASE_PHASE_TEXT[row.phase] }}</ElTag></template></ElTableColumn>
            <ElTableColumn label="应收 / 已收（件）" min-width="150"><template #default="{ row }">{{ row.requiredCases }} / {{ row.receivedCases }}<em v-if="row.phase === 'partial'" class="shortage">（欠 {{ row.requiredCases - row.receivedCases }}）</em></template></ElTableColumn>
            <ElTableColumn label="坏品" width="80"><template #default="{ row }">{{ row.badCases || "—" }}</template></ElTableColumn>
            <ElTableColumn label="采购总额" width="120"><template #default="{ row }">¥{{ fenToYuan(row.totalCost) }}</template></ElTableColumn>
            <ElTableColumn label="已收金额" width="120"><template #default="{ row }">¥{{ fenToYuan(row.receivedCost) }}</template></ElTableColumn>
            <ElTableColumn label="创建人 / 时间" min-width="180"><template #default="{ row }">{{ row.createdByName || "—" }}<br />{{ fmtDateTime(row.createdAt) }}</template></ElTableColumn>
            <ElTableColumn label="操作" fixed="right" width="100"><template #default="{ row }"><ElButton v-if="hasPerm('GET /admin/purchase/orders/:id')" size="small" type="primary" @click="openDetail(asPurchaseOrder(row))">详情</ElButton></template></ElTableColumn>
          </ElTable>
        </div>
      </ElTabPane>
      <ElTabPane v-if="canLedger" label="采购台账" name="ledger">
        <div class="data-panel ledger-panel">
          <div class="ledger-filter">
            <ElDatePicker
              v-model="ledgerRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="入库开始"
              end-placeholder="入库结束"
              :clearable="false"
            />
            <ElInput
              v-model="ledgerKeyword"
              clearable
              placeholder="搜索商品名称"
              class="ledger-keyword"
              @keyup.enter="searchLedger"
            />
            <ElSelect
              v-if="canPickLedgerCampus"
              v-model="ledgerCampus"
              clearable
              filterable
              placeholder="全部校区"
              class="ledger-campus"
            ><ElOption v-for="c in ledgerCampuses" :key="c.id" :label="c.name" :value="c.id" /></ElSelect>
            <ElButton type="primary" :loading="ledgerLoading" @click="searchLedger">查询</ElButton>
            <div class="ledger-actions">
              <ElButton :loading="exporting" @click="exportLedger">导出</ElButton>
              <ElButton v-if="hasPerm('POST /admin/purchases')" type="primary" @click="openCreate">手动新增</ElButton>
            </div>
          </div>
          <ElAlert
            v-if="ledgerExpiredCount || ledgerExpiringCount"
            type="warning"
            show-icon
            :closable="false"
            class="ledger-alert"
            title="到期预警"
            ><template #default
              >当前结果里 <strong>{{ ledgerExpiredCount }}</strong> 条已过期、<strong>{{ ledgerExpiringCount }}</strong> 条 30 天内到期</template
            ></ElAlert
          >
          <p v-if="ledgerError" class="load-error">{{ ledgerError }}</p>
          <ElTable
            v-loading="ledgerLoading"
            :data="ledgerDisplayRows"
            row-key="id"
            empty-text="暂无采购记录，点「手动新增」登记第一笔"
            @sort-change="onLedgerSortChange"
          >
            <ElTableColumn prop="productName" label="商品" min-width="180" />
            <ElTableColumn prop="qty" label="数量" width="90" />
            <ElTableColumn prop="price" label="采购价" width="110" sortable="custom"><template #default="{ row }">¥{{ fenToYuan(asPurchaseRecord(row).price) }}</template></ElTableColumn>
            <ElTableColumn label="入库日期" width="130" sortable="custom"><template #default="{ row }">{{ fmtDate(asPurchaseRecord(row).purchasedAt) }}</template></ElTableColumn>
            <ElTableColumn label="到期时间" width="130"><template #default="{ row }">{{ asPurchaseRecord(row).expiresAt ? fmtDate(asPurchaseRecord(row).expiresAt) : "—" }}</template></ElTableColumn>
            <ElTableColumn label="状态" width="130"><template #default="{ row }"><ElTag v-if="asPurchaseRecord(row).expired" type="danger">已过期</ElTag><ElTag v-else-if="asPurchaseRecord(row).expiring" type="warning">30 天内到期</ElTag><span v-else class="ledger-ok">正常</span></template></ElTableColumn>
            <ElTableColumn label="备注" min-width="140"><template #default="{ row }">{{ asPurchaseRecord(row).remark || "—" }}</template></ElTableColumn>
            <ElTableColumn label="登记人" width="110"><template #default="{ row }">{{ asPurchaseRecord(row).createdByName || "—" }}</template></ElTableColumn>
            <ElTableColumn label="登记时间" width="170"><template #default="{ row }">{{ fmtDateTime(asPurchaseRecord(row).createdAt) }}</template></ElTableColumn>
          </ElTable>
          <AdminPagination
            v-model:page="ledgerPage"
            v-model:page-size="ledgerPageSize"
            :total="ledgerTotal"
          />
        </div>
      </ElTabPane>
    </ElTabs>

    <!-- 详情 + 验收弹框 -->
    <ElDialog v-model="detailDrawer" :title="detail?.supplierName ?? '采购单'" width="min(860px, calc(100vw - 32px))" align-center destroy-on-close :close-on-click-modal="false">
        <div class="purchase-dialog-head">
          <div>
            <p class="eyebrow">PURCHASE ORDER</p>
            <h2>{{ detail?.supplierName ?? "采购单" }}</h2>
            <p v-if="detail" class="detail-window">
              {{ detail.batchName }}
              <span class="status" :class="PURCHASE_PHASE_CLASS[detail.phase]" style="margin-left: 8px">
                {{ PURCHASE_PHASE_TEXT[detail.phase] }}
              </span>
              <template v-if="detail.closedAt">
                · 关闭（{{ detail.closedByName || "—" }}）{{ detail.closedNote }}
              </template>
            </p>
          </div>
        </div>
        <template v-if="detail">
          <!-- 验收编辑态（IQ3 快捷全收：预填欠收，可改小可 0） -->
          <template v-if="rxLines.length">
            <ElForm class="rx-form" label-position="top">
              <ElRow v-for="l in rxLines" :key="l.productId" :gutter="12" class="rx-form-row">
                <ElCol :xs="24" :md="6"><ElFormItem label="商品"><strong class="rx-name">{{ detail.items.find((i) => i.productId === l.productId)?.name }}</strong></ElFormItem></ElCol>
                <ElCol :xs="24" :sm="12" :md="4"><ElFormItem label="应收 / 已收"><span class="rx-req">{{ detail.items.find((i) => i.productId === l.productId)?.requiredCases }} / {{ detail.items.find((i) => i.productId === l.productId)?.receivedCases }}</span></ElFormItem></ElCol>
                <ElCol :xs="24" :sm="12" :md="4"><ElFormItem label="本次到货"><ElInputNumber v-model="l.receive" :min="0" :step="1" /></ElFormItem></ElCol>
                <ElCol :xs="24" :sm="12" :md="4"><ElFormItem label="坏品"><ElInputNumber v-model="l.bad" :min="0" :step="1" /></ElFormItem></ElCol>
                <ElCol :xs="24" :sm="12" :md="6"><ElFormItem label="备注"><ElInput v-model="l.note" maxlength="100" placeholder="备注" /></ElFormItem></ElCol>
              </ElRow>
            </ElForm>
          </template>
          <!-- 只读行表 -->
          <template v-else>
            <div class="rx-line rx-line-head">
              <span>商品</span><span>应收</span><span>已收</span><span>欠收</span><span>坏品</span><span>单价</span>
            </div>
            <div v-for="i in detail.items" :key="i.id" class="rx-line rx-readonly">
              <span class="rx-name">{{ i.name }}</span>
              <span>{{ i.requiredCases }}</span>
              <span>{{ i.receivedCases }}</span>
              <span>{{ Math.max(0, i.requiredCases - i.receivedCases) }}</span>
              <span>{{ i.badCases || "—" }}</span>
              <span>¥{{ fenToYuan(i.unitCost) }}</span>
            </div>
            <p v-if="detail.items.some((i) => i.lastNote)" class="rx-note">
              最近验收备注：{{ detail.items.filter((i) => i.lastNote).map((i) => `${i.name}「${i.lastNote}」`).join("；") }}
            </p>
          </template>
        </template>
        <template v-if="detail" #footer>
          <ElButton @click="detailDrawer = false; rxLines = []">关闭</ElButton>
          <template v-if="detail.phase !== 'closed'">
            <ElButton
              v-if="hasPerm('POST /admin/purchase/orders/:id/close') && !rxLines.length && detail.phase !== 'completed'"
              @click="closeOrder"
            >
              关闭采购单
            </ElButton>
            <ElButton v-if="hasPerm('POST /admin/purchase/orders/:id/receive') && !rxLines.length" type="primary" @click="openReceive">
              验收入库
            </ElButton>
            <template v-else-if="rxLines.length && hasPerm('POST /admin/purchase/orders/:id/receive')">
              <ElButton @click="rxLines = []">取消验收</ElButton>
              <ElButton type="primary" :loading="rxBusy" @click="submitReceive">
                {{ rxBusy ? "提交中…" : "确认验收" }}
              </ElButton>
            </template>
          </template>
          <ElButton v-else-if="hasPerm('POST /admin/purchase/orders/:id/reopen')" type="primary" @click="reopenOrder">重开采购单</ElButton>
        </template>
    </ElDialog>

    <!-- 校区视角：订货单详情抽屉（IKJCJF） -->
    <ElDialog v-model="myDrawerOpen" title="订货单详情" width="min(760px, calc(100vw - 32px))" align-center destroy-on-close :close-on-click-modal="false">
        <div class="purchase-dialog-head">
          <div>
            <p class="eyebrow">RESTOCK ORDER</p>
            <h2>
              订货单
              <span class="status" :class="RESTOCK_ORDER_STATUS_CLASS[myDetail?.status ?? 'submitted']" style="margin-left: 8px">
                {{ RESTOCK_ORDER_STATUS_TEXT[myDetail?.status ?? 'submitted'] }}
              </span>
            </h2>
          </div>
        </div>
        <div class="drawer-body">
          <p v-if="!myDetail" class="empty-cell">加载中…</p>
          <template v-else>
            <dl class="my-meta">
              <dt>提交时间</dt><dd>{{ fmtDateTime(myDetail.submittedAt) }}</dd>
              <dt>提交人</dt><dd>{{ myDetail.submitByName || "—" }}</dd>
              <dt v-if="myDetail.auditNote">审核意见</dt>
              <dd v-if="myDetail.auditNote">{{ myDetail.auditNote }}</dd>
              <dt v-if="myDetail.shipment?.shippedAt">发货时间</dt>
              <dd v-if="myDetail.shipment?.shippedAt">{{ fmtDateTime(myDetail.shipment.shippedAt) }}</dd>
              <dt v-if="myDetail.shipment?.receivedAt">到货时间</dt>
              <dd v-if="myDetail.shipment?.receivedAt">{{ fmtDateTime(myDetail.shipment.receivedAt) }}</dd>
            </dl>
            <div v-if="myDetail.status === 'shipped'" class="drawer-actions">
              <ElButton
                v-if="hasPerm('POST /admin/restock/orders/:id/receipt')"
                type="primary"
                :loading="receiptBusy"
                @click="confirmReceipt"
              >
                {{ receiptBusy ? "入账中…" : "确认到货入账" }}
              </ElButton>
            </div>
            <ElTable :data="myDetail.items" row-key="productId" empty-text="暂无商品">
              <ElTableColumn label="商品" min-width="180"><template #default="{ row }">{{ row.product?.name ?? row.productId }}</template></ElTableColumn>
              <ElTableColumn prop="cases" label="件数" width="100" />
              <ElTableColumn label="零售单位数" width="130"><template #default="{ row }">{{ row.cases * row.unitsPerCase }}</template></ElTableColumn>
            </ElTable>
          </template>
        </div>
    </ElDialog>

    <!-- #97 手动新增采购台账：纯登记（不动库存不落流水），price 元→分提交 -->
    <ElDialog
      v-model="createOpen"
      title="手动新增采购台账"
      width="min(560px, calc(100vw - 32px))"
      align-center
      destroy-on-close
      :close-on-click-modal="false"
    >
      <ElForm label-position="top">
        <ElFormItem label="商品名称" required>
          <ElInput v-model="createForm.productName" maxlength="100" placeholder="商品名称" />
        </ElFormItem>
        <ElRow :gutter="12">
          <ElCol :span="12"><ElFormItem label="入库数量"><ElInputNumber v-model="createForm.qty" :min="1" :step="1" /></ElFormItem></ElCol>
          <ElCol :span="12"><ElFormItem label="自主采购价（元）"><ElInputNumber v-model="createForm.price" :min="0" :precision="2" :step="1" placeholder="0.00" /></ElFormItem></ElCol>
        </ElRow>
        <ElRow :gutter="12">
          <ElCol :span="12"><ElFormItem label="入库日期" required><ElDatePicker v-model="createForm.purchasedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择入库日期" /></ElFormItem></ElCol>
          <ElCol :span="12"><ElFormItem label="商品过期时间"><ElDatePicker v-model="createForm.expiresAt" type="date" value-format="YYYY-MM-DD" placeholder="可空" /></ElFormItem></ElCol>
        </ElRow>
        <ElFormItem label="备注">
          <ElInput v-model="createForm.remark" type="textarea" :rows="2" maxlength="200" placeholder="备注（可空）" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="createOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="creating" @click="submitCreate">登记</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
/* 页面壳/表格/统计条/骨架全走全局，与商品管理同源；scoped 只留弹框排版 */
.load-error {
  padding: 0 0 14px;
  font-size: 13px;
  color: #b33a3a;
}
.po-detail-drawer {
  width: min(760px, 94vw);
}
.detail-window {
  margin-top: 4px;
  font-size: 12px;
  color: #647169;
  display: flex;
  align-items: center;
}
.shortage {
  font-style: normal;
  color: #a95c20;
}
.rx-tip {
  margin-top: 14px;
  font-size: 11px;
  color: #a95c20;
  background: #fff0dc;
  border-radius: 10px;
  padding: 10px 12px;
}
.rx-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 90px 70px minmax(0, 1.2fr);
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12px;
  color: #37423c;
}
.rx-line-head {
  border-bottom: 1px solid var(--line);
  color: #7b8981;
  font-weight: 600;
  margin-top: 10px;
  padding-bottom: 8px;
}
/* 只读行表 6 列 */
.rx-readonly {
  grid-template-columns: minmax(0, 1.4fr) 70px 70px 70px 70px 90px;
}
.rx-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #153628;
  font-weight: 700;
}
.rx-req {
  text-align: center;
}
.rx-form { margin-top: 12px; }
.rx-form-row { padding-top: 12px; border-bottom: 1px dashed var(--line); }
.rx-form :deep(.el-input-number),
.rx-form :deep(.el-input) { width: 100%; }
.rx-note {
  margin-top: 10px;
  font-size: 11px;
  color: #647169;
}
/* ---------- 采购台账（#97） ---------- */
.purchase-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
.ledger-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.ledger-keyword {
  width: min(220px, 100%);
}
.ledger-campus {
  width: min(180px, 100%);
}
.ledger-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.ledger-alert {
  margin-bottom: 12px;
}
.ledger-ok {
  font-size: 12px;
  color: #647169;
}
</style>
