"""B03 认证与会话板块.

- `router.py`  HTTP 路由 `/api/auth/*`
- `service.py` 密码哈希 / JWT 签发与校验 / 注册登录 / 资料与改密
- `deps.py`    FastAPI 依赖：`get_current_user` / `get_optional_user`

旧的 `app/routers/auth.py`、`app/services/auth.py`、`app/middleware/auth.py`
保留为**兼容垫片**（只 re-export），后续可逐步改 import 后删除。
"""
