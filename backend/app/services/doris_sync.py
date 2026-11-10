# services/doris_sync.py — PG→Doris 数据同步服务
"""
后台服务：定期从 PostgreSQL 同步表到 Apache Doris
策略：
- 实时表：每30秒拉取最近更新的记录
- 历史表：每5分钟全量/增量同步
"""

import os
import time
import logging
from sqlalchemy import create_engine, text

logging.basicConfig(level=logging.INFO, format='%(asctime)s [DORIS-SYNC] %(message)s')
logger = logging.getLogger(__name__)

# ── 配置 ──
PG_URL = os.getenv("DATABASE_URL", "postgresql://mingzebi:mingzebi@127.0.0.1:5432/mingzebi")
DORIS_HOST = os.getenv("DORIS_HOST", "127.0.0.1")
DORIS_PORT = int(os.getenv("DORIS_PORT", "9030"))
DORIS_DB = os.getenv("DORIS_DB", "mingzebi")
DORIS_URL = f"mysql+pymysql://root:@{DORIS_HOST}:{DORIS_PORT}/{DORIS_DB}?charset=utf8mb4"

# 同步配置
SYNC_TABLES = [
    {"table": "bi_ai_generated_data", "interval": 30, "mode": "incremental"},
    {"table": "bi_dashboard_panels",     "interval": 300, "mode": "full"},
    {"table": "bi_dashboards",           "interval": 300, "mode": "full"},
]

def create_doris_tables(pg_engine, doris_engine):
    """在 Doris 中创建与 PG 结构相同的表"""
    for t in SYNC_TABLES:
        table = t["table"]
        # 从PG获取表结构
        cols = pg_engine.execute(text(f"""
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = '{table}' ORDER BY ordinal_position
        """)).fetchall()

        if not cols:
            logger.warning(f"表 {table} 在PG中不存在，跳过")
            continue

        # 类型映射 PG→Doris
        type_map = {
            "integer": "INT", "bigint": "BIGINT", "smallint": "SMALLINT",
            "character varying": "VARCHAR(500)", "text": "STRING",
            "numeric": "DECIMAL(18,2)", "real": "FLOAT", "double precision": "DOUBLE",
            "boolean": "BOOLEAN", "timestamp": "DATETIME",
            "jsonb": "JSON", "json": "JSON",
        }

        col_defs = []
        for col_name, col_type in cols:
            doris_type = type_map.get(col_type, "STRING")
            col_defs.append(f"`{col_name}` {doris_type}")

        ddl = f"CREATE TABLE IF NOT EXISTS `{table}` (\n  " + ",\n  ".join(col_defs) + "\n) ENGINE=OLAP DUPLICATE KEY(`id`) DISTRIBUTED BY HASH(`id`) BUCKETS 4"
        logger.info(f"创建 Doris 表: {table}\n{ddl}")
        try:
            doris_engine.execute(text(ddl))
        except Exception as e:
            logger.error(f"创建 {table} 失败: {e}")

def sync_table(pg_engine, doris_engine, config: dict):
    """同步单张表"""
    table = config["table"]
    mode = config["mode"]
    logger.info(f"同步 {table} ({mode})")

    try:
        if mode == "full":
            sync_full(pg_engine, doris_engine, table)
        elif mode == "incremental":
            sync_incremental(pg_engine, doris_engine, table)
    except Exception as e:
        logger.error(f"同步 {table} 失败: {e}")

def sync_full(pg_engine, doris_engine, table: str):
    """全量同步"""
    rows = pg_engine.execute(text(f"SELECT * FROM {table} LIMIT 50000")).fetchall()
    if not rows:
        return
    columns = list(rows[0]._mapping.keys())
    cols = ", ".join(f"`{c}`" for c in columns)
    placeholders = ", ".join(f":{c}" for c in columns)

    # 分批插入
    batch_size = 1000
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        values = [{c: row._mapping[c] for c in columns} for row in batch]
        try:
            doris_engine.execute(text(f"INSERT INTO `{table}` ({cols}) VALUES ({placeholders})"), values)
        except Exception as e:
            logger.warning(f"批量插入失败，尝试单条: {e}")
            for val in values:
                try:
                    doris_engine.execute(text(f"INSERT INTO `{table}` ({cols}) VALUES ({placeholders})"), val)
                except Exception as e2:
                    logger.warning(f"单条插入失败: {e2}")

    logger.info(f"全量同步 {table}: {len(rows)} 行")

def sync_incremental(pg_engine, doris_engine, table: str):
    """增量同步（最近更新的记录）"""
    # 简单实现：同步最近1000条
    rows = pg_engine.execute(text(f"SELECT * FROM {table} ORDER BY id DESC LIMIT 1000")).fetchall()
    if not rows:
        return
    sync_full(pg_engine, doris_engine, table)

def run():
    """主循环"""
    logger.info("Doris 同步服务启动")
    pg = create_engine(PG_URL, pool_size=2)
    doris = create_engine(DORIS_URL, pool_size=2)

    # 初始化：创建Doris表结构
    create_doris_tables(pg, doris)

    last_sync = {t["table"]: 0 for t in SYNC_TABLES}

    while True:
        now = time.time()
        for config in SYNC_TABLES:
            table = config["table"]
            if now - last_sync[table] >= config["interval"]:
                sync_table(pg, doris, config)
                last_sync[table] = now
        time.sleep(5)

if __name__ == "__main__":
    run()
