"""MCP 取数安全底座（完整版）—— 数据分级、行数预算、异常止损.

设计原则：
    * 强调「服务端硬拦」：Agent 端提示可以被绕过，额度与冻结必须在这里生效；
    * 预算按「用户 × 数据集 × 自然日」累计，来源就是 `bi_mcp_audit.row_count`（已含每次成功调用的行数）；
    * 数据分级决定：单次行数上限、每日行数预算、是否允许明细/分页扫描；
    * 异常行为（短时跨多个数据集、行数突增、非工作时段大量取数）直接冻结该用户在该客户端的授权，
      写 `bi_security_event`，管理员在后台可解冻。
"""

from __future__ import annotations

import os
from datetime import datetime

from sqlalchemy import text

from app.mcp.tools import McpPermissionError, McpQuotaError

# 会读数据集的工具（按 dataset_id 收口）
DATASET_TOOLS = {
    "bi_get_dataset_schema", "bi_query_dataset",
    "bi_list_metrics", "bi_get_metric", "bi_query_metric",
}

# 分级默认：每日行数预算 / 单次返回上限
DEFAULT_DAILY_ROWS = {"normal": 200_000, "confidential": 50_000, "financial": 20_000}
DEFAULT_MAX_ROWS = {"normal": 5_000, "confidential": 3_000, "financial": 1_000}
# 允许无过滤、纯明细取数的分级（财务/机密不允许）
DETAIL_ALLOWED = {"normal"}

CLASS_LABELS = {"normal": "普通", "confidential": "机密", "financial": "财务"}


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


def _env_flag(name: str, default: bool = True) -> bool:
    return (os.getenv(name, "1" if default else "0") or "").strip().lower() not in ("0", "false", "no", "off")


def dataset_policy(db, dataset_id: int) -> dict | None:
    """数据集的分级策略（不存在返回 None）."""
    row = db.execute(
        text("SELECT id, name, data_class, mcp_daily_rows FROM bi_dataset WHERE id = :i"),
        {"i": int(dataset_id)},
    ).fetchone()
    if row is None:
        return None
    data_class = (row[2] or "normal").strip()
    if data_class not in DEFAULT_DAILY_ROWS:
        data_class = "normal"
    daily = int(row[3]) if row[3] else _env_int(
        {"normal": "BI_MCP_DAILY_ROWS",
         "confidential": "BI_MCP_DAILY_ROWS_CONFIDENTIAL",
         "financial": "BI_MCP_DAILY_ROWS_FINANCIAL"}[data_class],
        DEFAULT_DAILY_ROWS[data_class],
    )
    return {
        "id": int(row[0]), "name": row[1] or f"数据集 {row[0]}",
        "data_class": data_class, "daily_rows": daily,
        "max_rows": _env_int("BI_MCP_MAX_ROWS", DEFAULT_MAX_ROWS[data_class])
        if data_class == "normal" else DEFAULT_MAX_ROWS[data_class],
        "detail_allowed": data_class in DETAIL_ALLOWED,
    }


def rows_used_today(db, user_id: int, dataset_id: int) -> int:
    try:
        return int(db.execute(
            text(
                "SELECT COALESCE(sum(row_count), 0) FROM bi_mcp_audit "
                "WHERE user_id = :u AND dataset_id = :d AND status = 'ok' "
                "  AND created_at >= date_trunc('day', now())"
            ),
            {"u": int(user_id), "d": int(dataset_id)},
        ).scalar() or 0)
    except Exception:
        return 0


def apply_dataset_policy(db, ctx, tool: str, args: dict, policy: dict) -> None:
    """按分级收口：预算耗尽 → 429；财务/机密 → 禁止明细与分页；并把 limit 夹到剩余额度."""
    used = rows_used_today(db, ctx.user.id, policy["id"])
    remaining = max(0, int(policy["daily_rows"]) - used)
    if remaining <= 0:
        raise McpQuotaError(
            f"数据集「{policy['name']}」今日行数额度已用完（{used}/{policy['daily_rows']}），明天再试"
        )

    if not policy["detail_allowed"]:
        label = CLASS_LABELS.get(policy["data_class"], policy["data_class"])
        if int(args.get("offset") or 0) > 0:
            raise McpPermissionError(f"{label}级数据集不允许分页扫描")
        if tool == "bi_query_dataset":
            has_agg = bool(args.get("dimensions"))
            has_filter = bool(args.get("filters"))
            if not (has_agg or has_filter):
                raise McpPermissionError(
                    f"{label}级数据集只允许聚合查询或带过滤条件的查询，不允许直接拉明细"
                )

    if tool in ("bi_query_dataset", "bi_query_metric"):
        cap = min(int(policy["max_rows"]), remaining)
        try:
            want = int(args.get("limit") or cap)
        except (TypeError, ValueError):
            want = cap
        args["limit"] = max(1, min(want, cap))


def freeze_grants(db, user_id: int, client_id: int, reason: str) -> int:
    """冻结该用户在该客户端上的有效授权（立即生效，管理员可解冻）."""
    try:
        count = db.execute(
            text(
                "UPDATE bi_mcp_grant SET frozen_at = now(), frozen_reason = :r "
                "WHERE user_id = :u AND client_id = :c AND revoked_at IS NULL "
                "  AND frozen_at IS NULL RETURNING id"
            ),
            {"u": int(user_id), "c": int(client_id), "r": (reason or "")[:200]},
        ).rowcount
        db.commit()
    except Exception:
        db.rollback()
        return 0
    return int(count or 0)


def check_anomaly(db, ctx, *, ip: str = "", user_agent: str = "") -> None:
    """短窗口异常行为 → 冻结授权并拒绝本次调用（写安全事件）."""
    window = _env_int("BI_MCP_ANOMALY_WINDOW_MIN", 10)
    max_datasets = _env_int("BI_MCP_ANOMALY_DATASETS", 5)
    max_rows = _env_int("BI_MCP_ANOMALY_ROWS", 50_000)
    offhours = _env_flag("BI_MCP_OFFHOURS_BLOCK", True)
    offhours_rows = _env_int("BI_MCP_OFFHOURS_ROWS", 5_000)
    try:
        # 管理员刚解冻：给一段观察期，避免同一个异常窗口立刻再冻结
        grace = db.execute(
            text(
                "SELECT 1 FROM bi_mcp_grant WHERE user_id = :u AND client_id = :c "
                "AND revoked_at IS NULL AND anomaly_grace_until > now() LIMIT 1"
            ),
            {"u": int(ctx.user.id), "c": int(ctx.client_id)},
        ).fetchone()
        if grace:
            return
        row = db.execute(
            text(
                "SELECT count(DISTINCT dataset_id), COALESCE(sum(row_count), 0) "
                "FROM bi_mcp_audit WHERE user_id = :u AND status = 'ok' "
                "  AND created_at > now() - make_interval(mins => :w)"
            ),
            {"u": int(ctx.user.id), "w": window},
        ).fetchone()
        datasets, rows = int(row[0] or 0), int(row[1] or 0)
    except Exception:
        return

    reason = ""
    if datasets >= max_datasets:
        reason = f"{window} 分钟内访问了 {datasets} 个数据集（阈值 {max_datasets}）"
    elif rows >= max_rows:
        reason = f"{window} 分钟内拉取 {rows} 行（阈值 {max_rows}）"
    elif offhours and 0 <= datetime.now().hour < 6 and rows >= offhours_rows:
        reason = f"非工作时段（00:00-06:00）拉取 {rows} 行（阈值 {offhours_rows}）"
    if not reason:
        return

    frozen = freeze_grants(db, ctx.user.id, ctx.client_id, reason)
    try:
        from app.security import security_events

        security_events.record(
            "mcp_data_anomaly",
            user_id=int(ctx.user.id),
            username=getattr(ctx.user, "username", "") or "",
            ip=ip, user_agent=user_agent,
            path="/api/mcp/rpc", status_code=429,
            detail={"client_id": int(ctx.client_id), "reason": reason, "frozen_grants": frozen},
        )
    except Exception:
        pass
    raise McpQuotaError(
        f"检测到异常取数行为（{reason}），该授权已被冻结，请联系管理员解冻"
    )
