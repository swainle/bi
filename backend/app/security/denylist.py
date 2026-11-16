"""安全黑名单常量 —— parser 与 rls 编译器共用.

单独成文件的原因：两处都要用，放任何一边都会造成「A 依赖 B 的内部细节」。
"""

from __future__ import annotations

# 危险函数：读文件 / 睡眠 / 提权 / 外部连接 / 系统信息
DANGEROUS_FUNCS = frozenset(
    {
        # PostgreSQL
        "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file",
        "pg_sleep", "pg_sleep_for", "pg_sleep_until",
        "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
        "pg_rotate_logfile", "pg_switch_wal", "pg_promote",
        "pg_create_restore_point", "pg_backup_start", "pg_backup_stop",
        "pg_logical_emit_message", "pg_export_snapshot",
        "lo_import", "lo_export", "lo_unlink",
        "dblink", "dblink_exec", "dblink_connect", "dblink_disconnect",
        "query_to_xml", "query_to_xmlschema", "cursor_to_xml",
        "set_config", "current_setting",
        # MySQL / 其他
        "load_file", "sys_eval", "sys_exec", "sleep", "benchmark",
        # 文件 / 网络
        "read_csv", "read_parquet", "read_json_auto",
    }
)

# 写操作 / DDL 节点名（用 getattr 兼容不同 sqlglot 版本）
WRITE_NODE_NAMES = (
    "Insert", "Update", "Delete", "Drop", "Create", "Alter",
    "TruncateTable", "Command", "Grant", "Revoke", "Copy",
    "Merge", "Into", "LoadData", "Set",
)

__all__ = ["DANGEROUS_FUNCS", "WRITE_NODE_NAMES"]
