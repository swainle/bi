# middleware/audit.py — 操作审计中间件
"""异步记录用户操作到 bi_audit_logs 表"""
import json
import time
from sqlalchemy import text
from app.database import SessionLocal

def log_audit(
    user_id: int,
    action: str,
    resource_type: str,
    resource_id: int = 0,
    detail: dict = None,
    ip: str = "",
):
    """异步写入审计日志（不阻塞请求）；自动带上请求 IP / UA / 指纹."""
    try:
        from app.middleware.audit_context import get_request_meta

        meta = get_request_meta()
        db = SessionLocal()
        db.execute(text("""
            INSERT INTO bi_audit_logs
              (user_id, action, resource_type, resource_id, detail, ip, user_agent, fingerprint)
            VALUES (:uid, :action, :rtype, :rid, CAST(:detail AS jsonb), :ip, :ua, :fp)
        """), {
            "uid": user_id or None,  # 0 会撞 users 外键，系统级审计用 NULL
            "action": action,
            "rtype": resource_type,
            "rid": resource_id,
            "detail": json.dumps(detail or {}),
            "ip": ip or meta["ip"],
            "ua": meta["user_agent"],
            "fp": meta["fingerprint"],
        })
        db.commit()
    except Exception:
        pass  # 审计失败不影响正常业务
    finally:
        db.close()
