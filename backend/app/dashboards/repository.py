"""看板文档仓储 —— 读写 bi_canvas.doc（v2），旧画布 layout 不动.

删除用软删除（deleted_at）：列表 / 详情都不再返回，行仍保留 ——
这样种子看板（code 非空）被删掉后，重启初始化不会又把它塞回来。
"""

from __future__ import annotations

from app.timezone import china_now, time_text



import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dashboards.models import DashboardDoc, validate_doc


@dataclass
class DashboardRow:
    id: int
    name: str
    code: str | None
    owner_id: int | None
    doc: dict
    updated_at: Any = None
    team_shared: bool = False

    @property
    def item_count(self) -> int:
        """页面上真正的元素数量（跨视图累加）."""
        return sum(len(view.get("items") or []) for view in self.doc.get("views") or [])

    @property
    def view_count(self) -> int:
        return len(self.doc.get("views") or [])

    @property
    def chart_count(self) -> int:
        """卡片上显示的图表数量：只数 chart 元素，不含标题 / 筛选栏 / 分割线."""
        return sum(
            1
            for view in self.doc.get("views") or []
            for item in view.get("items") or []
            if (item.get("type") or "chart") == "chart"
        )

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "code": self.code,
                "owner_id": self.owner_id, "doc": self.doc,
                "views": self.view_count, "items": self.item_count,
                "charts": self.chart_count, "team_shared": bool(self.team_shared),
                "updated_at": time_text(self.updated_at or "")}


def _row(item) -> DashboardRow | None:
    m = item._mapping
    raw = m.get("doc")
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = json.loads(raw)
    return DashboardRow(id=m["id"], name=m["name"], code=m.get("code"),
                        owner_id=m.get("owner_id"), doc=raw, updated_at=m.get("updated_at"),
                        team_shared=bool(m.get("team_shared")))


def get(db: Session, dashboard_id: int) -> DashboardRow | None:
    row = db.execute(
        text("SELECT * FROM bi_canvas WHERE id = :id AND deleted_at IS NULL"),
        {"id": dashboard_id},
    ).fetchone()
    return _row(row) if row else None


def get_by_code(db: Session, code: str) -> DashboardRow | None:
    """按 code 取（含已删除）—— 种子初始化靠它判断「这个页面建过没有」."""
    row = db.execute(text("SELECT * FROM bi_canvas WHERE code = :c"), {"c": code}).fetchone()
    return _row(row) if row else None


def list_dashboards(db: Session, owner_id: int | None = None, limit: int = 50,
                    published_only: bool = False) -> list[DashboardRow]:
    sql = "SELECT * FROM bi_canvas WHERE doc IS NOT NULL AND deleted_at IS NULL"
    params: dict = {"limit": max(1, min(limit, 200))}
    if owner_id is not None:
        sql += " AND (owner_id = :owner OR owner_id IS NULL)"
        params["owner"] = owner_id
    if published_only:
        # 只有显式 published=false 的草稿不进「我的看板」；没有该字段的老看板/种子看板视为已发布
        sql += " AND COALESCE(doc->>'published', 'true') <> 'false'"
    sql += " ORDER BY updated_at DESC LIMIT :limit"
    return [r for r in (_row(x) for x in db.execute(text(sql), params).fetchall()) if r]


def save(db: Session, dashboard_id: int, doc: DashboardDoc | dict, name: str | None = None,
         publish: bool = False, expected_updated_at: str | None = None) -> DashboardRow | None:
    """保存文档；传 `expected_updated_at` 时做乐观锁（不一致返回 None，调用方按 409 处理）."""
    payload = doc.model_dump() if isinstance(doc, DashboardDoc) else validate_doc(doc).model_dump()
    if publish:
        payload["published"] = True
        payload["published_at"] = china_now().isoformat(timespec="seconds")
    sql = "UPDATE bi_canvas SET doc = :doc, updated_at = now()"
    params: dict = {"doc": json.dumps(payload, ensure_ascii=False), "id": dashboard_id}
    if name:
        sql += ", name = :name"
        params["name"] = name[:120]
    sql += " WHERE id = :id AND deleted_at IS NULL"
    if expected_updated_at:
        sql += " AND updated_at = CAST(:expected AS timestamptz)"
        params["expected"] = str(expected_updated_at)
    result = db.execute(text(sql), params)
    if result.rowcount == 0:
        db.rollback()
        return None
    db.commit()
    return get(db, dashboard_id)


def rename(db: Session, dashboard_id: int, name: str) -> DashboardRow | None:
    db.execute(
        text("UPDATE bi_canvas SET name = :name, updated_at = now() "
             "WHERE id = :id AND deleted_at IS NULL"),
        {"name": name[:120], "id": dashboard_id},
    )
    db.commit()
    return get(db, dashboard_id)


def soft_delete(db: Session, dashboard_id: int) -> bool:
    result = db.execute(
        text("UPDATE bi_canvas SET deleted_at = now(), updated_at = now() "
             "WHERE id = :id AND deleted_at IS NULL"),
        {"id": dashboard_id},
    )
    db.commit()
    return bool(result.rowcount)


def set_team_shared(db: Session, dashboard_id: int, shared: bool) -> bool:
    """把看板设为 / 取消「协同看板」（只标记，不复制看板与数据集）."""
    result = db.execute(
        text("UPDATE bi_canvas SET team_shared = :shared, updated_at = now() "
             "WHERE id = :id AND deleted_at IS NULL"),
        {"shared": bool(shared), "id": dashboard_id},
    )
    db.commit()
    return bool(result.rowcount)


UNTITLED = "未命名项目"
_UNTITLED_RE = r"^未命名项目(\d+)$"


def next_untitled_name(db: Session) -> str:
    """没起名就用「未命名项目01 / 02 / 03…」（编号只增不重复，取现有最大号 +1）.

    已有裸名「未命名项目」的旧看板由 bootstrap.ensure_project_names() 统一编号。
    """
    rows = db.execute(
        text("SELECT name FROM bi_canvas WHERE deleted_at IS NULL AND name LIKE :like"),
        {"like": f"{UNTITLED}%"},
    ).fetchall()
    biggest = 0
    for (name,) in rows:
        match = re.match(_UNTITLED_RE, str(name or ""))
        if match:
            biggest = max(biggest, int(match.group(1)))
    return f"{UNTITLED}{biggest + 1:02d}"


def create(db: Session, name: str, code: str | None, doc: DashboardDoc | dict,
           owner_id: int | None = None) -> DashboardRow:
    payload = doc.model_dump() if isinstance(doc, DashboardDoc) else validate_doc(doc).model_dump()
    row = db.execute(
        text(
            "INSERT INTO bi_canvas (name, owner_id, layout, doc, code) "
            "VALUES (:name, :owner, '[]'::jsonb, :doc, :code) RETURNING id"
        ),
        {"name": name[:120], "owner": owner_id,
         "doc": json.dumps(payload, ensure_ascii=False), "code": code},
    ).fetchone()
    db.commit()
    return get(db, row[0])


def ensure_seed(db: Session, code: str, name: str, doc: DashboardDoc | dict,
                owner_id: int | None = None) -> DashboardRow:
    """按 code 幂等：存在就不覆盖（避免把用户改过的页面重置、删掉的页面复活）."""
    existing = get_by_code(db, code)
    if existing:
        return existing
    return create(db, name=name, code=code, doc=doc, owner_id=owner_id)


__all__ = ["DashboardRow", "get", "get_by_code", "list_dashboards", "save", "rename",
           "soft_delete", "create", "ensure_seed", "set_team_shared"]
