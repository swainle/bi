#!/usr/bin/env bash
# 按当前 Unix 账号选择前端开发端口，避免多人抢 5300。
set -euo pipefail
cd "$(dirname "$0")"

user="$(id -un)"
case "$user" in
  devops)      port=5300 ;;
  chenhanfeng) port=5310 ;;
  xiaobao)     port=5320 ;;
  wuyuanluo)   port=5330 ;;
  moyihao)     port=5340 ;;
  xuhongfei)   port=5350 ;;
  wangqili)    port=5360 ;;
  cavan)       port=5370 ;;
  liurunbiao)  port=5380 ;;
  *)           port="${MINGZEBI_DEV_PORT:-5390}" ;;
esac

echo "MingzeBI 前端：http://localhost:${port}"
echo "如果 AI 工具未自动打开浏览器，请在「端口」面板转发 ${port} 后访问。"
if [ "$#" -gt 0 ]; then
  exec npx vite "$@"
fi
exec npx vite --port "$port" --host 0.0.0.0
