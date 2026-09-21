import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 本地 API 约定跑 PORT=3100（3000 被其他项目占用），见 .env / 运维记忆
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5190,
    strictPort: true,
    proxy: { "/api": { target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3100", changeOrigin: true } },
  },
});
