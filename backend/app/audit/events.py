"""安全事件与请求指纹（S7 二期）.

记录「不是登录用户正常操作」的行为：
    * 匿名访问被拒 / 令牌无效 / 越权 403 / 限流 429；
    * 扫描器路径（.env / wp-admin / ../ 等）；
    * 外部直连数据库的会话（非应用 `application_name`）。

指纹 = sha256(IP + User-Agent + 浏览器设备号 + Accept-Language)[:16]：
既稳定（同一浏览器多次请求一致），又不保存可反查的个人信息。
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from sqlalchemy import text

_DEDUPE: dict[str, float] = {}
_DEDUPE_SECONDS = 60.0

# 扫描器常见路径特征（小写匹配）
SUSPICIOUS_MARKERS = (
    ".env", "wp-admin", "wp-login", "phpmyadmin", "xmlrpc.php", "/.git",
    "../", "etc/passwd", "cmd=", "shell", "eval(", "base64_decode",
)


def fingerprint(ip: str, user_agent: str, device_id: str = "", language: str = "") -> str:
    """浏览器/客户端指纹.

    v2（2026-11-15）：有设备号时**不再把 IP 混进指纹**，否则攻击者换 IP 就能同时绕过
    IP 与指纹两个维度。没有设备号（curl / 脚本）时仍混入 IP，避免所有同类客户端
    被算成同一指纹造成误杀。
    """
    device = (device_id or "").strip()
    ua = (user_agent or "").strip()
    lang = (language or "").strip()
    if device:
        raw = "|".join(["v2-device", device, ua, lang])
    else:
        raw = "|".join(["v2-ip", (ip or "").strip(), ua, lang])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def is_suspicious_path(path: str) -> bool:
    value = (path or "").lower()
    return any(marker in value for marker in SUSPICIOUS_MARKERS)


def _dedupe(key: str) -> bool:
    """同一指纹 + 路径 + 状态 60 秒内只记一次，避免扫描器刷爆审计表."""
    now = time.monotonic()
    last = _DEDUPE.get(key)
    if last and now - last < _DEDUPE_SECONDS:
        return False
    _DEDUPE[key] = now
    if len(_DEDUPE) > 5000:  # 防止内存无限增长
        cutoff = now - _DEDUPE_SECONDS
        for item in [k for k, v in _DEDUPE.items() if v < cutoff]:
            _DEDUPE.pop(item, None)
    return True


def record(
    event_type: str,
    *,
    ip: str = "",
    forwarded_for: str = "",
    user_agent: str = "",
    device_id: str = "",
    fp: str = "",
    method: str = "",
    path: str = "",
    status_code: int = 0,
    user_id: int | None = None,
    username: str = "",
    request_id: str = "",
    detail: dict[str, Any] | None = None,
) -> bool:
    """写一条安全事件（失败不影响主流程）；返回是否真的写入."""
    # detail 参与去重：同一攻击样本 60 秒内只记一次，但不同样本（如不同注入语句）都能留下
    signature = hashlib.sha256(
        json.dumps(detail or {}, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:8]
    if not _dedupe(f"{event_type}|{fp}|{path}|{status_code}|{signature}"):
        return False
    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            db.execute(
                text(
                    "INSERT INTO bi_security_event "
                    " (event_type, user_id, username, ip, forwarded_for, user_agent, device_id, "
                    "  fingerprint, method, path, status_code, request_id, detail) "
                    "VALUES (:t, :u, :un, :ip, :ff, :ua, :did, :fp, :m, :p, :s, :rid, "
                    "        CAST(:d AS jsonb))"
                ),
                {
                    "t": event_type, "u": user_id, "un": (username or "")[:80],
                    "ip": (ip or "")[:80], "ff": (forwarded_for or "")[:200],
                    "ua": (user_agent or "")[:400], "did": (device_id or "")[:80],
                    "fp": (fp or "")[:32], "m": (method or "")[:10],
                    "p": (path or "")[:400], "s": int(status_code or 0),
                    "rid": (request_id or "")[:64],
                    "d": json.dumps(detail or {}, ensure_ascii=False)[:4000],
                },
            )
            db.commit()
            return True
        finally:
            db.close()
    except Exception as exc:
        print(f"[security] 安全事件写入失败：{str(exc)[:160]}")
        return False


def sample_external_db_sessions() -> int:
    """把「不是应用连接」的数据库会话记成安全事件（直连查数据 / 黑客连库）."""
    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            rows = db.execute(
                text(
                    "SELECT pid, usename, COALESCE(client_addr::text, ''), "
                    "       COALESCE(application_name, ''), COALESCE(state, ''), "
                    "       LEFT(COALESCE(query, ''), 200) "
                    "FROM pg_stat_activity "
                    "WHERE datname = current_database() AND pid <> pg_backend_pid() "
                    "  AND COALESCE(application_name, '') <> 'mingcebi-api' "
                    "  AND state = 'active' "
                    "  AND query_start < now() - interval '5 seconds'"
                )
            ).fetchall()
        finally:
            db.close()
    except Exception:
        return 0

    recorded = 0
    for pid, usename, client_addr, app_name, state, query in rows:
        fp = fingerprint(client_addr, f"db:{usename}", app_name)
        if record(
            "db_external_session", ip=client_addr or "", user_agent=f"db:{usename}",
            fp=fp, method="SQL", path=f"db:{usename}",
            detail={"pid": int(pid), "usename": usename, "application_name": app_name,
                    "state": state, "query": query},
        ):
            recorded += 1
    return recorded


__all__ = [
    "SUSPICIOUS_MARKERS", "fingerprint", "is_suspicious_path", "record",
    "sample_external_db_sessions",
]
