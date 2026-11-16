"""AI 排版接口（S4）.

POST /api/bi/ai/layout
    { scope: "all" | "selection", items: [...], bounds?: {...}, instruction?: "上面 6 张一行…" }
    → { ops: [{key,x,y,w,h}], rows, summary }

只产出布局操作；前端应用后才进撤销栈，AI 出错最多按一次撤销。
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.admin.permissions import require
from app.ai import layout as layout_planner
from app.ai import recommend as recommend_mod
from app.database import get_db
from app.middleware.audit import log_audit
from app.middleware.audit_context import get_audit_user
from app.middleware.auth import get_current_user
from app.models.user import User
from app.semantic import repository as sem_repo
from app.semantic.access import can_access_dataset

router = APIRouter(prefix="/bi/ai", tags=["AI 排版"])

_AI_USE = [Depends(require("bi:ai:use", "没有 AI 使用权限，请联系管理员开通"))]


@router.post("/layout", dependencies=_AI_USE)
def plan_layout(payload: dict = Body(...)):
    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "没有可整理的元素")
    if len(items) > 200:
        raise HTTPException(400, "一次最多整理 200 个元素")

    design = payload.get("design") or {}
    width = int(design.get("width") or layout_planner.DEFAULT_WIDTH)
    gap = int(design.get("gap") or layout_planner.DEFAULT_GAP)
    if width < 320 or width > 4000:
        raise HTTPException(400, "画布宽度不合法")
    if gap < 0 or gap > 80:
        raise HTTPException(400, "间距不合法")

    scope = str(payload.get("scope") or "all")
    bounds = payload.get("bounds") if scope == "selection" else None

    forced_rows = None
    instruction = str(payload.get("instruction") or "").strip()
    if instruction:
        # LLM 只决定「每行几张」；失败就退回自动归行，不阻塞用户
        forced_rows = layout_planner.rows_from_instruction(instruction, len(items))

    result = layout_planner.plan_layout(
        items, width=width, gap=gap, scope=scope, bounds=bounds, forced_rows=forced_rows,
    )
    result["instruction_applied"] = bool(forced_rows)
    log_audit(get_audit_user(), "ai.layout", "dashboard", 0, {
        "scope": scope, "items": len(items),
        "instruction": bool(instruction), "rows": result.get("rows"),
    })
    return result


@router.post("/recommend", dependencies=_AI_USE)
def recommend_components(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A4：按数据集字段推荐 3~5 个组件（只出元素定义，落位由前端做）."""
    dataset_id = int(payload.get("dataset_id") or 0)
    if not dataset_id:
        raise HTTPException(400, "缺少 dataset_id")
    dataset = sem_repo.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(404, "数据集不存在")
    if not can_access_dataset(db, dataset, current_user):
        raise HTTPException(403, "没有该数据集的权限（归属部门不匹配）")

    limit = int(payload.get("limit") or 5)
    items = recommend_mod.recommend(db, dataset, limit)
    if not items:
        raise HTTPException(400, "这个数据集没有可用字段，无法推荐组件")
    log_audit(current_user.id, "ai.recommend", "dataset", dataset_id,
              {"items": len(items), "limit": limit})
    return {"dataset_id": dataset_id, "items": items}
