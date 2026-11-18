"""内置演示表目录及系统内部表保护；业务表无需登记即可查询。"""

import re

BUILTIN_TABLES: set[str] = {
    "bi_finance", "bi_pdd_ops", "bi_tmall", "bi_douyin",
    "bi_pdd_stores", "bi_pdd_annual", "bi_pdd_traffic",
    "bi_products", "bi_tmall_monthly", "bi_tmall_campaigns",
    "bi_douyin_live", "bi_pdd_profit",
    "bi_rank_board",
    "bi_demand_hot", "bi_demand_grow", "bi_demand_rel", "bi_demand_merged", "bi_demand_overview",
    # 演示数据（组件库 / 卡片预览专用，见 app/components/seed_demo.py）
    "bi_demo_sku",
}

# 只保护应用内部配置、凭据和权限表；不是业务表准入名单。
SYSTEM_TABLES = frozenset({
    "users", "roles", "permissions", "departments", "user_role", "role_permission",
    "schema_migrations", "bi_source", "bi_source_table", "bi_source_import", "bi_ai_model",
    "bi_audit_logs", "bi_ai_audit_log", "bi_ai_sql_cache", "bi_row_permissions",
    "bi_column_masks", "bi_resource_permissions", "bi_dataset", "bi_dataset_field",
    "bi_dataset_metric", "bi_dataset_row_rule", "bi_dataset_column_mask", "bi_metric_version",
    "bi_component", "bi_canvas", "bi_dashboards", "bi_dash_item_source", "bi_demo_meta",
    "bi_report_subscription", "bi_report_run", "bi_alert_rule", "bi_alert_event",
    "bi_error_log", "bi_query_slow", "bi_sync_logs", "bi_board_favorite",
    "bi_dashboard_cards", "bi_dashboard_snapshots", "bi_dataset_versions", "bi_template_market",
    "bi_filter_templates", "user_disabled_components",
})


def is_queryable(table: str) -> bool:
    # 旧接口会拼接表名，移除白名单后仍须拒绝 SQL 片段及系统内部表。
    return isinstance(table, str) and bool(re.fullmatch(r"[^\W\d]\w*", table)) and table.lower() not in SYSTEM_TABLES


def assert_queryable(table: str) -> str:
    from app.security.errors import TableNotAllowedError
    if not is_queryable(table):
        raise TableNotAllowedError([str(table)])
    return table
