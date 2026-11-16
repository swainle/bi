"""语义层仓储 —— 只在这一层写 SQL，上层不碰数据库细节."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.semantic.aliases import label_for, needs_label
from app.semantic.models import Dataset, DatasetField, DatasetMetric
from app.semantic.validator import (
    SemanticError,
    validate_format,
    validate_metric_expression,
    validate_role,
    validate_source_column,
    validate_table,
)


# ── 数据集 ──────────────────────────────────────────────────
def list_datasets(
    db: Session,
    owner_id: int | None = None,
    *,
    dept_ids: list[int] | None = None,
    all_departments: bool = False,
) -> list[Dataset]:
    """数据集列表。

    owner_id 给了才做可见性过滤：公共（owner 为空）+ 自己的 + 归属部门在 `dept_ids` 内的；
    `all_departments=True`（数据范围 all 的账号）不过滤。
    """
    sql = (
        "SELECT d.*, "
        " (SELECT count(*) FROM bi_dataset_field f WHERE f.dataset_id = d.id) AS field_count, "
        " (SELECT count(*) FROM bi_dataset_metric m WHERE m.dataset_id = d.id) AS metric_count "
        "FROM bi_dataset d"
    )
    params: dict = {}
    if owner_id is not None and not all_departments:
        clauses = ["d.owner_id IS NULL", "d.owner_id = :owner"]
        params["owner"] = owner_id
        if dept_ids:
            clauses.append("d.dept_id = ANY(:depts)")
            params["depts"] = list(dept_ids)
        sql += " WHERE (" + " OR ".join(clauses) + ")"
    sql += " ORDER BY d.updated_at DESC, d.id DESC"
    rows = db.execute(text(sql), params).fetchall()
    return [Dataset.from_row(r) for r in rows]


def get_dataset(db: Session, dataset_id: int, with_items: bool = True) -> Dataset | None:
    row = db.execute(
        text(
            "SELECT d.*, "
            " (SELECT count(*) FROM bi_dataset_field f WHERE f.dataset_id = d.id) AS field_count, "
            " (SELECT count(*) FROM bi_dataset_metric m WHERE m.dataset_id = d.id) AS metric_count "
            "FROM bi_dataset d WHERE d.id = :id"
        ),
        {"id": dataset_id},
    ).fetchone()
    if row is None:
        return None
    dataset = Dataset.from_row(row)
    if with_items:
        dataset.fields = list_fields(db, dataset_id)
        dataset.metrics = list_metrics(db, dataset_id)
    return dataset


def create_dataset(
    db: Session,
    name: str,
    physical_table: str,
    owner_id: int | None,
    description: str = "",
    sql_text: str = "",
    conn_mode: str = "extract",
    source_id: int | None = None,
    sandbox: bool = False,
    dept_id: int | None = None,
) -> Dataset:
    mode = (conn_mode or "extract").strip().lower()
    if mode not in ("extract", "live"):
        raise SemanticError(f"取数方式只能是 extract 或 live：{conn_mode}")
    if mode == "live":
        if source_id is None:
            raise SemanticError("直连数据集必须绑定数据源")
        if sql_text:
            raise SemanticError("直连数据集不支持自定义 SQL")
    elif not sql_text:
        validate_table(db, physical_table)
    exists = db.execute(
        text("SELECT 1 FROM bi_dataset WHERE name = :n"), {"n": name}
    ).fetchone()
    if exists:
        raise SemanticError(f"数据集名称已存在：{name}")

    row = db.execute(
        text(
            "INSERT INTO bi_dataset "
            "  (name, physical_table, description, owner_id, sql_text, conn_mode, source_id, "
            "   is_sandbox, dept_id) "
            "VALUES (:n, :t, :d, :o, :sql, :mode, :sid, :sandbox, :dept) RETURNING *"
        ),
        {"n": name, "t": physical_table, "d": description, "o": owner_id,
         "sql": sql_text or None, "mode": mode, "sid": source_id if mode == "live" else None,
         "sandbox": bool(sandbox), "dept": dept_id},
    ).fetchone()
    db.commit()
    return Dataset.from_row(row)


def delete_dataset(db: Session, dataset_id: int) -> bool:
    result = db.execute(
        text("DELETE FROM bi_dataset WHERE id = :id"), {"id": dataset_id}
    )
    db.commit()
    return result.rowcount > 0


# ── 字段 ────────────────────────────────────────────────────
def list_fields(db: Session, dataset_id: int) -> list[DatasetField]:
    rows = db.execute(
        text("SELECT * FROM bi_dataset_field WHERE dataset_id = :d ORDER BY id"),
        {"d": dataset_id},
    ).fetchall()
    return [DatasetField.from_row(r) for r in rows]


def _validate_column(db: Session, dataset: Dataset, column: str) -> None:
    """列校验：抽取模式查本地表；直连模式交给源库（这里不查本地库）."""
    if (dataset.conn_mode or "extract") == "live":
        return
    validate_source_column(db, dataset.physical_table, column)


def add_field(
    db: Session,
    dataset: Dataset,
    name: str,
    source_column: str,
    role: str = "dimension",
    data_type: str = "text",
    default_grain: str | None = None,
    description: str = "",
    is_filterable: bool = True,
    is_groupable: bool = True,
    validate: bool = True,
) -> DatasetField:
    if validate:
        _validate_column(db, dataset, source_column)
    # 源库英文列（dm.v_bangdan 的 29 列）自动起中文名；用户手改过名字的不动
    if needs_label(name, source_column):
        name = label_for(source_column, name)
    row = db.execute(
        text(
            "INSERT INTO bi_dataset_field "
            "(dataset_id, name, source_column, role, data_type, is_filterable, "
            " is_groupable, default_grain, description) "
            "VALUES (:d, :n, :c, :r, :t, :f, :g, :grain, :desc) RETURNING *"
        ),
        {
            "d": dataset.id, "n": name, "c": source_column,
            "r": validate_role(role), "t": data_type,
            "f": is_filterable, "g": is_groupable,
            "grain": default_grain, "desc": description,
        },
    ).fetchone()
    db.commit()
    return DatasetField.from_row(row)


def delete_field(db: Session, dataset_id: int, field_id: int) -> bool:
    result = db.execute(
        text("DELETE FROM bi_dataset_field WHERE id = :id AND dataset_id = :d"),
        {"id": field_id, "d": dataset_id},
    )
    db.commit()
    return result.rowcount > 0


# ── 指标 ────────────────────────────────────────────────────
def list_metrics(db: Session, dataset_id: int) -> list[DatasetMetric]:
    rows = db.execute(
        text("SELECT * FROM bi_dataset_metric WHERE dataset_id = :d ORDER BY id"),
        {"d": dataset_id},
    ).fetchall()
    return [DatasetMetric.from_row(r) for r in rows]


def add_metric(
    db: Session,
    dataset: Dataset,
    name: str,
    expression: str,
    fmt: str = "number",
    description: str = "",
    *,
    changed_by: int | None = None,
    changed_by_name: str = "",
) -> DatasetMetric:
    row = db.execute(
        text(
            "INSERT INTO bi_dataset_metric "
            "(dataset_id, name, expression, format, description, version) "
            "VALUES (:d, :n, :e, :f, :desc, 1) RETURNING *"
        ),
        {
            "d": dataset.id, "n": name,
            "e": validate_metric_expression(expression),
            "f": validate_format(fmt), "desc": description,
        },
    ).fetchone()
    metric = DatasetMetric.from_row(row)
    _record_metric_version(db, metric, changed_by, changed_by_name, "新建指标")
    db.commit()
    return metric


def _record_metric_version(
    db: Session,
    metric: DatasetMetric,
    changed_by: int | None,
    changed_by_name: str,
    note: str = "",
) -> None:
    """给指标留一版快照（唯一键 metric_id + version，重复写入自动忽略）."""
    db.execute(
        text(
            "INSERT INTO bi_metric_version "
            "  (metric_id, dataset_id, version, name, expression, format, description, "
            "   changed_by, changed_by_name, note) "
            "VALUES (:mid, :did, :v, :n, :e, :f, :desc, :by, :by_name, :note) "
            "ON CONFLICT (metric_id, version) DO NOTHING"
        ),
        {
            "mid": metric.id, "did": metric.dataset_id, "v": metric.version,
            "n": metric.name, "e": metric.expression, "f": metric.format,
            "desc": metric.description, "by": changed_by,
            "by_name": (changed_by_name or "")[:80], "note": (note or "")[:200],
        },
    )


def list_metric_versions(db: Session, metric_id: int) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT * FROM bi_metric_version WHERE metric_id = :id ORDER BY version DESC"
        ),
        {"id": metric_id},
    ).fetchall()
    return [
        {
            "version": int(r._mapping["version"]),
            "name": r._mapping["name"], "expression": r._mapping["expression"],
            "format": r._mapping["format"], "description": r._mapping["description"] or "",
            "changed_by": r._mapping["changed_by"],
            "changed_by_name": r._mapping["changed_by_name"] or "",
            "changed_at": str(r._mapping["changed_at"] or ""),
            "note": r._mapping["note"] or "",
        }
        for r in rows
    ]


def certify_metric(
    db: Session,
    dataset_id: int,
    metric_id: int,
    certified: bool,
    user_id: int | None,
) -> DatasetMetric:
    """认证 / 取消认证（认证代表口径已确认；口径后再改会自动掉认证）."""
    row = db.execute(
        text(
            "UPDATE bi_dataset_metric SET "
            "  certified = :c, "
            "  certified_by = CASE WHEN :c THEN :u ELSE NULL END, "
            "  certified_at = CASE WHEN :c THEN now() ELSE NULL END "
            "WHERE id = :id AND dataset_id = :d RETURNING *"
        ),
        {"c": bool(certified), "u": user_id, "id": metric_id, "d": dataset_id},
    ).fetchone()
    if row is None:
        raise SemanticError(f"指标不存在：{metric_id}")
    db.commit()
    return DatasetMetric.from_row(row)


def metric_usages(db: Session, dataset_id: int, metric_name: str) -> dict:
    """影响分析：哪些看板 / 元素引用了这个指标（来自 bi_dash_item_source 账本）."""
    rows = db.execute(
        text(
            "SELECT s.dashboard_id, c.name, s.view_key, s.item_key, s.item_kind, s.item_type, s.role "
            "FROM bi_dash_item_source s "
            "JOIN bi_canvas c ON c.id = s.dashboard_id AND c.deleted_at IS NULL "
            "WHERE s.dataset_id = :d AND s.metric = :m "
            "ORDER BY s.dashboard_id, s.view_key, s.item_key"
        ),
        {"d": dataset_id, "m": metric_name},
    ).fetchall()
    usages = [
        {
            "dashboard_id": r[0], "dashboard_name": r[1] or "",
            "view_key": r[2], "item_key": r[3], "item_kind": r[4],
            "item_type": r[5], "role": r[6],
        }
        for r in rows
    ]
    return {
        "metric": metric_name,
        "count": len(usages),
        "dashboard_count": len({u["dashboard_id"] for u in usages}),
        "usages": usages,
    }


def delete_metric(db: Session, dataset_id: int, metric_id: int) -> bool:
    result = db.execute(
        text("DELETE FROM bi_dataset_metric WHERE id = :id AND dataset_id = :d"),
        {"id": metric_id, "d": dataset_id},
    )
    db.commit()
    return result.rowcount > 0


def update_dataset(
    db: Session,
    dataset_id: int,
    name: str | None = None,
    description: str | None = None,
    sql_text: str | None = None,
    conn_mode: str | None = None,
    source_id: int | None = None,
) -> Dataset | None:
    """改数据集名称 / 描述 / 取数方式（名称全局唯一）."""
    mode = (conn_mode or "").strip().lower() or None
    if mode is not None and mode not in ("extract", "live"):
        raise SemanticError(f"取数方式只能是 extract 或 live：{conn_mode}")
    if mode == "live" and source_id is None:
        current = get_dataset(db, dataset_id, with_items=False)
        if current is None or (current.conn_mode != "live" and current.source_id is None):
            raise SemanticError("直连数据集必须绑定数据源")
    if name is not None:
        name = normalize_dataset_name(name)
        exists = db.execute(
            text("SELECT 1 FROM bi_dataset WHERE name = :n AND id <> :id"),
            {"n": name, "id": dataset_id},
        ).fetchone()
        if exists:
            raise SemanticError(f"数据集名称已存在：{name}")
    db.execute(
        text(
            "UPDATE bi_dataset SET "
            " name = COALESCE(:n, name), "
            " description = COALESCE(:d, description), "
            " sql_text = COALESCE(:s, sql_text), "
            " conn_mode = COALESCE(:mode, conn_mode), "
            " source_id = COALESCE(:sid, source_id), "
            " updated_at = now() "
            "WHERE id = :id"
        ),
        {"n": name, "d": description, "s": sql_text, "mode": mode,
         "sid": source_id, "id": dataset_id},
    )
    db.commit()
    return get_dataset(db, dataset_id)


def normalize_dataset_name(name: str | None) -> str:
    """校验并规整数据集名称（纯函数，便于单测）.

    只负责「这个名字能不能用」：去首尾空白、非空、≤120 字（与 bi_dataset.name 的列宽一致）。
    """
    clean = str(name if name is not None else "").strip()
    if not clean:
        raise SemanticError("数据集名称不能为空")
    if len(clean) > 120:
        raise SemanticError("数据集名称不能超过 120 个字符")
    return clean


def rename_dataset(db: Session, dataset_id: int, name: str | None) -> Dataset:
    """改名 —— 只写 name 一列.

    刻意不复用 update_dataset：这里 UPDATE 的 SET 只有 name / updated_at，
    物理表（physical_table）、取数方式（conn_mode）、绑定的数据源（source_id）、
    自定义 SQL（sql_text）在语句层面就不可能被这条路径改动 —— 改名永远不会碰数据库连接。
    """
    clean = normalize_dataset_name(name)
    exists = db.execute(
        text("SELECT 1 FROM bi_dataset WHERE name = :n AND id <> :id"),
        {"n": clean, "id": dataset_id},
    ).fetchone()
    if exists:
        raise SemanticError(f"数据集名称已存在：{clean}")
    try:
        result = db.execute(
            text("UPDATE bi_dataset SET name = :n, updated_at = now() WHERE id = :id"),
            {"n": clean, "id": dataset_id},
        )
        if result.rowcount == 0:
            raise SemanticError(f"数据集不存在：{dataset_id}")
        db.commit()
    except IntegrityError as exc:
        # 两个人同时改成同一个名字时唯一索引会兜底，给回同样的提示而不是 500
        db.rollback()
        raise SemanticError(f"数据集名称已存在：{clean}") from exc
    dataset = get_dataset(db, dataset_id, with_items=False)
    if dataset is None:
        raise SemanticError(f"数据集不存在：{dataset_id}")
    return dataset


def update_field(
    db: Session,
    dataset: Dataset,
    field_id: int,
    payload: dict,
) -> DatasetField | None:
    current = next((f for f in list_fields(db, dataset.id) if f.id == field_id), None)
    if current is None:
        raise SemanticError(f"字段不存在：{field_id}")

    source_column = str(payload.get("source_column", current.source_column)).strip()
    _validate_column(db, dataset, source_column)
    role = validate_role(payload.get("role", current.role))
    name = str(payload.get("name", current.name)).strip()
    if not name:
        raise SemanticError("字段名称不能为空")

    row = db.execute(
        text(
            "UPDATE bi_dataset_field SET name = :n, source_column = :c, role = :r, "
            " data_type = :t, is_filterable = :f, is_groupable = :g, "
            " default_grain = :grain, description = :desc "
            "WHERE id = :id AND dataset_id = :d RETURNING *"
        ),
        {
            "n": name, "c": source_column, "r": role,
            "t": str(payload.get("data_type", current.data_type) or "text"),
            "f": bool(payload.get("is_filterable", current.is_filterable)),
            "g": bool(payload.get("is_groupable", current.is_groupable)),
            "grain": payload.get("default_grain", current.default_grain) or None,
            "desc": str(payload.get("description", current.description) or ""),
            "id": field_id, "d": dataset.id,
        },
    ).fetchone()
    db.commit()
    _touch(db, dataset.id)
    return DatasetField.from_row(row) if row else None


def metric_spec_changed(current: DatasetMetric, expression: str, fmt: str) -> bool:
    """口径是否变了（只看聚合表达式 + 格式；改名 / 改描述不算口径变更）."""
    return (expression, fmt) != (current.expression, current.format)


def update_metric(
    db: Session,
    dataset: Dataset,
    metric_id: int,
    payload: dict,
    *,
    changed_by: int | None = None,
    changed_by_name: str = "",
) -> DatasetMetric | None:
    """改指标；聚合表达式 / 格式变了才算口径变更（版本 +1、自动掉认证、留快照）."""
    current = next((m for m in list_metrics(db, dataset.id) if m.id == metric_id), None)
    if current is None:
        raise SemanticError(f"指标不存在：{metric_id}")

    new_name = str(payload.get("name", current.name)).strip() or current.name
    new_expr = validate_metric_expression(str(payload.get("expression", current.expression)))
    new_fmt = validate_format(payload.get("format", current.format))
    new_desc = str(payload.get("description", current.description) or "")
    spec_changed = metric_spec_changed(current, new_expr, new_fmt)

    row = db.execute(
        text(
            "UPDATE bi_dataset_metric SET name = :n, expression = :e, format = :f, "
            " description = :desc, version = version + :bump, "
            " certified = CASE WHEN :bump > 0 THEN false ELSE certified END, "
            " certified_by = CASE WHEN :bump > 0 THEN NULL ELSE certified_by END, "
            " certified_at = CASE WHEN :bump > 0 THEN NULL ELSE certified_at END "
            "WHERE id = :id AND dataset_id = :d RETURNING *"
        ),
        {
            "n": new_name, "e": new_expr, "f": new_fmt, "desc": new_desc,
            "bump": 1 if spec_changed else 0,
            "id": metric_id, "d": dataset.id,
        },
    ).fetchone()
    metric = DatasetMetric.from_row(row) if row else None
    if metric and spec_changed:
        _record_metric_version(db, metric, changed_by, changed_by_name, "口径变更")
    db.commit()
    _touch(db, dataset.id)
    return metric


def _touch(db: Session, dataset_id: int) -> None:
    db.execute(
        text("UPDATE bi_dataset SET updated_at = now() WHERE id = :id"), {"id": dataset_id}
    )
    db.commit()


# ── 物理列同步（Superset 的「同步列」）──────────────────────
_NUMERIC = {"integer", "bigint", "smallint", "numeric", "double precision", "real", "decimal", "money"}
_TEMPORAL = {"timestamp without time zone", "timestamp with time zone", "date", "time without time zone"}


def physical_columns_typed(db: Session, table: str) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :t ORDER BY ordinal_position"
        ),
        {"t": table},
    ).fetchall()
    return [{"name": r[0], "type": r[1]} for r in rows]


def _infer_role_type(pg_type: str) -> tuple[str, str]:
    t = (pg_type or "").lower()
    if t in _TEMPORAL:
        return ("time", "date" if t == "date" else "datetime")
    if t in _NUMERIC:
        return ("measure", "integer" if t in ("integer", "bigint", "smallint") else "numeric")
    if t in ("boolean",):
        return ("dimension", "bool")
    return ("dimension", "text")


def sync_fields(db: Session, dataset: Dataset) -> dict:
    """把物理表里还没登记的列补成字段（只增不删，不覆盖已改过的定义）."""
    existing = {f.source_column for f in list_fields(db, dataset.id)}
    columns = physical_columns_typed(db, dataset.physical_table)
    added: list[str] = []
    for col in columns:
        if col["name"] in existing:
            continue
        role, data_type = _infer_role_type(col["type"])
        db.execute(
            text(
                "INSERT INTO bi_dataset_field "
                "(dataset_id, name, source_column, role, data_type) "
                "VALUES (:d, :n, :c, :r, :t) ON CONFLICT (dataset_id, name) DO NOTHING"
            ),
            {"d": dataset.id, "n": col["name"], "c": col["name"], "r": role, "t": data_type},
        )
        added.append(col["name"])
    db.commit()
    _touch(db, dataset.id)
    return {"added": len(added), "columns": len(columns), "new_fields": added}


def probe_sql_columns(db: Session, sql_text: str) -> list[dict]:
    """跑一次 LIMIT 1 拿到自定义 SQL 的输出列与样例值（建字段用）."""
    probe = f"SELECT * FROM ({sql_text}) AS __probe LIMIT 1"
    result = db.execute(text(probe))
    keys = list(result.keys())
    row = result.fetchone()
    out: list[dict] = []
    for idx, key in enumerate(keys):
        value = row[idx] if row is not None else None
        out.append({"name": str(key), "value": None if value is None else str(value)[:64]})
    return out


def list_physical_tables(db: Session) -> list[dict]:
    """可建数据集的物理表：内置白名单表 + 数据源同步表 / 文件导入表.

    每张表带 origin（内置 / 数据源 · 名称 / 文件 · 文件名），供新建数据集时挑选。
    """
    from app.query.whitelist import ALLOWED_TABLES

    rows = db.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type IN ('BASE TABLE','VIEW')"
        )
    ).fetchall()
    present = {r[0] for r in rows}

    registered: dict[str, dict] = {}
    try:
        for r in db.execute(
            text(
                "SELECT t.local_table, t.source_table, t.kind, s.name AS source_name "
                "FROM bi_source_table t LEFT JOIN bi_source s ON s.id = t.source_id"
            )
        ).fetchall():
            registered[r[0]] = {
                "source_table": r[1], "kind": r[2], "source_name": r[3] or "",
            }
    except Exception:
        registered = {}

    names = sorted((ALLOWED_TABLES & present) | (set(registered) & present))
    out: list[dict] = []
    for table in names:
        meta = registered.get(table)
        if not meta:
            origin = "内置"
        elif meta["kind"] == "file":
            origin = f"文件 · {meta['source_table']}"
        else:
            origin = f"数据源 · {meta['source_name'] or '已接入'}"
        try:
            count = db.execute(text(f'SELECT count(*) FROM "{table}"')).scalar() or 0
        except Exception:
            count = 0
        out.append({
            "table": table,
            "rows": int(count),
            "columns": physical_columns_typed(db, table),
            "origin": origin,
        })
    return out


__all__ = [
    "list_datasets", "get_dataset", "create_dataset", "update_dataset", "delete_dataset",
    "list_fields", "add_field", "update_field", "delete_field", "sync_fields",
    "list_metrics", "add_metric", "update_metric", "delete_metric",
    "list_physical_tables", "physical_columns_typed",
]
