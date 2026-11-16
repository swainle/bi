# 构建
FROM node:22-alpine AS build
WORKDIR /app

# 前端错误上报的 DSN 是**构建期**变量（Vite 会把它内联进产物）：
#   不传 = 产物里不带上报 SDK；传了 = 自动加载并上报到 Sentry / GlitchTip
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}

COPY package.json .npmrc ./
COPY packages ./packages
RUN npm install

COPY . .
RUN npm run build

# 运行
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
