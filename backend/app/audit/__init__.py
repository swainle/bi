"""B33 审计与操作监控板块.

- `context.py`          请求级审计上下文（用户 / IP / UA / 指纹）
- `log.py`              操作流水 `log_audit`（写 `bi_audit_logs`）
- `user_middleware.py`  从 JWT 写审计用户（不做鉴权）
- `events.py`           安全事件与指纹（`bi_security_event`）
- `monitor.py`          管理端「操作监控」路由 `/api/admin/monitor/*`

旧的 `app/middleware/audit*.py`、`app/security/security_events.py`、`app/admin/monitor.py`
保留为兼容垫片（只 re-export），后续可逐步改 import 后删除。
"""
