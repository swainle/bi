# 构建
FROM node:22-alpine AS build
WORKDIR /app

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
