<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import { api, fetchAllPages } from "../../../../api";
import {
  effectiveCampusId,
  hasPerm,
  switchableCampuses,
} from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import { rateText, nightStoreStatus } from "../../night-shared";
import NightCatalogPanel from "./NightCatalogPanel.vue";
import NightInventoryPanel from "./NightInventoryPanel.vue";
import type { Building, NightStoreRow, Staff } from "../../../../types";
import { fenToYuan } from "../../../../utils/money";

/**
 * 夜宵店铺页（IKSW1F，菜单 night-stores）：店铺列表（楼栋/楼长/营业状态/
 * 押金余额/今日订单与销售额）+ 建店 + 校区夜宵配置弹窗 + 夜主档商品 Tab。
 * 行点「详情」进 /night-stores/:id（router 随菜单动态注册的静态详情路由）。
 */
const STATUS_TABS = [
  { key: "", label: "全部" },
  { key: "open", label: "营业中" },
  { key: "paused", label: "已暂停" },
  { key: "closed", label: "打烊" },
  { key: "suspended", label: "停业" },
];

const activeTab = ref("stores");
const rows = ref<NightStoreRow[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const status = ref("");

const catalogPanel = ref<InstanceType<typeof NightCatalogPanel> | null>(null);

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

/** ElTable 作用域槽 row 兜底断言（同 CouponPage asCoupon 模式）。 */
function asStore(row: unknown) {
  return row as NightStoreRow;
}

async function load() {
  if (!effectiveCampusId.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const r = await api.nightStores(
      status.value || undefined,
      page.value,
      pageSize.value,
    );
    rows.value = r.items;
    total.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "夜宵店铺加载失败", "error");
  } finally {
    loading.value = false;
  }
}

/* ---------- 建店 ---------- */
const createOpen = ref(false);
const saving = ref(false);
const createForm = reactive({
  campusId: "",
  buildingId: "",
  managerStaffId: "",
  commissionPercent: 20,
});
/** 平台/组织账号未选校区时须显式选（后端 campusScope 校验授权集）。 */
const needCampusPick = computed(() => !effectiveCampusId.value);
const campusOptions = ref<{ id: string; name: string }[]>([]);
const buildings = ref<Building[]>([]);
const managers = ref<Staff[]>([]);
const optionsLoading = ref(false);

async function loadCreateOptions(campusId: string) {
  buildings.value = [];
  managers.value = [];
  if (!campusId) return;
  optionsLoading.value = true;
  try {
    const [b, m1, m2] = await Promise.all([
      fetchAllPages((q) => api.buildings({ ...q, campusId })),
      fetchAllPages((q) => api.staff({ ...q, role: "building-manager", campusId }), 100),
      fetchAllPages((q) => api.staff({ ...q, role: "intern-building-manager", campusId }), 100),
    ]);
    buildings.value = b;
    managers.value = [...m1, ...m2];
  } catch (e) {
    notify(e instanceof Error ? e.message : "楼栋/楼长选项加载失败", "error");
  } finally {
    optionsLoading.value = false;
  }
}

async function openCreate() {
  createForm.campusId = effectiveCampusId.value || "";
  createForm.buildingId = "";
  createForm.managerStaffId = "";
  createForm.commissionPercent = 20;
  if (needCampusPick.value) {
    try {
      const list = await api.adminCampuses("filter");
      campusOptions.value = list.map((c) => ({ id: c.id, name: c.name }));
    } catch {
      campusOptions.value = switchableCampuses.value.map((id) => ({
        id,
        name: id,
      }));
    }
  }
  createOpen.value = true;
  if (createForm.campusId) void loadCreateOptions(createForm.campusId);
}

watch(
  () => createForm.campusId,
  (v) => {
    createForm.buildingId = "";
    createForm.managerStaffId = "";
    void loadCreateOptions(v);
  },
);

function managerLabel(s: Staff) {
  return `${s.name}（${s.staffNo}）`;
}

async function submitCreate() {
  if (needCampusPick.value && !createForm.campusId)
    return notify("请选择校区", "error");
  if (!createForm.buildingId) return notify("请选择楼栋", "error");
  if (!(createForm.commissionPercent >= 0 && createForm.commissionPercent <= 100))
    return notify("佣金比例须在 0~100 之间", "error");
  saving.value = true;
  try {
    await api.createNightStore({
      ...(needCampusPick.value ? { campusId: createForm.campusId } : {}),
      buildingId: createForm.buildingId,
      managerStaffId: createForm.managerStaffId || undefined,
      commissionRate: Math.round(createForm.commissionPercent * 100),
    });
    createOpen.value = false;
    notify("夜宵店已创建");
    page.value = 1;
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "建店失败", "error");
  } finally {
    saving.value = false;
  }
}


const router = useRouter();
function goDetail(row: NightStoreRow) {
  void router.push(`/night-stores/${row.id}`);
}

watch([page, pageSize, status, effectiveCampusId], load);
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="夜宵店铺"
    eyebrow="NIGHT STORES"
    description="楼长夜宵店：押金=进货额度，夜间营业赚佣金。与白天业务数据/券/订单完全隔离。"
  >
    <template #actions>
      <ElButton
        v-if="hasPerm('POST /admin/night/stores')"
        type="primary"
        @click="openCreate"
        >建店</ElButton
      >
    </template>

    <div v-if="!effectiveCampusId" class="empty-hint">请先在顶部选择校区。</div>
    <template v-else>
      <nav class="night-tabs single-line-tabs" aria-label="夜宵经营分区">
        <ElButton
          text
          :class="{ active: activeTab === 'stores' }"
          @click="activeTab = 'stores'"
          >夜宵店铺</ElButton
        >
        <ElButton
          text
          :class="{ active: activeTab === 'catalog' }"
          @click="activeTab = 'catalog'"
          >夜宵商品库</ElButton
        >
        <ElButton v-if="hasPerm('GET /admin/night/stock-orders')" text :class="{ active: activeTab === 'stock' }" @click="activeTab = 'stock'">备货审核与出库</ElButton>
        <ElButton v-if="hasPerm('GET /admin/night/inventory-reports')" text :class="{ active: activeTab === 'reports' }" @click="activeTab = 'reports'">盘点报损审核</ElButton>
      </nav>

      <template v-if="activeTab === 'stores'">
        <section class="admin-filter-panel" aria-label="夜宵店铺筛选">
          <ElSegmented
            v-model="status"
            :options="STATUS_TABS.map((t) => ({ label: t.label, value: t.key }))"
          />
        </section>
        <section class="admin-table-panel" aria-label="夜宵店铺列表">
          <ElTable
            v-loading="loading"
            :data="rows"
            row-key="id"
            empty-text="暂无夜宵店——点右上角「建店」选择楼栋开张"
          >
            <ElTableColumn label="楼栋" min-width="140" prop="buildingName" />
            <ElTableColumn label="楼长" min-width="160">
              <template #default="{ row }">
                <template v-if="row.manager"
                  >{{ row.manager.name
                  }}<span class="muted">（{{ row.manager.staffNo }}）</span></template
                >
                <ElTag v-else size="small" type="warning">招募中</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn label="营业状态" width="100">
              <template #default="{ row }">
                <ElTag :type="nightStoreStatus(row.status).tag">{{
                  nightStoreStatus(row.status).text
                }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn label="佣金比例" width="100">
              <template #default="{ row }">{{ rateText(row.commissionRate) }}</template>
            </ElTableColumn>
            <ElTableColumn label="押金余额" width="110">
              <template #default="{ row }">¥{{ fenToYuan(row.deposit) }}</template>
            </ElTableColumn>
            <ElTableColumn label="今日订单" width="90" prop="todayOrders" />
            <ElTableColumn label="今日销售额" width="110">
              <template #default="{ row }">¥{{ fenToYuan(row.todaySales) }}</template>
            </ElTableColumn>
            <ElTableColumn label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <ElButton link type="primary" @click="goDetail(asStore(row))">详情</ElButton>
              </template>
            </ElTableColumn>
          </ElTable>
          <AdminPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :total="total"
          />
        </section>
      </template>

      <NightCatalogPanel v-else-if="activeTab === 'catalog'" ref="catalogPanel" />
      <NightInventoryPanel v-else-if="activeTab === 'stock' || activeTab === 'reports'" :kind="activeTab === 'stock' ? 'stock' : 'reports'" />
    </template>

    <!-- 建店 -->
    <ElDialog
      v-model="createOpen"
      title="建夜宵店"
      width="min(560px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm label-position="top">
        <ElFormItem v-if="needCampusPick" label="校区">
          <ElSelect v-model="createForm.campusId" filterable placeholder="选择校区">
            <ElOption
              v-for="c in campusOptions"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem v-else label="校区">
          <ElInput :model-value="effectiveCampusId" disabled />
        </ElFormItem>
        <ElFormItem label="楼栋（每栋一店）">
          <ElSelect
            v-model="createForm.buildingId"
            filterable
            :loading="optionsLoading"
            placeholder="选择本校区楼栋"
          >
            <ElOption
              v-for="b in buildings"
              :key="b.id"
              :label="b.name"
              :value="b.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="楼长（选填，可后续换绑；不选=招募中）">
          <ElSelect
            v-model="createForm.managerStaffId"
            filterable
            clearable
            :loading="optionsLoading"
            placeholder="从本校区在职楼长中选择"
          >
            <ElOption
              v-for="s in managers"
              :key="s.id"
              :label="managerLabel(s)"
              :value="s.id"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="佣金比例（%，按券后商品净实收计）">
          <ElInputNumber
            v-model="createForm.commissionPercent"
            :min="0"
            :max="100"
            :step="0.5"
            :precision="1"
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="createOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="submitCreate"
          >创建</ElButton
        >
      </template>
    </ElDialog>

  </AdminPageShell>
</template>
<style scoped>
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.night-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  margin-bottom: 18px;
  padding: 10px;
  overflow-x: auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 8px 24px #163f2b08;
}
.night-tabs button {
  flex: 0 0 auto;
  border-radius: 10px;
  min-height: 40px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
}
.night-tabs button.active {
  background: #07883b;
  border-color: #07883b;
  color: #fff;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.admin-filter-panel :deep(.el-segmented) {
  --el-border-radius-base: 8px;
}
@media (max-width: 760px) {
  .night-tabs {
    border-radius: 14px;
  }
}
</style>
