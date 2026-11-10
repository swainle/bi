"""明策BI — 应用配置（pydantic-settings，环境变量优先）."""

import os
import secrets
from pathlib import Path

from pydantic_settings import BaseSettings

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _get_jwt_secret() -> str:
    """安全获取 JWT 密钥：环境变量 > 持久化文件 > 开发模式自动生成 > 生产模式报错."""
    env_secret = os.getenv("JWT_SECRET", "").strip()
    if env_secret and len(env_secret) >= 32:
        return env_secret

    secret_file = os.path.join(_PROJECT_ROOT, ".jwt_secret")
    if os.path.exists(secret_file):
        saved = open(secret_file).read().strip()
        if saved:
            return saved

    debug = os.getenv("DEBUG", "true").lower() in ("true", "1", "yes")
    if debug:
        random_key = secrets.token_urlsafe(64)
        with open(secret_file, "w") as f:
            f.write(random_key)
        os.chmod(secret_file, 0o600)
        print(f"[mingzebi] 未设置 JWT_SECRET，已生成开发密钥 → {secret_file}")
        return random_key

    raise RuntimeError(
        "生产环境必须设置 JWT_SECRET（>=32 字符）：\n"
        '  export JWT_SECRET="$(python3 -c \'import secrets; print(secrets.token_urlsafe(64))\')"'
    )


class Settings(BaseSettings):
    """明策BI 全局配置."""

    app_name: str = "明策BI"
    app_version: str = "1.0.0"

    project_root: str = _PROJECT_ROOT

    # 数据库：PostgreSQL（BI 依赖 jsonb / 窗口函数，不推荐 SQLite）
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://mingzebi:mingzebi@127.0.0.1:5432/mingzebi",
    )

    # JWT
    jwt_secret: str = _get_jwt_secret()
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    # 上传 / 导出目录
    upload_dir: str = os.path.join(_PROJECT_ROOT, "uploads")
    max_upload_size_mb: int = 200

    # 初始化脚本目录
    schema_dir: str = os.path.join(_PROJECT_ROOT, "schema")

    # 默认管理员（首次初始化时创建）
    admin_username: str = os.getenv("ADMIN_USERNAME", "admin")
    admin_password: str = os.getenv("ADMIN_PASSWORD", "")
    admin_email: str = os.getenv("ADMIN_EMAIL", "admin@mingzebi.local")

    # 调试 / 日志
    debug: bool = os.getenv("DEBUG", "true").lower() in ("true", "1", "yes")
    db_echo: bool = False

    # CORS
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]

    # LLM（AI 生成看板 / 自然语言转 SQL）
    llm_api_base: str = os.getenv("LLM_API_BASE", "https://api.deepseek.com")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "deepseek-chat")

    # Redis（可选：布局缓存、限流、元数据缓存）
    redis_url: str = os.getenv("REDIS_URL", "")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


settings = Settings()
