"""结构化请求日志中间件 — 基于 structlog 输出 JSON 日志.

特性：
  - 每个请求自动注入 request_id、method、path、status、elapsed_ms
  - 生产环境输出 JSON（方便 ELK/Loki 采集）
  - 开发环境输出可读彩色控制台
  - 异常请求自动记录堆栈

用法（其他模块）：
  from app.middleware.logging import get_logger
  log = get_logger()
  log.info("article_created", article_id=123, user="admin")
"""

import os
import time
import uuid
import logging
import traceback
from typing import Optional

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


# ── structlog 配置 ──────────────────────────────────────
def setup_structlog():
    """初始化 structlog — 开发彩色控制台 / 生产 JSON."""
    debug = os.getenv("DEBUG", "true").lower() in ("true", "1", "yes")

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    if debug:
        # 开发环境：彩色可读控制台
        renderer = structlog.dev.ConsoleRenderer(colors=True)
    else:
        # 生产环境：JSON（方便 ELK/Loki 采集）
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # 配置标准 logging handler 也走 structlog 格式
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler()
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)

    # 降低 noisy 日志级别
    for name in ("uvicorn.access", "sqlalchemy.engine", "httpx"):
        logging.getLogger(name).setLevel(logging.WARNING)


# 模块加载时自动配置
setup_structlog()


def get_logger(name: Optional[str] = None):
    """获取 structlog logger — 可选绑定模块名."""
    log = structlog.get_logger()
    if name:
        log = log.bind(module=name)
    return log


# ── 请求日志中间件 ──────────────────────────────────────
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """记录所有 API 请求的结构化日志 — 含 request_id、耗时、状态码."""

    async def dispatch(self, request: Request, call_next):
        # 生成请求 ID（用于链路追踪）
        request_id = request.headers.get("x-request-id", uuid.uuid4().hex[:12])

        # 注入 structlog 上下文变量
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            client_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent", "")[:100],
        )

        log = get_logger("request")
        start = time.perf_counter()

        try:
            response: Response = await call_next(request)
            elapsed_ms = (time.perf_counter() - start) * 1000

            log.info(
                "request_completed",
                status=response.status_code,
                elapsed_ms=round(elapsed_ms, 1),
            )

            # 将 request_id 写入响应头（方便前端排障）
            response.headers["X-Request-Id"] = request_id
            return response

        except Exception:
            elapsed_ms = (time.perf_counter() - start) * 1000
            log.error(
                "request_error",
                status=500,
                elapsed_ms=round(elapsed_ms, 1),
                exc_info=True,
            )
            raise
