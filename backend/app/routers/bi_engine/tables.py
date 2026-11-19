"""BI 引擎 · 表数据与导出（/tables、/data、/export、物化视图加速）。"""

from __future__ import annotations

from app.timezone import china_now, time_text

from fastapi import Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
import io
import openpyxl
from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.audit import log_audit
from app.models.user import User
from app.security.errors import RlsBlockedError
from app.security import watermark
from app.security.rls import decide as rls_decide, where_sql as rls_where
from app.admin.permissions import require
import time as _time
from app.query.table_catalog import BUILTIN_TABLES, is_queryable

from fastapi import APIRouter

router = APIRouter()

from .common import ACCEL_MAP, _BI_REPLICA_URL, _apply_masks, _cache, _cache_key, _get_read_db
from .templates import TEMPLATE_MAP

@router.get("/tables")
def list_tables(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """返回所有可用 BI 表及其列信息"""
    names = db.execute(text("SELECT table_name FROM information_schema.tables "
                            "WHERE table_schema = 'public' AND table_type IN ('BASE TABLE','VIEW')")).fetchall()
    tables = []
    for tbl in sorted(row[0] for row in names if is_queryable(row[0])):
        try:
            cols = db.execute(text(f"""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = :tbl AND table_schema = 'public'
                ORDER BY ordinal_position
            """), {"tbl": tbl}).fetchall()
            tables.append({
                "table": tbl,
                "columns": [{"name": c[0], "type": c[1]} for c in cols],
            })
        except Exception:
            tables.append({"table": tbl, "columns": [], "error": "unavailable"})
    return {"tables": tables, "templates": list(TEMPLATE_MAP.keys())}


def _use_accel(table: str, db: Session) -> tuple[str, bool]:
    """判断是否使用加速表。存在物化视图则返回(mv_name, True)。"""
    mv = ACCEL_MAP.get(table, "")
    if not mv:
        return table, False
    try:
        db.execute(text(f"SELECT 1 FROM {mv} LIMIT 1"))
        return mv, True
    except Exception:
        db.rollback()
        return table, False


@router.post("/accelerate/refresh")
def refresh_materialized_views(
    table: str = Query(default=""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """刷新物化视图。table 为空则刷新全部。"""
    refreshed = []
    targets = [table] if table else [t for t in BUILTIN_TABLES]
    for t in targets:
        mv = ACCEL_MAP.get(t, "")
        if not mv:
            continue
        try:
            t0 = _time.time()
            db.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}"))
            db.commit()
            elapsed = (_time.time() - t0) * 1000
            refreshed.append({"table": t, "view": mv, "elapsed_ms": round(elapsed, 1)})
        except Exception as e:
            refreshed.append({"table": t, "view": mv, "error": str(e)[:100]})
    return {"refreshed": refreshed, "count": len(refreshed)}


@router.get("/accelerate/status")
def accelerator_status(db: Session = Depends(get_db)):
    """查看加速引擎状态"""
    status = []
    for tbl, mv in ACCEL_MAP.items():
        try:
            raw = db.execute(text(f"SELECT count(*) FROM {tbl}")).scalar()
            agg = db.execute(text(f"SELECT count(*) FROM {mv}")).scalar()
            status.append({"table": tbl, "raw_rows": raw, "agg_rows": agg, "compression": f"{round((1-agg/raw)*100,1) if raw else 0}%"})
        except Exception:
            status.append({"table": tbl, "error": "unavailable"})
    return {"views": status, "total_views": len(ACCEL_MAP)}


_active_queries = 0


MAX_CONCURRENT = 20


@router.get("/data/{table}")
def get_table_data(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=500, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    cache: bool = Query(default=True),
    precomputed: bool = Query(default=True),
):
    """查询 BI 业务表数据。precomputed=true 自动走物化视图加速。"""
    if not is_queryable(table):
        raise HTTPException(status_code=404, detail=f"表 {table} 不是可访问的业务表")

    # 行级权限：先算结论（fail-closed）
    try:
        decision = rls_decide(db, table, current_user)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    rls_active = bool(decision.conditions)

    # 并发控制
    global _active_queries
    if _active_queries >= MAX_CONCURRENT:
        raise HTTPException(status_code=429, detail=f"查询并发已满（{_active_queries}/{MAX_CONCURRENT}），请稍后重试",
                          headers={"Retry-After": "5"})
    _active_queries += 1
    read_db = db  # 默认主库

    # 分布式读写分离：预计算查询走主库，原表查询可走副本
    if not precomputed and _BI_REPLICA_URL:
        read_db = _get_read_db()

    source_table = table
    # 有行级规则时禁止走物化视图（聚合视图里没有明细行，规则无法下推）
    if precomputed and not rls_active:
        source_table, used_accel = _use_accel(table, db)
    else:
        used_accel = False

    ck = _cache_key(source_table, limit, offset, rls=decision.fingerprint)
    if cache:
        cached = _cache.get(ck)
        if cached:
            _active_queries -= 1
            return cached

    try:
        t0 = _time.time()
        order_clause = "id" if table == source_table else "1"
        where_clause = rls_where(decision)
        where_sql_part = f" WHERE {where_clause}" if where_clause else ""
        rows = read_db.execute(
            text(f"SELECT * FROM {source_table}{where_sql_part} ORDER BY {order_clause} LIMIT :limit OFFSET :offset"),
            {"limit": limit, "offset": offset},
        ).fetchall()
        elapsed = (_time.time() - t0) * 1000
        if elapsed > 1000:
            import logging
            logging.getLogger("bi-engine").warning(f"慢查询: {source_table} ({elapsed:.0f}ms)")

        if not rows:
            result = {"table": source_table, "rows": [], "columns": [], "count": 0, "accelerated": used_accel}
        else:
            columns = list(rows[0]._mapping.keys())
            row_dicts = [dict(r._mapping) for r in rows]
            # 自动应用列脱敏
            row_dicts = _apply_masks(table, row_dicts, db)
            result = {
                "table": source_table,
                "rows": row_dicts,
                "columns": columns,
                "count": len(rows),
                "accelerated": used_accel,
                "elapsed_ms": round(elapsed, 1),
            }
        if rls_active:
            result["rls"] = True
        if cache:
            _cache.set(ck, result, table_dep=table)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _active_queries -= 1
        if read_db != db:
            read_db.close()


@router.get("/export/{table}")
def export_excel(
    table: str,
    request: Request,
    current_user: User = Depends(require("bi:data:export:detail", "没有明细导出权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """导出 BI 表数据为 Excel（需要明细导出权限）"""
    if not is_queryable(table):
        raise HTTPException(status_code=404, detail=f"表 {table} 不是可访问的业务表")

    # 行级权限：导出与查询必须同口径，否则「查不到但导出得到」就是漏洞
    try:
        decision = rls_decide(db, table, current_user)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    where_clause = rls_where(decision)
    where_sql_part = f" WHERE {where_clause}" if where_clause else ""

    # R4 组合风控：陌生设备 + 非工作时段 + 明细导出 → 告警（默认）/ 阻断（配置后）
    from app.middleware.audit_context import get_request_meta
    from app.security import guard

    meta = get_request_meta()
    verdict = guard.assess_sensitive_export(
        db, user=current_user, ip=meta.get("ip", ""), fp=meta.get("fingerprint", ""),
        table=table,
    )
    if verdict["blocked"]:
        raise HTTPException(403, "陌生设备在非工作时段导出明细，已被安全卫士拦截，请联系管理员")
    guard.observe_business("export_detail", ip=meta.get("ip", ""),
                           fp=meta.get("fingerprint", ""), user_id=current_user.id)

    try:
        # 不是所有业务表都有 id（如 bi_demo_sku）；没有 id 时不做排序，避免固定 ORDER BY id 直接 500。
        from app.query.column_types import column_types as _column_types

        order_sql = ' ORDER BY "id"' if "id" in _column_types(db, table) else ""
        rows = db.execute(text(f"SELECT * FROM {table}{where_sql_part}{order_sql}")).fetchall()
        if not rows:
            raise HTTPException(404, "无数据")

        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = table

        columns = list(rows[0]._mapping.keys())
        row_dicts = _apply_masks(table, [dict(r._mapping) for r in rows], db)
        # 水印身份化：导出人 / 部门 / 时间 / 请求号（导出文件外传后可回溯）
        info = watermark.identity(
            db, current_user,
            request_id=getattr(request.state, "request_id", "") or "",
            source="明细导出",
        )
        next_row = watermark.xlsx_stamp(ws, info, start_row=1, span=max(1, len(columns)))
        header_row = next_row + 1
        from openpyxl.styles import Font

        for index, name in enumerate(columns, start=1):
            ws.cell(row=header_row, column=index, value=name).font = Font(bold=True)
        for offset, r in enumerate(row_dicts, start=header_row + 1):
            for index, name in enumerate(columns, start=1):
                ws.cell(row=offset, column=index, value=r[name])
        watermark.xlsx_header(ws, info)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        log_audit(current_user.id, "data.export.detail", "table", 0,
                  {"table": table, "rows": len(row_dicts), "request_id": info["request_id"]})
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={table}.xlsx"},
        )
    except ImportError:
        raise HTTPException(500, "openpyxl 未安装")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
