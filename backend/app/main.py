"""明策BI · FastAPI 应用入口.

模块边界：
    /api/auth/**         认证（登录 / 刷新 / 资料 / 头像）
    /api/bi/engine/**    BI 引擎（查询 / 图表 / 看板 / AI 生成 / 模板 / 权限）
    /api/bi/datasource/** 数据源连接与测试
    /api/bi/team/**      看板团队共享
    /api/bi/engine/**    看板权限 + 操作审计（bi_admin）
"""

from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import TimeoutError as SATimeoutError

from app.config import settings
from app.database import Base, engine
from app.observability import init_sentry

# 来源：环境变量或 backend/.env（Settings 读 .env）；为空 = 不启用，写错也不影响启动
SENTRY_ENABLED = init_sentry(
    settings.sentry_dsn,
    settings.sentry_environment,
    settings.sentry_traces_sample_rate,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.upload_dir, exist_ok=True)

    # 建表 / 种子 / 管理员（幂等）
    from app import bootstrap

    bootstrap.ensure_schema()
    Base.metadata.create_all(bind=engine)
    bootstrap.ensure_migrations()
    bootstrap.ensure_item_sources()
    bootstrap.ensure_project_names()
    bootstrap.ensure_components()
    bootstrap.ensure_rbac_seed()
    bootstrap.ensure_rls_backstop()
    bootstrap.ensure_seed_data()
    bootstrap.ensure_admin()

    # 后台采集 BI 元数据（表结构 → 向量知识库），失败不影响启动
    def _sync_bi_metadata():
        try:
            from app.database import SessionLocal
            from app.services.bi_ai_engine import collect_metadata

            db = SessionLocal()
            try:
                collect_metadata(db)
            finally:
                db.close()
        except Exception as e:
            print(f"[startup] BI 元数据采集跳过：{e}")

    threading.Thread(target=_sync_bi_metadata, daemon=True).start()

    # 告警评估（默认每 60s；BI_ALERT_INTERVAL_SECONDS=0 关闭；多进程用 PG advisory lock 去重）
    from app.alerts import evaluate as alert_evaluate

    alert_evaluate.start_background()

    # 定时报表调度（默认每 60s 检查一次；BI_REPORT_INTERVAL_SECONDS=0 关闭）
    from app.reports import scheduler as report_scheduler

    report_scheduler.start_background()

    # 已接入表自动同步（默认每 60s 检查到期表；BI_SYNC_INTERVAL_SECONDS=0 关闭）
    from app.sources import sync_scheduler

    sync_scheduler.start_background()

    # 外部数据库会话采样（S7 二期）：非应用连接（psql / 黑客直连）每 60s 记一次安全事件
    def _security_db_watch():
        import time as _time

        from app.security.security_events import sample_external_db_sessions

        while True:
            _time.sleep(60)
            try:
                sample_external_db_sessions()
                from app.security import guard as _guard

                _guard.cleanup()
            except Exception:
                pass

    threading.Thread(target=_security_db_watch, daemon=True).start()
    from app.sources import import_jobs

    import_stop = import_jobs.start_background()
    try:
        yield
    finally:
        import_stop.set()


app = FastAPI(
    title="明策BI API",
    description="自研 BI 底座：数据源、数据集、看板画布、AI 生成、权限与审计",
    version=settings.app_version,
    lifespan=lifespan,
)

# ── 中间件（顺序：从内到外）─────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)

from app.middleware.audit_user import AuditUserMiddleware  # noqa: E402
from app.middleware.logging import RequestLoggingMiddleware  # noqa: E402
from app.middleware.rate_limit import RateLimitMiddleware  # noqa: E402
from app.middleware.csrf import CSRFMiddleware  # noqa: E402
from app.middleware.security_watch import SecurityWatchMiddleware  # noqa: E402

app.add_middleware(AuditUserMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CSRFMiddleware)
# 最外层：能看到 CSRF / 限流 / 鉴权的最终状态码，并给所有审计写指纹
app.add_middleware(SecurityWatchMiddleware)

# ── 路由注册 ───────────────────────────────────────────────────
from app.routers import auth, bi_admin, bi_datasource, bi_engine, bi_team  # noqa: E402
from app.sources import router as sources_router  # noqa: E402

app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(bi_engine.router, prefix="/api", tags=["BI引擎"])
app.include_router(bi_datasource.router, prefix="/api", tags=["BI数据源"])
app.include_router(sources_router.router, prefix="/api")
app.include_router(bi_team.router, prefix="/api", tags=["BI团队共享"])
app.include_router(bi_admin.router, prefix="/api/bi/engine", tags=["BI权限与审计"])

# ── 查询契约 / 语义层（新增模块，互不影响既有路由）──────────────
from app.routers import bi_query  # noqa: E402
from app.semantic import router as semantic_router  # noqa: E402
from app.semantic import router_items as semantic_items  # noqa: E402
from app.components import router as components_router  # noqa: E402
from app.canvas import router as canvas_router  # noqa: E402
from app.dashboards import router as dashboards_router  # noqa: E402
from app.dashboards import favorites as dashboard_favorites  # noqa: E402
from app.routers import images as images_router  # noqa: E402

app.include_router(bi_query.router, prefix="/api")
app.include_router(semantic_router.router, prefix="/api")
app.include_router(semantic_items.router, prefix="/api")
app.include_router(components_router.router, prefix="/api")
app.include_router(canvas_router.router, prefix="/api")
app.include_router(dashboards_router.router, prefix="/api")
# 结构操作（加页 / 删页 / 改名 / 发布）：只改结构，不写别的页的内容
from app.dashboards import structure as dashboard_structure  # noqa: E402

app.include_router(dashboard_structure.router, prefix="/api")
app.include_router(dashboard_favorites.router, prefix="/api")
app.include_router(images_router.router, prefix="/api")

# ── 系统指标（监控 / 排障）──────────────────────────────────────
from app.routers import metrics as metrics_router  # noqa: E402

app.include_router(metrics_router.router, prefix="/api")

# ── 告警（指标卡阈值 / 波动 → 站内事件 + Webhook）──────────────
from app.alerts import router as alerts_router  # noqa: E402

app.include_router(alerts_router.router, prefix="/api")

# ── 定时报表（订阅 → HTML / Excel → 站内 + Webhook）────────────
from app.reports import router as reports_router  # noqa: E402

app.include_router(reports_router.router, prefix="/api")

# ── 地图数据（省级 GeoJSON，前端地图组件按需加载）────────────────
from app.maps import router as maps_router  # noqa: E402

app.include_router(maps_router.router, prefix="/api")

# ── 错误日志（前端上报 + 管理员查询）──────────────────────────────
from app.errors import router as errors_router  # noqa: E402

app.include_router(errors_router.router, prefix="/api")

# ── 管理后台（概览 / 用户 / 角色权限 / 模型配置 / 运维）──────────────
from app.admin import router as admin_router  # noqa: E402

app.include_router(admin_router, prefix="/api")

# ── 操作监控（S7：操作 / AI / MCP 统一流水）────────────────────────
from app.admin import monitor as monitor_router  # noqa: E402

app.include_router(monitor_router.router, prefix="/api/admin")

# ── MCP 工具网关（管理后台：客户端 / 工具目录；网关在 S2 接入）────────
from app.mcp import router as mcp_router  # noqa: E402
from app.mcp import gateway as mcp_gateway  # noqa: E402

app.include_router(mcp_router.router, prefix="/api/admin")
app.include_router(mcp_gateway.router, prefix="/api")

# ── AI 排版（编辑器「AI 整理版面」；只产布局操作，不写文档）────────────
from app.ai import router as ai_layout_router  # noqa: E402

app.include_router(ai_layout_router.router, prefix="/api")

# ── 实时同步（版本轮询 + 按页取内容；1 秒一次，见 app/live/router.py）──
from app.live import router as live_router  # noqa: E402

app.include_router(live_router.router, prefix="/api/live")


# ── 健康检查 ───────────────────────────────────────────────────
def _probe_database() -> bool:
    """一条 `SELECT 1`：只看连接能不能用，不查业务表."""
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _probe_redis() -> str:
    """返回 up / down / disabled.

    Redis 是可选依赖（连不上回退进程内缓存），所以 down 不影响就绪判定；
    但要在探针里如实报出来，排障时一眼能看出「慢是因为缓存没了」。
    """
    if not (os.getenv("REDIS_URL") or "").strip():
        return "disabled"
    from app.query import redis_bus

    client = redis_bus.client()
    if client is None:
        return "down"
    try:
        client.ping()
        return "up"
    except Exception:
        redis_bus.reset()  # 下次探测重新建连，恢复后能自动变回 up
        return "down"


@app.get("/api/livez", tags=["系统"])
def livez():
    """存活探针：只证明进程还能响应，不碰数据库.

    数据库抖动 / 慢查询不应该让 K8s 重启 API（那会把正在跑的请求全打断），
    所以存活与就绪必须分开。
    """
    return {"status": "alive"}


@app.get("/api/readyz", tags=["系统"])
def readyz():
    """就绪探针：数据库不可用 → 503（从 Service 摘掉；Redis 挂了不影响就绪）."""
    db_ok = _probe_database()
    redis_state = _probe_redis()
    payload = {
        "status": "ready" if db_ok else "not_ready",
        "database": "up" if db_ok else "down",
        "redis": redis_state,
        "sentry": "on" if SENTRY_ENABLED else "off",
        "app": settings.app_name,
        "version": settings.app_version,
    }
    return JSONResponse(payload, status_code=200 if db_ok else 503)


@app.get("/api/health", tags=["系统"])
def health():
    from sqlalchemy import text

    db_ok = True
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "app": settings.app_name,
        "version": settings.app_version,
        "database": "up" if db_ok else "down",
    }


@app.get("/api/version", tags=["系统"])
def version():
    return {"name": settings.app_name, "version": settings.app_version}


# ── 前端错误上报在 app/errors/router.py（POST /api/report）──

# ── 连接池耗尽：快速失败成 503，别把 30s 等待变成 500 并刷屏错误日志 ──
_pool_timeout_log_at = 0.0


@app.exception_handler(SATimeoutError)
async def pool_timeout_handler(request: Request, exc: SATimeoutError):
    """SQLAlchemy QueuePool 取连接超时 = 数据库繁忙，返回 503 + Retry-After。

    这里不写 bi_error_log、不抛给 Sentry：连接池耗尽是一次可恢复的容量事件，
    按请求逐条上报只会把真正的异常淹没（2026-11-14 的 40 条 500 就是这么来的）。
    日志按 60s 汇总打一条，仍然能在运行日志里看到频率。
    """
    global _pool_timeout_log_at
    import time as _time

    now = _time.time()
    if now - _pool_timeout_log_at >= 60:
        _pool_timeout_log_at = now
        print(f"[db] 连接池耗尽（60s 内首次）：{request.method} {request.url.path} · {str(exc)[:160]}")
    try:
        from app.query import metrics as query_metrics

        query_metrics.incr("pool_timeout")
    except Exception:
        pass
    return JSONResponse(
        status_code=503,
        content={"detail": "数据库繁忙，请稍后重试"},
        headers={"Retry-After": "2"},
    )


# ── 全局异常：避免堆栈外泄（同时落错误日志，管理员可查）──────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback

    traceback.print_exc()
    try:
        from app.database import SessionLocal
        from app.errors import repository as error_repo

        db = SessionLocal()
        try:
            error_repo.insert(db, {
                "source": "backend",
                "level": "error",
                "message": f"{type(exc).__name__}: {exc}",
                "stack": traceback.format_exc()[-8000:],
                "url": f"{request.method} {request.url.path}",
                "user_agent": request.headers.get("user-agent", ""),
                "extra": {"query": str(request.url.query)[:500]},
            })
        finally:
            db.close()
    except Exception as log_exc:  # 落库失败不能掩盖原始异常
        print(f"[errors] 后端异常落库失败：{str(log_exc)[:200]}")
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


# ── 静态资源（头像 / 导出文件）──────────────────────────────────
if os.path.isdir(settings.upload_dir):
    app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")

# 必须最后挂载，API 与上传文件路由优先。
from pathlib import Path  # noqa: E402
from app.frontend import mount_frontend  # noqa: E402

if os.getenv("BI_SERVE_FRONTEND", "1") == "1":
    mount_frontend(app, Path(settings.project_root) / "frontend")
