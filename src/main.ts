import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
// ElMessage 等程序式组件不会被模板按需插件扫描，样式必须显式加载。
import "element-plus/es/components/message/style/css";
import "./style.css";
import "./drawer.css";
import "./rbac.css";
import "./element-plus.css";
createApp(App).use(router).mount("#app");
