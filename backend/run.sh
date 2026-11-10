#!/usr/bin/env bash
# 明策BI 后端启动脚本
set -euo pipefail
cd "$(dirname "$0")"

# 0) 选择 Python 3.10+（系统自带 3.9 无法解析 `X | None` 运行时注解）
PY="${PYTHON:-python3}"
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  PY=""
  for cand in python3.12 python3.11 python3.10; do
    if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
  done
  if [ -z "$PY" ]; then
    echo "[run] 需要 Python 3.10+（当前 python3 版本过低）。请安装后重试，或设置 PYTHON=。" >&2
    exit 1
  fi
fi
echo "[run] 使用 Python：$($PY -V)"

# 1) venv
if [ ! -d .venv ]; then
  "$PY" -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi

# 2) .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[run] 已生成 .env，请按需修改 DATABASE_URL / LLM_API_KEY"
fi

# 3) 数据库初始化（幂等）
.venv/bin/python -m app.bootstrap

# 4) 启动
exec .venv/bin/python -m uvicorn app.main:app \
  --host "${HOST:-127.0.0.1}" \
  --port "${PORT:-8000}" \
  --reload
