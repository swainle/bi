"""组件库 API.

端点：
    GET    /api/bi/components            列表（可按 kind / category / 关键词过滤）
    GET    /api/bi/components/meta       可选项（类型 / 配色 / 格式 / 聚合）
    POST   /api/bi/components            新建
    GET    /api/bi/components/{id}       详情
    PUT    /api/bi/components/{id}       更新（改字段 / 改样式 / 改计算规则）
    DELETE /api/bi/components/{id}       删除（内置组件禁删）
    POST   /api/bi/components/{id}/render  执行并返回渲染数据
    POST   /api/bi/components/preview      未保存的配置直接预览
"""

from __future__ import annotations

import json
import re
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.components import catalog as chart_catalog
from app.security.nav_guard import require_nav
from app.components import repository as repo
from app.components import transfer
from app.components.compute import fmt_number
from app.components.resolver import resolve
from app.components.spec import (
    ACCENTS,
    AGGREGATES,
    FORMATS,
    HEADLINES,
    HINTS,
    KINDS,
    ComponentSpec,
    ComponentSpecError,
    validate_kind,
    validate_spec,
)
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.security.errors import SecurityError

router = APIRouter(prefix="/bi/components", tags=["BI组件库"])

_CODE = re.compile(r"^[a-z][a-z0-9.\-]{1,63}$")


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, SecurityError):
        return HTTPException(exc.http_status, exc.message)
    return HTTPException(400, f"组件执行失败：{str(exc)[:200]}")


@router.get("/thumbnail-tables")
def thumbnail_tables(dataset_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.components.related_thumbnail import thumbnail_tables as options
    try:
        return options(db, dataset_id, current_user)
    except Exception as exc:
        raise _guard(exc) from exc


@router.get("")
def list_components(
    kind: str | None = Query(default=None),
    category: str | None = Query(default=None),
    q: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = repo.list_components(db, kind=kind, category=category, keyword=q)
    categories = sorted({c.category for c in repo.list_components(db)})
    return {
        "components": [c.to_dict() for c in items],
        "total": len(items),
        "categories": categories,
    }


@router.get("/catalog")
def component_catalog():
    """图表类型目录：按「图表类型」分类，供新建时选择."""
    return chart_catalog.catalog()


@router.post("/from-catalog", dependencies=[Depends(require_nav("bi:nav:components"))])
def create_from_catalog(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """按目录条目新建组件；带 case_id 时用「案例字段」预填配置."""
    entry = chart_catalog.find(str(payload.get("entry_id", "")))
    if entry is None:
        raise HTTPException(404, "图表类型不存在")

    spec = json.loads(json.dumps(entry["defaults"]))
    dataset_id = payload.get("dataset_id")
    if dataset_id:
        spec["binding"]["dataset_id"] = int(dataset_id)

    case_id = payload.get("case_id")
    if case_id:
        case = repo.get_component(db, int(case_id))
        if case:
            merged = dict(case.spec.get("binding") or {})
            if dataset_id:
                merged["dataset_id"] = int(dataset_id)
            spec["binding"].update({k: v for k, v in merged.items() if v is not None})
            spec["title"] = case.name

    name = str(payload.get("name") or entry["label"])
    code = str(payload.get("code") or f"{entry['id']}-{uuid.uuid4().hex[:6]}")
    try:
        component = repo.create_component(
            db, code=code, name=name, kind=entry["kind"], spec=spec,
            category=entry["category"], description=entry["desc"],
            owner_id=current_user.id,
        )
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    return component.to_dict()


@router.get("/meta")
def component_meta():
    """前端下拉选项 + 设计令牌（避免前端硬编码枚举）."""
    return {
        "kinds": list(KINDS),
        "accents": list(ACCENTS),
        "formats": list(FORMATS),
        "aggregates": [*AGGREGATES, "CUSTOM"],
        "headlines": list(HEADLINES),
        "hints": list(HINTS),
    }


@router.post("", dependencies=[Depends(require_nav("bi:nav:components"))])
def create_component(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    code = str(payload.get("code", "")).strip().lower()
    if not _CODE.match(code):
        raise HTTPException(400, "组件 code 需为小写字母开头，只含字母数字 . _ -（2-64 位）")
    if repo.get_by_code(db, code):
        raise HTTPException(409, f"组件 code 已存在：{code}")

    try:
        component = repo.create_component(
            db, code=code,
            name=str(payload.get("name", "")).strip() or code,
            kind=payload.get("kind", "kpi"),
            spec=payload.get("spec") or {},
            category=str(payload.get("category", "通用")),
            description=str(payload.get("description", "")),
            owner_id=current_user.id,
        )
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    return component.to_dict()


@router.get("/{component_id}")
def get_component(
    component_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    component = repo.get_component(db, component_id)
    if component is None:
        raise HTTPException(404, "组件不存在")
    return component.to_dict()


@router.put("/{component_id}", dependencies=[Depends(require_nav("bi:nav:components"))])
def update_component(
    component_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        updated = repo.update_component(
            db, component_id,
            name=payload.get("name"),
            category=payload.get("category"),
            description=payload.get("description"),
            spec=payload.get("spec"),
        )
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    if updated is None:
        raise HTTPException(404, "组件不存在")
    return updated.to_dict()


@router.delete("/{component_id}", dependencies=[Depends(require_nav("bi:nav:components"))])
def delete_component(
    component_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    component = repo.get_component(db, component_id)
    if component is None:
        raise HTTPException(404, "组件不存在")
    if component.is_builtin:
        raise HTTPException(403, "内置组件不可删除，可复制后修改")
    return {"deleted": repo.delete_component(db, component_id), "id": component_id}


@router.post("/{component_id}/render")
def render_component(
    component_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """执行组件：返回可直接渲染的数据 + 生成的 SQL（便于排查）."""
    component = repo.get_component(db, component_id)
    if component is None:
        raise HTTPException(404, "组件不存在")

    spec_payload = payload.get("spec") or component.spec
    try:
        kind = validate_kind(component.kind)
        spec = validate_spec(kind, spec_payload)
        data = resolve(db, spec, kind, current_user, extra_filters=payload.get("filters"))
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    except Exception as exc:
        raise _guard(exc) from exc

    data["component_id"] = component.id
    return data


@router.post("/preview")
def preview_component(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """实时预览：配置还没保存也能看效果（拖字段即时反馈）."""
    try:
        kind = validate_kind(payload.get("kind", "kpi"))
        spec = validate_spec(kind, payload.get("spec") or {})
        data = resolve(db, spec, kind, current_user)
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    except Exception as exc:
        raise _guard(exc) from exc
    return data


def _demo_dataset_id(db: Session) -> int | None:
    """组件库模板不写死数据集（见 AGENTS §5），卡片墙预览兜底用「演示数据集」."""
    from app.components.seed_demo import TABLE as DEMO_TABLE
    from app.semantic import repository as semantic_repo

    # 按物理表认（这行数据集允许改名），别再按 name 认 —— 改名后会找不到、卡片墙就没缩略图了
    hit = next((d for d in semantic_repo.list_datasets(db) if d.physical_table == DEMO_TABLE), None)
    return hit.id if hit is not None else None


@router.post("/preview-batch")
def preview_batch(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """批量预览（组件库卡片墙用）：一次算出多张卡的画面，单张失败不影响其它.

    模板的 binding 里不带数据集（拖到画布时用当前看板的数据集）；
    卡片墙要看到图，这里给没绑定数据集的模板临时挂上演示数据集，**只作用于本次预览**。
    """
    items = payload.get("items") or []
    if not isinstance(items, list):
        raise HTTPException(400, "items 必须是数组")
    if len(items) > 60:
        items = items[:60]

    cards: dict[str, dict] = {}
    errors: dict[str, str] = {}
    demo_id: int | None = None
    for index, raw in enumerate(items):
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key") or index)
        try:
            kind = validate_kind(raw.get("kind", "kpi"))
            spec = validate_spec(kind, raw.get("spec") or {})
            if kind not in ("insight", "banner", "section", "nav", "filter") and not spec.binding.dataset_id:
                if demo_id is None:
                    demo_id = _demo_dataset_id(db) or 0
                if demo_id:
                    spec.binding.dataset_id = demo_id
            cards[key] = resolve(db, spec, kind, current_user)
        except Exception as exc:  # 单张失败不影响整体
            errors[key] = (
                exc.message if isinstance(exc, SecurityError) else str(exc)[:120]
            )
    return {"cards": cards, "errors": errors}


@router.get("/utils/format")
def format_sample(value: float = 12345678, fmt: str = "int"):
    return {"value": value, "format": fmt, "rendered": fmt_number(value, fmt)}


@router.get("/{component_id}/export")
def export_component(
    component_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把一个组件导出成 JSON（前端存成文件），带上数据集引用便于跨环境导入."""
    row = repo.get_component(db, component_id)
    if row is None:
        raise HTTPException(404, "组件不存在")
    data = row.to_dict()
    dataset = transfer.dataset_ref(db, transfer.first_dataset_id(data.get("spec")))
    return transfer.build_payload(data, dataset)


@router.post("/import", dependencies=[Depends(require_nav("bi:nav:components"))])
def import_component(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导入组件 JSON：按物理表 / 名称找回本地数据集，找不到就清掉绑定并提示."""
    try:
        component, ref = transfer.normalize_payload(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    dataset_id = transfer.find_dataset_id(db, ref)
    spec = transfer.remap_dataset_ids(component["spec"], dataset_id)
    try:
        created = repo.create_component(
            db,
            code=f"imp_{uuid.uuid4().hex[:8]}",
            name=component["name"],
            kind=component["kind"],
            spec=spec,
            category=component["category"],
            description=component["description"],
            owner_id=current_user.id,
        )
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    return {
        **created.to_dict(),
        "dataset_matched": bool(dataset_id),
        "dataset_name": (ref or {}).get("name") if ref else None,
    }


__all__ = ["router"]
