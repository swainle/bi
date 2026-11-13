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
    POST   /api/bi/sources/upload         上传 CSV / Excel / JSON
    GET    /api/bi/sources/files          已接入表（含文件上传）
    DELETE /api/bi/sources/files/{id}     移除已接入表
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.sources import repository as repo

router = APIRouter(prefix="/bi/sources", tags=["BI数据源"])


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, repo.SourceError):
        return HTTPException(400, str(exc))
    return HTTPException(400, f"数据源操作失败：{str(exc)[:200]}")


@router.get("")
def list_sources(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"sources": repo.list_sources(db)}


@router.post("")
def create_source(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return repo.create_source(db, payload, current_user.id)
    except Exception as exc:
        raise _guard(exc) from exc


@router.patch("/{source_id}")
def update_source(
    source_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return repo.update_source(db, source_id, payload)
    except Exception as exc:
        raise _guard(exc) from exc


@router.delete("/{source_id}")
def delete_source(
    source_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return repo.delete_source(db, source_id)
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/test")
def test_payload(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """新建对话框的「测试连接」：不落库、不产生临时数据源."""
    try:
        return repo.test_payload(payload)
    except Exception as exc:
        raise _guard(exc) from exc


@router.post("/{source_id}/test")
def test_source(
    source_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    src = repo.get_source(db, source_id)
    if src is None:
        raise HTTPException(404, "数据源不存在")
    try:
        return repo.test_source(src)
    except Exception as exc:
        raise _guard(exc) from exc


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


@router.post("/{source_id}/sync")
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


@router.post("/{source_id}/schema-check")
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


@router.post("/files/{table_id}/resync")
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


@router.patch("/files/{table_id}/schedule")
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


@router.post("/sync/due")
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


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(400, "文件太大（上限 200MB）")
    try:
        return repo.import_file(db, content, file.filename or "upload.csv", current_user.id)
    except Exception as exc:
        raise _guard(exc) from exc


@router.get("/files")
def list_files(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"tables": repo.list_source_tables(db)}


@router.delete("/files/{table_id}")
def drop_file(
    table_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return repo.drop_source_table(db, table_id)
    except Exception as exc:
        raise _guard(exc) from exc
