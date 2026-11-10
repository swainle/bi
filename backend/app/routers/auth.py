"""认证路由 —— /api/auth/*."""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.csrf import generate_csrf_token, CSRF_COOKIE_NAME
from app.models.user import User
from app.schemas.common import ApiResponse
from app.schemas.user import (
    UserCreate, UserLogin, UserResponse, AuthResponse,
    ProfileUpdate, PasswordChange, RefreshRequest, DeleteAccountRequest,
)
from app.services import auth as auth_service

router = APIRouter()


@router.get("/csrf-token")
def get_csrf_token(request: Request):
    """获取 CSRF token — Double Submit Cookie 模式.

    后端生成随机 token，同时写入 HttpOnly=False cookie 和响应 body。
    前端从 cookie 读取 token，附加到后续请求的 X-CSRF-Token header。
    """
    token = generate_csrf_token()
    response = JSONResponse(content={"csrf_token": token})
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token,
        httponly=False,     # 前端 JS 需要读取
        samesite="lax",     # 防止跨站发送
        secure=False,       # 开发环境 http；生产环境应改为 True
        max_age=86400,      # 24 小时
        path="/",
    )
    return response


@router.post("/register", response_model=ApiResponse[AuthResponse])
def register(request: Request, data: UserCreate, db: Session = Depends(get_db)):
    """用户注册.

    Args:
        data: 注册数据（用户名、邮箱、密码）.
        db: 数据库会话.

    Returns:
        ApiResponse[AuthResponse]: 用户信息 + Token.

    Raises:
        409: 用户名或邮箱已被注册.
    """
    try:
        result = auth_service.register_user(db, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return ApiResponse(data=AuthResponse(**result))


@router.post("/login", response_model=ApiResponse[AuthResponse])
def login(request: Request, data: UserLogin, db: Session = Depends(get_db)):
    """用户登录.

    Args:
        data: 登录数据（用户名、密码）.
        db: 数据库会话.

    Returns:
        ApiResponse[AuthResponse]: 用户信息 + Token.

    Raises:
        401: 用户名或密码错误.
    """
    try:
        result = auth_service.login_user(db, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
    return ApiResponse(data=AuthResponse(**result))


@router.get("/me", response_model=ApiResponse[UserResponse])
def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息（需认证）.

    Args:
        current_user: 从 JWT 解析的当前用户.

    Returns:
        ApiResponse[UserResponse]: 当前用户信息.
    """
    return ApiResponse(data=UserResponse.model_validate(current_user))

@router.put("/profile", response_model=ApiResponse[UserResponse])
def update_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新个人资料（需认证）."""
    try:
        user = auth_service.update_profile(
            db, current_user.id, data.model_dump(exclude_unset=True, exclude_none=True)
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return ApiResponse(data=UserResponse.model_validate(user))


# 头像存储目录
AVATAR_DIR = Path("uploads/avatars")
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_AVATAR_SIZE = 15 * 1024 * 1024  # 15MB


@router.post("/avatar", response_model=ApiResponse[UserResponse])
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """上传个人头像（需认证）"""
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 JPG/PNG/WebP/GIF 格式")

    contents = await file.read()
    if len(contents) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="头像文件不能超过 15MB")

    # 删除旧头像文件
    if current_user.avatar_url:
        old_path = AVATAR_DIR / Path(current_user.avatar_url).name
        if old_path.exists():
            old_path.unlink()

    # 保存新头像
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    filename = f"{current_user.id}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = AVATAR_DIR / filename
    filepath.write_bytes(contents)

    # 更新数据库
    avatar_url = f"/uploads/avatars/{filename}"
    current_user.avatar_url = avatar_url
    db.commit()
    db.refresh(current_user)

    return ApiResponse(data=UserResponse.model_validate(current_user))


@router.put("/password", response_model=ApiResponse[dict])
def change_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """修改密码（需认证）."""
    try:
        auth_service.change_password(db, current_user.id, data.old_password, data.new_password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ApiResponse(data={}, message="密码已更新")


@router.post("/refresh", response_model=ApiResponse[dict])
def refresh_token(data: RefreshRequest, db: Session = Depends(get_db)):
    """刷新 access token — 使用 refresh_token 换取新的 access_token.

    Args:
        data: 包含 refresh_token 的请求体.
        db: 数据库会话.

    Returns:
        ApiResponse[dict]: 新的 access_token 和 refresh_token.

    Raises:
        401: refresh_token 无效或已过期.
    """
    try:
        user_id = auth_service.verify_refresh_token(data.refresh_token, db)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")

    return ApiResponse(data={
        "access_token": auth_service.create_access_token(user_id, user.token_version or 0),
        "refresh_token": auth_service.create_refresh_token(user_id, user.token_version or 0),
    })


@router.get("/quick-perms", response_model=ApiResponse[dict])
def my_quick_perms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """当前用户的快捷入口权限（含角色管理页配置的细粒度权限）."""
    import json
    # 1. 先检查 users.permissions JSON 字段（角色管理页配置）
    perms_json = current_user.permissions
    if perms_json:
        try:
            saved = json.loads(perms_json)
            return ApiResponse(data={
                "article": saved.get("write_article", True),
                "note": saved.get("notes", True),
                "file": saved.get("files", True),
                "ai_chat": saved.get("ai", True),
                "knowledge_base": saved.get("knowledge", True),
                "office": saved.get("office", True),
            })
        except Exception:
            pass
    # 2. 回退到 user_disabled_components 表
    from sqlalchemy import text as sa_text
    try:
        rows = db.execute(sa_text(
            "SELECT component_id FROM user_disabled_components WHERE user_id = :uid"
        ), {"uid": current_user.id}).fetchall()
        disabled = set(r[0] for r in rows)
    except Exception:
        disabled = set()
    return ApiResponse(data={
        "article": "article" not in disabled,
        "note": "note" not in disabled,
        "file": "file" not in disabled,
        "ai_chat": "ai_chat" not in disabled,
        "knowledge_base": "knowledge_base" not in disabled,
        "office": "office" not in disabled,
    })
