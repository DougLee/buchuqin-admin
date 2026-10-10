import { ref, type Ref } from "vue";

/**
 * Latest-request-wins collection loader. Scope changes and manual refreshes cannot
 * let an older response overwrite newer data.
 */
export function useAsyncCollection<T>(loader: () => Promise<T[]>) {
  const rows = ref<T[]>([]) as Ref<T[]>;
  const loading = ref(false);
  const error = ref("");
  let generation = 0;

  async function load() {
    const request = ++generation;
    loading.value = true;
    error.value = "";
    try {
      const result = await loader();
      if (request === generation) rows.value = result;
    } catch (reason) {
      if (request === generation)
        error.value = reason instanceof Error ? reason.message : "加载失败";
    } finally {
      if (request === generation) loading.value = false;
    }
  }

  return { rows, loading, error, load };
}
