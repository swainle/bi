"""BI 引擎 · 数据集版本、告警与指标（/datasets、/alerts、/metrics、/monitor）。"""

from __future__ import annotations

from app.timezone import china_now, time_text

from fastapi import Depends, HTTPException, Query, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.query.table_catalog import BUILTIN_TABLES, is_queryable

from fastapi import APIRouter

router = APIRouter()

@router.get("/datasets/versions/{table}")
def list_dataset_versions(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出数据集的版本快照"""
    rows = db.execute(text(
        "SELECT id, version_name, row_count, created_at FROM bi_dataset_versions WHERE table_name=:t ORDER BY id DESC LIMIT 20"
    ), {"t": table}).fetchall()
    return {"versions": [{"id": r[0], "name": r[1], "rows": r[2], "created_at": time_text(r[3])} for r in rows]}


@router.post("/datasets/snapshot/{table}")
def create_dataset_snapshot(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建数据集快照"""
    if not is_queryable(table):
        raise HTTPException(404)
    count = db.execute(text(f"SELECT count(*) FROM {table}")).scalar()
    db.execute(text(
        "INSERT INTO bi_dataset_versions (table_name, version_name, row_count, snapshot_data) VALUES (:t, :v, :c, (SELECT json_agg(t.*) FROM (SELECT * FROM :tbl) t)::text)"
    ), {"t": table, "v": f"{table}_v{int(__import__('time').time())}"})
    db.commit()
    return {"table": table, "row_count": count, "snapshot_id": "created"}


@router.get("/alerts")
def list_alerts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT id, name, table_name, metric_col, operator, threshold, enabled, last_triggered FROM bi_alerts WHERE owner_id=:uid ORDER BY id DESC"
    ), {"uid": current_user.id}).fetchall()
    return {"alerts": [dict(r._mapping) for r in rows]}


@router.post("/alerts")
def create_alert(payload: dict = Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(text(
        "INSERT INTO bi_alerts (name, table_name, metric_col, operator, threshold, enabled, owner_id) VALUES (:n,:t,:m,:op,:th,:en,:uid)"
    ), {"n": payload["name"], "t": payload["table_name"], "m": payload["metric_col"], "op": payload.get("operator", ">"), "th": payload["threshold"], "en": payload.get("enabled", True), "uid": current_user.id})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": payload["name"]}


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM bi_alerts WHERE id=:id AND owner_id=:uid"), {"id": alert_id, "uid": current_user.id})
    db.commit()
    return {"deleted": True}


@router.post("/alerts/check")
def check_alerts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    alerts = db.execute(text(
        "SELECT id, name, table_name, metric_col, operator, threshold FROM bi_alerts WHERE enabled=true AND owner_id=:uid"
    ), {"uid": current_user.id}).fetchall()
    triggered = []
    for a in alerts:
        try:
            val = db.execute(text(f"SELECT {a[3]}({a[4]}) FROM {a[2]}")).scalar() or 0
            op, th = a[4], a[5]
            hit = (op == ">" and val > th) or (op == "<" and val < th) or (op == "=" and val == th)
            if hit:
                db.execute(text("UPDATE bi_alerts SET last_triggered=NOW() WHERE id=:id"), {"id": a[0]})
                triggered.append({"id": a[0], "name": a[1], "value": val, "threshold": th, "operator": op})
        except Exception:
            pass
    db.commit()
    return {"triggered": triggered, "total_checked": len(alerts)}


@router.get("/monitor")
def system_monitor(current_user: User = Depends(get_current_user)):
    import psutil, os
    cpu = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    pg_version = ""
    try:
        from app.database import engine
        with engine.connect() as conn:
            pg_version = conn.execute(text("SELECT version()")).scalar()
    except Exception:
        pass
    return {
        "cpu_percent": cpu,
        "memory": {"total_gb": round(mem.total / 1e9, 1), "used_gb": round(mem.used / 1e9, 1), "percent": mem.percent},
        "disk": {"total_gb": round(disk.total / 1e9, 1), "free_gb": round(disk.free / 1e9, 1), "percent": disk.percent},
        "pg_version": pg_version.split(",")[0] if pg_version else "unknown",
    }


@router.post("/metrics/execute/{metric_id}")
def execute_metric(metric_id: int, payload: dict = Body(...),
                   current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    row = db.execute(text("SELECT formula FROM bi_metrics WHERE id=:id"), {"id": metric_id}).fetchone()
    if not row: raise HTTPException(404, "指标不存在")
    # 落库前已校验；执行前再校验一次，防止历史脏数据 / 手工 SQL 写入绕过
    from app.semantic.validator import SemanticError, validate_metric_expression

    try:
        formula = validate_metric_expression(str(row[0] or ""))
    except SemanticError as exc:
        raise HTTPException(400, f"指标公式不合法：{exc}") from exc
    table = payload.get("table", "")
    if not is_queryable(table): raise HTTPException(404, f"表 {table} 不是可访问的业务表")
    try:
        result = db.execute(text(f"SELECT {formula} AS result FROM {table}")).scalar()
        return {"metric_id": metric_id, "formula": formula, "table": table, "result": result}
    except Exception as e:
        raise HTTPException(400, f"公式执行错误: {str(e)}")


@router.get("/metrics")
def list_metrics(category: str = Query(default=""), db: Session = Depends(get_db)):
    query = "SELECT id, name, formula, description, category, business_line FROM bi_metrics"
    params = {}
    if category: query += " WHERE category = :cat"; params["cat"] = category
    query += " ORDER BY id DESC"
    rows = db.execute(text(query), params).fetchall()
    return {"metrics": [dict(r._mapping) for r in rows], "categories": ["财务", "运营", "销售", "通用"]}


@router.post("/metrics")
def create_metric(payload: dict = Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 公式最终会被拼进 SELECT 执行，必须是「聚合表达式」：禁止子查询 / 写操作 / 危险函数
    from app.semantic.validator import SemanticError, validate_metric_expression

    try:
        formula = validate_metric_expression(str(payload.get("formula") or ""))
    except SemanticError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.execute(text("INSERT INTO bi_metrics (name, formula, description, category, business_line, owner_id) VALUES (:n,:f,:d,:c,:bl,:uid)"),
               {"n": payload["name"], "f": formula, "d": payload.get("description",""), "c": payload.get("category","通用"), "bl": payload.get("business_line","通用"), "uid": current_user.id})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": payload["name"]}
