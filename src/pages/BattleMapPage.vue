<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api";
import type {
  BattleFloor,
  BattleMapBuilding,
  BattleRoomCell,
  BattleRoomDetail,
  Building,
} from "../types";
import { fenToYuan } from "../utils/money";
import { effectiveCampusId } from "../session";
// 寝室三色字典见 src/dicts/misc（BATTLE_ROOM_STATUS_TEXT，IKIYMM 集中化）
import { BATTLE_ROOM_STATUS_TEXT } from "../dicts";

/**
 * 营销作战地图（IKFOQ3，2026-09-17 grilling 定版）：
 * - 楼栋→楼层→寝室格子三色：🟢 已下单（paidAt 非空）/🟡 注册未下单/⚪ 未开发
 * - 点格子开抽屉：注册用户列表+下单统计，高频客户=近 30 天 ≥3 单
 * - 校区上下文统一取顶部选择；平台/组织未选校区时不加载数据；
 *   校区级账号使用账号固有校区。
 */
const loading = ref(true);
const error = ref("");
const buildings = ref<Building[]>([]);
const buildingId = ref("");
const map = ref<BattleMapBuilding | null>(null);
const floorNo = ref<number | null>(null);

const operationalCampusId = effectiveCampusId;

const drawerOpen = ref(false);
const roomLoading = ref(false);
const roomDetail = ref<BattleRoomDetail | null>(null);

const floor = computed<BattleFloor | null>(
  () => map.value?.floors.find((f) => f.floor === floorNo.value) ?? null,
);

async function loadMap() {
  if (!buildingId.value) {
    map.value = null;
    floorNo.value = null;
    loading.value = false;
    error.value = "";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    map.value = await api.battleMapBuilding(
      buildingId.value,
      operationalCampusId.value,
    );
    // 缺省选最低楼层
    floorNo.value = map.value.floors[0]?.floor ?? null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
    ElMessage.error(error.value);
    map.value = null;
  } finally {
    loading.value = false;
  }
}

async function openRoom(cell: BattleRoomCell) {
  drawerOpen.value = true;
  roomLoading.value = true;
  roomDetail.value = null;
  try {
    roomDetail.value = await api.battleMapRoom(
      cell.roomId,
      operationalCampusId.value,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载寝室详情失败";
    ElMessage.error(error.value);
    drawerOpen.value = false;
  } finally {
    roomLoading.value = false;
  }
}

/** 拉当前校区楼栋；保持空值，让用户通过占位提示主动选择目标楼栋。 */
async function loadBuildings() {
  buildings.value = [];
  buildingId.value = "";
  map.value = null;
  floorNo.value = null;
  drawerOpen.value = false;
  if (!operationalCampusId.value) {
    loading.value = false;
    error.value = "";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const list = await api.buildings({
      page: 1,
      pageSize: 100,
      campusId: operationalCampusId.value,
    });
    buildings.value = list.items;
    buildingId.value = "";
    map.value = null;
    loading.value = false;
  } catch {
    loading.value = false;
    error.value = "楼栋列表加载失败";
    ElMessage.error(error.value);
  }
}

onMounted(() => void loadBuildings());
watch(operationalCampusId, () => void loadBuildings());
</script>

<template>
  <div class="workspace">
    <!-- 用 div 不用 header：.shell header 是顶栏专用元素选择器 -->
    <div class="page-head">
      <div>
        <h1>营销作战地图</h1>
        <p>
          楼栋→楼层→寝室的下单覆盖：🟢 已下单（付过钱就算）· 🟡 注册未下单 ·
          ⚪ 未开发。点格子看寝室客户详情。
        </p>
      </div>
      <ElForm class="head-actions battle-filter" label-position="top">
        <ElRow><ElCol :span="24"><ElFormItem label="楼栋"><ElSelect
          v-model="buildingId"
          class="battle-building-select"
          clearable
          placeholder="请选择楼栋"
          aria-label="选择楼栋"
          :disabled="!buildings.length"
          @change="loadMap"
        >
          <ElOption v-for="b in buildings" :key="b.id" :label="b.name" :value="b.id" />
        </ElSelect></ElFormItem></ElCol></ElRow>
      </ElForm>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>

    <div v-if="map" class="battle-body">
      <!-- 楼层切换 -->
      <div class="floor-tabs single-line-tabs">
        <button
          v-for="f in map.floors"
          :key="f.floor"
          class="floor-tab"
          :class="{ active: floorNo === f.floor }"
          type="button"
          @click="floorNo = f.floor"
        >
          {{ f.floor }} 层
        </button>
      </div>

      <!-- 汇总条 -->
      <div v-if="floor" class="battle-summary">
        <span><strong>{{ floor.total }}</strong> 个寝室</span>
        <span class="dot ordered">🟢 已下单 {{ floor.ordered }}</span>
        <span class="dot registered">🟡 注册未下单 {{ floor.registered }}</span>
        <span class="dot fresh">⚪ 未开发 {{ floor.fresh }}</span>
        <span class="coverage">覆盖率 <strong>{{ (floor.coverageRate / 100).toFixed(1) }}%</strong></span>
      </div>

      <!-- 寝室格子网格 -->
      <div v-if="floor" class="room-grid">
        <button
          v-for="cell in floor.rooms"
          :key="cell.roomId"
          class="room-cell"
          :class="cell.status"
          type="button"
          :title="`${cell.roomNo} · ${BATTLE_ROOM_STATUS_TEXT[cell.status]}`"
          @click="openRoom(cell)"
        >
          <b>{{ cell.roomNo }}</b>
          <small v-if="cell.status === 'ordered'">{{ cell.orderCount }} 单</small>
          <small v-else-if="cell.status === 'registered'">{{ cell.userCount }} 人</small>
        </button>
      </div>
      <div v-else-if="!loading" class="data-panel">
        <p class="empty-cell">该楼栋暂无寝室数据（先到楼栋管理建寝室）。</p>
      </div>
    </div>
    <div v-else-if="loading" class="data-panel">
      <div class="row-skeleton"></div>
    </div>
    <div v-else-if="!error" class="data-panel">
      <p class="empty-cell">
        {{
          buildings.length
            ? "请选择楼栋查看寝室下单覆盖情况。"
            : operationalCampusId
              ? "当前校区暂无楼栋，先到楼栋管理新建。"
              : "请先在顶部选择校区。"
        }}
      </p>
    </div>

    <ElDialog v-model="drawerOpen" class="battle-room-dialog" width="min(760px, calc(100vw - 32px))" align-center destroy-on-close>
      <template #header><div><p class="eyebrow">BATTLE ROOM</p><h2>{{ roomDetail?.room.roomNo }} <small v-if="roomDetail">· {{ roomDetail.room.floor }} 层 · {{ roomDetail.orderCount }} 单</small></h2></div></template>
        <div v-if="roomLoading" class="drawer-body"><div class="row-skeleton"></div></div>
        <div v-else-if="roomDetail" class="drawer-body">
          <p v-if="!roomDetail.users.length" class="empty-cell">
            还没有注册用户落到这个寝室——未开发格子，先推二维码。
          </p>
          <ElTable v-else :data="roomDetail.users" row-key="userId">
            <ElTableColumn label="用户" min-width="130"><template #default="{ row }"><strong>{{ row.nickname }}</strong> <ElTag v-if="row.highFrequency" size="small" type="success">高频</ElTag></template></ElTableColumn>
            <ElTableColumn prop="phone" label="手机号" min-width="130" />
            <ElTableColumn prop="orderCount" label="下单次数" width="100" />
            <ElTableColumn label="累计金额" min-width="110"><template #default="{ row }">¥{{ fenToYuan(row.totalAmount) }}</template></ElTableColumn>
            <ElTableColumn label="注册时间" min-width="120"><template #default="{ row }">{{ row.registeredAt.slice(0, 10) }}</template></ElTableColumn>
          </ElTable>
        </div>
    </ElDialog>
  </div>
</template>

<style scoped>
.battle-building-select {
  width: clamp(240px, 24vw, 340px);
}
@media (max-width: 760px) {
  .page-head {
    flex-direction: column;
  }
  .battle-filter,
  .battle-building-select {
    width: 100%;
  }
}
.load-error {
  padding: 0 0 14px;
  font-size: 13px;
  color: #b33a3a;
}
.floor-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  padding-bottom: 4px;
}
.floor-tab {
  height: 34px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.floor-tab.active {
  background: var(--brand, #159c55);
  border-color: var(--brand, #159c55);
  color: #fff;
  font-weight: 600;
}
.battle-summary {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
  background: #fff;
  border-radius: 14px;
  padding: 12px 18px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px #10241b0a;
  font-size: 13px;
  color: #4c5c53;
}
.battle-summary strong {
  color: #153628;
}
.battle-summary .coverage {
  margin-left: auto;
}
.room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 10px;
}
.room-cell {
  aspect-ratio: 1;
  border-radius: 12px;
  border: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 14px;
  transition: transform 0.15s;
}
.room-cell:hover {
  transform: translateY(-2px);
}
.room-cell b {
  font-size: 15px;
}
.room-cell small {
  font-size: 11px;
  opacity: 0.85;
}
.room-cell.ordered {
  background: #159c55;
  color: #fff;
}
.room-cell.registered {
  background: #f0a13a;
  color: #fff;
}
.room-cell.fresh {
  background: #eef2f0;
  color: #8a978f;
  border: 1px dashed #cfd9d3;
}
.hf-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #159c5520;
  color: var(--brand, #159c55);
  font-size: 11px;
  font-weight: 600;
}
.battle-room-drawer {
  width: min(560px, 92vw);
}
.drawer-body {
  padding: 16px 20px;
  overflow-y: auto;
}
</style>
