"""管理后台 API（按分区拆成子模块，URL / 函数名 / 注册顺序不变）。"""
from __future__ import annotations

from fastapi import APIRouter

from . import overview
from . import users
from . import departments
from . import registrations
from . import roles
from . import models
from . import ops

router = APIRouter(prefix="/admin", tags=["管理后台"])

router.include_router(overview.router)
router.include_router(users.router)
router.include_router(departments.router)
router.include_router(registrations.router)
router.include_router(roles.router)
router.include_router(models.router)
router.include_router(ops.router)

__all__ = ["router"]
