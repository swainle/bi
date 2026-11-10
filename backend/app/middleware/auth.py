"""认证中间件 —— JWT 依赖注入."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """从 JWT Token 中提取当前用户.

    Args:
        credentials: HTTP Bearer Token 凭证.
        db: 数据库会话.

    Returns:
        当前登录的 User 对象.

    Raises:
        HTTPException 401: Token 无效或已过期.
    """
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无法验证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = int(user_id_str)
        token_ver = payload.get("ver", 0)
    except JWTError:
        raise credentials_exception

    # Redis 缓存：先查缓存，未命中再查 DB
    from app.services.cache import cache_get, cache_set, cache_delete
    cache_key = f"user:{user_id}"
    cached = cache_get(cache_key)
    if cached:
        cached_ver = cached.get("token_version", 0)
        if cached_ver == token_ver:
            return _dict_to_user(cached, db)
        # 缓存版本过期（其他设备登录了）→ 删除缓存，回退 DB 查询
        cache_delete(cache_key)

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    # 验证 token_version
    if (user.token_version or 0) != token_ver:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号已在其他设备登录，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 缓存 10 分钟（含 token_version）
    cache_set(cache_key, {"id": user.id, "username": user.username, "role": user.role, "is_active": user.is_active, "token_version": user.token_version or 0}, 600)
    return user


def _dict_to_user(data: dict, db: Session) -> User:
    """从缓存字典重建 User 对象（不持久化到会话，避免冲突）."""
    from app.models.user import User as UserModel
    u = db.query(UserModel).filter(UserModel.id == data["id"]).first()
    return u if u else UserModel(**data)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        HTTPBearer(auto_error=False)
    ),
    db: Session = Depends(get_db),
) -> User | None:
    """可选的用户认证 —— 不强制要求登录，但如果有 Token 则解析.

    Args:
        credentials: HTTP Bearer Token 凭证（可选）.
        db: 数据库会话.

    Returns:
        User 对象或 None.
    """
    if credentials is None:
        return None

    try:
        payload = jwt.decode(
            credentials.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id_str = payload.get("sub")
        if user_id_str is None:
            return None
        user_id = int(user_id_str)
        token_ver = payload.get("ver", 0)
        user = db.query(User).filter(User.id == user_id).first()
        if not user or (user.token_version or 0) != token_ver:
            return None
        return user
    except JWTError:
        return None
