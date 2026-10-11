<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import type { Coupon, WheelPrizeInput } from "../../../../types";

defineProps<{ embedded?: boolean }>();
const loading = ref(false),
  saving = ref(false),
  active = ref(false),
  coupons = ref<Coupon[]>([]),
  prizes = ref<WheelPrizeInput[]>([]);
const canSave = () => hasPerm("PUT /admin/wheel");
function blankPrize(): WheelPrizeInput {
  return { type: "none", label: "谢谢参与", weight: 0 };
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
async function load() {
  loading.value = true;
  try {
    const [config, couponResult] = await Promise.all([
      api.wheel(),
      api.coupons({ page: 1, pageSize: 200 }, "active"),
    ]);
    active.value = config.active;
    coupons.value = couponResult.items;
    prizes.value = Array.from({ length: 8 }, (_, i) => ({
      ...blankPrize(),
      ...(config.prizes[i] ?? {}),
    }));
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "转盘配置加载失败",
      "error",
    );
  } finally {
    loading.value = false;
  }
}
function changeType(index: number) {
  const prize = prizes.value[index];
  prize.couponId = undefined;
  prize.bizTitle = undefined;
  prize.bizImage = undefined;
  prize.bizNote = undefined;
  prize.label =
    prize.type === "coupon"
      ? "优惠券"
      : prize.type === "partner"
        ? "异业券"
        : "谢谢参与";
}
async function save() {
  if (active.value && prizes.value.every((p) => !(p.weight > 0))) {
    notify("开启活动至少要有一个奖位权重大于 0", "error");
    return;
  }
  for (const prize of prizes.value) {
    if (prize.type === "coupon" && !prize.couponId) {
      notify("平台券奖位必须选择优惠券", "error");
      return;
    }
    if (
      prize.type === "partner" &&
      !prize.couponId &&
      !prize.bizTitle?.trim()
    ) {
      notify("未关联异业券时请填写福利标题", "error");
      return;
    }
  }
  saving.value = true;
  try {
    await api.upsertWheel({
      active: active.value,
      prizes: prizes.value.map((p) => ({
        ...p,
        label: p.label.trim() || (p.type === "none" ? "谢谢参与" : ""),
        ...(p.type === "partner" && !p.couponId ? { couponId: undefined } : {}),
      })),
    });
    notify("转盘配置已保存");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
onMounted(load);
watch(effectiveCampusId, load);
</script>
<template>
  <AdminPageShell
    title="抽奖转盘"
    eyebrow="LUCKY WHEEL"
    description="配置活动开关与固定 8 个奖位，权重决定中奖概率。"
  >
    <template #actions
      ><ElButton v-if="canSave()" type="primary" :loading="saving" @click="save"
        >保存配置</ElButton
      ></template
    >
    <div class="wheel-page" v-loading="loading">
      <section
        class="admin-filter-panel wheel-settings"
        aria-label="抽奖活动设置"
      >
        <ElAlert type="info" :closable="false" show-icon
          ><template #title
            >权重按全部奖位的总和计算；“谢谢参与”也需要设置权重。</template
          ></ElAlert
        ><ElCheckbox v-model="active" :disabled="!canSave()"
          >活动开启（关闭后小程序隐藏抽奖入口）</ElCheckbox
        >
      </section>
      <div class="wheel-grid">
        <section
          v-for="(prize, index) in prizes"
          :key="index"
          class="prize-card"
        >
          <header>
            <strong>奖位 {{ index + 1 }}</strong
            ><ElSelect
              v-model="prize.type"
              :disabled="!canSave()"
              @change="changeType(index)"
              ><ElOption label="平台券" value="coupon" /><ElOption
                label="异业券"
                value="partner" /><ElOption label="谢谢参与" value="none"
            /></ElSelect>
          </header>
          <ElForm label-position="top"
            ><ElRow
              ><ElCol :span="24"
                ><ElFormItem label="扇区文案"
                  ><ElInput
                    v-model="prize.label"
                    :disabled="!canSave()"
                    maxlength="12" /></ElFormItem></ElCol
              ><ElCol :span="24"
                ><ElFormItem label="权重"
                  ><ElInputNumber
                    v-model="prize.weight"
                    :disabled="!canSave()"
                    :min="0"
                    :precision="0" /></ElFormItem></ElCol
              ><ElCol v-if="prize.type === 'coupon'" :span="24"
                ><ElFormItem label="优惠券"
                  ><ElSelect
                    v-model="prize.couponId"
                    filterable
                    :disabled="!canSave()"
                    placeholder="选择金额券"
                    ><ElOption
                      v-for="item in coupons.filter(
                        (c) => c.kind === 'platform',
                      )"
                      :key="item.id"
                      :label="`${item.name}（${item.remain == null ? '不限量' : `剩 ${item.remain} 张`}）`"
                      :value="item.id" /></ElSelect></ElFormItem></ElCol
              ><template v-if="prize.type === 'partner'"
                ><ElCol :span="24"
                  ><ElFormItem label="异业券（选填）"
                    ><ElSelect
                      v-model="prize.couponId"
                      clearable
                      filterable
                      :disabled="!canSave()"
                      placeholder="不选则展示下方图文"
                      ><ElOption
                        v-for="item in coupons.filter(
                          (c) => c.kind === 'partner',
                        )"
                        :key="item.id"
                        :label="item.name"
                        :value="item.id" /></ElSelect></ElFormItem></ElCol
                ><ElCol v-if="!prize.couponId" :span="24"
                  ><ElFormItem label="福利标题"
                    ><ElInput
                      v-model="prize.bizTitle"
                      :disabled="!canSave()"
                      maxlength="40" /></ElFormItem></ElCol
                ><ElCol :span="24"
                  ><ElFormItem label="福利图片"
                    ><ImageUploadField
                      :model-value="prize.bizImage ?? ''"
                      folder="app/wheel"
                      @update:model-value="
                        prize.bizImage = $event
                      " /></ElFormItem></ElCol
                ><ElCol v-if="!prize.couponId" :span="24"
                  ><ElFormItem label="说明"
                    ><ElInput
                      v-model="prize.bizNote"
                      :disabled="!canSave()"
                      type="textarea"
                      :rows="2"
                      maxlength="120" /></ElFormItem></ElCol></template></ElRow
          ></ElForm>
        </section>
      </div>
    </div>
  </AdminPageShell>
</template>
<style scoped>
.wheel-page {
  display: grid;
  gap: 16px;
}
.wheel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.wheel-settings {
  display: grid;
  gap: 14px;
}
.prize-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  background: #fff;
}
.prize-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.prize-card header .el-select {
  width: 150px;
}
.prize-card :deep(.el-select),
.prize-card :deep(.el-input-number) {
  width: 100%;
}
@media (max-width: 760px) {
  .wheel-grid {
    grid-template-columns: 1fr;
  }
}
</style>
