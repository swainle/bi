#!/usr/bin/env bash
# 兼容入口；开发统一使用 uv run dev。
set -euo pipefail
cd "$(dirname "$0")"
exec uv run dev "$@"
