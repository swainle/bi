"""增量迁移器 —— 让 schema 可以演进（不再只有「表不存在才建」）.

机制：
    schema/migrations/*.sql 按文件名排序执行，执行过的记入 schema_migrations。
    每条迁移在**同一个事务**里执行 SQL + 写记录，失败整体回滚，不会留下半套表。

用法：
    from app.schema_migrations import run_all
    run_all()          # 幂等，返回本次实际执行的文件名列表
"""

from __future__ import annotations

import os
from typing import Iterable

from sqlalchemy import inspect, text

from app.config import settings
from app.database import SessionLocal, engine

MIGRATIONS_DIR = os.path.join(settings.schema_dir, "migrations")

_TRACK_TABLE = """
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename    varchar(200) PRIMARY KEY,
    applied_at  timestamp without time zone NOT NULL DEFAULT now()
)
"""


def _listed_files() -> list[str]:
    if not os.path.isdir(MIGRATIONS_DIR):
        return []
    return sorted(
        f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql")
    )


def applied_files(db) -> set[str]:
    rows = db.execute(text("SELECT filename FROM schema_migrations")).fetchall()
    return {r[0] for r in rows}


def run_all() -> list[str]:
    """执行未应用的迁移，返回本次执行的文件名."""
    if not os.path.isdir(MIGRATIONS_DIR):
        return []

    db = SessionLocal()
    executed: list[str] = []
    try:
        db.execute(text(_TRACK_TABLE))
        db.commit()

        done = applied_files(db)
        for filename in _listed_files():
            if filename in done:
                continue
            path = os.path.join(MIGRATIONS_DIR, filename)
            with open(path, encoding="utf-8") as fh:
                sql = fh.read()
            try:
                db.execute(text(sql))
                db.execute(
                    text("INSERT INTO schema_migrations (filename) VALUES (:f)"),
                    {"f": filename},
                )
                db.commit()
                executed.append(filename)
            except Exception as exc:  # 单条失败不影响已提交的迁移
                db.rollback()
                raise RuntimeError(f"迁移 {filename} 失败：{exc}") from exc
    finally:
        db.close()
    return executed


def pending_files() -> list[str]:
    """列出尚未应用的迁移（用于启动日志 / 健康检查）."""
    db = SessionLocal()
    try:
        db.execute(text(_TRACK_TABLE))
        db.commit()
        done = applied_files(db)
    finally:
        db.close()
    return [f for f in _listed_files() if f not in done]


def table_exists(name: str) -> bool:
    return name in inspect(engine).get_table_names()


__all__ = ["run_all", "pending_files", "applied_files", "table_exists", "MIGRATIONS_DIR"]
