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


def ensure_migrations() -> list[str]:
    """执行 schema/migrations 下未应用的增量迁移（幂等）."""
    try:
        from app.schema_migrations import run_all
        from app.services.rbac_seed import seed_permissions

        # 授权迁移依赖权限码，必须先补定义；角色种子仍在迁移后执行。
        with SessionLocal() as db:
            seed_permissions(db)
        executed = run_all()
        if executed:
            print(f"[bootstrap] 已应用迁移：{', '.join(executed)}")
        return executed
    except Exception as e:  # 迁移失败必须让启动失败，否则后续查询会撞缺表
        raise RuntimeError(f"[bootstrap] 迁移失败：{e}") from e


def ensure_item_sources() -> int:
    """按现有看板文档重建「组件 → 数据源」账本（幂等，启动时跑一遍）."""
    from app.dashboards import sources

    db = SessionLocal()
    try:
        count = sources.backfill(db)
        if count:
            print(f"[bootstrap] 组件数据源账本已同步：{count} 行")
        return count
    finally:
        db.close()


def ensure_project_names() -> int:
    """把历史上没起名（就叫「未命名项目」）的看板按创建顺序补成 未命名项目01/02/03…（幂等）."""
    from sqlalchemy import text

    from app.dashboards.repository import UNTITLED, next_untitled_name

    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT id, name FROM bi_canvas WHERE deleted_at IS NULL AND name = :name "
                 "ORDER BY created_at ASC, id ASC"),
            {"name": UNTITLED},
        ).fetchall()
        if not rows:
            return 0
        renamed = 0
        for row in rows:
            db.execute(
                text("UPDATE bi_canvas SET name = :name WHERE id = :id"),
                {"name": next_untitled_name(db), "id": row[0]},
            )
            renamed += 1
        db.commit()
        print(f"[bootstrap] 未命名项目已编号：{renamed} 个")
        return renamed
    finally:
        db.close()


def ensure_components() -> dict:
    """组件库种子：数据集 + 15 个「类型级」基础组件（同类不在库里重复）。"""
    try:
        from app.components import seed as component_seed
        from app.components import seed_base, seed_demand, seed_demo

        db = SessionLocal()
        try:
            if not component_seed.table_ready(db):
                return {"skipped": "bi_component 表不存在"}
            dataset_id = component_seed.ensure_dataset(db)
            demo_dataset_id = seed_demo.ensure_demo_dataset(db)
            demand = seed_demand.ensure_datasets(db) if seed_demand.table_ready(db) else {}
            base = seed_base.ensure_base(db, dataset_id, demo_dataset_id)
            return {"dataset_id": dataset_id, "demo_dataset_id": demo_dataset_id,
                    "demand_datasets": demand, "base_components": base}
        finally:
            db.close()
    except Exception as e:
        # 种子挂了不能只是一行「跳过」：组件库会停在旧版本，改模板永远不生效（2026-11-15 实测踩到）。
        # 打全栈，进错误日志，返回 error 让启动自检能看到。
        import traceback

        print(f"[bootstrap] 组件库种子失败：{type(e).__name__}: {e}")
        traceback.print_exc()
        try:  # 顺带进「错误日志」，管理后台能看到，不用翻启动日志
            from app.errors import repository as error_repo

            db = SessionLocal()
            try:
                error_repo.insert(db, {
                    "source": "backend", "level": "error",
                    "message": f"组件库种子失败：{type(e).__name__}: {e}",
                    "stack": traceback.format_exc(),
                    "url": "bootstrap.ensure_components",
                })
            finally:
                db.close()
        except Exception:
            pass
        return {"error": f"{type(e).__name__}: {e}"[:200]}


def ensure_pages() -> dict:
    """两个成品看板（从 seed_docs 载入；已存在不覆盖）。"""
    try:
        from app.dashboards.seed_loader import ensure_docs

        db = SessionLocal()
        try:
            return {"dashboards": ensure_docs(db)}
        finally:
            db.close()
    except Exception as e:
        print(f"[bootstrap] 看板种子跳过：{e}")
        return {"error": str(e)[:200]}


def ensure_rls_backstop() -> dict:
    """S6：确保 RLS 只读角色 + 已配置部门规则的物理表策略（失败只告警，不阻断启动）."""
    try:
        from app.security import rls_backstop

        db = SessionLocal()
        try:
            result = rls_backstop.ensure_all(db)
            print(f"[bootstrap] RLS 兜底：{result}")
            return result
        finally:
            db.close()
    except Exception as e:
        print(f"[bootstrap] RLS 兜底跳过：{e}")
        return {"error": str(e)[:200]}


def init_all() -> None:
    """完整初始化（幂等）."""
    ensure_schema()
    ensure_migrations()
    ensure_components()
    ensure_pages()
    ensure_rbac_seed()
    ensure_rls_backstop()
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
