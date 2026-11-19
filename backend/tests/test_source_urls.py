"""数据源连接串：方言 → 驱动 scheme（P4 连接器）."""

from __future__ import annotations

from app.sources.repository import apply_source_overrides, build_url, clean_probe_error


def test_clickhouse_uses_native_driver() -> None:
    url = build_url({
        "ds_type": "clickhouse", "host": "10.0.0.9", "port": 9000,
        "db_name": "dm", "username": "default",
    })
    # 空密码不拼 `:`（否则 PyHive / Presto 会把空串当密码）
    assert url == "clickhouse+native://default@10.0.0.9:9000/dm"


def test_clickhouse_http_port_uses_http_driver() -> None:
    url = build_url({
        "ds_type": "clickhouse", "host": "10.0.0.9", "port": 8123,
        "db_name": "dm", "username": "default",
    })
    assert url == "clickhouse+http://default@10.0.0.9:8123/dm"


def test_clickhouse_http_uri_kept() -> None:
    uri = "clickhouse+http://default:@10.0.0.9:8123/dm"
    url = build_url({"ds_type": "clickhouse", "uri": uri})
    assert url == uri


def test_clickhouse_plain_uri_normalized() -> None:
    url = build_url({"uri": "clickhouse://default:@h:9000/dm"})
    assert url == "clickhouse+native://default:@h:9000/dm"


def test_mysql_uses_pymysql() -> None:
    url = build_url({
        "ds_type": "mysql", "host": "h", "port": 3306, "db_name": "x", "username": "u",
    })
    assert url.startswith("mysql+pymysql://")


def test_postgres_unchanged() -> None:
    url = build_url({
        "ds_type": "postgresql", "host": "h", "port": 5432, "db_name": "x", "username": "u",
    })
    assert url.startswith("postgresql://")


def test_oracle_uses_python_oracledb() -> None:
    """`oracle://` 默认找 cx_Oracle（没装），必须显式走 oracle+oracledb."""
    url = build_url({
        "ds_type": "oracle", "host": "h", "port": 1521, "db_name": "x", "username": "u",
    })
    assert url == "oracle+oracledb://u@h:1521/x"


def test_oracle_plain_uri_normalized() -> None:
    url = build_url({"uri": "oracle://u:p@h:1521/x"})
    assert url == "oracle+oracledb://u:p@h:1521/x"


def test_redshift_uses_postgres_protocol() -> None:
    url = build_url({
        "ds_type": "redshift", "host": "h", "port": 5439, "db_name": "x", "username": "u",
    })
    assert url == "postgresql://u@h:5439/x"


def test_redshift_uri_normalized_to_postgres() -> None:
    assert build_url({"uri": "redshift://u:p@h:5439/x"}) == "postgresql://u:p@h:5439/x"
    assert build_url({"uri": "redshift+redshift_connector://u:p@h:5439/x"}) == "postgresql://u:p@h:5439/x"


def test_sqlserver_uses_pyodbc_with_ms_driver(monkeypatch) -> None:
    monkeypatch.setenv("BI_MSSQL_DRIVER", "ODBC Driver 18 for SQL Server")
    url = build_url({
        "ds_type": "sqlserver", "host": "h", "port": 1433, "db_name": "x", "username": "u",
    })
    assert url.startswith("mssql+pyodbc://u@h:1433/x?")
    assert "driver=ODBC+Driver+18+for+SQL+Server" in url
    # MS 驱动 18 默认强制加密，自签证书必须放行
    assert "TrustServerCertificate=yes" in url


def test_sqlserver_freetds_driver(monkeypatch) -> None:
    monkeypatch.setenv("BI_MSSQL_DRIVER", "FreeTDS")
    url = build_url({
        "ds_type": "sqlserver", "host": "h", "port": 1433, "db_name": "x", "username": "u",
    })
    # FreeTDS 不认 TrustServerCertificate，不能加
    assert url == "mssql+pyodbc://u@h:1433/x?driver=FreeTDS"


def test_mssql_plain_uri_normalized(monkeypatch) -> None:
    monkeypatch.setenv("BI_MSSQL_DRIVER", "FreeTDS")
    url = build_url({"uri": "mssql://u:p@h:1433/db"})
    assert url == "mssql+pyodbc://u:p@h:1433/db?driver=FreeTDS"


def test_mssql_uri_with_driver_kept(monkeypatch) -> None:
    monkeypatch.setenv("BI_MSSQL_DRIVER", "FreeTDS")
    uri = "mssql+pyodbc://u:p@h:1433/db?driver=ODBC+Driver+17+for+SQL+Server&TDS_Version=7.4"
    # 手填了 driver 就完全照用，不重复追加
    assert build_url({"uri": uri}) == uri


# ── 编辑数据源：「已存配置 + 未落库修改」合并（测连通不落库） ──────────────

def test_overrides_merge_keeps_unset_fields() -> None:
    stored = {
        "id": 7, "ds_type": "postgresql", "host": "10.0.0.8", "port": 5432,
        "db_name": "dm", "username": "u", "password": "cipher", "uri": "",
    }
    merged = apply_source_overrides(stored, {"host": "10.0.0.9"})
    assert merged["host"] == "10.0.0.9"
    assert merged["port"] == 5432 and merged["db_name"] == "dm"
    # 改地址不用重填密码
    assert merged["password"] == "cipher"
    assert merged["id"] == 7


def test_overrides_blank_password_keeps_stored() -> None:
    stored = {"ds_type": "postgresql", "password": "cipher"}
    assert apply_source_overrides(stored, {"password": ""})["password"] == "cipher"


def test_overrides_explicit_empty_uri_switches_to_host_mode() -> None:
    stored = {"ds_type": "postgresql", "uri": "postgresql://u@old:5432/dm", "host": "old"}
    merged = apply_source_overrides(stored, {"uri": ""})
    assert merged["uri"] == ""
    # 没给 uri 键时必须原样保留（旧实现的坑：缺省即写空串会把连接串清掉）
    assert apply_source_overrides(stored, {"host": "new"})["uri"] == stored["uri"]


# ── 数据源圆点：驱动报错压成一句能给 tooltip 看的话 ───────────────────────

def test_clean_probe_error_trims_noise() -> None:
    raw = (
        "连接失败：(psycopg2.OperationalError) connection to server at \"10.0.0.9\", "
        "port 5432 failed: timeout expired\n\n(Background on this error at: https://sqlalche.me/e/20/e3q8)"
    )
    assert clean_probe_error(raw) == (
        'connection to server at "10.0.0.9", port 5432 failed: timeout expired'
    )


def test_clean_probe_error_collapses_driver_newlines() -> None:
    raw = (
        '连接失败：(psycopg2.OperationalError) connection to server at "127.0.0.1", port 5999 '
        "failed: Connection refused\n\tIs the server running on that host and accepting "
        "TCP/IP connections?\n\n(Background on this error at: https://sqlalche.me/e/20/e3q8)"
    )
    assert clean_probe_error(raw) == (
        'connection to server at "127.0.0.1", port 5999 failed: Connection refused '
        "Is the server running on that host and accepting TCP/IP connections?"
    )


def test_clean_probe_error_keeps_plain_reason() -> None:
    assert clean_probe_error("数据源密码无法解密（服务密钥可能变过），请重新填写密码") == (
        "数据源密码无法解密（服务密钥可能变过），请重新填写密码"
    )
    assert clean_probe_error("") == "未知原因"
