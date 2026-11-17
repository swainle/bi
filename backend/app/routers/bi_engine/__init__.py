"""BI 引擎（旧版聚合入口）—— 按域拆成子模块，URL、函数名与注册顺序保持不变。"""
from __future__ import annotations

from fastapi import APIRouter

from .common import ACCEL_MAP, SYNC_STATE, _auto_refresh_loop, _cache, _call_llm, _refresh_once
from .analysis import FUNC_META
from .templates import TEMPLATE_MAP

from . import analysis
from . import templates
from . import tables
from . import ops
from . import access
from . import query
from . import governance
from . import ai
from . import dashboards
from . import import_clean
from . import imports
from . import editor

router = APIRouter(prefix="/bi/engine", tags=["BI引擎"])

router.include_router(analysis.router)
router.include_router(templates.router)
router.include_router(tables.router)
router.include_router(ops.router)
router.include_router(access.router)
router.include_router(query.router)
router.include_router(governance.router)
router.include_router(ai.router)
router.include_router(dashboards.router)
router.include_router(imports.router)
router.include_router(editor.router)

# 原文件在 import 时启动 5 分钟增量刷新线程 + 缓存自刷新（保持行为不变）
try:
    import threading

    _refresh_thread = threading.Thread(target=_auto_refresh_loop, daemon=True)
    _refresh_thread.start()
except Exception:
    pass

_cache.start_auto_refresh(interval=120)
