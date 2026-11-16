"""明策BI — 应用配置（pydantic-settings，环境变量优先）."""

import os
import secrets
from pathlib import Path

from pydantic import model_validator
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
    # 不内置默认口令：未配置时由 _require_database_url 给出明确报错
    database_url: str = os.getenv("DATABASE_URL", "")

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

    # 错误上报（Sentry / 自建 GlitchTip）；dsn 为空 = 不启用
    sentry_dsn: str = os.getenv("SENTRY_DSN", "")
    sentry_environment: str = os.getenv("SENTRY_ENVIRONMENT", "production")
    sentry_traces_sample_rate: float = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE") or 0)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @model_validator(mode="after")
    def _require_database_url(self):
        """数据库连接串必须显式配置，不允许静默使用内置弱口令。"""
        if not (self.database_url or "").strip():
            raise ValueError(
                "未配置 DATABASE_URL。\n"
                "  请在 backend/.env 中填写（参考 backend/.env.example）：\n"
                "    DATABASE_URL=postgresql://<用户>:<口令>@<主机>:5432/<库名>\n"
                "  出于安全考虑，代码不再内置默认数据库口令。"
            )
        return self

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


settings = Settings()
