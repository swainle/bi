"""语义层 API —— 字段与指标的子资源端点.

单独成文件的原因：数据集 CRUD 已经占满 200+ 行，
再加字段/指标就会越过 300 行红线。
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.security.nav_guard import require_nav
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


@router.get("/datasets/{dataset_id}/fields/usages")
def field_usages(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """字段级血缘：每个字段被哪些看板 / 元素当维度、指标或筛选用到（改字段前先看这里）."""
    _dataset_or_404(db, dataset_id)
    from app.dashboards import sources as dash_sources

    fields = repo.list_fields(db, dataset_id)
    usage_map = dash_sources.usages_of_field(db, dataset_id, [f.name for f in fields])
    return {
        "dataset_id": dataset_id,
        "counts": {name: len(items) for name, items in usage_map.items()},
        "usages": usage_map,
    }


@router.post("/datasets/{dataset_id}/fields", dependencies=[Depends(require_nav("bi:nav:datasets"))])
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


@router.patch("/datasets/{dataset_id}/fields/{field_id}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
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


@router.delete("/datasets/{dataset_id}/fields/{field_id}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
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


@router.post("/datasets/{dataset_id}/metrics", dependencies=[Depends(require_nav("bi:nav:datasets"))])
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
            changed_by=current_user.id,
            changed_by_name=getattr(current_user, "username", "") or "",
        )
    except KeyError as exc:
        raise HTTPException(400, f"缺少字段：{exc}") from exc
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return metric.to_dict()


@router.patch("/datasets/{dataset_id}/metrics/{metric_id}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
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
        metric = repo.update_metric(db, dataset, metric_id, payload or {},
                                    changed_by=current_user.id,
                                    changed_by_name=getattr(current_user, "username", "") or "")
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return metric.to_dict() if metric else {"id": metric_id}


@router.delete("/datasets/{dataset_id}/metrics/{metric_id}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def delete_metric(
    dataset_id: int,
    metric_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _dataset_or_404(db, dataset_id)
    return {"deleted": repo.delete_metric(db, dataset_id, metric_id)}


# ── dbt / LookML 语义模型导入 ───────────────────────────────
def _plan_import(db: Session, dataset_id: int, payload: dict) -> tuple:
    from app.semantic import importer

    dataset = repo.get_dataset(db, dataset_id)
    if dataset is None:
        raise HTTPException(404, f"数据集不存在：{dataset_id}")
    result = importer.plan(
        str(payload.get("format") or ""),
        str(payload.get("content") or ""),
        dataset.metrics,
        dataset.fields,
    )
    return dataset, result


@router.post("/datasets/{dataset_id}/model-preview")
def preview_model_import(
    dataset_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导入前预览：新建 / 更新（含口径变更提示）/ 无变化 / 跳过（带原因），不写库."""
    try:
        _, result = _plan_import(db, dataset_id, payload or {})
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return result


@router.post("/datasets/{dataset_id}/model-import", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def run_model_import(
    dataset_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """执行导入：指标走版本治理（口径变了自动 +1 版本并取消认证），字段只补描述."""
    from app.semantic import importer

    try:
        dataset, result = _plan_import(db, dataset_id, payload or {})
        if not result["metrics"] and not result["fields"]:
            raise SemanticError("没有可导入的定义（全部被跳过，原因见预览）")
        applied = importer.apply_plan(
            db, dataset, result,
            user_id=current_user.id,
            user_name=getattr(current_user, "username", "") or "",
        )
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return applied


@router.get("/datasets/{dataset_id}/security")
def get_dataset_security(
    dataset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """数据集的行级规则 + 列级脱敏（模板复制时整组跟着走）."""
    _dataset_or_404(db, dataset_id)
    from app.security import dataset_rules

    return dataset_rules.list_rules(db, dataset_id)


def _require_dataset_owner(db: Session, dataset_id: int, user: User):
    dataset = _dataset_or_404(db, dataset_id)
    if dataset.owner_id not in (None, user.id) and user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "只能修改自己创建的数据集权限")
    return dataset


@router.post("/datasets/{dataset_id}/security/row-rules", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def add_dataset_row_rule(
    dataset_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """新增 / 覆盖一条行级规则（user_id 精确到人，role_name 精确到角色，都空 = 所有人）."""
    _require_dataset_owner(db, dataset_id, current_user)
    from app.security import dataset_rules

    try:
        return dataset_rules.add_row_rule(
            db, dataset_id,
            filter_rule=str(payload.get("filter_rule") or ""),
            user_id=payload.get("user_id") or None,
            role_name=str(payload.get("role_name") or "").strip() or None,
            note=str(payload.get("note") or ""),
            created_by=current_user.id,
        )
    except dataset_rules.DatasetRuleError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/datasets/{dataset_id}/security/row-rules/{rule_id}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def delete_dataset_row_rule(
    dataset_id: int,
    rule_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_dataset_owner(db, dataset_id, current_user)
    from app.security import dataset_rules

    return dataset_rules.delete_row_rule(db, dataset_id, rule_id)


@router.post("/datasets/{dataset_id}/security/masks", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def set_dataset_mask(
    dataset_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """新增 / 更新列级脱敏（同一数据集同一列只有一条）."""
    _require_dataset_owner(db, dataset_id, current_user)
    from app.security import dataset_rules

    try:
        return dataset_rules.set_mask(
            db, dataset_id,
            column_name=str(payload.get("column_name") or ""),
            mask_type=str(payload.get("mask_type") or ""),
            mask_pattern=str(payload.get("mask_pattern") or ""),
            created_by=current_user.id,
        )
    except dataset_rules.DatasetRuleError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/datasets/{dataset_id}/security/masks/{column_name}", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def delete_dataset_mask(
    dataset_id: int,
    column_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_dataset_owner(db, dataset_id, current_user)
    from app.security import dataset_rules

    return dataset_rules.delete_mask(db, dataset_id, column_name)


@router.get("/datasets/{dataset_id}/metrics/{metric_id}/versions")
def metric_versions(
    dataset_id: int,
    metric_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """指标口径的版本历史（每次表达式 / 格式变更留一版）."""
    _dataset_or_404(db, dataset_id)
    versions = repo.list_metric_versions(db, metric_id)
    return {"metric_id": metric_id, "count": len(versions), "versions": versions}


@router.post("/datasets/{dataset_id}/metrics/{metric_id}/certify", dependencies=[Depends(require_nav("bi:nav:datasets"))])
def certify_metric(
    dataset_id: int,
    metric_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """认证 / 取消认证指标（认证 = 口径已确认）."""
    _dataset_or_404(db, dataset_id)
    try:
        metric = repo.certify_metric(db, dataset_id, metric_id,
                                     bool(payload.get("certified", True)), current_user.id)
    except (SemanticError, SecurityError) as exc:
        raise _guard(exc) from exc
    return metric.to_dict()


@router.get("/datasets/{dataset_id}/metrics/{metric_id}/usages")
def metric_usages(
    dataset_id: int,
    metric_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """影响分析：这个指标被哪些看板 / 页面元素引用（改口径前先看这里）."""
    _dataset_or_404(db, dataset_id)
    metric = next((m for m in repo.list_metrics(db, dataset_id) if m.id == metric_id), None)
    if metric is None:
        raise HTTPException(404, f"指标不存在：{metric_id}")
    return {"metric_id": metric.id, **repo.metric_usages(db, dataset_id, metric.name)}
