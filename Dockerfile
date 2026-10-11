# 构建阶段：pnpm 装依赖 + vite build（build 脚本含 vue-tsc 类型检查，类型错即构建失败）
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# 运行阶段：nginx 直出静态 + /api/v1 反代 nest（配置见 nginx.conf）
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
