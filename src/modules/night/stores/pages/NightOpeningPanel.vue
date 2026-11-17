<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../../../api';
import { effectiveCampusId, hasPerm } from '../../../../session';
import { fmtDateTime } from '../../../../utils/datetime';
import NightLoadError from '../../NightLoadError.vue';
import type { NightOpeningRequest } from '../../../../types';

const asOpening = (value: unknown) => value as NightOpeningRequest;
const rows = ref<NightOpeningRequest[]>([]), status = ref('pending'), loading = ref(false), error = ref(''), busy = ref(false);
let generation = 0;
async function load() {
  const ticket = ++generation, campus = effectiveCampusId.value;
  rows.value = []; error.value = '';
  if (!campus) return;
  loading.value = true;
  try { const data = await api.nightOpeningRequests(status.value); if (ticket === generation && campus === effectiveCampusId.value) rows.value = data; }
  catch (e) { if (ticket === generation) error.value = e instanceof Error ? e.message : '加载失败'; }
  finally { if (ticket === generation) loading.value = false; }
}
async function review(row: NightOpeningRequest, approved: boolean) {
  if (busy.value) return;
  const campus = effectiveCampusId.value;
  let reason: string;
  try { reason = (await ElMessageBox.prompt(`申请时段：${fmtDateTime(row.startAt)} 至 ${fmtDateTime(row.endAt)}。批准后仅本楼、原申请楼长可在该时段营业，开店仍需满足押金和库存条件。`, approved ? '批准临时营业' : '驳回临时营业', { inputType: 'textarea', inputValidator: value => !!value?.trim() || '请填写审核说明' })).value.trim(); }
  catch { return; }
  if (campus !== effectiveCampusId.value) return;
  busy.value = true;
  try { await api.nightReviewOpening(row.id, approved, reason); ElMessage.success('审核完成'); await load(); }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : '审核失败'); }
  finally { busy.value = false; }
}
onMounted(load); watch([effectiveCampusId, status], load);
</script>
<template>
  <section class="opening-panel">
    <div class="opening-toolbar"><div><h3>临时营业审批</h3><p>正常夜宵时段无需申请。批准窗口外营业仅影响申请楼栋，不关闭整个校区白天店。</p></div><ElSelect v-model="status" style="width:160px"><ElOption label="待审核" value="pending" /><ElOption label="已批准" value="approved" /><ElOption label="已驳回" value="rejected" /><ElOption label="全部" value="all" /></ElSelect></div>
    <NightLoadError :message="error" :loading="loading" @retry="load" />
    <ElTable v-loading="loading" :data="rows" row-key="id" empty-text="暂无营业申请">
      <ElTableColumn prop="buildingName" label="楼栋" width="120" /><ElTableColumn prop="managerName" label="楼长" width="110" />
      <ElTableColumn label="申请时段" min-width="245"><template #default="{ row }">{{ fmtDateTime(row.startAt) }}<br>{{ fmtDateTime(row.endAt) }}</template></ElTableColumn>
      <ElTableColumn prop="reason" label="申请原因" min-width="160" /><ElTableColumn label="状态" width="105"><template #default="{ row }">{{ row.status === 'pending' ? '待审核' : row.status === 'approved' ? (new Date(row.endAt).getTime() <= Date.now() ? '许可已到期' : '已批准') : '已驳回' }}</template></ElTableColumn>
      <ElTableColumn prop="reviewReason" label="审核说明" min-width="160" /><ElTableColumn label="操作" width="170"><template #default="{ row }"><template v-if="row.status === 'pending' && hasPerm('POST /admin/night/opening-requests/:id/review')"><ElButton link type="primary" :disabled="busy" @click="review(asOpening(row), true)">批准</ElButton><ElButton link type="danger" :disabled="busy" @click="review(asOpening(row), false)">驳回</ElButton></template></template></ElTableColumn>
    </ElTable>
  </section>
</template>
<style scoped>
.opening-panel{background:#fff;border:1px solid #e1e8df;border-radius:18px;padding:24px}.opening-toolbar{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:24px}.opening-toolbar h3{margin:0 0 8px}.opening-toolbar p{color:#6d7a71;margin:0;line-height:1.6}
</style>
