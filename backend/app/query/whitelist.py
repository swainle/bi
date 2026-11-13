"""受管辖业务表白名单（唯一事实来源）.

之所以单独成模块：
    bi_engine / 查询契约 / 语义层 / 异步任务 都要用它，
    放在任何一个路由里都会造成「A import B 的常量」的循环依赖风险。
"""

from __future__ import annotations

ALLOWED_TABLES: set[str] = {
    "bi_finance", "bi_pdd_ops", "bi_tmall", "bi_douyin",
    "bi_pdd_stores", "bi_pdd_annual", "bi_pdd_traffic",
    "bi_products", "bi_tmall_monthly", "bi_tmall_campaigns",
    "bi_douyin_live", "bi_pdd_profit",
    "bi_rank_board",
    "bi_demand_hot", "bi_demand_grow", "bi_demand_rel", "bi_demand_merged", "bi_demand_overview",
    # 演示数据（组件库 / 卡片预览专用，见 app/components/seed_demo.py）
    "bi_demo_sku",
}

AI_TABLE_PREFIX = "bi_ai_"
# 数据源同步表 / 文件导入表 / 模板数据副本由本系统的接入层创建，前缀即白名单
SOURCE_TABLE_PREFIXES = ("bi_ai_", "bi_src_", "bi_imp_", "bi_tpl_")


def is_allowed(table: str) -> bool:
    return table in ALLOWED_TABLES or table.startswith(SOURCE_TABLE_PREFIXES)


def assert_allowed(table: str) -> str:
    from app.security.errors import TableNotAllowedError

    if not is_allowed(table):
        raise TableNotAllowedError([table])
    return table


__all__ = ["ALLOWED_TABLES", "AI_TABLE_PREFIX", "is_allowed", "assert_allowed"]
