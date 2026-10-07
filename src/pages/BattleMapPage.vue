<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import type {
  BattleFloor,
  BattleMapBuilding,
  BattleRoomCell,
  BattleRoomDetail,
  Building,
  Campus,
} from "../types";
import { fenToYuan } from "../utils/money";
import { isPlatform } from "../session";
import { fetchOperationalCampuses, type CampusOption } from "../dicts";
// 寝室三色字典见 src/dicts/misc（BATTLE_ROOM_STATUS_TEXT，IKIYMM 集中化）
import { BATTLE_ROOM_STATUS_TEXT } from "../dicts";

/**
 * 营销作战地图（IKFOQ3，2026-09-17 grilling 定版）：
 * - 楼栋→楼层→寝室格子三色：🟢 已下单（paidAt 非空）/🟡 注册未下单/⚪ 未开发
 * - 点格子开抽屉：注册用户列表+下单统计，高频客户=近 30 天 ≥3 单
 * - 校区上下文（IKISDN）：平台账号页内选校区（记住上次，摆脱顶栏切换依赖）；
 *   校区级账号跟账号本校区，无下拉
 */
const loading = ref(true);
const error = ref("");
const buildings = ref<Building[]>([]);
const buildingId = ref("");
const map = ref<BattleMapBuilding | null>(null);
const floorNo = ref<number | null>(null);

const CAMPUS_KEY = "battle-campus";
const campuses = ref<CampusOption[]>([]);
const campusId = ref("");

/** 平台账号可选校区：排除总部仓（type=hq 无楼栋无寝室，选了必空） */
const campusOptions = computed(() =>
  campuses.value.filter((c) => c.type !== "hq"),
);

const drawerOpen = ref(false);
const roomLoading = ref(false);
const roomDetail = ref<BattleRoomDetail | null>(null);

const floor = computed<BattleFloor | null>(
  () => map.value?.floors.find((f) => f.floor === floorNo.value) ?? null,
);

async function loadMap() {
  if (!buildingId.value) return;
  loading.value = true;
  error.value = "";
  try {
    map.value = await api.battleMapBuilding(
      buildingId.value,
      campusId.value || undefined,
    );
    // 缺省选最低楼层
    floorNo.value = map.value.floors[0]?.floor ?? null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
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
      campusId.value || undefined,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载寝室详情失败";
    drawerOpen.value = false;
  } finally {
    roomLoading.value = false;
  }
}

/** 拉当前校区楼栋并自动落到第一栋；校区级账号不传 → 后端回落账号本校区 */
async function loadBuildings() {
  loading.value = true;
  error.value = "";
  try {
    const list = await api.buildings({
      page: 1,
      pageSize: 100,
      campusId: campusId.value || undefined,
    });
    buildings.value = list.items;
    const first = buildings.value[0];
    if (first) {
      buildingId.value = first.id;
      await loadMap();
    } else {
      buildingId.value = "";
      map.value = null;
      loading.value = false;
    }
  } catch {
    loading.value = false;
    error.value = "楼栋列表加载失败";
  }
}

async function onCampusChange() {
  localStorage.setItem(CAMPUS_KEY, campusId.value);
  await loadBuildings();
}

onMounted(async () => {
  try {
    // 平台账号：页内选校区（IKISDN），恢复上次选择、缺省第一个校区
    if (isPlatform.value) {
      campuses.value = await fetchOperationalCampuses();
      const saved = localStorage.getItem(CAMPUS_KEY) ?? "";
      campusId.value =
        campusOptions.value.find((c) => c.id === saved)?.id ??
        campusOptions.value[0]?.id ??
        "";
    }
    await loadBuildings();
  } catch {
    loading.value = false;
    error.value = "楼栋列表加载失败";
  }
});
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
      <div class="head-actions battle-filter">
        <select
          v-if="isPlatform && campusOptions.length"
          v-model="campusId"
          @change="onCampusChange"
        >
          <option v-for="c in campusOptions" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
        <select v-model="buildingId" :disabled="!buildings.length" @change="loadMap">
          <option v-for="b in buildings" :key="b.id" :value="b.id">
            {{ b.name }}
          </option>
        </select>
      </div>
    </div>

    <p v-if="error" class="load-error">{{ error }}</p>

    <div v-if="map" class="battle-body">
      <!-- 楼层切换 -->
      <div class="floor-tabs">
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
            ? "该楼栋暂无寝室数据（先到楼栋管理建寝室）。"
            : "当前校区暂无楼栋，先到楼栋管理新建。"
        }}
      </p>
    </div>

    <!-- 寝室详情抽屉 -->
    <div v-if="drawerOpen" class="drawer-mask" @click.self="drawerOpen = false">
      <div class="drawer battle-room-drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">BATTLE ROOM</p>
            <h2>
              {{ roomDetail?.room.roomNo }}
              <small v-if="roomDetail">· {{ roomDetail.room.floor }} 层 · {{ roomDetail.orderCount }} 单</small>
            </h2>
          </div>
          <button @click="drawerOpen = false">✕</button>
        </div>
        <div v-if="roomLoading" class="drawer-body"><div class="row-skeleton"></div></div>
        <div v-else-if="roomDetail" class="drawer-body">
          <p v-if="!roomDetail.users.length" class="empty-cell">
            还没有注册用户落到这个寝室——未开发格子，先推二维码。
          </p>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>手机号</th>
                  <th>下单次数</th>
                  <th>累计金额</th>
                  <th>注册时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in roomDetail.users" :key="u.userId">
                  <td>
                    <strong>{{ u.nickname }}</strong>
                    <span v-if="u.highFrequency" class="hf-badge">高频</span>
                  </td>
                  <td>{{ u.phone }}</td>
                  <td>{{ u.orderCount }}</td>
                  <td>¥{{ fenToYuan(u.totalAmount) }}</td>
                  <td>{{ u.registeredAt.slice(0, 10) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.battle-filter select {
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 0 10px;
  font-size: 13px;
  background: #fff;
  outline: 0;
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
  flex-wrap: wrap;
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
