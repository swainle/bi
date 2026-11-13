"""查询契约 API —— 前端只描述意图，SQL 由服务端生成.

端点：
    POST /api/bi/query/run          同步执行
    POST /api/bi/query/async        提交异步任务
    GET  /api/bi/query/jobs/{id}    轮询任务
    GET  /api/bi/query/jobs         任务统计
    POST /api/bi/query/cancel/{id}  取消正在执行的查询
    POST /api/bi/query/jobs/{id}/cancel  取消异步任务
    GET  /api/bi/query/slow         最近的慢查询（管理员）
    GET  /api/bi/query/grains       支持的粒度

安全：白名单 + 行级权限 + 参数绑定 + 列脱敏，全部在 app/query 与 app/security 内完成。
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.query import async_jobs, running, slowlog
from app.query.contract import QueryObject
from app.query.executor import run as execute_query
from app.query.grain import supported_grains
from app.query.whitelist import ALLOWED_TABLES
from app.security.errors import RlsBlockedError, SecurityError

router = APIRouter(prefix="/bi/query", tags=["BI查询契约"])


def _parse(payload: dict) -> QueryObject:
    try:
        return QueryObject(**payload)
    except ValidationError as exc:
        detail = exc.errors()[0].get("msg", "参数不合法") if exc.errors() else "参数不合法"
        raise HTTPException(400, f"查询参数不合法：{detail}") from exc
    except ValueError as exc:
        raise HTTPException(400, f"查询参数不合法：{exc}") from exc


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SecurityError):
        return HTTPException(exc.http_status, exc.message)
    if isinstance(exc, ValueError):
        return HTTPException(400, str(exc))
    return HTTPException(400, f"查询失败：{str(exc)[:200]}")


@router.post("/run")
def run_query(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """按 QueryObject 执行一次查询."""
    query = _parse(payload)
    try:
        result = execute_query(db, query, current_user, allowed_tables=ALLOWED_TABLES)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    except Exception as exc:
        raise _http_error(exc) from exc

    return {
        "sql": result.sql,
        "columns": result.columns,
        "rows": result.rows,
        "count": result.count,
        "elapsed_ms": result.elapsed_ms,
        "rls": result.rls,
        # 取消这条查询用：POST /bi/query/cancel/{query_id}
        "query_id": result.query_id,
    }


@router.post("/async")
def run_query_async(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """提交异步查询，立即返回 job_id."""
    query = _parse(payload)
    try:
        job = async_jobs.submit(query, current_user.id, getattr(current_user, "role", ""))
    except SecurityError as exc:
        raise HTTPException(429 if "队列" in exc.message else exc.http_status, exc.message) from exc
    return {"job_id": job.id, "state": job.state}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    """轮询任务状态；done 时带完整结果."""
    job = async_jobs.STORE.get(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在或已过期")
    return job.to_dict()


@router.get("/jobs")
def job_stats():
    return async_jobs.stats()


@router.post("/cancel/{query_id}")
def cancel_query(query_id: str, current_user: User = Depends(get_current_user)):
    """取消一条正在执行的查询（数据库端打断，只能取消自己的；管理员不限）."""
    try:
        return running.cancel(query_id, current_user)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, current_user: User = Depends(get_current_user)):
    """取消异步任务：正在执行的杀死 SQL，排队中的标记后由 worker 跳过."""
    job = async_jobs.STORE.get(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在或已过期")
    role = current_user.role or ""
    if role not in ("admin", "super_admin") and job.user_id and job.user_id != current_user.id:
        raise HTTPException(403, "只能取消自己的任务")
    try:
        return running.cancel(job_id, current_user)
    except LookupError:
        pass  # 还没开始执行 → 走下面的排队取消
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    if async_jobs.jobqueue.mark_cancel(job_id):
        async_jobs.STORE.mark_failed(job_id, "任务已被用户取消")
        return {"job_id": job_id, "state": "cancelled", "cancelled": True}
    raise HTTPException(409, "任务已经结束或还没开始执行")


@router.get("/slow")
def list_slow_queries(limit: int = 50, current_user: User = Depends(get_current_user)):
    """最近的慢查询采样（管理员），用于排查哪张卡/哪个数据集在拖慢看板."""
    if (current_user.role or "") not in ("admin", "super_admin"):
        raise HTTPException(403, "只有管理员可以查看慢查询")
    return {"items": slowlog.recent(limit), "threshold_ms": slowlog.threshold_ms()}


@router.get("/grains")
def list_grains():
    return {"grains": supported_grains(), "default": None}
