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

from app.config import settings
from app.database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.upload_dir, exist_ok=True)

    # 建表 / 种子 / 管理员（幂等）
    from app import bootstrap

    bootstrap.ensure_schema()
    Base.metadata.create_all(bind=engine)
    bootstrap.ensure_rbac_seed()
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
    yield


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

from app.middleware.logging import RequestLoggingMiddleware  # noqa: E402
from app.middleware.rate_limit import RateLimitMiddleware  # noqa: E402
from app.middleware.csrf import CSRFMiddleware  # noqa: E402

app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CSRFMiddleware)

# ── 路由注册 ───────────────────────────────────────────────────
from app.routers import auth, bi_admin, bi_datasource, bi_engine, bi_team  # noqa: E402

app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(bi_engine.router, prefix="/api", tags=["BI引擎"])
app.include_router(bi_datasource.router, prefix="/api", tags=["BI数据源"])
app.include_router(bi_team.router, prefix="/api", tags=["BI团队共享"])
app.include_router(bi_admin.router, prefix="/api/bi/engine", tags=["BI权限与审计"])


# ── 健康检查 ───────────────────────────────────────────────────
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


# ── 前端错误上报（ErrorBoundary 使用 raw fetch，CSRF 已豁免该路径）──
@app.post("/api/report", tags=["系统"])
async def report_frontend_error(payload: dict):
    import logging

    logging.getLogger("frontend").error(
        "%s | %s | %s",
        payload.get("type", "error"),
        payload.get("message", ""),
        str(payload.get("stack", ""))[:800],
    )
    return {"ok": True}


# ── 全局异常：避免堆栈外泄 ─────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback

    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


# ── 静态资源（头像 / 导出文件）──────────────────────────────────
if os.path.isdir(settings.upload_dir):
    app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
