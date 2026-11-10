"""数据库初始化 — 建表、示例数据、默认管理员.

用法：
    python -m app.bootstrap            # 幂等：缺什么补什么
    python -m app.bootstrap --reset    # 先删库再重建（危险，仅开发）
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import inspect, text

from app.config import settings
from app.database import SessionLocal, engine


# ─────────────────────────── 基础工具 ───────────────────────────
def existing_tables() -> set[str]:
    return set(inspect(engine).get_table_names())


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _normalize(sql: str) -> str:
    """pg_dump 会清空 search_path（会话级）；改回 public，避免连接池复用后建表失败。"""
    return sql.replace(
        "SELECT pg_catalog.set_config('search_path', '', false);",
        "SET search_path TO public;",
    )


def exec_sql_file(path: str) -> None:
    """整文件执行（psycopg2 支持多语句；含 $$ 函数体也安全）."""
    sql = _normalize(_read(path))
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(sql)
        raw.commit()
    finally:
        raw.close()


# ─────────────────────────── 建表 ───────────────────────────
def ensure_schema() -> bool:
    """核心表不存在时执行 schema.sql。返回是否执行了初始化。"""
    tables = existing_tables()
    if {"users", "bi_dashboards"} <= tables:
        return False

    schema_path = os.path.join(settings.schema_dir, "schema.sql")
    if not os.path.exists(schema_path):
        raise FileNotFoundError(f"找不到建表脚本：{schema_path}")

    print(f"[bootstrap] 初始化数据库结构 ← {schema_path}")
    try:
        exec_sql_file(schema_path)
    except Exception as e:
        msg = str(e)
        if "extension" in msg.lower() and "vector" in msg.lower():
            raise RuntimeError(
                "数据库缺少 pgvector 扩展（AI 元数据知识库依赖 vector 列）。\n"
                "  macOS:  brew install pgvector\n"
                "  Linux:  apt install postgresql-16-pgvector\n"
                "  Docker: 使用镜像 pgvector/pgvector:pg16\n"
                f"  原始错误：{msg[:300]}"
            ) from e
        raise
    return True


def ensure_seed_data() -> bool:
    """示例数据为空时导入（13 张电商主题表）。"""
    try:
        db = SessionLocal()
        try:
            n = db.execute(text("SELECT COUNT(*) FROM bi_pdd_profit")).scalar()
        finally:
            db.close()
    except Exception:
        return False
    if n and n > 0:
        return False

    seed_path = os.path.join(settings.schema_dir, "seed.sql")
    if not os.path.exists(seed_path):
        return False
    print(f"[bootstrap] 导入示例数据 ← {seed_path}")
    exec_sql_file(seed_path)
    return True


# ─────────────────────────── 默认管理员 ─────────────────────────--
def ensure_admin() -> None:
    """无任何用户时创建管理员账号。"""
    from app.models.rbac import Role
    from app.models.user import User
    from app.services.auth import hash_password

    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return

        password = settings.admin_password or "Admin@123456"
        user = User(
            username=settings.admin_username,
            email=settings.admin_email,
            password_hash=hash_password(password),
            role="admin",
            is_active=True,
        )
        db.add(user)
        db.flush()

        # 绑定所有系统角色（含 admin）
        roles = db.query(Role).all()
        if roles:
            user.roles = roles
        db.commit()

        print(
            "\n" + "=" * 62 + "\n"
            f"  已创建默认管理员：{settings.admin_username} / {password}\n"
            "  请立即登录后在「个人设置」中修改密码。\n"
            + "=" * 62 + "\n"
        )
    except Exception as e:
        db.rollback()
        print(f"[bootstrap] 创建管理员失败：{e}")
    finally:
        db.close()


def ensure_rbac_seed() -> None:
    """写入权限/角色种子（幂等）。"""
    try:
        from app.services.rbac_seed import seed_permissions, seed_roles

        db = SessionLocal()
        try:
            seed_permissions(db)
            seed_roles(db)
            db.commit()
        finally:
            db.close()
    except Exception as e:  # 种子失败不阻塞启动
        print(f"[bootstrap] RBAC 种子跳过：{e}")


def init_all() -> None:
    """完整初始化（幂等）."""
    ensure_schema()
    ensure_rbac_seed()
    ensure_seed_data()
    ensure_admin()


if __name__ == "__main__":
    if "--reset" in sys.argv and os.getenv("ALLOW_RESET") == "1":
        raw = engine.raw_connection()
        try:
            cur = raw.cursor()
            cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            raw.commit()
        finally:
            raw.close()
        print("[bootstrap] schema 已重置")
    init_all()
    print("[bootstrap] 完成")
