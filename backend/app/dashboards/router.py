"""看板 v2 API —— 文档读取 / 参数渲染 / 浮层渲染 / 保存."""

from __future__ import annotations

from app.timezone import time_text

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.components import repository as component_repo
from app.components.resolver import apply_dataset_switch, resolve as resolve_component
from app.security.nav_guard import require_nav
from app.components.spec import ComponentSpecError, validate_spec
from app.dashboards import drill as drill_mod
from app.dashboards import render_cache
from app.dashboards import repository as repo
from app.dashboards import sources
from app.dashboards import render as renderer
from app.dashboards.models import DashboardDoc, validate_doc
from app.database import get_db
from app.middleware.audit import log_audit
from app.middleware.auth import get_current_user
from app.models.user import User
from app.security.errors import SecurityError
from app.semantic.compiler import compile_query
from app.semantic.repository import get_dataset

router = APIRouter(prefix="/bi/dashboards", tags=["BI看板"])


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, SecurityError):
        return HTTPException(exc.http_status, exc.message)
    if isinstance(exc, ComponentSpecError):
        return HTTPException(400, exc.message)
    return HTTPException(400, f"看板操作失败：{str(exc)[:200]}")


def _can_manage(row: repo.DashboardRow, user: User) -> bool:
    """改名 / 删除 / 分享设置的权限：自己的看板，或管理员；系统种子（owner 为空）只有管理员能动."""
    if user.role in ("admin", "super_admin"):
        return True
    return row.owner_id is not None and row.owner_id == user.id


def _canvas_permission(db: Session, dashboard_id: int, user_id: int) -> str | None:
    row = db.execute(
        text(
            "SELECT permission FROM bi_resource_permissions "
            "WHERE resource_type = 'canvas' AND resource_id = :rid AND user_id = :uid "
            "ORDER BY CASE permission WHEN 'manage' THEN 2 WHEN 'edit' THEN 1 ELSE 0 END DESC LIMIT 1"
        ),
        {"rid": dashboard_id, "uid": user_id},
    ).fetchone()
    return row[0] if row else None


def _can_read(row: repo.DashboardRow, user: User, db: Session) -> bool:
    """协同看板：全团队可看；私有看板：所有者 / 管理员 / 公共种子."""
    if user.role in ("admin", "super_admin"):
        return True
    if row.owner_id is None or row.owner_id == user.id:
        return True
    return bool(row.team_shared) or _canvas_permission(db, row.id, user.id) is not None


def _can_edit(row: repo.DashboardRow, user: User, db: Session) -> bool:
    """协同看板：被设为「可编辑」的成员能改；查看权限不能改."""
    if user.role in ("admin", "super_admin"):
        return True
    if row.owner_id is not None and row.owner_id == user.id:
        return True
    if not row.team_shared:
        return False
    return _canvas_permission(db, row.id, user.id) in ("edit", "manage")


def _my_permission(row: repo.DashboardRow, user: User, db: Session) -> str:
    """当前用户对这个看板的权限：owner / edit / view（给前端决定显不显示「编辑」）."""
    if user.role in ("admin", "super_admin") or (row.owner_id is not None and row.owner_id == user.id):
        return "owner"
    permission = _canvas_permission(db, row.id, user.id)
    if permission in ("edit", "manage"):
        return "edit"
    return "view"


def _require_read(row: repo.DashboardRow | None, user: User, db: Session) -> repo.DashboardRow:
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_read(row, user, db):
        raise HTTPException(403, "没有查看这个看板的权限")
    return row


def _require_edit(row: repo.DashboardRow | None, user: User, db: Session) -> repo.DashboardRow:
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_edit(row, user, db):
        raise HTTPException(403, "没有编辑这个看板的权限")
    return row


@router.get("")
def list_dashboards(
    published_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """我的看板：只列自己的 + 公共种子看板（管理员也不列别人的，别人的看板只在「我的团队」按权限出现）."""
    rows = repo.list_dashboards(
        db,
        owner_id=current_user.id,
        published_only=published_only,
    )
    ids = [r.id for r in rows]
    editor_counts: dict[int, int] = {}
    agent_ids: set[int] = set()
    if ids:
        for row in db.execute(
            text(
                "SELECT resource_id, count(*) FROM bi_resource_permissions "
                "WHERE resource_type = 'canvas' AND permission IN ('edit', 'manage') "
                "AND resource_id = ANY(:ids) GROUP BY resource_id"
            ),
            {"ids": ids},
        ).fetchall():
            editor_counts[int(row[0])] = int(row[1])
        # Agent 建的草稿：前端据此打「草稿 · Agent 生成」标（不靠 doc.meta，保存会被重建）
        agent_ids = {
            int(row[0]) for row in db.execute(
                text("SELECT dashboard_id FROM bi_mcp_dashboard WHERE dashboard_id = ANY(:ids)"),
                {"ids": ids},
            ).fetchall()
        }
    return {"dashboards": [
        {"id": r.id, "name": r.name, "code": r.code,
         "views": r.view_count, "items": r.item_count, "charts": r.chart_count,
         "published": (r.doc or {}).get("published") is not False,
         "agent_generated": r.id in agent_ids,
         "updated_at": time_text(r.updated_at or ""),
         "team_shared": bool(r.team_shared), "team_editors": editor_counts.get(r.id, 0),
         "owner_id": r.owner_id, "can_manage": _can_manage(r, current_user)}
        for r in rows
    ]}


@router.get("/team")
def list_team_dashboards(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """「我的团队」：我分享出去的协同看板 + 团队共享给我的看板（同一份看板，不复制）."""
    rows = db.execute(
        text(
            "SELECT * FROM bi_canvas WHERE doc IS NOT NULL AND deleted_at IS NULL "
            "AND team_shared IS TRUE ORDER BY updated_at DESC"
        )
    ).fetchall()
    names = {int(r[0]): r[1] for r in db.execute(text("SELECT id, username FROM users")).fetchall()}
    permissions = {
        int(r[0]): r[1]
        for r in db.execute(
            text(
                "SELECT resource_id, permission FROM bi_resource_permissions "
                "WHERE resource_type = 'canvas' AND user_id = :uid"
            ),
            {"uid": current_user.id},
        ).fetchall()
    }
    editor_counts = {
        int(r[0]): int(r[1])
        for r in db.execute(
            text(
                "SELECT resource_id, count(*) FROM bi_resource_permissions "
                "WHERE resource_type = 'canvas' AND permission IN ('edit', 'manage') GROUP BY resource_id"
            )
        ).fetchall()
    }

    my_shared: list[dict] = []
    shared_with_me: list[dict] = []
    for raw in rows:
        row = repo._row(raw)
        if row is None:
            continue
        item = {
            "id": row.id, "name": row.name, "owner_id": row.owner_id,
            "owner_name": names.get(row.owner_id or 0, ""),
            "charts": row.chart_count, "views": row.view_count,
            "updated_at": time_text(row.updated_at or ""),
            "team_editors": editor_counts.get(row.id, 0),
        }
        if row.owner_id == current_user.id:
            my_shared.append({**item, "my_permission": "owner"})
        else:
            item["my_permission"] = permissions.get(row.id, "view")
            shared_with_me.append(item)
    return {"my_shared": my_shared, "shared_with_me": shared_with_me}


def _with_live_items(doc, view_key: str | None, raw_items: list) -> "DashboardDoc":
    """把「还没保存的当前版面」套进文档再渲染 —— 用户拖完卡、选完字段就能立刻看到数据.

    只替换目标视图的 items，其它视图 / 头部 / 参数定义照旧；不改数据库。
    """
    data = doc.model_dump()
    views = data.get("views") or []
    if not views:
        return doc
    target = next((v for v in views if v.get("key") == view_key), None) or views[0]
    target["items"] = raw_items
    # 现场版面已经是「当前平台那一套」了，清掉存的分平台卡片，免得两者叠在一起
    target["items_map"] = {}
    return validate_doc(data)


def _blank_doc() -> dict:
    """新项目的空文档 —— 一个主视图，进去就能直接拖卡."""
    return {
        "version": 2.1, "mode": "flow", "published": False,
        "header": {}, "params": [],
        "views": [{"key": "main", "title": "主视图", "items": [], "guides": []}],
    }


@router.post("", dependencies=[Depends(require_nav("bi:nav:editor"))])
def create_dashboard(
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """新建项目（= 一块可编辑画布）；没起名就自动编号「未命名项目01 / 02 / 03…」."""
    given = str(payload.get("name") or "").strip()
    name = given if given and given != repo.UNTITLED else repo.next_untitled_name(db)
    try:
        row = repo.create(db, name=name, code=None,
                          doc=payload.get("doc") or _blank_doc(),
                          owner_id=current_user.id)
    except Exception as exc:
        raise _guard(exc) from exc
    if row is None:
        raise HTTPException(400, "创建项目失败")
    log_audit(current_user.id, "dashboard.create", "canvas", row.id, {"name": name})
    return row.to_dict()


@router.get("/by-code/{code}")
def get_by_code(
    code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = repo.get_by_code(db, code)
    if row is None:
        raise HTTPException(404, "看板不存在")
    return row.to_dict()


@router.get("/{dashboard_id}")
def get_dashboard(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _require_read(repo.get(db, dashboard_id), current_user, db)
    data = row.to_dict()
    data["my_permission"] = _my_permission(row, current_user, db)
    data["agent_generated"] = bool(db.execute(
        text("SELECT 1 FROM bi_mcp_dashboard WHERE dashboard_id = :id"), {"id": dashboard_id}
    ).fetchone())
    return data


# ── 分享到我的团队（协同看板：看板本体不变、数据集不复制）────────
@router.post("/{dashboard_id}/team-share")
def share_dashboard_to_team(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把看板设为协同看板：全团队可在「我的团队」看到（默认只能查看）."""
    row = repo.get(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_manage(row, current_user):
        raise HTTPException(403, "只有看板所有者可以分享")
    repo.set_team_shared(db, dashboard_id, True)
    log_audit(current_user.id, "dashboard.share", "canvas", dashboard_id, {"name": row.name})
    return {"id": dashboard_id, "team_shared": True}


@router.delete("/{dashboard_id}/team-share")
def unshare_dashboard_from_team(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """取消协同：看板回到私有，同时清掉成员权限."""
    row = repo.get(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_manage(row, current_user):
        raise HTTPException(403, "只有看板所有者可以取消分享")
    repo.set_team_shared(db, dashboard_id, False)
    db.execute(
        text("DELETE FROM bi_resource_permissions WHERE resource_type = 'canvas' AND resource_id = :id"),
        {"id": dashboard_id},
    )
    db.commit()
    log_audit(current_user.id, "dashboard.unshare", "canvas", dashboard_id, {"name": row.name})
    return {"id": dashboard_id, "team_shared": False}


@router.get("/{dashboard_id}/team-permissions")
def get_team_permissions(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """协同看板的成员权限（查看 / 编辑）."""
    row = repo.get(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_manage(row, current_user):
        raise HTTPException(403, "只有看板所有者可以设置权限")
    permissions = {
        int(r[0]): r[1]
        for r in db.execute(
            text(
                "SELECT user_id, permission FROM bi_resource_permissions "
                "WHERE resource_type = 'canvas' AND resource_id = :id"
            ),
            {"id": dashboard_id},
        ).fetchall()
    }
    members = [
        {"id": int(r[0]), "username": r[1], "permission": permissions.get(int(r[0]), "view")}
        for r in db.execute(
            text("SELECT id, username FROM users WHERE is_active IS TRUE ORDER BY id")
        ).fetchall()
        if int(r[0]) != row.owner_id
    ]
    return {
        "id": dashboard_id,
        "name": row.name,
        "team_shared": bool(row.team_shared),
        "owner_id": row.owner_id,
        "members": members,
    }


@router.put("/{dashboard_id}/team-permissions")
def set_team_permissions(
    dashboard_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """保存协同权限：view = 只能看，edit = 能改内容（保存看板）."""
    row = repo.get(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_manage(row, current_user):
        raise HTTPException(403, "只有看板所有者可以设置权限")

    cleaned: list[dict] = []
    for item in payload.get("permissions") or []:
        try:
            user_id = int((item or {}).get("user_id"))
        except (TypeError, ValueError):
            continue
        permission = str((item or {}).get("permission") or "view")
        if permission not in ("view", "edit"):
            continue
        cleaned.append({"user_id": user_id, "permission": permission})

    db.execute(
        text("DELETE FROM bi_resource_permissions WHERE resource_type = 'canvas' AND resource_id = :id"),
        {"id": dashboard_id},
    )
    if cleaned:
        db.execute(
            text(
                "INSERT INTO bi_resource_permissions "
                "(resource_type, resource_id, user_id, permission) "
                "VALUES ('canvas', :id, :uid, :permission)"
            ),
            [{"id": dashboard_id, "uid": item["user_id"], "permission": item["permission"]}
             for item in cleaned],
        )
    db.commit()
    log_audit(current_user.id, "dashboard.permission", "canvas", dashboard_id,
              {"name": row.name, "members": cleaned})
    return {"id": dashboard_id, "permissions": cleaned}


@router.put("/{dashboard_id}/views/{view_key}")
def save_dashboard_view(
    dashboard_id: int,
    view_key: str,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """只保存某一页（页面级保存：别的页不会被这份（可能过期的）副本覆盖）."""
    _require_edit(repo.get(db, dashboard_id), current_user, db)
    view = payload.get("view")
    if not isinstance(view, dict):
        raise HTTPException(400, "缺少 view")
    try:
        saved = repo.save_view(db, dashboard_id, view_key, view)
    except Exception as exc:
        raise _guard(exc) from exc
    if saved is not None:
        render_cache.invalidate(dashboard_id)
        try:
            sources.rebuild(db, dashboard_id, saved.doc)
        except Exception as exc:  # 账本写失败不影响保存本身
            print(f"[dashboards] 数据源账本重建失败：{exc}")
        log_audit(current_user.id, "dashboard.save_view", "canvas", dashboard_id, {"view": view_key})
    return saved.to_dict() if saved else {"id": dashboard_id}


@router.put("/{dashboard_id}")
def save_dashboard(
    dashboard_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_edit(repo.get(db, dashboard_id), current_user, db)
    try:
        # 保存/发布时才做结构自愈（编辑过程中的渲染不参与，避免把用户删掉的筛选栏补回来）
        doc = validate_doc(payload.get("doc") or {}, heal=True)
        saved = repo.save(db, dashboard_id, doc, name=payload.get("name"),
                          publish=bool(payload.get("publish")))
    except Exception as exc:
        raise _guard(exc) from exc
    if saved is not None:
        render_cache.invalidate(dashboard_id)  # 文档变了 → 这个看板的整页缓存全部作废
        # 组件 → 数据源账本：按这次保存的文档整体重建（页面 ID / 元素 ID / 数据集都可查）
        try:
            sources.rebuild(db, dashboard_id, saved.doc)
        except Exception as exc:  # 账本写失败不影响保存本身
            print(f"[dashboards] 数据源账本重建失败：{exc}")
        log_audit(
            current_user.id,
            "dashboard.publish" if payload.get("publish") else "dashboard.save",
            "canvas", dashboard_id,
            {"name": saved.name, "charts": saved.chart_count, "items": saved.item_count},
        )
    return saved.to_dict() if saved else {"id": dashboard_id}


@router.get("/{dashboard_id}/sources")
def list_dashboard_sources(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """这个看板每个元素用了哪个数据集（页面 ID / 元素 ID / 指标 / 维度都带）."""
    _require_read(repo.get(db, dashboard_id), current_user, db)
    return {"dashboard_id": dashboard_id, "sources": sources.list_for(db, dashboard_id)}


@router.patch("/{dashboard_id}", dependencies=[Depends(require_nav("bi:nav:editor"))])
def rename_dashboard(
    dashboard_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """只改看板名称，不动页面内容."""
    row = repo.get(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_manage(row, current_user):
        raise HTTPException(403, "无权修改此看板")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "看板名称不能为空")
    saved = repo.rename(db, dashboard_id, name)
    if saved is None:
        raise HTTPException(404, "看板不存在")
    return {"id": saved.id, "name": saved.name, "updated_at": time_text(saved.updated_at or "")}


@router.delete("/{dashboard_id}", dependencies=[Depends(require_nav("bi:nav:editor"))])
def delete_dashboard(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = repo.get(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    if not _can_manage(row, current_user):
        raise HTTPException(403, "无权删除此看板")
    deleted = repo.soft_delete(db, dashboard_id)
    if deleted:
        render_cache.invalidate(dashboard_id)
        sources.drop_for(db, dashboard_id)  # 软删的看板不再算「在用」
        db.execute(
            text("DELETE FROM bi_resource_permissions WHERE resource_type = 'canvas' AND resource_id = :id"),
            {"id": dashboard_id},
        )
        db.commit()
        log_audit(current_user.id, "dashboard.delete", "canvas", dashboard_id,
                  {"name": row.name})
    return {"deleted": deleted, "id": dashboard_id}


@router.post("/{dashboard_id}/render")
def render_dashboard(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _require_read(repo.get(db, dashboard_id), current_user, db)
    live_items = payload.get("items")
    cross_filters = payload.get("cross_filters") or []
    # 权限校验永远先做（缓存里只有数据，不含权限判断）；命中的是「同一用户、同一份文档、同一组参数」
    cache_key = render_cache.key_for(
        dashboard_id,
        updated_at=row.updated_at,
        user=current_user,
        view=payload.get("view"),
        params=payload.get("params") or {},
        live_items=live_items if isinstance(live_items, list) else None,
        cross_filters=cross_filters,
    )
    cached = render_cache.load(cache_key)
    if cached is not None:
        return cached
    # 权限查完就把连接还回池子：下面回源可能排队，别让排队的请求各占一条连接
    db.commit()

    def _compute() -> dict:
        doc = validate_doc(row.doc)
        if isinstance(live_items, list):
            try:
                doc = _with_live_items(doc, payload.get("view"), live_items)
            except Exception:
                doc = validate_doc(row.doc)  # 版面里有半成品就先按已保存的渲染，别整页报错
        result = renderer.render_dashboard(
            db, doc, current_user,
            view_key=payload.get("view"),
            params=payload.get("params") or {},
            cross_filters=cross_filters,
        )
        # 单卡报错的结果不缓存：可能只是一次数据库抖动，别把错误冻住整个 TTL
        if not render_cache.has_card_error(result):
            render_cache.store(cache_key, result)
        return result

    try:
        if render_cache.ttl() <= 0:
            return _compute()
        # 单飞：缓存过期那一刻只让一个请求回源，其余等它写进缓存后直接读（防雪崩）
        with render_cache.lock_for(cache_key):
            cached = render_cache.load(cache_key)
            if cached is not None:
                return cached
            return _compute()
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{dashboard_id}/rows")
def dashboard_rows(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """单个表格元素的全量行（弹窗「查看更多」用）—— 行限制放到最大，口径与卡片一致."""
    row = _require_read(repo.get(db, dashboard_id), current_user, db)
    try:
        doc = validate_doc(row.doc)
        raw_items = payload.get("items")
        if isinstance(raw_items, list):
            try:
                doc = _with_live_items(doc, payload.get("view"), raw_items)
            except Exception:
                doc = validate_doc(row.doc)
        item_key = str(payload.get("item_key") or "")
        found = renderer.find_item(doc, item_key, payload.get("view"))
        item = found[1] if found else None
        if item is None:
            raise HTTPException(404, "元素不存在")

        spec = validate_spec("table", item.spec or {})
        spec = spec.model_copy(deep=True)
        spec.binding.top_n = max(int(payload.get("limit") or 2000), 2000)

        # 页面筛选照旧注入，弹窗里看到的就是卡片同一口径的全量
        defs = renderer.collect_param_defs(db, doc, payload.get("view"), payload.get("params") or {})
        effective = renderer.effective_params(defs, payload.get("params") or {})
        page_filters, keywords = renderer._page_filters(defs, effective)
        cross = renderer.normalize_cross_filters(payload.get("cross_filters"))
        if cross:
            existing = {field.get("name") for field in page_filters}
            page_filters = page_filters + [field for field in cross if field["name"] not in existing]
        switches = renderer.dataset_switches(defs)
        # 「查看更多」也要按当前平台切表，弹窗里的行才是这张卡的口径
        spec, _switched = apply_dataset_switch(db, spec, effective, switches)
        if page_filters and spec.binding.dataset_id:
            columns = renderer._dataset_fields(db, spec.binding.dataset_id)
            extra = [f for f in page_filters if f["name"] in columns]
            if extra:
                spec.binding.filters = list(spec.binding.filters or []) + extra

        # 搜索框同样作用于「查看更多」/ 导出的全量行（与卡片同一口径）
        data = resolve_component(db, spec, "table", current_user,
                                 params=payload.get("params") or {}, keywords=keywords,
                                 switches=switches)
        rows = data.get("rows") or []
        return {"rows": rows, "columns": data.get("columns") or [], "count": len(rows)}
    except HTTPException:
        raise
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{dashboard_id}/top-list")
def dashboard_top_list(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """指标卡右上角徽标的弹窗：按卡片里配的「维度 + 指标」独立算一个 TOP N 榜单.

    与卡片上的数字是两套口径（卡片可能是 COUNT，这里按指标 SUM 排行）；
    只读、不改文档、不动页面参数 —— 页面筛选照旧生效，弹窗自己关闭不影响其它卡片。
    """
    row = _require_read(repo.get(db, dashboard_id), current_user, db)
    try:
        doc = validate_doc(row.doc)
        raw_items = payload.get("items")
        if isinstance(raw_items, list):
            try:
                doc = _with_live_items(doc, payload.get("view"), raw_items)
            except Exception:
                doc = validate_doc(row.doc)
        item_key = str(payload.get("item_key") or "")
        found = renderer.find_item(doc, item_key, payload.get("view"))
        item = found[1] if found else None
        if item is None:
            raise HTTPException(404, "元素不存在")

        code = str(item.component or "")
        component = component_repo.get_by_code(db, code) if code else None
        kind = component.kind if component is not None else "kpi"
        spec = validate_spec(kind, item.spec or {})
        top = spec.top
        if not top.enabled:
            raise HTTPException(400, "这个指标卡没有配置右上角弹窗")

        view_key = payload.get("view")
        defs = renderer.collect_param_defs(db, doc, view_key, payload.get("params") or {})
        effective = renderer.effective_params(defs, payload.get("params") or {})
        page_filters, keywords = renderer._page_filters(defs, effective)
        switches = renderer.dataset_switches(defs)
        spec, _switched = apply_dataset_switch(db, spec, effective, switches)

        metric = top.metric or spec.binding.metric
        if not metric:
            raise HTTPException(400, "弹窗没有配置指标：面板里选一个")
        dim = str(top.dim or "").strip()
        if not dim and str(spec.binding.dimension or "").strip():
            dim = str(spec.binding.dimension).strip()
        # 优先沿用这一页的「明细表」：列顺序 / 列定义 / 缩略图 / 列宽都照它来，
        # 弹窗看起来就是那张表的排行版；页面上没有明细表时再用弹窗自己的配置。
        page_table = None
        view_key = payload.get("view")
        for v, item in doc.all_items():
            if view_key and v.key != view_key:
                continue
            # 画布上的明细表存的是 type=chart + component=base.table（按 kind 认，别只看 type）
            code = str(item.component or "")
            component = component_repo.get_by_code(db, code) if code else None
            is_table = (component.kind == "table") if component is not None else (item.type == "table")
            if not is_table:
                continue
            try:
                candidate = validate_spec("table", item.spec or {})
            except Exception:
                continue
            if spec.binding.dataset_id and candidate.binding.dataset_id not in (None, spec.binding.dataset_id):
                continue
            page_table = candidate
            break

        # 弹窗没配排名维度（早期的卡只开了开关、维度留空）时，借本页明细表的第一列当维度，
        # 否则表格一个字段都没有，直接报「明细表至少需要一个字段」。
        if not dim and page_table is not None:
            candidates = [str(n or "").strip() for n in (page_table.binding.dimensions or [])]
            candidates = [n for n in candidates if n]
            # 优先「…标题 / …名称」这类文本列（排行通常按商品走），否则用明细表第一列
            dim = next((n for n in candidates if "标题" in n or "名称" in n), candidates[0] if candidates else "")
        if not dim:
            raise HTTPException(400, "弹窗没有配置排名维度：面板里选一个")

        # 附加列不能当原始列塞进 GROUP BY（一个产品在多条榜单里会被拆成多行）：
        # 统一按 MAX 取值 —— 一行一个维度，属性取其中任意一条，和主流 BI 的「排行明细」一致。
        metrics = [{"name": metric, "agg": top.agg or "SUM"}]
        seen = {metric, dim}
        extra: list[str] = []
        thumb_key = ""
        if page_table is not None:
            extra.extend(page_table.binding.dimensions or [])
            if page_table.table_view.thumb and page_table.table_view.thumb_key:
                thumb_key = page_table.table_view.thumb_key
                extra.append(thumb_key)
        extra.extend(top.columns or [])
        for name in extra:
            text = str(name or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            metrics.append({"name": text, "agg": "MAX"})

        title = top.title or f"{spec.title} TOP{top.top_n}"
        # 先多取一些（并列很多时也有序），再在下面自己排一次：
        # 只按指标排序时同分那一批顺序是数据库给的，每次打开可能换人 —— 补一个维度升序当稳定并列规则。
        table_view = {"page_size": top.page_size, "more": False,
                      "index_column": True, "thumb": False, "thumb_key": ""}
        if page_table is not None:
            table_view = {
                **page_table.table_view.model_dump(),
                "more": False,                      # 弹窗里不再套「查看更多」
                "page_size": len(metrics) and top.page_size or page_table.table_view.page_size,
                "columns": [],                      # 列由下面按真实取到的行重建（避免多出空列）
                # 缩略图列已经并按 MAX 取了：这里不挂 thumb，否则 resolver 会把它当原始列再拼一次（GROUP BY 冲突）
                "thumb": False, "thumb_key": "",
            }
        table = validate_spec("table", {
            "title": title,
            "binding": {
                "dataset_id": spec.binding.dataset_id, "dimension": dim or None, "dimensions": [],
                "metrics": metrics, "sort": "desc",
                "top_n": 2000, "limit": 2000,
            },
            "table_view": table_view,
        })
        if page_filters and table.binding.dataset_id:
            names = renderer._dataset_fields(db, table.binding.dataset_id)
            table.binding.filters = [f for f in page_filters if f["name"] in names]
        data = resolve_component(db, table, "table", current_user,
                                 params=effective, keywords=keywords, switches=None)
        rows = list(data.get("rows") or [])

        def value_of(row: dict) -> float:
            try:
                return float(row.get(metric))
            except (TypeError, ValueError):
                return float("-inf")

        def sort_key(row: dict):
            return (-value_of(row), str(row.get(dim) if dim else ""))

        rows.sort(key=sort_key)
        shown = rows[: top.top_n]
        # 和第 N 名同分的**全部**一起给：16 条并列 2000 时，只给 10 条的话漏哪 6 条完全取决于排序规则，
        # 用户没法核对（2026-11-15 用户实测质疑）。上限 200 条防极端。
        tied = 0
        expanded = False
        if shown:
            edge = value_of(shown[-1])
            tied = sum(1 for row in rows if value_of(row) == edge)
            if top.ties == "all" and tied > len(shown):
                shown = [row for row in rows if value_of(row) >= edge][:200]
                expanded = True
        requested = top.top_n
        base_columns = data.get("columns") or []
        columns = base_columns
        if page_table is not None and shown:
            # 列顺序 / 列定义都照这一页的明细表来
            keys = list(shown[0].keys())
            wanted = {c["key"]: c for c in page_table.table_view.columns or []}
            derived = {c["key"]: c for c in base_columns}
            order: list[str] = []
            for key in page_table.binding.dimensions or []:
                if key in keys and key not in order:
                    order.append(key)
            if metric in keys and metric not in order:
                order.append(metric)
            for key in keys:
                if key not in order:
                    order.append(key)
            if thumb_key:
                order = [key for key in order if key != thumb_key]     # 缩略图列单独画
            columns = []
            for key in order:
                if key in wanted:
                    columns.append(wanted[key])
                elif key in derived:
                    columns.append(derived[key])
                else:
                    columns.append({"key": key, "label": key, "type": "text", "align": "left", "width": 0})
        return {
            "title": title,
            "rows": shown,
            "columns": columns,
            "count": len(shown),
            "requested": requested,
            "tied": tied,
            "ties": top.ties,
            "expanded": expanded,
            "metric": metric,
            "agg": top.agg or "SUM",
            # 缩略图 / 序号列跟着明细表走（弹窗与那张表的观感一致）
            "thumb": bool(thumb_key) and page_table is not None and bool(page_table.table_view.thumb),
            "thumb_key": thumb_key,
            "index_column": bool(page_table.table_view.index_column) if page_table is not None else True,
            # 行详情（点行弹抽屉）：沿用页面明细表的弹窗配置
            "detail": (page_table.table_view.detail.model_dump() if page_table is not None and page_table.table_view.detail.enabled else None),
            "source": "table" if page_table is not None else "default",
            "top": top.model_dump(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{dashboard_id}/drill")
def drill_rows(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """下钻明细：按某个维度值取这张卡的数据集原始行（最多 200 行，口径与看板一致）."""
    row = _require_read(repo.get(db, dashboard_id), current_user, db)
    try:
        doc = validate_doc(row.doc)
        item_key = str(payload.get("item_key") or "")
        found = renderer.find_item(doc, item_key, payload.get("view"))
        item = found[1] if found else None
        if item is None:
            raise HTTPException(404, "元素不存在")

        _kind, spec = renderer._item_spec(db, item)
        defs = renderer.collect_param_defs(db, doc, payload.get("view"), payload.get("params") or {})
        effective = renderer.effective_params(defs, payload.get("params") or {})
        switches = renderer.dataset_switches(defs)
        spec, _switched = apply_dataset_switch(db, spec, effective, switches)
        if not spec.binding.dataset_id:
            raise HTTPException(400, "这张卡没有绑定数据集")
        dataset = get_dataset(db, spec.binding.dataset_id)
        if dataset is None:
            raise HTTPException(400, "数据集不存在")

        column = str(payload.get("column") or spec.binding.dimension or "").strip()
        value = payload.get("value")
        if not column or value in (None, "", [], {}):
            raise HTTPException(400, "缺少下钻列或值")
        field_names = {field.name for field in (getattr(dataset, "fields", None) or [])}
        if column not in field_names:
            raise HTTPException(400, f"数据集里没有字段：{column}")

        columns = drill_mod.drill_columns(getattr(dataset, "fields", None) or [])
        if column not in columns:
            columns = [column] + columns
        columns = columns[: drill_mod.MAX_COLUMNS]
        request = drill_mod.build_request(columns, column, value)

        from app.components.resolver import _execute_dataset

        result = _execute_dataset(db, dataset, compile_query(dataset, request), current_user)
        rows = [dict(entry) for entry in result.rows]
        return jsonable_encoder({
            "columns": columns,
            "rows": rows,
            "count": len(rows),
            "sql": result.sql,
        })
    except HTTPException:
        raise
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{dashboard_id}/overlay")
def render_overlay(
    dashboard_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _require_read(repo.get(db, dashboard_id), current_user, db)
    item_key = str(payload.get("item_key") or "")
    if not item_key:
        raise HTTPException(400, "缺少 item_key")
    try:
        doc = validate_doc(row.doc)
        return renderer.render_overlay(
            db, doc, current_user,
            item_key=item_key,
            params=payload.get("params") or {},
            action_params=payload.get("action_params") or {},
            view_key=payload.get("view"),
            trigger=str(payload.get("trigger") or "primary"),
        )
    except Exception as exc:
        raise _guard(exc) from exc
