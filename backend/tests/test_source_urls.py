"""数据源连接串：方言 → 驱动 scheme（P4 连接器）."""

from __future__ import annotations

from app.sources.repository import build_url


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
