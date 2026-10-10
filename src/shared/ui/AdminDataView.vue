<template>
  <section class="admin-data-view data-panel">
    <div class="admin-data-view__desktop"><slot name="desktop" /></div>
    <div class="admin-data-view__mobile"><slot name="mobile" /></div>
  </section>
</template>

<style scoped>
.admin-data-view__mobile { display: none; }
@media (max-width: 760px) {
  .admin-data-view__desktop { display: none; }
  .admin-data-view__mobile { display: grid; gap: 10px; padding: 10px; background: #eef3ef; }
}
</style>
