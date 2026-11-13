"""模板库（看板分享）—— 分享时复制数据集，克隆时直接用模板这份数据.

约定：
    · 模板库里的「看板模板」= 一份深拷贝的 bi_canvas.doc + 它用到的数据副本；
    · 数据副本落在 `bi_tpl_<模板 id>_<原数据集 id>`，对应的 bi_dataset 归属公共（owner 为空），
      只在「测试数据集」页展示，不进「数据集」页；
    · 模板默认所有人可见，也可以只给指定成员看（shared_user_ids）；
    · 克隆模板生成的看板直接绑定模板这份公共数据，所有克隆者看同一份。
"""

from __future__ import annotations

import copy
import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dashboards import repository as dash_repo
from app.dashboards import sources as dash_sources
from app.semantic import repository as sem_repo

TEMPLATE_KIND_PAGE = "page"
TEMPLATE_KINDS = (TEMPLATE_KIND_PAGE, "engine")
CATEGORIES = ("拼多多", "天猫", "财务", "产品部", "通用")
MAX_COPY_ROWS = 5000

_TYPE_SQL = {
    "integer": "integer",
    "numeric": "numeric",
    "date": "date",
    "datetime": "timestamp",
    "bool": "boolean",
    "text": "text",
}


class TemplateError(Exception):
    """模板库业务错误（路由层转 HTTPException）."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _is_admin(user) -> bool:
    return getattr(user, "role", "") in ("admin", "super_admin")


def _uid(user) -> int | None:
    value = getattr(user, "id", None)
    return int(value) if value is not None else None


def _q(name: str) -> str:
    """标识符双引号包裹（表名可能带 schema 前缀）."""
    return ".".join('"' + part.replace('"', '""') + '"' for part in str(name).split("."))


def _visible_sql(alias: str = "t") -> tuple[str, dict]:
    """模板可见性：公开 / 自己发布 / 被指定成员."""
    return (
        f"({alias}.is_public IS TRUE OR {alias}.author_id = :__uid "
        f"OR jsonb_exists(COALESCE({alias}.shared_user_ids, '[]'::jsonb), CAST(:__uid AS text)))",
        {"__uid": 0},
    )


def _visible_where(user, alias: str = "t") -> tuple[str, dict]:
    if _is_admin(user):
        return "TRUE", {}
    where, params = _visible_sql(alias)
    params["__uid"] = _uid(user) or 0
    return where, params


# ── 看板文档里的数据集引用 ────────────────────────────────────
def doc_dataset_ids(doc: dict) -> list[int]:
    """文档里出现的所有数据集 id（binding / 导出范围 / 筛选栏分平台映射）."""
    found: set[int] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("dataset_id", "export_dataset_id"):
                    try:
                        number = int(value)
                    except (TypeError, ValueError):
                        number = 0
                    if number > 0:
                        found.add(number)
                elif key == "dataset_map" and isinstance(value, dict):
                    for mapped in value.values():
                        try:
                            number = int(mapped)
                        except (TypeError, ValueError):
                            number = 0
                        if number > 0:
                            found.add(number)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(doc or {})
    return sorted(found)


def _remap_doc(node, mapping: dict[int, int]):
    """把文档里的旧数据集 id 换成模板数据副本的 id（原地重建，不改原对象）."""
    if isinstance(node, dict):
        out: dict = {}
        for key, value in node.items():
            if key in ("dataset_id", "export_dataset_id"):
                try:
                    old = int(value)
                except (TypeError, ValueError):
                    old = 0
                out[key] = mapping.get(old, value)
            elif key == "dataset_map" and isinstance(value, dict):
                mapped: dict = {}
                for platform, dataset_id in value.items():
                    try:
                        old = int(dataset_id)
                    except (TypeError, ValueError):
                        old = 0
                    mapped[platform] = mapping.get(old, dataset_id)
                out[key] = mapped
            else:
                out[key] = _remap_doc(value, mapping)
        return out
    if isinstance(node, list):
        return [_remap_doc(item, mapping) for item in node]
    return node


# ── 数据集复制 ────────────────────────────────────────────────
def _unique_dataset_name(db: Session, base: str, template_id: int) -> str:
    name = (base or "模板数据")[:90]
    exists = db.execute(text("SELECT 1 FROM bi_dataset WHERE name = :n"), {"n": name}).fetchone()
    if not exists:
        return name
    name = f"{base[:80]}（模板{template_id}）"
    index = 2
    while db.execute(text("SELECT 1 FROM bi_dataset WHERE name = :n"), {"n": name}).fetchone():
        name = f"{base[:74]}（模板{template_id}-{index}）"
        index += 1
    return name


def _live_rows(db: Session, dataset, fields: list) -> tuple[list[dict], list[str]]:
    """直连数据集取一份快照（列 = 语义字段的源列）."""
    from app.query.live import engine_for_source, source_tables
    from app.sources import repository as sources_repo

    if dataset.source_id is None:
        raise TemplateError(400, f"直连数据集未绑定数据源：{dataset.name}")
    src = sources_repo.get_source(db, int(dataset.source_id))
    if src is None:
        raise TemplateError(400, f"数据集绑定的数据源不存在：{dataset.name}")

    columns: list[str] = []
    for field in fields:
        if field.source_column and field.source_column not in columns:
            columns.append(field.source_column)
    if not columns:
        raise TemplateError(400, f"数据集没有字段，无法复制：{dataset.name}")

    engine = engine_for_source(src)
    if dataset.physical_table not in source_tables(engine, int(src["id"])):
        raise TemplateError(400, f"源库里没有这张表：{dataset.physical_table}")
    select_list = ", ".join(_q(column) for column in columns)
    sql = f"SELECT {select_list} FROM {_q(dataset.physical_table)} LIMIT {MAX_COPY_ROWS}"
    try:
        with engine.connect() as conn:
            rows = [dict(r._mapping) for r in conn.execute(text(sql)).fetchall()]
    except Exception as exc:
        raise TemplateError(400, f"源库取数失败（{dataset.name}）：{str(exc)[:160]}") from exc
    return rows, columns


def _copy_dataset(db: Session, src, template_id: int, template_name: str) -> int:
    """复制一个数据集（物理表 + 字段 + 指标），返回新数据集 id."""
    if src is None:
        raise TemplateError(400, "看板引用的数据集不存在")
    fields = list(src.fields or [])
    if not fields:
        src = sem_repo.get_dataset(db, src.id) or src
        fields = list(src.fields or [])

    table = f"bi_tpl_{template_id}_{src.id}"
    mode = (src.conn_mode or "extract").lower()

    if mode == "live":
        rows, columns = _live_rows(db, src, fields)
        column_sql: list[str] = []
        for column in columns:
            field = next((f for f in fields if f.source_column == column), None)
            column_sql.append(f"{_q(column)} {_TYPE_SQL.get((field.data_type if field else 'text'), 'text')}")
        db.execute(text(f"DROP TABLE IF EXISTS {_q(table)}"))
        db.execute(text(f"CREATE TABLE {_q(table)} ({', '.join(column_sql)})"))
        if rows:
            keys = list(rows[0].keys())
            binds = ", ".join(f":p{i}" for i in range(len(keys)))
            insert_sql = text(
                f"INSERT INTO {_q(table)} ({', '.join(_q(k) for k in keys)}) VALUES ({binds})"
            )
            for start in range(0, len(rows), 500):
                chunk = [
                    {f"p{i}": row.get(key) for i, key in enumerate(keys)}
                    for row in rows[start:start + 500]
                ]
                db.execute(insert_sql, chunk)
    else:
        if src.sql_text:
            source_sql = f"SELECT * FROM ({src.sql_text}) AS __tpl_src"
        else:
            source_sql = f"SELECT * FROM {_q(src.physical_table)}"
        db.execute(text(f"DROP TABLE IF EXISTS {_q(table)}"))
        db.execute(text(f"CREATE TABLE {_q(table)} AS {source_sql}"))

    name = _unique_dataset_name(db, f"模板·{template_name}·{src.name}", template_id)
    row = db.execute(
        text(
            "INSERT INTO bi_dataset (name, physical_table, description, owner_id, conn_mode) "
            "VALUES (:n, :t, :d, NULL, 'extract') RETURNING id"
        ),
        {
            "n": name, "t": table,
            "d": f"模板「{template_name}」的数据副本（由「{src.name}」复制，公共只读）",
        },
    ).fetchone()
    dataset_id = int(row[0])

    db.execute(
        text(
            "INSERT INTO bi_dataset_field "
            "(dataset_id, name, source_column, role, data_type, is_filterable, "
            " is_groupable, default_grain, description) "
            "VALUES (:did, :name, :col, :role, :dtype, :filterable, :groupable, :grain, :desc)"
        ),
        [
            {
                "did": dataset_id, "name": f.name, "col": f.source_column, "role": f.role,
                "dtype": f.data_type, "filterable": f.is_filterable, "groupable": f.is_groupable,
                "grain": f.default_grain, "desc": f.description or "",
            }
            for f in fields
        ],
    )

    if src.metrics:
        db.execute(
            text(
                "INSERT INTO bi_dataset_metric (dataset_id, name, expression, format, description) "
                "VALUES (:did, :name, :expr, :fmt, :desc)"
            ),
            [
                {
                    "did": dataset_id, "name": m.name, "expr": m.expression,
                    "fmt": m.format, "desc": m.description or "",
                }
                for m in src.metrics
            ],
        )
    return dataset_id


# ── 分享 ──────────────────────────────────────────────────────
def share_board(db: Session, board_id: int, user, payload: dict) -> dict:
    board = dash_repo.get(db, board_id)
    if board is None:
        raise TemplateError(404, "看板不存在")
    if not _is_admin(user) and board.owner_id != _uid(user):
        raise TemplateError(403, "只能分享自己的看板")

    name = str(payload.get("name") or board.name or "未命名模板").strip()[:80]
    description = str(payload.get("description") or "").strip()[:400]
    category = str(payload.get("category") or "通用").strip()
    if category not in CATEGORIES:
        category = "通用"
    is_public = bool(payload.get("is_public", True))
    shared_users = sorted({
        int(uid) for uid in (payload.get("user_ids") or [])
        if str(uid).strip().lstrip("-").isdigit() and int(uid) > 0
    })
    if is_public:
        shared_users = []

    row = db.execute(
        text(
            "INSERT INTO bi_template_market "
            "(name, description, category, panels, table_map, author_id, kind, is_public, "
            " shared_user_ids, source_board_id) "
            "VALUES (:n, :d, :c, '[]'::jsonb, '{}'::jsonb, :uid, 'page', :pub, "
            "        CAST(:users AS jsonb), :board) RETURNING id"
        ),
        {
            "n": name, "d": description, "c": category, "uid": _uid(user),
            "pub": is_public, "users": json.dumps(shared_users), "board": board_id,
        },
    ).fetchone()
    template_id = int(row[0])

    try:
        mapping: dict[int, int] = {}
        for dataset_id in doc_dataset_ids(board.doc):
            src = sem_repo.get_dataset(db, dataset_id)
            mapping[dataset_id] = _copy_dataset(db, src, template_id, name)
        doc = _remap_doc(copy.deepcopy(board.doc or {}), mapping)
        db.execute(
            text(
                "UPDATE bi_template_market SET doc = CAST(:doc AS jsonb), "
                "dataset_ids = CAST(:ids AS jsonb) WHERE id = :id"
            ),
            {
                "doc": json.dumps(doc, ensure_ascii=False),
                "ids": json.dumps(sorted(mapping.values())),
                "id": template_id,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "id": template_id, "name": name, "kind": TEMPLATE_KIND_PAGE,
        "dataset_ids": sorted(mapping.values()),
        "message": f"已分享到模板库，并复制了 {len(mapping)} 个数据集",
    }


# ── 列表 / 详情 / 克隆 ───────────────────────────────────────
def _panel_titles(row) -> list[str]:
    doc = row.get("doc")
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except ValueError:
            doc = None
    if isinstance(doc, dict):
        titles: list[str] = []
        for view in doc.get("views") or []:
            items = list((view or {}).get("items") or [])
            for group in ((view or {}).get("items_map") or {}).values():
                items.extend(group or [])
            for item in items:
                title = str((item or {}).get("title") or "").strip()
                if title and title not in titles:
                    titles.append(title)
        return titles[:6]
    panels = row.get("panels")
    if isinstance(panels, str):
        try:
            panels = json.loads(panels)
        except ValueError:
            panels = []
    return [str((panel or {}).get("title") or "").strip()
            for panel in (panels or []) if str((panel or {}).get("title") or "").strip()][:6]


def list_templates(db: Session, user, category: str = "") -> list[dict]:
    where, params = _visible_where(user)
    sql = (
        "SELECT id, name, description, category, panels, table_map, doc, dataset_ids, downloads, rating, "
        "       is_official, author_id, kind, created_at "
        f"FROM bi_template_market t WHERE {where}"
    )
    if category:
        sql += " AND category = :cat"
        params["cat"] = category
    sql += " ORDER BY downloads DESC, id DESC LIMIT 50"
    rows = db.execute(text(sql), params).fetchall()
    result: list[dict] = []
    for item in rows:
        row = dict(item._mapping)
        dataset_ids = row.pop("dataset_ids", None) or []
        if isinstance(dataset_ids, str):
            try:
                dataset_ids = json.loads(dataset_ids)
            except ValueError:
                dataset_ids = []
        panels = row.get("panels")
        if isinstance(panels, str):
            try:
                panels = json.loads(panels)
            except ValueError:
                panels = []
        row["panels"] = panels or []
        row["panel_titles"] = _panel_titles(row)
        row["dataset_count"] = len(dataset_ids)
        row["kind"] = row.get("kind") or "engine"
        if isinstance(row.get("created_at"), str) is False and row.get("created_at") is not None:
            row["created_at"] = str(row["created_at"])
        row.pop("doc", None)
        result.append(row)
    return result


def get_template(db: Session, template_id: int, user) -> dict:
    where, params = _visible_where(user)
    params["id"] = template_id
    row = db.execute(
        text(
            "SELECT id, name, description, category, panels, table_map, doc, dataset_ids, downloads, rating, "
            "       is_official, author_id, kind, created_at "
            f"FROM bi_template_market t WHERE t.id = :id AND {where}"
        ),
        params,
    ).fetchone()
    if row is None:
        raise TemplateError(404, "模板不存在或无权查看")
    data = dict(row._mapping)
    data["panel_titles"] = _panel_titles(data)
    return data


def _mark_download(db: Session, template_id: int) -> None:
    db.execute(text("UPDATE bi_template_market SET downloads = downloads + 1 WHERE id = :id"),
               {"id": template_id})


def clone_template(db: Session, template_id: int, user) -> dict:
    tpl = get_template(db, template_id, user)
    template_name = str(tpl.get("name") or "模板")
    kind = tpl.get("kind") or "engine"

    if kind == TEMPLATE_KIND_PAGE:
        doc = tpl.get("doc")
        if isinstance(doc, str):
            try:
                doc = json.loads(doc)
            except ValueError:
                doc = None
        if not isinstance(doc, dict):
            raise TemplateError(400, "模板缺少看板内容，无法使用")
        dataset_ids = tpl.get("dataset_ids") or []
        if isinstance(dataset_ids, str):
            try:
                dataset_ids = json.loads(dataset_ids)
            except ValueError:
                dataset_ids = []
        missing = [
            int(dataset_id) for dataset_id in dataset_ids
            if sem_repo.get_dataset(db, int(dataset_id), with_items=False) is None
        ]
        if missing:
            raise TemplateError(400, "模板数据副本已被删除，无法使用这个模板")
        payload = copy.deepcopy(doc)
        payload["published"] = True
        try:
            created = dash_repo.create(
                db, name=f"{template_name}（副本）", code=None, doc=payload,
                owner_id=_uid(user),
            )
        except Exception as exc:
            raise TemplateError(400, f"生成看板失败：{str(exc)[:160]}") from exc
        dash_sources.rebuild(db, created.id, created.doc)
        _mark_download(db, template_id)
        db.commit()
        return {
            "id": created.id, "name": created.name, "kind": "page",
            "source_template_id": template_id,
            "message": f"已从模板「{template_name}」创建看板",
        }

    # 旧版引擎模板：panels + table_map 深拷贝到 bi_dashboards
    panels_json = tpl.get("panels") if isinstance(tpl.get("panels"), str) else json.dumps(tpl.get("panels") or [])
    table_map_json = json.dumps(tpl.get("table_map") or {})
    new_name = f"{template_name}（副本）"
    result = db.execute(
        text(
            "INSERT INTO bi_dashboards (name, owner_id, panels, table_map) "
            "VALUES (:name, :uid, CAST(:panels AS jsonb), CAST(:tmap AS jsonb)) RETURNING id"
        ),
        {"name": new_name, "uid": _uid(user), "panels": panels_json, "tmap": table_map_json},
    )
    dashboard_id = int(result.scalar())
    _mark_download(db, template_id)
    db.commit()
    return {
        "id": dashboard_id, "name": new_name, "kind": "engine",
        "source_template_id": template_id,
        "message": f"已从模板「{template_name}」创建看板",
    }


# ── 数据集归属（测试数据集页 / 数据集页过滤）────────────────
def dataset_template_map(db: Session, user=None) -> dict[int, dict]:
    """数据集 id → 所属模板（user 传了才做可见性过滤）."""
    sql = "SELECT id, name, dataset_ids, is_public, author_id, shared_user_ids FROM bi_template_market"
    params: dict = {}
    if user is not None and not _is_admin(user):
        where, wparams = _visible_where(user)
        sql += f" WHERE {where}"
        params.update(wparams)
    sql += " ORDER BY id"
    result: dict[int, dict] = {}
    for row in db.execute(text(sql), params).fetchall():
        data = dict(row._mapping)
        ids = data.get("dataset_ids") or []
        if isinstance(ids, str):
            try:
                ids = json.loads(ids)
            except ValueError:
                ids = []
        for dataset_id in ids:
            try:
                key = int(dataset_id)
            except (TypeError, ValueError):
                continue
            result.setdefault(key, {"template_id": data["id"], "template_name": data["name"]})
    return result


def list_template_datasets(db: Session, user) -> list[dict]:
    mapping = dataset_template_map(db, user)
    items: list[dict] = []
    for dataset_id, meta in sorted(mapping.items()):
        dataset = sem_repo.get_dataset(db, dataset_id)
        if dataset is None:
            continue
        payload = dataset.to_dict(with_items=False)
        payload["template_id"] = meta["template_id"]
        payload["template_name"] = meta["template_name"]
        items.append(payload)
    return items


__all__ = [
    "TemplateError", "CATEGORIES", "TEMPLATE_KIND_PAGE",
    "share_board", "list_templates", "get_template", "clone_template",
    "list_template_datasets", "dataset_template_map", "doc_dataset_ids",
]
