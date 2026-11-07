import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3100';
if (!['localhost', '127.0.0.1', 'admin-test.buchuqin.com'].includes(new URL(apiTarget).hostname)) throw new Error('本地开发只允许本机或测试API，禁止生产连接');

// 本地 API 约定跑 PORT=3100（3000 被其他项目占用），见 .env / 运维记忆
export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: "css" })],
      dts: "src/components.d.ts",
    }),
    { name: 'local-night-preview-isolation', apply: 'serve', configureServer(server) {
      if (['http://localhost:3150', 'http://127.0.0.1:3150', 'https://admin-test.buchuqin.com'].includes(apiTarget)) server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy', `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: ws://localhost:* ws://127.0.0.1:* ${new URL(apiTarget).origin}; img-src 'self' data: blob: ${new URL(apiTarget).origin}; frame-src 'none'`);
        next();
      });
    } },
  ],
  server: {
    port: 5190,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
