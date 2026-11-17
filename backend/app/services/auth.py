"""兼容垫片：认证服务已迁到 `app.auth.service`（B03）."""

from app.auth.service import (
    change_password,
    create_access_token,
    create_refresh_token,
    get_current_user_info,
    hash_password,
    login_user,
    register_user,
    update_profile,
    verify_password,
    verify_refresh_token,
)

__all__ = [
    "change_password",
    "create_access_token",
    "create_refresh_token",
    "get_current_user_info",
    "hash_password",
    "login_user",
    "register_user",
    "update_profile",
    "verify_password",
    "verify_refresh_token",
]
