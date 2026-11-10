"""用户相关 Schema."""

from datetime import datetime

from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    """用户注册请求 — 邮箱或手机号至少填一个."""

    username: str = Field(..., min_length=2, max_length=50, description="用户名")
    email: Optional[EmailStr] = Field(default=None, description="邮箱（与手机号至少填一个）")
    phone: Optional[str] = Field(default=None, min_length=11, max_length=20, description="手机号（与邮箱至少填一个）")
    password: str = Field(..., min_length=6, max_length=128, description="密码（至少6位）")

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        """密码至少6位，且必须包含大小写字母和数字."""
        if len(v) < 6:
            raise ValueError("密码至少需要6位")
        if not any(c.islower() for c in v):
            raise ValueError("密码必须包含至少一个小写字母")
        if not any(c.isupper() for c in v):
            raise ValueError("密码必须包含至少一个大写字母")
        if not any(c.isdigit() for c in v):
            raise ValueError("密码必须包含至少一个数字")
        return v

    @field_validator("phone")
    @classmethod
    def phone_or_email_required(cls, v: Optional[str], info) -> Optional[str]:
        """校验手机号或邮箱至少提供一个."""
        email = info.data.get("email") if hasattr(info, "data") else None
        if not v and not email:
            raise ValueError("邮箱和手机号至少填写一个")
        if v and not v.isdigit():
            raise ValueError("手机号必须为数字")
        return v


class UserLogin(BaseModel):
    """用户登录请求 — 支持邮箱/手机号/用户名."""

    account: str = Field(..., min_length=1, description="邮箱 / 手机号 / 用户名")
    password: str = Field(..., min_length=1, description="密码")


class UserResponse(BaseModel):
    """用户信息响应."""

    id: int
    username: str
    email: str
    role: str = "user"
    is_active: bool = True
    avatar_url: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    """认证响应（含 access_token + refresh_token）."""

    id: int
    username: str
    email: str
    role: str = "user"
    avatar_url: Optional[str] = None
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

    model_config = {"from_attributes": True}


class RefreshRequest(BaseModel):
    """刷新 token 请求."""

    refresh_token: str = Field(..., min_length=1, description="刷新令牌")


class ProfileUpdate(BaseModel):
    """更新个人资料请求."""

    username: Optional[str] = Field(default=None, min_length=2, max_length=50, description="新用户名")
    email: Optional[str] = Field(default=None, description="新邮箱")


class DeleteAccountRequest(BaseModel):
    """注销账号请求."""

    password: str = Field(..., min_length=1, description="密码确认")


class PasswordChange(BaseModel):
    """修改密码请求."""

    old_password: str = Field(..., min_length=1, description="当前密码")
    new_password: str = Field(..., min_length=6, max_length=128, description="新密码（至少6位，需含大小写字母+数字）")

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        """密码至少6位，且必须包含大小写字母和数字."""
        if len(v) < 6:
            raise ValueError("密码至少需要6位")
        if not any(c.islower() for c in v):
            raise ValueError("密码必须包含至少一个小写字母")
        if not any(c.isupper() for c in v):
            raise ValueError("密码必须包含至少一个大写字母")
        if not any(c.isdigit() for c in v):
            raise ValueError("密码必须包含至少一个数字")
        return v
