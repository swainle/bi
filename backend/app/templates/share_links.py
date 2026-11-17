"""明策BI分享链接服务 — 生成带过期的只读访问链接."""
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def generate_share_link(db: "Session", dashboard_id: int, user_id: int,
                        expires_hours: int = 168) -> dict:
    """生成 明策BI分享链接.

    Args:
        dashboard_id: 看板 ID
        user_id: 创建者 ID
        expires_hours: 过期时间（默认 7 天 = 168 小时）
    """
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_hours)

    # 存储分享记录（可复用 bi_team 表的 share 机制）
    share_data = {
        "token": token,
        "dashboard_id": dashboard_id,
        "created_by": user_id,
        "expires_at": expires_at.isoformat(),
        "view_count": 0,
    }

    return share_data


def validate_share_token(token: str, share_data: dict) -> bool:
    """验证分享链接是否有效."""
    if not share_data:
        return False

    expires_at = datetime.fromisoformat(share_data["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        return False

    return share_data["token"] == token
