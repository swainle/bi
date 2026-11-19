"""数据源接入层（Superset 的 Database）.

链路：数据源（连接 / 文件） → 选表同步成本地物理表 → 数据集 → 图表。

为什么同步落地而不是直连查询：
    图表查询走本地 PG 的查询内核（系统表保护 / 行级权限 / 脱敏 / 类型转换），
    直连外部库要重做一套安全与方言适配，风险远大于收益。
    同步是显式的（记录 row_count / synced_at），不假装直连。
"""

from __future__ import annotations

from app.timezone import as_china, time_text, utc_now

import hashlib
import io
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import quote_plus

import pandas as pd
from sqlalchemy import Column, MetaData, Numeric, Table, create_engine, inspect, select, text
from sqlalchemy.schema import SetColumnComment, SetTableComment
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.database import engine as local_engine
from app.services.crypto import decrypt, encrypt

MAX_ROWS = 200_000

# 源库里不需要暴露给用户的系统 schema
_SYSTEM_SCHEMAS = {
    "pg_catalog", "pg_toast", "information_schema", "pg_temp_1", "pg_toast_temp_1",
    "mysql", "performance_schema", "sys", "innodb", "sysaux", "system", "outln",
}

# 数据源类型 → SQLAlchemy 方言（驱动没装时引擎创建会直接抛错，错误信息会带驱动名）
TYPE_DIALECT: dict[str, str] = {
    "postgresql": "postgresql",
    "mysql": "mysql",
    "mariadb": "mysql",
    "tidb": "mysql",
    "doris": "mysql",
    "starrocks": "mysql",
    "clickhouse": "clickhouse",
    "sqlserver": "mssql",
    "oracle": "oracle",
    "db2": "ibm_db_sa",
    "kingbase": "postgresql",
    # Redshift 走 PostgreSQL 协议（psycopg2），不额外装第三方方言
    "redshift": "postgresql",
    "presto": "presto",
    "hive": "hive",
    "impala": "impala",
}

FILE_TYPES = ("csv", "excel")

# 源库连接池缓存：(数据源 id 或 None, 连接串指纹) → (engine, 建池时间)
_ENGINE_TTL = 3600
_engines: dict[tuple[int | None, str], tuple[Engine, float]] = {}
_engine_lock = threading.Lock()


class SourceError(Exception):
    """数据源操作失败（连不上 / 驱动缺失 / 表不存在 …）."""


def _ident(name: str) -> str:
    return '"' + str(name).replace('"', "") + '"'


def _slug(value: str) -> str:
    text_value = re.sub(r"[^0-9A-Za-z_]+", "_", value or "").strip("_").lower()
    return (text_value or "t")[:36]


# ── 结构快照 / 漂移 / 新鲜度 ─────────────────────────────

# 新鲜度阈值：24 小时内算新鲜，7 天内算待更新，再久算过期（导出看板的取数口径提示用）
FRESH_HOURS = 24
STALE_HOURS = 24 * 7


def diff_columns(old: list[dict] | None, new: list[dict] | None) -> dict:
    """对比两份字段快照（`[{name,type}]`），返回增 / 删 / 类型变更."""
    old_map = {str(c.get("name")): str(c.get("type") or "") for c in (old or [])}
    new_map = {str(c.get("name")): str(c.get("type") or "") for c in (new or [])}
    added = [{"name": n, "type": new_map[n]} for n in new_map if n not in old_map]
    removed = [{"name": n, "type": old_map[n]} for n in old_map if n not in new_map]
    changed = [
        {"name": n, "from": old_map[n], "to": new_map[n]}
        for n in new_map
        if n in old_map and old_map[n] != new_map[n]
    ]
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "has_changes": bool(added or removed or changed),
    }


def snapshot_hash(columns: list[dict] | None) -> str:
    """字段快照指纹（按字段名排序，只看「有哪些字段 + 类型」，列顺序变化不算变更）."""
    items = sorted(
        ({"name": str(c.get("name")), "type": str(c.get("type") or "")} for c in (columns or [])),
        key=lambda item: item["name"],
    )
    payload = json.dumps(items, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def freshness_of(synced_at: Any, now: datetime | None = None) -> dict:
    """数据新鲜度：fresh（<24h）/ aging（<7d）/ stale（更久）/ unknown."""
    if not synced_at:
        return {"level": "unknown", "age_hours": None}
    if isinstance(synced_at, str):
        try:
            synced_at = datetime.fromisoformat(synced_at.replace("Z", "+00:00"))
        except ValueError:
            return {"level": "unknown", "age_hours": None}
    current = as_china(now or utc_now())
    synced_at = as_china(synced_at)
    hours = max(0.0, (current - synced_at).total_seconds() / 3600)
    if hours < FRESH_HOURS:
        level = "fresh"
    elif hours < STALE_HOURS:
        level = "aging"
    else:
        level = "stale"
    return {"level": level, "age_hours": round(hours, 1)}


# 自动同步间隔：0 = 关闭；其余限制在 15 分钟 ~ 7 天（太短会把源库打爆）
SYNC_INTERVALS = (0, 60, 360, 1440)
SYNC_MIN_MINUTES = 15
SYNC_MAX_MINUTES = 60 * 24 * 7


def normalize_interval(minutes: Any) -> int:
    """校验自动同步间隔（分钟）."""
    try:
        value = int(minutes)
    except (TypeError, ValueError) as exc:
        raise SourceError("同步间隔必须是整数分钟") from exc
    if value == 0:
        return 0
    if value < SYNC_MIN_MINUTES or value > SYNC_MAX_MINUTES:
        raise SourceError(f"同步间隔需在 {SYNC_MIN_MINUTES} 分钟到 7 天之间（0 = 关闭）")
    return value


def next_sync_at(synced_at: Any, minutes: Any) -> datetime | None:
    """下次到期时间 = 上次同步 + 间隔；未开自动同步返回 None."""
    if not synced_at or not minutes:
        return None
    if isinstance(synced_at, str):
        try:
            synced_at = datetime.fromisoformat(synced_at.replace("Z", "+00:00"))
        except ValueError:
            return None
    if getattr(synced_at, "tzinfo", None) is not None:
        synced_at = synced_at.astimezone(timezone.utc).replace(tzinfo=None)
    try:
        return synced_at + timedelta(minutes=int(minutes))
    except (TypeError, ValueError):
        return None


def _remote_columns(eng: Engine, table: str) -> list[dict]:
    """读源表的字段快照（table 可写成 schema.name）."""
    schema, name = table.rsplit(".", 1) if "." in table else (None, table)
    insp = inspect(eng)
    cols = insp.get_columns(name, schema=schema)
    return [{"name": str(c["name"]), "type": str(c.get("type") or ""),
             "comment": str(c.get("comment") or "")} for c in cols]


# MySQL 家族：SQLAlchemy 的 `mysql://` 默认驱动是 MySQLdb（须编译安装），
# 仓库只带纯 Python 的 PyMySQL，所以统一拼 mysql+pymysql://
_MYSQL_FAMILY = {"mysql", "mariadb", "tidb", "doris", "starrocks"}

# SQL Server：统一走 pyodbc，驱动名按本机实际安装的 ODBC 驱动选
_MSSQL_FAMILY = {"mssql", "sqlserver", "tsql"}
_MSSQL_DEFAULT_DRIVER = "ODBC Driver 18 for SQL Server"


def mssql_driver() -> str:
    """SQL Server 用的 ODBC 驱动名.

    顺序：`BI_MSSQL_DRIVER` 显式指定 → 本机已注册的 Microsoft 驱动（18 / 17）→ FreeTDS。
    一个都没注册时仍返回 MS 驱动名，让 pyodbc 抛 IM002（「未找到数据源」），
    比报「方言不存在」更贴近真实原因。
    """
    override = (os.environ.get("BI_MSSQL_DRIVER") or "").strip()
    if override:
        return override
    try:
        import pyodbc

        installed = list(pyodbc.drivers())
    except Exception:  # 驱动包没装 / 非 pyodbc 环境
        installed = []
    for name in ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server"):
        if name in installed:
            return name
    if "FreeTDS" in installed:
        return "FreeTDS"
    return _MSSQL_DEFAULT_DRIVER


def _with_mssql_driver(url: str) -> str:
    """给 mssql+pyodbc 连接串补 driver 参数（已有则原样返回）."""
    if "driver=" in url.lower():
        return url
    driver = mssql_driver()
    extra = f"{'&' if '?' in url else '?'}driver={quote_plus(driver)}"
    if driver.lower().startswith("odbc driver"):
        # MS 驱动 18 默认强制加密，内网自签证书会握手失败
        extra += "&TrustServerCertificate=yes"
    return url + extra


def _driver_scheme(dialect: str, port: Any = None) -> str:
    """方言 → SQLAlchemy 连接串 scheme（驱动差异）.

    · MySQL 家族统一 `mysql+pymysql`（`mysql://` 默认要 MySQLdb）；
    · ClickHouse：8123 走 HTTP（`clickhouse+http`），其余按原生 9000（`clickhouse+native`）；
    · SQL Server 统一 `mssql+pyodbc`（driver 参数见 `_with_mssql_driver`）；
    · Oracle 统一 `oracle+oracledb`（`oracle://` 默认要 cx_Oracle，本仓库装的是 python-oracledb）；
    · Redshift 走 PostgreSQL 方言（TYPE_DIALECT 已收敛成 postgresql）；
      手填 URI 的照原样用。
    """
    if dialect in _MYSQL_FAMILY:
        return "mysql+pymysql"
    if dialect == "clickhouse":
        try:
            return "clickhouse+http" if int(port or 0) == 8123 else "clickhouse+native"
        except (TypeError, ValueError):
            return "clickhouse+native"
    if dialect in _MSSQL_FAMILY:
        return "mssql+pyodbc"
    if dialect == "oracle":
        return "oracle+oracledb"
    return dialect


def _normalize_driver(url: str) -> str:
    """手填的 URI 也收敛到已安装的驱动（`mysql://` / `mariadb://` → `mysql+pymysql://`）."""
    lowered = url.lower()
    for scheme in ("mysql", "mariadb"):
        if lowered.startswith(f"{scheme}://"):
            return "mysql+pymysql://" + url[len(scheme) + 3:]
    if lowered.startswith("clickhouse://"):
        return "clickhouse+native://" + url[len("clickhouse://"):]
    if lowered.startswith(("sqlserver://", "mssql://")):
        return _with_mssql_driver("mssql+pyodbc://" + url.split("://", 1)[1])
    if lowered.startswith("mssql+pyodbc://"):
        return _with_mssql_driver(url)
    # Oracle 只装了 python-oracledb；`oracle://` 会去找 cx_Oracle
    if lowered.startswith("oracle://"):
        return "oracle+oracledb://" + url[len("oracle://"):]
    # Redshift 走 PostgreSQL 协议
    if lowered.startswith(("redshift://", "redshift+psycopg2://", "redshift+redshift_connector://")):
        return "postgresql://" + url.split("://", 1)[1]
    return url


def build_url(src: dict) -> str:
    """拼连接串；MySQL 家族固定走 PyMySQL（`mysql://` 默认要 MySQLdb，本仓库没装）."""
    if (src.get("uri") or "").strip():
        return _normalize_driver(src["uri"].strip())
    ds_type = str(src.get("ds_type") or "").strip()
    if not ds_type:
        raise SourceError("请选择数据源类型，或直接填写连接串 URI")
    if ds_type not in TYPE_DIALECT:
        raise SourceError(f"暂未适配的数据源类型：{ds_type}（可在连接串 URI 里直连）")
    dialect = TYPE_DIALECT[ds_type]
    password = decrypt(src.get("password") or "")
    if password == "(无法解密)":
        raise SourceError("数据源密码无法解密（服务密钥可能变过），请重新填写密码")
    user = str(src.get("username") or "").strip()
    # 空密码不能拼成 `user:@host`：PyHive（Presto / Hive）会把空串当密码，
    # 报「Protocol must be https when passing a password」这类与真实原因无关的错
    auth = f"{user}:{password}@" if (user and password) else (f"{user}@" if user else "")
    host = str(src.get("host") or "127.0.0.1").strip()
    port = f":{int(src['port'])}" if src.get("port") else ""
    db_name = str(src.get("db_name") or "").strip()
    url = f"{_driver_scheme(dialect, src.get('port'))}://{auth}{host}{port}/{db_name}"
    if dialect in _MSSQL_FAMILY:
        url = _with_mssql_driver(url)
    return url


def engine_for(src: dict) -> Engine:
    """源库引擎（按连接串指纹缓存，避免每次测连通 / 同步都新建连接池）.

    与直连查询（`app/query/live.engine_for_source`）刻意分开：这里用于批量同步 / 表清单，
    不设 statement_timeout（几十万行的同步会长于 30s）；直连查询则必须限时。
    """
    url = build_url(src)
    fingerprint = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    key = (int(src["id"]) if src.get("id") else None, fingerprint)
    now = time.time()
    with _engine_lock:
        cached = _engines.get(key)
        if cached and now - cached[1] < _ENGINE_TTL:
            return cached[0]
    try:
        kwargs: dict[str, Any] = {"pool_pre_ping": True, "pool_recycle": 1800}
        if url.startswith(("postgresql", "mysql")):
            kwargs["connect_args"] = {"connect_timeout": 8}
        elif url.startswith("clickhouse+native"):
            kwargs["connect_args"] = {
                "connect_timeout": 8,
                # 列名优先于别名：否则 `toStartOfMonth(dt) AS dt` 的 GROUP BY/ORDER BY 会报错
                "settings": {"prefer_column_name_to_alias": 1},
            }
        elif url.startswith("mssql+pyodbc"):
            # pyodbc 的登录超时（秒），单位与 connect_timeout 不同
            kwargs["connect_args"] = {"timeout": 8}
        eng = create_engine(url, **kwargs)
    except ModuleNotFoundError as exc:
        raise SourceError(f"该类型的驱动未安装：{exc.name}（装好驱动后重试）") from exc
    except Exception as exc:  # URL 不合法 / 方言不可用
        raise SourceError(f"连接配置有误：{str(exc)[:160]}") from exc
    with _engine_lock:
        _engines[key] = (eng, now)
        # 同一个数据源改过地址 / 密码：旧指纹的连接池直接释放
        if key[0] is not None:
            for old_key in [k for k in _engines if k[0] == key[0] and k != key]:
                old_eng, _ = _engines.pop(old_key)
                old_eng.dispose()
    return eng


def test_source(src: dict) -> dict:
    try:
        eng = engine_for(src)
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "message": "连接成功"}
    except SourceError:
        raise
    except Exception as exc:
        # 先压成一句人话再落 180 字：驱动原文里的 SQLAlchemy 文档尾巴对用户没用
        raise SourceError(f"连接失败：{clean_probe_error(exc)[:180]}") from exc


def test_payload(payload: dict) -> dict:
    """按未落库的配置测连通（新建对话框用，不产生临时数据源）."""
    src = {
        "ds_type": str(payload.get("ds_type") or "").strip(),
        "host": str(payload.get("host") or "").strip(),
        "port": payload.get("port"),
        "db_name": str(payload.get("db_name") or "").strip(),
        "username": str(payload.get("username") or "").strip(),
        "password": encrypt(str(payload.get("password") or "")),
        "uri": str(payload.get("uri") or "").strip(),
    }
    return test_source(src)


def list_remote_tables(src: dict) -> list[dict]:
    """列出源库里的表 **和视图**，覆盖 public 之外的 schema（如 dm.v_pdd_bangdan）."""
    try:
        eng = engine_for(src)
        insp = inspect(eng)
        try:
            schemas: list[str | None] = [
                s for s in insp.get_schema_names()
                if (s or "").lower() not in _SYSTEM_SCHEMAS
            ]
        except Exception:
            schemas = [None]

        out: list[dict] = []
        for schema in schemas:
            try:
                found = [(n, "table") for n in insp.get_table_names(schema=schema)]
                found += [(n, "view") for n in insp.get_view_names(schema=schema)]
            except Exception:
                continue
            for name, kind in found:
                qualified = name if schema in (None, "public") else f"{schema}.{name}"
                column_types: dict[str, str] = {}
                try:
                    raw_cols = insp.get_columns(name, schema=schema)
                    columns = [c["name"] for c in raw_cols]
                    column_types = {c["name"]: str(c.get("type") or "") for c in raw_cols}
                except Exception:
                    columns = []
                out.append({
                    "table": qualified,
                    "schema": schema or "",
                    "kind": kind,
                    "columns": columns,
                    "column_types": column_types,
                })
        out.sort(key=lambda item: item["table"].lower())
        return out
    except SourceError:
        raise
    except Exception as exc:
        raise SourceError(f"读取源库表清单失败：{str(exc)[:180]}") from exc


def _read_remote(eng: Engine, table: str, on_progress=None) -> pd.DataFrame:
    """读源表/视图；table 可写成 schema.name（如 dm.v_pdd_bangdan）."""
    schema, name = table.rsplit(".", 1) if "." in table else (None, table)
    meta = MetaData()
    try:
        tbl = Table(name, meta, schema=schema, autoload_with=eng)
    except Exception as exc:
        raise SourceError(f"源表不存在或无权访问：{table}") from exc
    stmt = select(tbl).limit(MAX_ROWS + 1)
    with eng.connect() as conn:
        result = conn.execute(stmt)
        keys = list(result.keys())
        rows = []
        while chunk := result.fetchmany(1000):
            rows.extend(dict(r._mapping) for r in chunk)
            if len(rows) > MAX_ROWS:
                raise SourceError(f"源表超过 {MAX_ROWS:,} 行接入上限，未写入本地表，请缩小源表或使用直连数据集")
            if on_progress:
                on_progress("reading", len(rows))
    return pd.DataFrame(rows, columns=keys)


def _decimal_dtypes(df: pd.DataFrame) -> dict[str, Any]:
    """pandas 推断不出 decimal，object 列里的 Decimal 会被 to_sql 写成 text（金额精度直接丢）.
    显式给成 NUMERIC，值仍是 Decimal，原样落库."""
    dtypes: dict[str, Any] = {}
    for column in df.columns:
        values = df[column].dropna()
        if len(values) and all(isinstance(v, Decimal) for v in values):
            dtypes[column] = Numeric()
    return dtypes


def _local_columns(table: str) -> set[str]:
    with local_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t"
            ),
            {"t": table},
        ).fetchall()
    return {r[0] for r in rows}


def _as_date(value: Any) -> Any:
    """DateTime/Timestamp → date；其余（含 None）原样返回."""
    return value.date() if hasattr(value, "date") and not isinstance(value, type) else value


def _write_local(df: pd.DataFrame, table: str, on_progress=None) -> dict:
    """写本地物理表（图表查询读的就是它）.

    源里有 `dt` 列且本地表结构一致 → **按 dt 幂等追加**：只删掉这批 dt、再插入，
    历史快照原样保留（重复跑结果相同）。
    无 dt / 表结构变了 → 回退覆盖重写。
    """
    if df.empty and not len(df.columns):
        raise SourceError("没有可导入的数据（表为空且无列）")

    existing = _local_columns(table)
    appendable = bool(existing) and "dt" in df.columns and existing == set(df.columns)
    written = 0

    def write_chunk(pd_table, conn, keys, data_iter):
        nonlocal written
        values = [dict(zip(keys, row)) for row in data_iter]
        conn.execute(pd_table.table.insert(), values)
        written += len(values)
        on_progress("writing", written)
        return len(values)

    if appendable:
        dts = sorted({_as_date(v) for v in df["dt"].dropna()})
        dts = [d for d in dts if d is not None]
        with local_engine.begin() as conn:
            if dts:
                conn.execute(
                    text(f"DELETE FROM {_ident(table)} WHERE dt = ANY(:dts)"),
                    {"dts": dts},
                )
            df.to_sql(table, conn, index=False, if_exists="append",
                      method=write_chunk if on_progress else "multi", chunksize=500, dtype=_decimal_dtypes(df) or None)
        return {"mode": "append", "dt": [str(d) for d in dts]}

    with local_engine.begin() as conn:
        df.to_sql(table, conn, index=False, if_exists="replace",
                  method=write_chunk if on_progress else "multi", chunksize=500, dtype=_decimal_dtypes(df) or None)
    return {"mode": "replace", "dt": []}


def _sync_stats(table: str) -> dict:
    """本地表落地后的统计：总行数 + 日期范围（有 dt 才有）."""
    with local_engine.connect() as conn:
        if "dt" in _local_columns(table):
            row = conn.execute(
                text(f"SELECT count(*), min(dt), max(dt), count(DISTINCT dt) FROM {_ident(table)}")
            ).fetchone()
            return {"rows": int(row[0]), "dt_min": row[1], "dt_max": row[2], "dt_count": int(row[3])}
        row = conn.execute(text(f"SELECT count(*) FROM {_ident(table)}")).fetchone()
    return {"rows": int(row[0]), "dt_min": None, "dt_max": None, "dt_count": 0}


# ── 已接入表登记 ───────────────────────────────────────────
def _register(db: Session, *, source_id: int | None, source_table: str, local_table: str,
              stats: dict, kind: str, owner_id: int | None,
              columns: list[dict] | None = None) -> None:
    """登记已接入表；同时落下字段快照（基线），并把上一次的漂移清空."""
    snapshot = json.dumps(columns or [], ensure_ascii=False)
    db.execute(
        text(
            "INSERT INTO bi_source_table "
            "  (source_id, source_table, local_table, row_count, dt_min, dt_max, dt_count, kind, owner_id, "
            "   synced_at, columns_snapshot, schema_hash, checked_at, drift) "
            "VALUES (:s, :st, :lt, :rc, :dmin, :dmax, :dcnt, :k, :o, "
            "        now(), CAST(:snap AS jsonb), :hash, now(), NULL) "
            "ON CONFLICT (local_table) DO UPDATE SET "
            "  source_table = :st, row_count = :rc, dt_min = :dmin, dt_max = :dmax, "
            "  dt_count = :dcnt, synced_at = now(), "
            "  columns_snapshot = CAST(:snap AS jsonb), schema_hash = :hash, checked_at = now(), drift = NULL"
        ),
        {"s": source_id, "st": source_table, "lt": local_table,
         "rc": int(stats.get("rows") or 0),
         "dmin": stats.get("dt_min"), "dmax": stats.get("dt_max"),
         "dcnt": int(stats.get("dt_count") or 0),
         "k": kind, "o": owner_id,
         "snap": snapshot, "hash": snapshot_hash(columns)},
    )
    db.commit()


def list_source_tables(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT t.*, s.name AS source_name, s.ds_type, "
            " (SELECT count(*) FROM bi_dataset d WHERE d.physical_table = t.local_table) AS dataset_count "
            "FROM bi_source_table t LEFT JOIN bi_source s ON s.id = t.source_id "
            "ORDER BY t.synced_at DESC, t.id DESC"
        )
    ).fetchall()
    out = []
    for r in rows:
        m = dict(r._mapping)
        fresh = freshness_of(m.get("synced_at"))
        snapshot = m.get("columns_snapshot") or []
        interval = m.get("sync_interval_minutes") or 0
        nxt = next_sync_at(m.get("synced_at"), interval)
        out.append({
            "id": m["id"], "source_id": m["source_id"], "source_table": m["source_table"],
            "local_table": m["local_table"], "row_count": m["row_count"], "kind": m["kind"],
            "owner_id": m["owner_id"], "synced_at": time_text(m["synced_at"] or ""),
            "dt_min": str(m["dt_min"] or ""), "dt_max": str(m["dt_max"] or ""),
            "dt_count": m.get("dt_count", 0) or 0,
            "source_name": m["source_name"] or "", "ds_type": m["ds_type"] or "",
            "dataset_count": m["dataset_count"],
            # 结构 / 新鲜度（P4）：字段数、指纹、上次检查时间、漂移明细
            "column_count": len(snapshot), "schema_hash": m.get("schema_hash") or "",
            "checked_at": time_text(m.get("checked_at") or ""),
            "drift": m.get("drift") or None,
            "freshness": fresh["level"], "age_hours": fresh["age_hours"],
            # 自动同步（P4 第三批）
            "sync_interval_minutes": interval,
            "next_sync_at": time_text(nxt or ""),
            "last_sync_status": m.get("last_sync_status") or "",
            "last_sync_error": m.get("last_sync_error") or "",
        })
    return out


def _local_name(prefix: str, source_id: int | None, table: str) -> str:
    seed = f"{source_id}:{table}" if source_id else table
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:6]
    sid = f"{source_id}_" if source_id else ""
    return f"{prefix}_{sid}{_slug(table)}_{digest}"[:110]


def run_refresh_sql(src_row: dict) -> dict:
    """执行数据源上配置的远端刷新语句（如 select dm.refresh_bangdan()）.

    只接受单条 SELECT —— 它跑在别人的库上，不给写权限口子。
    """
    sql_text = str(src_row.get("refresh_sql") or "").strip()
    if not sql_text:
        return {"skipped": True}
    lowered = sql_text.lower()
    if not lowered.startswith("select") or ";" in sql_text.rstrip(";").strip():
        raise SourceError("刷新语句必须是单条 SELECT（如 select dm.refresh_bangdan()）")
    eng = engine_for(src_row)
    try:
        with eng.begin() as conn:
            value = conn.execute(text(sql_text)).scalar()
    except Exception as exc:
        raise SourceError(f"刷新语句执行失败：{str(exc)[:160]}") from exc
    return {"skipped": False, "result": str(value)}


def sync_tables(db: Session, src_row: dict, tables: list[str], owner_id: int | None,
                on_progress=None, refresh: bool = True) -> dict:
    if not tables:
        raise SourceError("请至少选择一张表")
    refreshed = run_refresh_sql(src_row) if refresh else {"skipped": True}
    eng = engine_for(src_row)
    created: list[dict] = []
    for table in tables:
        df = _read_remote(eng, table, on_progress)
        # 结构快照取源库真实定义（类型来自 inspector，比 pandas 推断准）
        try:
            columns = _remote_columns(eng, table)
        except Exception:
            columns = [{"name": str(c), "type": ""} for c in df.columns]
        local = _local_name("bi_src", src_row["id"], table)
        if on_progress:
            on_progress("writing", 0)
        write_info = _write_local(df, local, on_progress)
        stats = _sync_stats(local)
        _register(db, source_id=src_row["id"], source_table=table, local_table=local,
                  stats=stats, kind="db", owner_id=owner_id, columns=columns)
        created.append({
            "source_table": table, "local_table": local,
            "rows": stats["rows"], "rows_in_batch": int(len(df)),
            "mode": write_info["mode"], "dt": write_info["dt"],
            "dt_min": str(stats["dt_min"] or ""), "dt_max": str(stats["dt_max"] or ""),
            "dt_count": stats["dt_count"],
            "columns": [str(c) for c in df.columns],
        })
    return {"refresh": refreshed, "tables": created}


def import_file(db: Session, content: bytes, filename: str, owner_id: int | None) -> dict:
    lower = (filename or "").lower()
    try:
        if lower.endswith((".csv", ".txt", ".tsv")):
            df = pd.read_csv(io.BytesIO(content), sep="\t" if lower.endswith(".tsv") else ",")
        elif lower.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        elif lower.endswith(".json"):
            df = pd.read_json(io.BytesIO(content))
        else:
            raise SourceError("只支持 CSV / Excel / JSON 文件")
    except SourceError:
        raise
    except Exception as exc:
        raise SourceError(f"文件解析失败：{str(exc)[:160]}") from exc

    if df.empty and not len(df.columns):
        raise SourceError("文件里没有可导入的数据")
    df.columns = [str(c).strip() or f"col_{i}" for i, c in enumerate(df.columns)]

    stem = os.path.splitext(os.path.basename(filename))[0]
    local = _local_name("bi_imp", None, f"{stem}_{hashlib.sha1(content[:4096]).hexdigest()[:6]}")
    write_info = _write_local(df, local)
    stats = _sync_stats(local)
    _register(db, source_id=None, source_table=filename, local_table=local,
              stats=stats, kind="file", owner_id=owner_id,
              columns=[{"name": str(c), "type": str(df[c].dtype)} for c in df.columns])
    return {"local_table": local, "rows": stats["rows"], "mode": write_info["mode"],
            "columns": [str(c) for c in df.columns], "filename": filename}


def drop_source_table(db: Session, table_id: int) -> dict:
    row = db.execute(
        text("SELECT local_table FROM bi_source_table WHERE id = :id"), {"id": table_id}
    ).fetchone()
    if row is None:
        raise SourceError("已接入表不存在")
    local = row[0]
    used = db.execute(
        text("SELECT name FROM bi_dataset WHERE physical_table = :t LIMIT 3"), {"t": local}
    ).fetchall()
    if used:
        names = "、".join(u[0] for u in used)
        raise SourceError(f"这些数据集还在用它：{names}，先删数据集再移除表")
    with local_engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_ident(local)}"))
    db.execute(text("DELETE FROM bi_source_table WHERE id = :id"), {"id": table_id})
    db.commit()
    return {"deleted": True, "id": table_id}


def check_source_schema(db: Session, src_row: dict) -> dict:
    """检查该数据源下所有已接入表的字段是否变了（只读远端结构，不重拉数据）.

    结果落 `bi_source_table.drift`：有变更才写，没变更清空（避免旧告警一直挂着）。
    """
    eng = engine_for(src_row)
    rows = db.execute(
        text(
            "SELECT id, source_table, columns_snapshot, schema_hash FROM bi_source_table "
            "WHERE source_id = :s AND kind = 'db' ORDER BY id"
        ),
        {"s": src_row["id"]},
    ).fetchall()
    tables: list[dict] = []
    for r in rows:
        item = {"id": r._mapping["id"], "source_table": r._mapping["source_table"]}
        try:
            columns = _remote_columns(eng, item["source_table"])
        except Exception as exc:
            item["error"] = f"读取源表结构失败：{str(exc)[:140]}"
            tables.append(item)
            continue
        old = r._mapping["columns_snapshot"]
        if not old:
            # 迁移前接入的表没有基线：这次检查只补基线，不报变更（避免把全部列当「新增」吓人）
            db.execute(
                text(
                    "UPDATE bi_source_table SET checked_at = now(), columns_snapshot = CAST(:snap AS jsonb), "
                    "  schema_hash = :hash, drift = NULL WHERE id = :id"
                ),
                {
                    "snap": json.dumps(columns, ensure_ascii=False),
                    "hash": snapshot_hash(columns),
                    "id": item["id"],
                },
            )
            item.update({"has_changes": False, "baseline": True, "column_count": len(columns)})
            tables.append(item)
            continue
        drift = diff_columns(old, columns)
        db.execute(
            text("UPDATE bi_source_table SET checked_at = now(), drift = CAST(:d AS jsonb) WHERE id = :id"),
            {
                "d": json.dumps(drift, ensure_ascii=False) if drift["has_changes"] else None,
                "id": item["id"],
            },
        )
        item.update({
            "has_changes": drift["has_changes"],
            "added": drift["added"], "removed": drift["removed"], "changed": drift["changed"],
            "column_count": len(columns),
        })
        tables.append(item)
    db.commit()
    return {
        "checked": len(tables),
        "changed": sum(1 for t in tables if t.get("has_changes") or t.get("error")),
        "tables": tables,
    }


def sync_table_metadata(db: Session, table_id: int) -> dict:
    """只将源表与匹配字段的注释写入本地表，不重建表、不读写业务行。"""
    row = db.execute(text("SELECT source_id, source_table, local_table, kind "
                          "FROM bi_source_table WHERE id = :id"), {"id": table_id}).first()
    if row is None:
        raise SourceError("已接入表不存在")
    source_id, source_table, local_table, kind = row
    if kind != "db" or not source_id:
        raise SourceError("文件导入的表没有可同步的源库注释，请重新上传文件")
    source = get_source(db, int(source_id))
    if source is None:
        raise SourceError("数据源已不存在")
    remote_engine = engine_for(source)
    schema, name = source_table.rsplit(".", 1) if "." in source_table else (None, source_table)
    try:
        columns = _remote_columns(remote_engine, source_table)
        comment = inspect(remote_engine).get_table_comment(name, schema=schema).get("text")
    except Exception as exc:
        raise SourceError("读取源库表和字段注释失败，未修改本地注释") from exc
    with local_engine.begin() as conn:
        local_columns = inspect(conn).get_columns(local_table, schema="public")
        table = Table(local_table, MetaData(), *(Column(col["name"]) for col in local_columns),
                      schema="public", comment=comment or None)
        conn.execute(SetTableComment(table))
        synced = 0
        missing = []
        for column in columns:
            if column["name"] not in table.c:
                missing.append(column["name"])
                continue
            local_column = table.c[column["name"]]
            local_column.comment = column.get("comment") or None
            conn.execute(SetColumnComment(local_column))
            synced += 1
    return {"table_id": table_id, "local_table": local_table,
            "columns_synced": synced, "missing_columns": missing}


def resync_table(db: Session, table_id: int, owner_id: int | None) -> dict:
    """重新同步单张已接入表（重拉数据 + 刷新结构快照 + 清空漂移）."""
    row = db.execute(
        text("SELECT source_id, source_table, kind FROM bi_source_table WHERE id = :id"),
        {"id": table_id},
    ).fetchone()
    if row is None:
        raise SourceError("已接入表不存在")
    source_id, source_table, kind = row[0], row[1], row[2]
    if kind != "db" or not source_id:
        raise SourceError("文件导入的表不支持重新同步，请重新导入文件")
    src = get_source(db, int(source_id))
    if src is None:
        raise SourceError("这张表绑定的数据源已不存在")
    try:
        result = sync_tables(db, src, [source_table], owner_id)
    except Exception as exc:
        record_sync_result(db, table_id, ok=False, error=str(exc)[:300])
        raise
    record_sync_result(db, table_id, ok=True)
    synced = (result.get("tables") or [{}])[0]
    return {"table_id": table_id, "source_table": source_table, "synced": synced,
            "refresh": result.get("refresh")}


def record_sync_result(db: Session, table_id: int, *, ok: bool, error: str | None = None) -> None:
    """记录最近一次同步结果（ok / failed + 原因），供列表与页面提示用."""
    db.execute(
        text(
            "UPDATE bi_source_table SET last_sync_status = :st, last_sync_error = :err WHERE id = :id"
        ),
        {"st": "ok" if ok else "failed", "err": None if ok else (error or "")[:300], "id": table_id},
    )
    db.commit()


def set_sync_interval(db: Session, table_id: int, minutes: Any) -> dict:
    """设置单表自动同步间隔（0 = 关闭）."""
    value = normalize_interval(minutes)
    row = db.execute(
        text("SELECT kind FROM bi_source_table WHERE id = :id"), {"id": table_id}
    ).fetchone()
    if row is None:
        raise SourceError("已接入表不存在")
    if value and row[0] != "db":
        raise SourceError("文件导入的表不支持自动同步")
    db.execute(
        text("UPDATE bi_source_table SET sync_interval_minutes = :m WHERE id = :id"),
        {"m": value, "id": table_id},
    )
    db.commit()
    return {"id": table_id, "sync_interval_minutes": value}


def due_tables(db: Session, limit: int = 5) -> list[dict]:
    """到期需要自动同步的表（synced_at + 间隔 <= now）."""
    rows = db.execute(
        text(
            "SELECT id, source_id, source_table, local_table, sync_interval_minutes, synced_at "
            "FROM bi_source_table "
            "WHERE kind = 'db' AND source_id IS NOT NULL AND sync_interval_minutes > 0 "
            "  AND synced_at <= now() - make_interval(mins => sync_interval_minutes) "
            "ORDER BY synced_at ASC, id ASC LIMIT :lim"
        ),
        {"lim": max(1, int(limit))},
    ).fetchall()
    return [dict(r._mapping) for r in rows]


# ── 数据源 CRUD ────────────────────────────────────────────
def _public(row) -> dict:
    m = row._mapping
    return {
        "id": m["id"], "name": m["name"], "ds_type": m["ds_type"],
        "host": m["host"] or "", "port": m["port"], "db_name": m["db_name"] or "",
        "username": m["username"] or "", "uri": bool(m["uri"]),
        "dept_id": m.get("dept_id"),
        "created_at": time_text(m["created_at"] or ""), "updated_at": time_text(m["updated_at"] or ""),
    }


def list_sources(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT s.*, d.name AS dept_name, "
            "  (SELECT count(*) FROM bi_source_table t WHERE t.source_id = s.id) AS table_count "
            "FROM bi_source s LEFT JOIN departments d ON d.id = s.dept_id "
            "ORDER BY s.id DESC"
        )
    ).fetchall()
    out = []
    for row in rows:
        item = _public(row)
        item["table_count"] = row._mapping["table_count"]
        item["dept_name"] = row._mapping.get("dept_name") or ""
        out.append(item)
    return out


def get_source(db: Session, source_id: int) -> dict | None:
    row = db.execute(text("SELECT * FROM bi_source WHERE id = :id"), {"id": source_id}).fetchone()
    return dict(row._mapping) if row else None


def create_source(db: Session, payload: dict, owner_id: int | None) -> dict:
    name = str(payload.get("name") or "").strip()
    ds_type = str(payload.get("ds_type") or "").strip()
    if not name:
        raise SourceError("数据源名称不能为空")
    if ds_type not in TYPE_DIALECT and not str(payload.get("uri") or "").strip():
        raise SourceError(f"暂未适配的数据源类型：{ds_type}（可在连接串 URI 里直连）")
    exists = db.execute(text("SELECT 1 FROM bi_source WHERE name = :n"), {"n": name}).fetchone()
    if exists:
        raise SourceError(f"数据源名称已存在：{name}")
    row = db.execute(
        text(
            "INSERT INTO bi_source (name, ds_type, host, port, db_name, username, password, uri, "
            "  owner_id, dept_id) "
            "VALUES (:n, :t, :h, :p, :d, :u, :pw, :uri, :o, :dept) RETURNING *"
        ),
        {
            "n": name, "t": ds_type,
            "h": str(payload.get("host") or "").strip(),
            "p": int(payload["port"]) if payload.get("port") else None,
            "d": str(payload.get("db_name") or "").strip(),
            "u": str(payload.get("username") or "").strip(),
            "pw": encrypt(str(payload.get("password") or "")),
            "uri": str(payload.get("uri") or "").strip(),
            "o": owner_id,
            "dept": payload.get("dept_id") or None,
        },
    ).fetchone()
    db.commit()
    row = db.execute(text(
        "SELECT s.*, d.name AS dept_name FROM bi_source s "
        "LEFT JOIN departments d ON d.id = s.dept_id WHERE s.id = :i"
    ), {"i": int(row._mapping["id"])}).fetchone()
    item = _public(row)
    item["dept_name"] = row._mapping.get("dept_name") or ""
    return item


def clean_probe_error(text: object) -> str:
    """把驱动的长报错压成一句能放进 tooltip 的话.

    去掉三截噪音：SQLAlchemy 的 `(Background on this error at: …)` 尾巴、
    `(psycopg2.OperationalError)` 这类驱动前缀、以及开头重复的状态词（tooltip 自己会写「连接失败」）。
    """
    msg = str(text or "").strip()
    for marker in ("\n\n(Background on this error at:", "\n(Background on this error at:"):
        if marker in msg:
            msg = msg.split(marker)[0]
    msg = re.sub(r"\([A-Za-z_][A-Za-z0-9_.]*Error\)\s*", "", msg)
    msg = re.sub(r"^连接失败[：:]\s*", "", msg)
    # 驱动的缩进换行（psycopg 的 "…\n\tIs the server running…"）压成一行，弹窗 / tooltip 都不跳行
    msg = re.sub(r"\s+", " ", msg).strip()
    return msg[:180] or "未知原因"


def apply_source_overrides(src: dict, overrides: dict | None) -> dict:
    """把「还没落库的修改」叠到已存配置上 —— 只给测连通 / 列表预览用，绝不写库.

    - 没给（或给了 null）的键沿用原值：前端只送用户真正改过的字段；
    - `password` 空串 / 缺省沿用已存密文，改主机时不必重新输密码；
    - `uri` 显式给空串 = 清掉连接串、改回主机 + 端口模式。
    """
    merged = dict(src)
    overrides = overrides or {}
    for key in ("ds_type", "host", "db_name", "username", "uri"):
        if overrides.get(key) is not None:
            merged[key] = str(overrides[key]).strip()
    if "port" in overrides and overrides.get("port") is not None:
        port = overrides.get("port")
        merged["port"] = int(port) if str(port).strip() else None
    if overrides.get("password"):
        merged["password"] = encrypt(str(overrides["password"]))
    return merged


def update_source(db: Session, source_id: int, payload: dict) -> dict:
    """编辑数据源（改主机 / 端口 / 库名 / 账号 / 密码 / 连接串 / 名称 / 归属部门）.

    `uri` 键缺席 = 保留原连接串；显式给空串 = 清空连接串、改用主机+端口。
    """
    current = get_source(db, source_id)
    if current is None:
        raise SourceError("数据源不存在")
    name = str(payload.get("name", current["name"]) or "").strip()
    if not name:
        raise SourceError("数据源名称不能为空")
    dup = db.execute(
        text("SELECT 1 FROM bi_source WHERE name = :n AND id <> :id"), {"n": name, "id": source_id}
    ).fetchone()
    if dup:
        raise SourceError(f"数据源名称已存在：{name}")
    password = current["password"]
    if payload.get("password"):
        password = encrypt(str(payload["password"]))
    uri = (
        str(payload.get("uri") or "").strip()
        if "uri" in payload
        else str(current.get("uri") or "").strip()
    )
    dept_id = current.get("dept_id")
    if "dept_id" in payload:
        dept_id = payload.get("dept_id") or None
    db.execute(
        text(
            "UPDATE bi_source SET name = :n, host = :h, port = :p, db_name = :d, "
            " username = :u, password = :pw, uri = :uri, dept_id = :dept, updated_at = now() "
            "WHERE id = :id"
        ),
        {
            "n": name,
            "h": str(payload.get("host", current["host"]) or "").strip(),
            "p": int(payload["port"]) if payload.get("port") else current["port"],
            "d": str(payload.get("db_name", current["db_name"]) or "").strip(),
            "u": str(payload.get("username", current["username"]) or "").strip(),
            "pw": password,
            "uri": uri,
            "dept": dept_id,
            "id": source_id,
        },
    )
    db.commit()
    row = db.execute(text(
        "SELECT s.*, d.name AS dept_name FROM bi_source s "
        "LEFT JOIN departments d ON d.id = s.dept_id WHERE s.id = :i"
    ), {"i": source_id}).fetchone()
    item = _public(row)
    item["dept_name"] = row._mapping.get("dept_name") or ""
    return item


def delete_source(db: Session, source_id: int) -> dict:
    db.execute(select(text("id")).select_from(text("bi_source"))
               .where(text("id = :id")).with_for_update(), {"id": source_id})
    active = db.execute(text("SELECT 1 FROM bi_source_import WHERE source_id = :id "
                             "AND state IN ('queued','reading','writing') LIMIT 1"), {"id": source_id}).first()
    if active:
        raise SourceError("该数据源还有等待或执行中的导入任务，请完成后再删除")
    # 直连数据集直接绑 source_id（查的是源库，不经过已接入表），必须单独拦
    live_used = db.execute(
        text(
            "SELECT name FROM bi_dataset "
            "WHERE source_id = :id AND COALESCE(conn_mode, 'extract') = 'live' ORDER BY id"
        ),
        {"id": source_id},
    ).fetchall()
    if live_used:
        names = [r[0] for r in live_used]
        more = f" 等 {len(names)} 个" if len(names) > 3 else ""
        raise SourceError(
            f"有直连数据集在用它：{'、'.join(names[:3])}{more}，先删掉这些数据集或改绑其它数据源"
        )

    tables = db.execute(
        text("SELECT local_table FROM bi_source_table WHERE source_id = :id"), {"id": source_id}
    ).fetchall()
    used = []
    for t in tables:
        hit = db.execute(
            text("SELECT name FROM bi_dataset WHERE physical_table = :t LIMIT 1"), {"t": t[0]}
        ).fetchone()
        if hit:
            used.append(hit[0])
    if used:
        raise SourceError(f"这些数据集还在用它同步的表：{'、'.join(used[:3])}，先删数据集再删数据源")
    for t in tables:
        with local_engine.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {_ident(t[0])}"))
    db.execute(text("DELETE FROM bi_source_table WHERE source_id = :id"), {"id": source_id})
    db.execute(text("DELETE FROM bi_source WHERE id = :id"), {"id": source_id})
    db.commit()
    return {"deleted": True, "id": source_id}


__all__ = [
    "SourceError", "TYPE_DIALECT", "FILE_TYPES",
    "test_source", "test_payload", "list_remote_tables", "sync_tables", "import_file",
    "list_sources", "get_source", "create_source", "update_source", "delete_source",
    "list_source_tables", "drop_source_table", "build_url",
    "check_source_schema", "resync_table", "sync_table_metadata", "diff_columns", "snapshot_hash", "freshness_of",
    "normalize_interval", "next_sync_at", "set_sync_interval", "record_sync_result",
    "due_tables", "SYNC_INTERVALS",
]
