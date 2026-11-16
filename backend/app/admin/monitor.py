"""操作监控（S7）—— 管理员视角的「谁、什么时候、做了什么」.

数据来源（不另建表，全部复用已有审计）：
    * `bi_audit_logs`  ：登录、看板保存/发布/删除、数据集/数据源变更、模型/角色/用户等
    * `bi_mcp_audit`   ：Agent 每次工具调用（含被拒绝）
    * `bi_ai_audit_log`：AI 生成 SQL / 看板配置

口径：以只读查询为主；安全卫士的「启停 / 解封」是管理员写操作，都会写审计。
所有查询都按时间倒序 + 索引（见迁移 050）。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.permissions import require
from app.database import get_db
from app.middleware.audit import log_audit
from app.models.user import User
from app.security import guard

router = APIRouter(prefix="/monitor", tags=["操作监控"])

_GUARD = Depends(require("bi:audit:view", "没有操作监控权限，请联系管理员开通"))

ACTION_LABELS: dict[str, str] = {
    "auth.login": "登录",
    "auth.login_failed": "登录失败",
    "auth.register_apply": "提交注册申请",
    "dashboard.create": "新建看板",
    "dashboard.save": "保存看板",
    "dashboard.publish": "发布看板",
    "dashboard.delete": "删除看板",
    "dashboard.share": "分享到团队",
    "dashboard.unshare": "取消团队分享",
    "dashboard.permission": "修改看板成员权限",
    "dataset.create": "新建数据集",
    "dataset.update": "修改数据集",
    "dataset.rename": "数据集改名",
    "dataset.sync": "同步数据集字段",
    "dataset.delete": "删除数据集",
    "dataset.dept_scope": "配置部门隔离",
    "dataset.dept_scope_delete": "移除部门隔离",
    "source.create": "新建数据源",
    "source.update": "修改数据源",
    "source.delete": "删除数据源",
    "source.upload": "上传数据文件",
    "source.file_delete": "删除接入表",
    "ai.call": "调用大模型",
    "ai.layout": "AI 整理版面",
    "ai.recommend": "AI 推荐组件",
    "ai.generate": "AI 生成",
    "mcp.client.create": "创建 MCP 客户端",
    "mcp.client.update": "修改 MCP 客户端",
    "mcp.grant.create": "授权 Agent",
    "mcp.grant.revoke": "撤销 Agent 授权",
    "admin.user.create": "新建用户",
    "admin.user.update": "修改用户",
    "admin.user.delete": "删除用户",
    "admin.role.create": "新建角色",
    "admin.role.update": "修改角色",
    "admin.role.delete": "删除角色",
    "admin.department.create": "新建部门",
    "admin.department.update": "修改部门",
    "admin.department.delete": "删除部门",
    "admin.model.create": "新建模型",
    "admin.model.update": "修改模型",
    "admin.model.delete": "删除模型",
    "admin.ops.clear_cache": "清理渲染缓存",
    "admin.ops.prune_errors": "清理错误日志",
    "permission.update": "修改看板权限",
    "security.rls.sync_failed": "RLS 策略同步失败",
    "security.rls.policy_missing": "RLS 策略缺失",
    "denied_anonymous": "匿名访问被拒",
    "denied_invalid_token": "令牌无效被拒",
    "denied_forbidden": "越权访问被拒",
    "rate_limited": "触发限流",
    "suspicious_path": "疑似扫描器路径",
    "db_external_session": "外部直连数据库",
    "guard_block": "安全卫士自动封禁",
    "security.guard.toggle": "安全卫士启停",
    "security.guard.release_manual": "安全卫士人工解封",
    "security.guard.block": "安全卫士自动封禁",
    "data.export.detail": "导出明细",
    "data.export.summary": "导出汇总",
    "report.subscription.outbound": "报表外发配置",
    "alert.rule.outbound": "告警外发配置",
}

# 敏感动作：删除 / 权限 / 规则 / 模型 / 角色 / 用户 / 导出 / 密钥
SENSITIVE_PREFIXES = (
    "auth.login_failed",
    "denied_", "rate_limited", "suspicious", "db_external", "guard_block",
    "security.guard", "data.export", "report.subscription.outbound", "alert.rule.outbound",
    "dashboard.delete", "dashboard.permission",
    "dataset.delete", "dataset.dept_scope",
    "source.delete", "source.file_delete",
    "admin.user", "admin.role", "admin.department", "admin.model",
    "mcp.client", "mcp.grant",
    "permission.update",
    "security.rls",
)

_RANGE = "(:days || ' days')::interval"


def _cte(days: int) -> str:
    return f"""
    WITH combined AS (
        SELECT CASE WHEN a.action LIKE 'ai.%' THEN 'ai' ELSE 'op' END AS source,
               a.id::bigint AS id, a.created_at, a.user_id, a.action,
               a.resource_type AS target_type, a.resource_id AS target_id,
               a.detail, COALESCE(a.ip, '') AS ip, ''::text AS status, 0 AS duration_ms,
               NULL::text AS risk, COALESCE(a.fingerprint, '') AS fingerprint,
               COALESCE(a.user_agent, '') AS user_agent
        FROM bi_audit_logs a
        WHERE a.created_at >= now() - {_RANGE}
        UNION ALL
        SELECT 'mcp', m.id, m.created_at, m.user_id, m.tool,
               'mcp_tool', NULL::integer, m.args_summary, COALESCE(m.ip, ''),
               m.status, COALESCE(m.duration_ms, 0), t.risk,
               ''::text, ''::text
        FROM bi_mcp_audit m
        LEFT JOIN bi_mcp_tool t ON t.code = m.tool
        WHERE m.created_at >= now() - {_RANGE}
        UNION ALL
        SELECT 'ai', ai.id::bigint, ai.created_at, ai.user_id, 'ai.generate',
               'ai_model', ai.dashboard_id,
               jsonb_build_object('query', left(ai.query_text, 200),
                                  'sql', left(ai.generated_sql, 200)),
               ''::text, ai.status, COALESCE(ai.latency_ms, 0), NULL::text,
               ''::text, ''::text
        FROM bi_ai_audit_log ai
        WHERE ai.created_at >= now() - {_RANGE}
        UNION ALL
        SELECT 'security', s.id, s.created_at, s.user_id, s.event_type,
               'security', NULL::integer, s.detail, COALESCE(s.ip, ''),
               CASE WHEN s.event_type LIKE 'db_%' THEN 'error' ELSE 'denied' END,
               0, 'high', s.fingerprint, s.user_agent
        FROM bi_security_event s
        WHERE s.created_at >= now() - {_RANGE}
    )
    """


def _sensitive(action: str, risk: str | None) -> bool:
    if risk == "high":
        return True
    return any(action == prefix or action.startswith(prefix + ".") or action.startswith(prefix)
               for prefix in SENSITIVE_PREFIXES)


def _label(action: str, tool_name: str | None) -> str:
    return tool_name or ACTION_LABELS.get(action) or action


@router.get("/summary", dependencies=[_GUARD])
def monitor_summary(
    days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """概览：来源分布 / 敏感与失败 / 活跃用户 / 每日趋势 / 高频动作."""
    params = {"days": int(days)}
    combined = _cte(days)
    totals = db.execute(text(combined + """
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE source = 'op') AS op,
          count(*) FILTER (WHERE source = 'ai') AS ai,
          count(*) FILTER (WHERE source = 'mcp') AS mcp,
          count(*) FILTER (WHERE source = 'security') AS security,
          count(*) FILTER (WHERE status IN ('denied', 'error')) AS failed,
          count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS users
        FROM combined
    """), params).fetchone()

    rows = db.execute(text(combined + """
        SELECT source, action, risk, count(*) AS n
        FROM combined
        GROUP BY source, action, risk
    """), params).fetchall()
    sensitive = sum(int(r[3]) for r in rows if _sensitive(str(r[1]), r[2]))
    top = sorted(
        ({"action": str(r[1]), "label": _label(str(r[1]), None), "count": int(r[3])}
         for r in rows),
        key=lambda item: item["count"], reverse=True,
    )[:8]

    daily = [
        {"date": str(r[0]), "count": int(r[1])}
        for r in db.execute(text(combined + """
            SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS d, count(*) AS n
            FROM combined
            GROUP BY date_trunc('day', created_at)
            ORDER BY date_trunc('day', created_at)
        """), params).fetchall()
    ]

    return {
        "range_days": int(days),
        "totals": {
            "all": int(totals[0] or 0), "op": int(totals[1] or 0), "ai": int(totals[2] or 0),
            "mcp": int(totals[3] or 0), "security": int(totals[4] or 0),
            "sensitive": sensitive, "failed": int(totals[5] or 0),
            "users": int(totals[6] or 0),
        },
        "daily": daily,
        "top_actions": top,
    }


@router.get("/activity", dependencies=[_GUARD])
def monitor_activity(
    days: int = Query(default=7, ge=1, le=90),
    source: str = Query(default=""),
    keyword: str = Query(default=""),
    status: str = Query(default=""),
    user_id: int = Query(default=0),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """明细：统一的操作 / AI / MCP 流水（时间倒序，可按来源 / 人 / 状态 / 关键词筛）."""
    params: dict[str, Any] = {
        "days": int(days), "source": (source or "").strip().lower(),
        "keyword": (keyword or "").strip(), "kw": f"%{(keyword or '').strip()}%",
        "status": (status or "").strip(), "user_id": int(user_id or 0),
        "limit": int(limit), "offset": int(offset),
    }
    combined = _cte(days)
    where = """
        WHERE (:source = '' OR c.source = :source)
          AND (:status = '' OR c.status = :status)
          AND (:user_id = 0 OR c.user_id = :user_id)
          AND (:keyword = '' OR c.action ILIKE :kw OR COALESCE(u.username, '') ILIKE :kw
               OR COALESCE(t.name, '') ILIKE :kw OR CAST(c.detail AS text) ILIKE :kw)
    """
    joins = """
        LEFT JOIN users u ON u.id = c.user_id
        LEFT JOIN departments d ON d.id = u.department_id
        LEFT JOIN bi_mcp_tool t ON c.source = 'mcp' AND t.code = c.action
    """
    total = int(db.execute(
        text(combined + "SELECT count(*) FROM combined c " + joins + where), params
    ).scalar() or 0)
    rows = db.execute(text(combined + f"""
        SELECT c.id, c.source, c.created_at, c.user_id, COALESCE(u.username, ''),
               COALESCE(d.name, ''), c.action, COALESCE(t.name, ''), c.target_type,
               c.target_id, c.detail, c.ip, c.status, c.duration_ms, COALESCE(c.risk, ''),
               c.fingerprint, c.user_agent
        FROM combined c {joins} {where}
        ORDER BY c.created_at DESC LIMIT :limit OFFSET :offset
    """), params).fetchall()

    items = []
    for row in rows:
        action = str(row[6] or "")
        risk = row[14] or None
        items.append({
            "id": int(row[0]), "source": row[1], "created_at": str(row[2] or ""),
            "user_id": row[3], "username": row[4] or ("系统" if row[3] is None else ""),
            "department": row[5], "action": action, "label": _label(action, row[7] or None),
            "target_type": row[8], "target_id": row[9], "detail": row[10] or {},
            "ip": row[11], "status": row[12] or "ok", "duration_ms": int(row[13] or 0),
            "sensitive": _sensitive(action, risk), "risk": risk or "",
            "fingerprint": row[15] or "", "user_agent": row[16] or "",
        })
    return {"days": int(days), "total": total, "items": items,
            "limit": int(limit), "offset": int(offset)}


@router.get("/guard", dependencies=[_GUARD])
def guard_status():
    """安全卫士：当前策略 + 生效中的封禁列表."""
    return {"config": guard.config(),
            "blocks": guard.list_blocks(active_only=True, limit=100)}


@router.put("/guard/config")
def update_guard_config(
    payload: dict = Body(...),
    current_user: User = Depends(require("bi:audit:view", "没有操作监控权限，请联系管理员开通")),
):
    """管理员启停安全卫士（立即生效；已有封禁记录保留，重新开启后仍在有效期内的恢复生效）."""
    if not isinstance(payload.get("enabled"), bool):
        raise HTTPException(400, "enabled 必须是布尔值")
    config = guard.set_enabled(bool(payload["enabled"]), getattr(current_user, "id", None))
    return {"config": config,
            "blocks": guard.list_blocks(active_only=True, limit=100)}


@router.delete("/guard/blocks/{block_id}")
def release_block(
    block_id: int,
    current_user: User = Depends(require("bi:audit:view", "没有操作监控权限，请联系管理员开通")),
):
    """人工解封（误封 / 已确认安全）."""
    result = guard.release(block_id, getattr(current_user, "id", None))
    log_audit(getattr(current_user, "id", None), "security.guard.release_manual",
              "security", block_id, result)
    return result


__all__ = ["router", "ACTION_LABELS", "SENSITIVE_PREFIXES"]
