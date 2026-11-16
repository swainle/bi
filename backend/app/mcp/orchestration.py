"""MCP 编排回滚（R9）—— 同一会话里后续工具失败时，清理本次新建的孤儿草稿.

只清理「本次会话由 Agent 新建、未发布、没有用户编辑过」的草稿：
    * 登记在 `bi_mcp_dashboard`；
    * `published_at IS NULL`；
    * 软删除（`deleted_at`），不物理删，误判也能恢复。
会话状态只存进程内存（10 分钟），多 worker 各管各的；真正的清洗由调用方触发。
"""

from __future__ import annotations

import time

_LOCK_SESSIONS: dict[str, dict] = {}
_TTL = 600.0


def _state(session: str) -> dict:
    now = time.monotonic()
    if len(_LOCK_SESSIONS) > 2000:
        for key in [k for k, v in _LOCK_SESSIONS.items() if now - v.get("seen", 0) > _TTL]:
            _LOCK_SESSIONS.pop(key, None)
    state = _LOCK_SESSIONS.setdefault(session, {"drafts": [], "seen": now})
    state["seen"] = now
    return state


def note_created(session: str, dashboard_id: int) -> None:
    if not session or not dashboard_id:
        return
    state = _state(session)
    if int(dashboard_id) not in state["drafts"]:
        state["drafts"].append(int(dashboard_id))


def rollback(session: str, db) -> list[int]:
    """清理本会话新建的未发布草稿；返回被清理的看板 id."""
    state = _LOCK_SESSIONS.pop(session, None)
    if not state or not state.get("drafts"):
        return []
    from sqlalchemy import text

    cleaned: list[int] = []
    for dashboard_id in state["drafts"]:
        try:
            row = db.execute(
                text(
                    "SELECT d.dashboard_id FROM bi_mcp_dashboard d "
                    "JOIN bi_canvas c ON c.id = d.dashboard_id "
                    "WHERE d.dashboard_id = :id AND d.published_at IS NULL "
                    "  AND c.deleted_at IS NULL"
                ),
                {"id": dashboard_id},
            ).fetchone()
            if row is None:
                continue
            db.execute(
                text("UPDATE bi_canvas SET deleted_at = now(), updated_at = now() "
                     "WHERE id = :id AND deleted_at IS NULL"), {"id": dashboard_id}
            )
            db.execute(
                text("DELETE FROM bi_mcp_dashboard WHERE dashboard_id = :id"),
                {"id": dashboard_id},
            )
            cleaned.append(dashboard_id)
        except Exception:
            db.rollback()
    if cleaned:
        db.commit()
    return cleaned


def forget(session: str) -> None:
    if session:
        _LOCK_SESSIONS.pop(session, None)


__all__ = ["note_created", "rollback", "forget"]
