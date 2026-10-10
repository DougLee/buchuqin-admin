import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";
import "./drawer.css";
import "./rbac.css";
import "./element-plus.css";
createApp(App).use(router).mount("#app");
