"""业务入口权限守卫（数据集 / 数据源 / SQL / 组件库 / 编辑设计）.

原则：
    * 菜单里能看到什么，接口层也要能管住关键写操作；
    * 但**共享读接口**（数据集列表、字段列表、组件预览、看板渲染）不在这里拦 ——
      编辑画布 / 查看看板都依赖它们，拦了会把主链路弄坏。
      真正的边界：入口页 + 本模块的增删改 / 执行类操作。
"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User


def has_nav(db: Session, user: User | None, code: str) -> bool:
    from app.admin.permissions import has_permission

    return has_permission(db, user, code)


def require_nav(code: str):
    """要求某个业务入口权限（如 bi:nav:datasets）."""

    def dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not has_nav(db, current_user, code):
            raise HTTPException(403, "没有该功能的权限，请联系管理员在「角色权限」里开通")
        return current_user

    return dependency


def require_nav_any(codes: list[str]):
    def dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not any(has_nav(db, current_user, c) for c in codes):
            raise HTTPException(403, "没有该功能的权限，请联系管理员在「角色权限」里开通")
        return current_user

    return dependency


__all__ = ["has_nav", "require_nav", "require_nav_any"]
