"""B05 可观测与错误（sentry / 进程指标 / 慢查询 / 错误日志 / /api/metrics）."""

from app.observability.sentry import *  # noqa: F401,F403
from app.observability.sentry import dsn_host, enabled, init_sentry  # noqa: F401
