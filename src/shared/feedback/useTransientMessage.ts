import { ref } from "vue";

export function useTransientMessage() {
  const message = ref("");
  const messageError = ref(false);
  let timer: number | undefined;
  function notify(text: string, error = false) {
    message.value = text;
    messageError.value = error;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => { message.value = ""; }, error ? 4200 : 2600);
  }
  return { message, messageError, notify };
}
