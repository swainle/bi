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
    """异步写入审计日志（不阻塞请求）"""
    try:
        db = SessionLocal()
        db.execute(text("""
            INSERT INTO bi_audit_logs (user_id, action, resource_type, resource_id, detail, ip)
            VALUES (:uid, :action, :rtype, :rid, CAST(:detail AS jsonb), :ip)
        """), {
            "uid": user_id,
            "action": action,
            "rtype": resource_type,
            "rid": resource_id,
            "detail": json.dumps(detail or {}),
            "ip": ip,
        })
        db.commit()
    except Exception:
        pass  # 审计失败不影响正常业务
    finally:
        db.close()
