<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import NightLoadError from '../../NightLoadError.vue';
import { ElMessage, ElMessageBox } from "element-plus";
import { api, fetchAllPages } from "../../../../api";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import { fmtDateTime } from '../../../../utils/datetime';
import { fenToYuan } from "../../../../utils/money";
import type { NightSettlementBatch, NightStoreRow } from "../../../../types";

/**
 * 夜宵结算（IKSW1F，菜单 night-settlements）：楼长佣金周账单——
 * 出账（pending 佣金 → settled + settleBatch 批次）+ 批次列表 + 标记打款留痕。
 * estimated（未完成订单）不进批次；出账范围=本校区全部待结算店铺（可显式勾选店铺收窄）。
 */
const rows = ref<NightSettlementBatch[]>([]);
const loading = ref(false);
const loadError = ref('');
const settling = ref(false);
const page = ref(1), pageSize = ref(20), keyword = ref(''), paidFilter = ref('');
const filtered = computed(() => rows.value.filter(row => (!keyword.value.trim() || row.batch.includes(keyword.value.trim())) && (!paidFilter.value || (paidFilter.value === 'paid' ? row.markedPaid : !row.markedPaid))));
const displayed = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch([keyword, paidFilter, pageSize], () => { page.value = 1; });
let loadGeneration = 0;

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

/** ElTable 作用域槽 row 兜底断言（同 CouponPage asCoupon 模式）。 */
function asBatch(row: unknown) {
  return row as NightSettlementBatch;
}

async function load() {
  const generation = ++loadGeneration;
  loadError.value = '';
  if (!effectiveCampusId.value) {
    rows.value = [];
    return;
  }
  loading.value = true;
  try {
    const result = await api.nightSettlements();
    if (generation === loadGeneration) rows.value = result;
  } catch (e) {
    if (generation === loadGeneration) loadError.value = e instanceof Error ? e.message : '周账单加载失败';
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

/* ---------- 出账 ---------- */
const settleOpen = ref(false);
const settleStores = ref<NightStoreRow[]>([]);
const settleChecked = ref<Record<string, boolean>>({});
const settleScope = ref<"all" | "pick">("all");
async function openSettle() {
  settleScope.value = "all";
  settleChecked.value = {};
  settleOpen.value = true;
  if (!settleStores.value.length) {
    try {
      settleStores.value = await fetchAllPages(
        (q) => api.nightStores(undefined, q.page, q.pageSize),
        100,
      );
    } catch {
      /* 店铺清单失败不阻断整校出账 */
    }
  }
}
async function submitSettle() {
  if (settling.value) return;
  const storeIds =
    settleScope.value === "pick"
      ? Object.keys(settleChecked.value).filter((k) => settleChecked.value[k])
      : undefined;
  if (settleScope.value === "pick" && !storeIds?.length)
    return notify("请至少勾选一家店铺", "error");
  try {
    await ElMessageBox.confirm(
      settleScope.value === "all"
        ? "将把本校区全部店铺的待结算佣金出一期周账单（仅含已完成订单的 pending 佣金）。确认出账？"
        : `将对勾选的 ${storeIds?.length} 家店铺出一期周账单。确认出账？`,
      "周账单出账",
      { type: "info", confirmButtonText: "确认出账", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  settling.value = true;
  try {
    const r = await api.nightSettle(storeIds);
    notify(
      `出账完成：批次 ${r.batch}，佣金 ¥${fenToYuan(r.commissionTotal)}，配送费 ¥${fenToYuan(r.deliveryFeeTotal)}，共 ${r.txnCount} 笔`,
    );
    settleOpen.value = false;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "出账失败", "error");
  } finally {
    settling.value = false;
  }
}

/* ---------- 标记打款 ---------- */
const payOpen = ref(false);
const payBatch = ref("");
const payRemark = ref("");
const paying = ref(false);
function openPay(row: NightSettlementBatch) {
  payBatch.value = row.batch;
  payRemark.value = "";
  payOpen.value = true;
}
async function submitPay() {
  if (paying.value) return;
  paying.value = true;
  try {
    const r = await api.nightMarkBatchPaid(payBatch.value, payRemark.value.trim());
    notify(r.alreadyPaid ? '该批次已登记打款，本次未重复追加' : `批次 ${r.batch} 已标记打款（${r.txnCount} 笔留痕）`);
    payOpen.value = false;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "标记失败", "error");
  } finally {
    paying.value = false;
  }
}

function fmtTime(value?: string | null) {
  return fmtDateTime(value);
}
watch(effectiveCampusId, () => { rows.value = []; settleStores.value = []; settleOpen.value = false; payOpen.value = false; page.value = 1; void load(); });
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="夜宵结算"
    eyebrow="NIGHT SETTLEMENTS"
    description="楼长佣金周账单：出账 → 线下打款 → 标记留痕。配送费收入随批次一并结算。"
  >
    <template #actions>
      <ElButton
        v-if="hasPerm('POST /admin/night/settlements/settle')"
        type="primary"
        @click="openSettle"
        >周账单出账</ElButton
      >
    </template>
    <div v-if="!effectiveCampusId" class="empty-hint">请先在顶部选择校区。</div>
    <section v-else class="admin-table-panel" aria-label="夜宵佣金周账单">
      <NightLoadError :message="loadError" :loading="loading" @retry="load" />
      <div class="batch-filters"><ElInput v-model="keyword" clearable placeholder="搜索批次号" style="max-width: 280px" /><ElSelect v-model="paidFilter" clearable placeholder="全部打款状态" style="width: 180px"><ElOption label="待登记打款" value="unpaid" /><ElOption label="已标记打款" value="paid" /></ElSelect><ElButton :loading="loading" @click="load">刷新</ElButton></div>
      <ElTable
        v-loading="loading"
        :data="displayed"
        row-key="batch"
        empty-text="暂无周账单——点右上角「周账单出账」把待结算佣金出成批次"
      >
        <ElTableColumn label="批次号" min-width="170">
          <template #default="{ row }">
            <span class="mono">{{ row.batch }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="流水笔数" width="100" prop="txnCount" />
        <ElTableColumn label="佣金合计" width="120">
          <template #default="{ row }">¥{{ fenToYuan(row.commissionTotal) }}</template>
        </ElTableColumn>
        <ElTableColumn label="配送费合计" width="120">
          <template #default="{ row }">¥{{ fenToYuan(row.deliveryFeeTotal) }}</template>
        </ElTableColumn>
        <ElTableColumn label="批内合计" width="120">
          <template #default="{ row }">
            <b>¥{{ fenToYuan(row.commissionTotal + row.deliveryFeeTotal) }}</b>
          </template>
        </ElTableColumn>
        <ElTableColumn label="最新流水时间" min-width="150">
          <template #default="{ row }">{{ fmtTime(row.latestAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <ElTag v-if="row.markedPaid" type="success">已标记打款</ElTag>
            <ElButton
              v-else-if="hasPerm('POST /admin/night/settlements/:batch/pay')"
              link
              type="primary"
              @click="openPay(asBatch(row))"
              >标记打款</ElButton
            >
          </template>
        </ElTableColumn>
      </ElTable>
      <AdminPagination v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" />
      <p class="form-hint">
        出账规则：仅「已完成且无进行中售后」订单的待结算佣金进批次；预计佣金（estimated）不参与。
        标记打款为财务线下打款后的留痕操作，写批次流水备注。
      </p>
    </section>

    <!-- 出账弹窗 -->
    <ElDialog
      v-model="settleOpen"
      title="周账单出账"
      width="min(620px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm label-position="top">
        <ElFormItem label="出账范围">
          <ElRadioGroup v-model="settleScope">
            <ElRadio value="all">本校区全部店铺（待结算佣金）</ElRadio>
            <ElRadio value="pick">指定店铺</ElRadio>
          </ElRadioGroup>
        </ElFormItem>
        <template v-if="settleScope === 'pick'">
          <div class="attach-list">
            <ElCheckbox
              v-for="s in settleStores"
              :key="s.id"
              v-model="settleChecked[s.id]"
            >
              <span>{{ s.buildingName }}</span>
              <span class="muted">
                {{ s.manager ? s.manager.name : "招募中" }} · 押金 ¥{{ fenToYuan(s.deposit) }}
              </span>
            </ElCheckbox>
          </div>
          <p v-if="!settleStores.length" class="form-hint">本校区暂无夜宵店。</p>
        </template>
      </ElForm>
      <template #footer>
        <ElButton @click="settleOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="settling" @click="submitSettle"
          >确认出账</ElButton
        >
      </template>
    </ElDialog>

    <!-- 标记打款弹窗 -->
    <ElDialog
      v-model="payOpen"
      title="标记打款（线下打款留痕）"
      width="min(480px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <p class="form-hint">批次 {{ payBatch }}——确认已在微信商户平台/银行完成打款后再标记。</p>
      <ElForm label-position="top">
        <ElFormItem label="打款备注（选填，写入流水留痕）">
          <ElInput
            v-model="payRemark"
            maxlength="100"
            placeholder="如：微信商家转账 2026-11-05 / 银行回单号 xxx"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="payOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="paying" @click="submitPay"
          >确认标记</ElButton
        >
      </template>
    </ElDialog>
  </AdminPageShell>
</template>
<style scoped>
.batch-filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding: 16px; }
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.form-hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.attach-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 6px;
  background: #fbfdfb;
}
.attach-list :deep(.el-checkbox) {
  display: flex;
  align-items: center;
  height: auto;
  margin-right: 0;
  padding: 7px 10px;
  border-radius: 8px;
}
.attach-list :deep(.el-checkbox__label) {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex: 1;
}
</style>
