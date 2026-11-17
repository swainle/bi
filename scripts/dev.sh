#!/usr/bin/env bash
# 明策BI 本地开发服务：./scripts/dev.sh [start|stop|status]
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT=8300
WEB_PORT=5300
DB_URL="${DATABASE_URL:-postgresql://cavan-m4max@127.0.0.1:5432/mingzebi_dev}"
# 前端用已加入 macOS 防火墙白名单的 node（否则局域网访问会被 ALF 静默拦截）
NODE_BIN="${NODE_BIN:-/usr/local/bin/node}"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"

alive() { curl -s -o /dev/null -m 2 "http://127.0.0.1:$1"; }
status() {
  printf "后端 %s: " "$API_PORT"; alive $API_PORT && curl -s "http://127.0.0.1:$API_PORT/api/health" || echo "未运行"
  printf "前端 %s: " "$WEB_PORT"
  if alive $WEB_PORT; then
    echo "已运行 → http://127.0.0.1:$WEB_PORT"
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
    [ -n "$LAN_IP" ] && echo "          局域网 → http://$LAN_IP:$WEB_PORT"
  else
    echo "未运行"
  fi
}
start() {
  cd "$ROOT/backend"
  DATABASE_URL="$DB_URL" DEBUG=true nohup uv run dev --port $API_PORT --host 127.0.0.1 > /tmp/mzbi_api.log 2>&1 &
  sleep 6
  cd "$ROOT/frontend"
  nohup "$NODE_BIN" ./node_modules/vite/bin/vite.js > /tmp/mzbi_web.log 2>&1 &
  sleep 8
  status
}
stop() {
  lsof -nP -iTCP:$API_PORT -sTCP:LISTEN -t 2>/dev/null | xargs -r kill 2>/dev/null 2>/dev/null
  pkill -f "vite.*--port $WEB_PORT" 2>/dev/null
  lsof -nP -iTCP:$WEB_PORT -sTCP:LISTEN -t 2>/dev/null | xargs -r kill 2>/dev/null
  echo "已停止"
}
case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  *) status ;;
esac
