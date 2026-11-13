"""语义层 API —— 字段与指标的子资源端点.

单独成文件的原因：数据集 CRUD 已经占满 200+ 行，
再加字段/指标就会越过 300 行红线。
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.semantic import repository as repo
from app.semantic.validator import SemanticError
from app.security.errors import SecurityError

router = APIRouter(prefix="/bi/semantic", tags=["BI语义层·字段与指标"])


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, SecurityError):
        return HTTPException(exc.http_status, exc.message)
    return HTTPException(400, str(exc)[:200])


def _dataset_or_404(db: Session, dataset_id: int):
    dataset = repo.get_dataset(db, dataset_id, with_items=False)
    if dataset is None:
        raise HTTPException(404, f"数据集不存在：{dataset_id}")
    return dataset


@router.get("/datasets/{dataset_id}/fields")
def list_fields(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _dataset_or_404(db, dataset_id)
    return {"fields": [f.to_dict() for f in repo.list_fields(db, dataset_id)]}


@router.post("/datasets/{dataset_id}/fields")
def add_field(
    dataset_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dataset = _dataset_or_404(db, dataset_id)
    try:
        field = repo.add_field(
            db, dataset,
            name=str(payload["name"]).strip(),
            source_column=str(payload["source_column"]).strip(),
            role=payload.get("role", "dimension"),
            data_type=payload.get("data_type", "text"),
            default_grain=payload.get("default_grain"),
            description=payload.get("description", ""),
            is_filterable=payload.get("is_filterable", True),
            is_groupable=payload.get("is_groupable", True),
        )
    except KeyError as exc:
        raise HTTPException(400, f"缺少字段：{exc}") from exc
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return field.to_dict()


@router.patch("/datasets/{dataset_id}/fields/{field_id}")
def update_field(
    dataset_id: int,
    field_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """改字段：显示名 / 来源列 / 角色 / 类型 / 可筛选 / 可分组."""
    dataset = repo.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(404, f"数据集不存在：{dataset_id}")
    try:
        field = repo.update_field(db, dataset, field_id, payload or {})
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return field.to_dict() if field else {"id": field_id}


@router.delete("/datasets/{dataset_id}/fields/{field_id}")
def delete_field(
    dataset_id: int,
    field_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _dataset_or_404(db, dataset_id)
    return {"deleted": repo.delete_field(db, dataset_id, field_id)}


@router.get("/datasets/{dataset_id}/metrics")
def list_metrics(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _dataset_or_404(db, dataset_id)
    return {"metrics": [m.to_dict() for m in repo.list_metrics(db, dataset_id)]}


@router.post("/datasets/{dataset_id}/metrics")
def add_metric(
    dataset_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dataset = _dataset_or_404(db, dataset_id)
    try:
        metric = repo.add_metric(
            db, dataset,
            name=str(payload["name"]).strip(),
            expression=str(payload["expression"]).strip(),
            fmt=payload.get("format", "number"),
            description=payload.get("description", ""),
        )
    except KeyError as exc:
        raise HTTPException(400, f"缺少字段：{exc}") from exc
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return metric.to_dict()


@router.patch("/datasets/{dataset_id}/metrics/{metric_id}")
def update_metric(
    dataset_id: int,
    metric_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dataset = repo.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(404, f"数据集不存在：{dataset_id}")
    try:
        metric = repo.update_metric(db, dataset, metric_id, payload or {})
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return metric.to_dict() if metric else {"id": metric_id}


@router.delete("/datasets/{dataset_id}/metrics/{metric_id}")
def delete_metric(
    dataset_id: int,
    metric_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _dataset_or_404(db, dataset_id)
    return {"deleted": repo.delete_metric(db, dataset_id, metric_id)}
