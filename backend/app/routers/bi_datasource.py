"""BI 数据源连接引擎 — 支持 OLTP/OLAP/数据湖/API/文件五大类 24 种数据源."""

from __future__ import annotations

import json
import os
import sqlite3  # 本地 SQLite 直连
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.routers.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/bi/datasource", tags=["BI数据源"])


# ====== 安全：SQL 只读网关（app/security 内核）======

from app.security.errors import SecurityError
from app.security.sql_guard import guard_readonly, to_sql


def _validate_sql(sql: str, max_rows: int = 1000, dialect: str | None = None) -> str:
    """只读校验（sqlglot AST）+ 强制行数上限.

    对接外部数据源时方言未知，交给 sqlglot 自动识别；
    校验内容：单条语句 / 仅 SELECT 家族 / 无 DDL,DML / 无危险函数。
    """
    try:
        root = guard_readonly(sql, dialect=dialect)
    except SecurityError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    # 没有 LIMIT 就补一个，防全表扫描撑爆内存
    if root.args.get("limit") is None:
        root = root.limit(max_rows)

    return to_sql(root, dialect=dialect or "postgres")


# ====== 请求体 ======

class DsTestRequest(BaseModel):
    """测试连接请求."""
    type: str           # mysql / postgresql / clickhouse / api / excel / csv ...
    host: str = ""
    port: int = 0
    dbName: str = ""
    username: str = ""
    password: str = ""
    url: str = ""
    filePath: str = ""


class DsQueryRequest(BaseModel):
    """执行查询请求."""
    type: str
    host: str = ""
    port: int = 0
    dbName: str = ""
    username: str = ""
    password: str = ""
    url: str = ""
    filePath: str = ""
    sql: str = ""         # SQL 查询（数据库类）
    method: str = "GET"   # HTTP 方法（API 类）
    queryPath: str = ""   # API 路径


# ====== 数据库驱动映射 ======

DIALECT_MAP: dict[str, str] = {
    "mysql":       "mysql+pymysql",
    "mariadb":     "mysql+pymysql",
    "postgresql":  "postgresql+psycopg2",
    "clickhouse":  "clickhouse+http",      # 需 clickhouse-driver
    "sqlserver":   "mssql+pymssql",         # 需 pymssql
    "oracle":      "oracle+cx_oracle",      # 需 cx_Oracle
    "db2":         "db2+ibm_db",            # 需 ibm_db
    "tidb":        "mysql+pymysql",
    "dm":          "mysql+pymysql",          # 达梦兼容 MySQL 协议
    "kingbase":    "postgresql+psycopg2",
    "mongodb":     "mongodb",               # 需 pymongo
    "mongodb_bi":  "mysql+pymysql",         # BI Connector 兼容 MySQL
    "doris":       "mysql+pymysql",         # Doris 兼容 MySQL 协议
    "starrocks":   "mysql+pymysql",
    "impala":      "impala",                # 需 impyla
    "presto":      "presto",                # 需 pyhive
    "kylin":       "kylin",                 # 需 kylinpy
    "elasticsearch": "elasticsearch",
    "redshift":    "postgresql+psycopg2",
    "hive":        "hive",                  # 需 pyhive
}


def _build_connection_url(params: dict) -> str:
    """构建 SQLAlchemy 连接 URL."""
    dialect = DIALECT_MAP.get(params.get("type", ""), "")
    if not dialect:
        raise ValueError(f"不支持的数据源类型: {params.get('type')}")

    host = params.get("host", "localhost")
    port = params.get("port", 0)
    db = params.get("dbName", "")
    user = params.get("username", "")
    pwd = params.get("password", "")

    # SQLite 本地
    if params.get("type") == "sqlite":
        return f"sqlite:///{host or db}"

    port_str = f":{port}" if port else ""
    auth = f"{user}:{pwd}@" if user else ""
    db_str = f"/{db}" if db else ""

    return f"{dialect}://{auth}{host}{port_str}{db_str}"


# ====== API 端点 ======

@router.get("/list")
def list_datasources():
    """返回已配置的数据源列表（从 bi_datasource.json 读取）。"""
    cfg_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "bi_datasource.json")
    if not os.path.exists(cfg_path):
        return {"datasources": [], "message": "数据源配置文件不存在"}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            ds_list = json.load(f)
        # 脱敏：不返回密码
        safe = []
        for ds in ds_list:
            safe.append({k: v for k, v in ds.items() if k != "password"})
        return {"datasources": safe}
    except Exception:
        return {"datasources": [], "error": "读取配置失败"}


@router.post("/test")
def test_connection(req: DsTestRequest, current_user: User = Depends(get_current_user)):
    """测试数据源连接是否可达."""
    ds_type = req.type

    # --- 文件类 ---
    if ds_type in ("excel", "csv"):
        path = req.filePath or req.url
        if not path:
            return {"ok": False, "message": "未指定文件路径"}
        exists = os.path.isfile(path)
        return {"ok": exists, "message": "文件存在" if exists else f"文件不存在: {path}"}

    # --- API 类 ---
    if ds_type == "api":
        api_url = req.url
        if not api_url:
            return {"ok": False, "message": "未指定 API URL"}
        try:
            r = httpx.get(api_url, timeout=10, follow_redirects=True)
            return {"ok": r.status_code < 500, "message": f"HTTP {r.status_code}"}
        except Exception as e:
            return {"ok": False, "message": f"连接失败: {str(e)[:80]}"}

    # --- 数据库类 ---
    if ds_type in DIALECT_MAP:
        dialect = DIALECT_MAP[ds_type]
        try:
            url = _build_connection_url(req.model_dump())
            engine = create_engine(url, connect_args={"connect_timeout": 5} if "mysql" in dialect else {})
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"ok": True, "message": "连接成功"}
        except ValueError as e:
            return {"ok": False, "message": str(e)}
        except SQLAlchemyError as e:
            msg = str(e).split("\n")[0][:120]
            return {"ok": False, "message": msg}
        except Exception as e:
            return {"ok": False, "message": f"连接失败: {str(e)[:80]}"}

    return {"ok": False, "message": f"不支持的数据源类型: {ds_type}"}


@router.post("/query")
def execute_query(req: DsQueryRequest, current_user: User = Depends(get_current_user)):
    """执行查询并返回数据."""
    ds_type = req.type
    params = req.model_dump()

    # --- 文件类 ---
    if ds_type in ("excel", "csv"):
        path = req.filePath or req.url
        if not path or not os.path.isfile(path):
            raise HTTPException(404, f"文件不存在: {path}")
        try:
            import pandas as pd
            if ds_type == "csv":
                df = pd.read_csv(path, nrows=1000)
            else:
                df = pd.read_excel(path, nrows=1000)
            return {"columns": list(df.columns), "rows": df.fillna("").to_dict(orient="records"), "total": len(df)}
        except Exception as e:
            raise HTTPException(500, f"文件读取失败: {str(e)[:120]}")

    # --- API 类 ---
    if ds_type == "api":
        api_url = req.queryPath or req.url
        if not api_url:
            raise HTTPException(400, "未指定 API URL")
        try:
            method = (req.method or "GET").upper()
            r = httpx.request(method, api_url, timeout=30, follow_redirects=True)
            data = r.json()
            if isinstance(data, list):
                return {"columns": list(data[0].keys()) if data else [], "rows": data, "total": len(data)}
            if isinstance(data, dict) and "data" in data:
                rows = data["data"]
                if isinstance(rows, list):
                    return {"columns": list(rows[0].keys()) if rows else [], "rows": rows, "total": len(rows)}
            return {"columns": list(data.keys()), "rows": [data], "total": 1}
        except Exception as e:
            raise HTTPException(500, f"API 请求失败: {str(e)[:120]}")

    # --- 数据库类 ---
    if ds_type in DIALECT_MAP:
        # 安全校验：黑名单关键字 + 多语句注入 + 行数限制
        safe_sql = _validate_sql(req.sql, max_rows=1000)

        try:
            url = _build_connection_url(params)
            engine = create_engine(url, connect_args={"connect_timeout": 10} if "mysql" in DIALECT_MAP.get(ds_type, "") else {})
            with engine.connect() as conn:
                result = conn.execute(text(safe_sql))
                columns = list(result.keys())
                rows = [dict(zip(columns, row)) for row in result.fetchall()]
                # Convert non-serializable types
                for row in rows:
                    for k, v in list(row.items()):
                        if hasattr(v, "isoformat"):
                            row[k] = v.isoformat()
                        elif not isinstance(v, (int, float, str, bool, type(None))):
                            row[k] = str(v)
                return {"columns": columns, "rows": rows, "total": len(rows)}
        except ValueError as e:
            raise HTTPException(400, str(e))
        except SQLAlchemyError as e:
            msg = str(e).split("\n")[0][:200]
            raise HTTPException(500, f"查询失败: {msg}")
        except Exception as e:
            raise HTTPException(500, f"查询失败: {str(e)[:200]}")

    raise HTTPException(400, f"不支持的数据源类型: {ds_type}")


@router.post("/csv-import")
async def import_csv_data(
    file: UploadFile = File(...),
    delimiter: str = Form(default=","),
    current_user: User = Depends(get_current_user),
):
    """导入 CSV 文件为 BI 数据源."""
    from app.services.bi_csv_import import parse_csv_content, csv_to_json_rows

    content = await file.read()
    text = content.decode("utf-8-sig")  # handle BOM

    parsed = parse_csv_content(text, delimiter)
    json_rows = csv_to_json_rows(text, delimiter)

    return {
        "code": 200,
        "data": {
            "filename": file.filename,
            "parsed": parsed,
            "json_rows": json_rows[:100],  # 返回前100行预览
            "total_rows": parsed["row_count"],
        }
    }
