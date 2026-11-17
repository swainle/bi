"""认证服务 —— 注册、登录、密码哈希、JWT 生成/验证、刷新令牌."""

from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt, JWTError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin


def hash_password(password: str) -> str:
    """对明文密码进行 bcrypt 哈希."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证明文密码与哈希是否匹配."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


def _create_token(user_id: int, token_version: int, expire_hours: int, token_type: str = "access") -> str:
    """生成 JWT Token（通用）."""
    expire = datetime.now(timezone.utc) + timedelta(hours=expire_hours)
    payload = {"sub": str(user_id), "exp": expire, "type": token_type, "ver": token_version}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, token_version: int = 0) -> str:
    """生成短期 access token (24h)."""
    return _create_token(user_id, token_version, settings.jwt_expire_hours, "access")


def create_refresh_token(user_id: int, token_version: int = 0) -> str:
    """生成长期 refresh token (7 days)."""
    return _create_token(user_id, token_version, 24 * 7, "refresh")


def verify_refresh_token(token: str, db: Session) -> int:
    """验证 refresh token 并返回 user_id.

    Raises:
        ValueError: token 无效、已过期、或已被新登录覆盖.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "refresh":
            raise ValueError("不是刷新令牌")
        user_id = int(payload.get("sub", 0))
        if not user_id:
            raise ValueError("无效令牌")
        # 验证 token_version：如果被其他设备登录覆盖，旧 refresh token 也失效
        token_ver = payload.get("ver", 0)
        user = db.query(User).filter(User.id == user_id).first()
        if not user or (user.token_version or 0) != token_ver:
            raise ValueError("账号已在其他设备登录，请重新登录")
        return user_id
    except JWTError as e:
        raise ValueError(f"令牌无效") from e


def register_user(db: Session, data: UserCreate) -> dict:
    """注册新用户 — 邮箱或手机号至少提供一个."""
    if db.query(User).filter(User.username == data.username).first():
        raise ValueError("用户名已被注册")
    if data.email:
        if db.query(User).filter(User.email == data.email).first():
            raise ValueError("邮箱已被注册")
    if data.phone:
        if db.query(User).filter(User.phone == data.phone).first():
            raise ValueError("手机号已被注册")

    department_id = int(getattr(data, "department_id", 0) or 0)
    if department_id:
        exists = db.execute(
            text("SELECT 1 FROM departments WHERE id = :id AND COALESCE(is_deleted, false) = false"),
            {"id": department_id},
        ).first()
        if not exists:
            raise ValueError("所选部门不存在，请重新选择")

    user = User(
        username=data.username,
        email=data.email or f"phone:{data.phone}@mingcebi.local",  # 仅有手机号时生成占位邮箱
        phone=data.phone,
        password_hash=hash_password(data.password),
        token_version=1,
        department_id=department_id or None,
        # 注册不自动生效：先进入待审批，管理员或该部门负责人通过后才能登录
        is_active=False,
        approval_status="pending",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "status": "pending",
        "message": "注册申请已提交，待部门负责人或管理员审批通过后即可登录",
    }


def login_user(db: Session, data: UserLogin) -> dict:
    """用户登录 — 支持邮箱/手机号/用户名任意一种 + 密码.

    Args:
        db: 数据库会话.
        data: 登录请求数据.

    Returns:
        包含用户信息和 Token 的字典.

    Raises:
        ValueError: 账号或密码错误.
    """
    account = data.account.strip()

    # 依次尝试：邮箱 → 手机号 → 用户名
    user = None
    if "@" in account:
        user = db.query(User).filter(User.email == account).first()
    elif account.isdigit() and len(account) >= 11:
        # 优先手机号匹配，找不到再试用户名（兼容纯数字用户名）
        user = db.query(User).filter(User.phone == account).first()
        if not user:
            user = db.query(User).filter(User.username == account).first()
    if not user:
        user = db.query(User).filter(User.username == account).first()

    if not user:
        raise ValueError("账号或密码错误")
    # 先验密码再报账号状态：避免用错误密码探测「这个账号存在且被禁/待审批」
    if not verify_password(data.password, user.password_hash):
        raise ValueError("账号或密码错误")
    approval = (getattr(user, "approval_status", "") or "approved").strip() or "approved"
    if approval == "pending":
        raise ValueError("注册申请待审批，审批通过后即可登录")
    if approval == "rejected":
        reason = (getattr(user, "reject_reason", "") or "").strip()
        raise ValueError("注册申请未通过" + (f"：{reason}" if reason else ""))
    if not user.is_active:
        raise ValueError("账号已被停用")

    # 每次登录递增 token_version，使旧 token 失效（单设备登录）
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)

    # 清除 Redis 用户缓存，使新 token_version 立即生效
    try:
        from app.services.cache import cache_delete
        cache_delete(f"user:{user.id}")
    except Exception:
        pass

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role or "user",
        "access_token": create_access_token(user.id, user.token_version),
        "refresh_token": create_refresh_token(user.id, user.token_version),
    }


def get_current_user_info(user: User) -> dict:
    """获取当前用户信息."""
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "created_at": user.created_at.isoformat(),
    }


def update_profile(db: Session, user_id: int, data: dict) -> User:
    """更新用户资料."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError("用户不存在")

    if "username" in data and data["username"] and data["username"] != user.username:
        if db.query(User).filter(User.username == data["username"]).first():
            raise ValueError("用户名已被注册")
        user.username = data["username"]

    if "email" in data and data["email"] and data["email"] != user.email:
        if db.query(User).filter(User.email == data["email"]).first():
            raise ValueError("邮箱已被注册")
        user.email = data["email"]

    db.commit()
    db.refresh(user)
    return user


def change_password(db: Session, user_id: int, old_password: str, new_password: str) -> None:
    """修改密码."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError("用户不存在")

    if not verify_password(old_password, user.password_hash):
        raise ValueError("当前密码错误")

    user.password_hash = hash_password(new_password)
    db.commit()
