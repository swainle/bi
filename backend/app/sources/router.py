"""数据源 API —— Superset 的 Database 层.

    GET    /api/bi/sources                数据源列表
    POST   /api/bi/sources                新建
    PATCH  /api/bi/sources/{id}           修改
    DELETE /api/bi/sources/{id}           删除（连带已同步表，有数据集引用则拒绝）
    POST   /api/bi/sources/{id}/test      测连通
    GET    /api/bi/sources/{id}/tables    源库表清单
    POST   /api/bi/sources/{id}/sync      选表同步成本地物理表
    POST   /api/bi/sources/{id}/schema-check  检查已接入表的字段是否变了
    POST   /api/bi/sources/files/{id}/resync  重新同步单张表
    POST   /api/bi/sources/files/{id}/sync-metadata  同步源库注释到本地表
    POST   /api/bi/sources/upload         上传 CSV / Excel / JSON
    GET    /api/bi/sources/files          已接入表（含文件上传）
    DELETE /api/bi/sources/files/{id}     移除已接入表
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.audit import log_audit
from app.security.nav_guard import require_nav
from app.middleware.auth import get_current_user
from app.models.user import User
from app.sources import repository as repo
from app.sources import types_catalog

router = APIRouter(prefix="/bi/sources", tags=["BI数据源"])


@router.get("/import-jobs", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def list_import_jobs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.sources import import_jobs

    return {"jobs": import_jobs.list_jobs(db, current_user.id), "active_tables": import_jobs.active_tables(db)}


@router.post("/{source_id}/import-jobs", status_code=202,
             dependencies=[Depends(require_nav("bi:nav:datasources"))])
def create_import_job(source_id: int, payload: dict = Body(...),
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.sources import import_jobs

    try:
        job_id = import_jobs.create(db, source_id, payload.get("tables"), current_user.id)
    except import_jobs.ImportConflict as exc:
        db.rollback()
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise _guard(exc) from exc
    return {"job_id": job_id}


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, repo.SourceError):
        return HTTPException(400, str(exc))
    return HTTPException(400, f"数据源操作失败：{str(exc)[:200]}")


@router.get("/types")
def list_source_types(
    current_user: User = Depends(get_current_user),
):
    """数据源类型清单（唯一事实来源：`sources/types_catalog.py`）.

    驱动没装的类型也会返回，但 `available=false` 且带 `reason`，
    前端据此置灰，避免「界面能选、点了报不支持」。
    """
    return {"types": types_catalog.list_types()}


# 数据源连通性缓存：值 = {ok, message, at}；进页面探一次，短时间重复进入不再连源库
_STATUS_TTL = 30.0
_status_cache: dict[int, dict] = {}


@router.get("/status")
def sources_status(
    refresh: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """数据源连通性（列表名称旁的小圆点：绿=连得上 / 红=连不上）.

    只读探测，30 秒内复用结果；点圆点传 refresh=1 立即重探。失败原文给 tooltip，
    不改库、不写审计。
    """
    items = repo.list_sources(db)
    if not items:
        return {"status": {}}

    now = time.time()
    need = [
        s for s in items
        if refresh
        or int(s["id"]) not in _status_cache
        or now - _status_cache[int(s["id"])]["at"] >= _STATUS_TTL
    ]
    # 取配置放在主线程（Session 不能跨线程用），线程里只做网络 I/O
    jobs: list[tuple[int, dict]] = []
    for item in need:
        src = repo.get_source(db, int(item["id"]))
        if src is not None:
            jobs.append((int(item["id"]), src))

    def probe(job: tuple[int, dict]) -> tuple[int, bool, str]:
        source_id, src = job
        try:
            repo.test_source(src)
            return source_id, True, "连接正常"
        except Exception as exc:  # 网络 / 驱动 / 认证失败都归到红点，压成一句给 tooltip
            return source_id, False, repo.clean_probe_error(exc)

    if jobs:
        with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
            for source_id, ok, message in pool.map(probe, jobs):
                _status_cache[source_id] = {"ok": ok, "message": message, "at": time.time()}

    return {"status": {
        str(s["id"]): {
            "ok": _status_cache[int(s["id"])]["ok"],
            "message": _status_cache[int(s["id"])]["message"],
            "checked_at": int(_status_cache[int(s["id"])]["at"]),
        }
        for s in items if int(s["id"]) in _status_cache
    }}


@router.get("")
def list_sources(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"sources": repo.list_sources(db)}


@router.post("", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def create_source(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.semantic.access import validate_dept_choice

    payload = dict(payload)
    payload["dept_id"] = validate_dept_choice(db, payload.get("dept_id"), current_user)
    try:
        created = repo.create_source(db, payload, current_user.id)
    except Exception as exc:
        raise _guard(exc) from exc
    log_audit(current_user.id, "source.create", "source", int(created.get("id") or 0),
              {"name": created.get("name"), "type": created.get("ds_type")})
    return created


@router.patch("/{source_id}", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def update_source(
    source_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current = repo.get_source(db, source_id)
    if current is None:
        raise HTTPException(404, "数据源不存在")
    payload = dict(payload or {})
    if "dept_id" in payload:
        from app.semantic.access import validate_dept_choice

        # 只有真的换部门才校验数据范围：原样提交不能被自己看不到的旧部门挡住
        if (payload.get("dept_id") or None) != (current.get("dept_id") or None):
            payload["dept_id"] = validate_dept_choice(db, payload.get("dept_id"), current_user)
    try:
        updated = repo.update_source(db, source_id, payload)
    except Exception as exc:
        raise _guard(exc) from exc
    # 地址 / 密码 / 账号可能变了：旧连通性结论立即作废
    _status_cache.pop(source_id, None)
    # 只记改了哪些键，绝不落密码/连接串
    log_audit(current_user.id, "source.update", "source", source_id,
              {"fields": sorted(k for k in (payload or {}) if "pass" not in k.lower())})
    return updated


@router.delete("/{source_id}")
def delete_source(
    source_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        result = repo.delete_source(db, source_id)
    except Exception as exc:
        raise _guard(exc) from exc
    _status_cache.pop(source_id, None)
    log_audit(current_user.id, "source.delete", "source", source_id, {})
    return result


@router.post("/test", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def test_payload(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """新建对话框的「测试连接」：不落库、不产生临时数据源."""
    try:
        return repo.test_payload(payload)
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{source_id}/test", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def test_source(
    source_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """测连通；带 body 时按「已存配置 + 本次修改」测 —— 编辑对话框不必重填密码."""
    src = repo.get_source(db, source_id)
    if src is None:
        raise HTTPException(404, "数据源不存在")
    overrides = payload or {}
    try:
        result = repo.test_source(repo.apply_source_overrides(src, overrides))
    except Exception as exc:
        # 只有测的是「已存配置」才更新列表圆点；编辑对话框里的临时配置不能污染它
        if not overrides:
            _status_cache[int(source_id)] = {
                "ok": False, "message": repo.clean_probe_error(exc), "at": time.time(),
            }
        raise _guard(exc) from exc
    if not overrides:
        _status_cache[int(source_id)] = {"ok": True, "message": "连接正常", "at": time.time()}
    return result


@router.get("/{source_id}/tables")
def remote_tables(
    source_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    src = repo.get_source(db, source_id)
    if src is None:
        raise HTTPException(404, "数据源不存在")
    try:
        return {"tables": repo.list_remote_tables(src)}
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{source_id}/sync", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def sync_tables(
    source_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    src = repo.get_source(db, source_id)
    if src is None:
        raise HTTPException(404, "数据源不存在")
    tables = [str(t).strip() for t in (payload.get("tables") or []) if str(t).strip()]
    try:
        result = repo.sync_tables(db, src, tables, current_user.id)
        return {"synced": result["tables"], "refresh": result["refresh"]}
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{source_id}/schema-check", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def check_schema(
    source_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """检查该数据源下所有已接入表的字段变更（只读源库结构，不重拉数据）."""
    src = repo.get_source(db, source_id)
    if src is None:
        raise HTTPException(404, "数据源不存在")
    try:
        return repo.check_source_schema(db, src)
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/files/{table_id}/resync", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def resync_table(
    table_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """重新同步单张已接入表（重拉数据 + 刷新结构快照）."""
    try:
        return repo.resync_table(db, table_id, current_user.id)
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/files/{table_id}/sync-metadata", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def sync_table_metadata(table_id: int, current_user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    try:
        return repo.sync_table_metadata(db, table_id)
    except Exception as exc:
        raise _guard(exc) from exc


@router.patch("/files/{table_id}/schedule", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def set_schedule(
    table_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """设置单表自动同步间隔（分钟，0 = 关闭）."""
    try:
        return repo.set_sync_interval(db, table_id, payload.get("interval_minutes", 0))
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/sync/due", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def sync_due(
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
):
    """立即跑一轮到期同步（手动触发 / 验证调度用，不占 advisory lock）."""
    from app.sources import sync_scheduler

    try:
        limit = int(payload.get("limit") or sync_scheduler.max_per_run())
    except (TypeError, ValueError):
        limit = sync_scheduler.max_per_run()
    return sync_scheduler.run_once(limit)


@router.post("/upload", dependencies=[Depends(require_nav("bi:nav:datasources"))])
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(400, "文件太大（上限 200MB）")
    try:
        result = repo.import_file(db, content, file.filename or "upload.csv", current_user.id)
    except Exception as exc:
        raise _guard(exc) from exc
    log_audit(current_user.id, "source.upload", "source_table", 0,
              {"filename": file.filename, "bytes": len(content),
               "local_table": result.get("local_table")})
    return result


@router.get("/files")
def list_files(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"tables": repo.list_source_tables(db)}


@router.delete("/files/{table_id}", dependencies=[Depends(require_nav("bi:nav:datasources"))])
def drop_file(
    table_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        result = repo.drop_source_table(db, table_id)
    except Exception as exc:
        raise _guard(exc) from exc
    log_audit(current_user.id, "source.file_delete", "source_table", table_id, {})
    return result
