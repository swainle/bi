"""安全卫士（S7 三期）—— 累计风险判定 + 自动封禁.

策略（可用环境变量调）：
    BI_GUARD_ENABLED=1               总开关（默认值；管理员可在后台覆盖）
    BI_GUARD_WINDOW_SECONDS=300      统计窗口
    BI_GUARD_MAX_HITS=10             窗口内命中多少次触发封禁
    BI_GUARD_BAN_SECONDS=1800        封禁时长
    BI_GUARD_WHITELIST_IPS=127.0.0.1,::1   白名单 IP（运维本机，完全豁免：不计数也不封禁）

开关优先级：`bi_app_setting.security.guard.enabled`（管理员后台）> 环境变量 > 默认开启；
后台切换 5 秒内生效，已有封禁记录保留（重新开启后在有效期内的封禁恢复生效）。

维度：IP / 浏览器指纹 / 账号（user_id），同时触发、可单独解封。
计数只针对攻击型事件：匿名/伪造令牌/越权/限流/扫描/登录失败。
封禁是「临时」的：到期自动失效，管理员可在「操作监控 → 安全封禁」里提前解封。
"""

from __future__ import annotations

import ipaddress
import json
import os
import time
from datetime import datetime
from typing import Any

from sqlalchemy import text

# 计入风险的事件类型
COUNTED_EVENTS = {
    "denied_anonymous", "denied_invalid_token", "denied_forbidden",
    "rate_limited", "suspicious_path", "auth_failed",
}
_CACHE_TTL = 10.0
_ENABLED_KEY = "security.guard.enabled"
_ENABLED_TTL = 5.0
_blocked_cache: dict[str, tuple[float, dict | None]] = {}
_enabled_cache: tuple[float, bool] | None = None


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


def env_enabled() -> bool:
    return (os.getenv("BI_GUARD_ENABLED", "1") or "1").strip() != "0"


def enabled() -> bool:
    """当前是否启用：数据库开关 > 环境变量；5s 进程内缓存，避免每请求查库."""
    global _enabled_cache
    now = time.monotonic()
    if _enabled_cache is not None and now - _enabled_cache[0] < _ENABLED_TTL:
        return _enabled_cache[1]
    value = env_enabled()
    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            row = db.execute(
                text("SELECT value FROM bi_app_setting WHERE key = :k"), {"k": _ENABLED_KEY}
            ).fetchone()
        finally:
            db.close()
        if row is not None:
            value = str(row[0]).strip() not in ("0", "false", "False")
    except Exception:
        pass
    _enabled_cache = (now, value)
    return value


def set_enabled(value: bool, by_user_id: int | None = None) -> dict:
    """管理员启停安全卫士（立即生效，写审计）."""
    global _enabled_cache
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO bi_app_setting (key, value, updated_by, updated_at) "
                "VALUES (:k, :v, :u, now()) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
                "updated_by = EXCLUDED.updated_by, updated_at = now()"
            ),
            {"k": _ENABLED_KEY, "v": "1" if value else "0", "u": by_user_id},
        )
        db.commit()
    finally:
        db.close()
    _enabled_cache = (time.monotonic(), bool(value))
    _invalidate()
    try:
        from app.middleware.audit import log_audit

        log_audit(by_user_id, "security.guard.toggle", "security", 0,
                  {"enabled": bool(value)})
    except Exception:
        pass
    return config()


def window_seconds() -> int:
    return _env_int("BI_GUARD_WINDOW_SECONDS", 300)


def max_hits() -> int:
    return _env_int("BI_GUARD_MAX_HITS", 10)


def ban_seconds() -> int:
    return _env_int("BI_GUARD_BAN_SECONDS", 1800)


def whitelist() -> set[str]:
    raw = os.getenv("BI_GUARD_WHITELIST_IPS", "127.0.0.1,::1")
    return {item.strip() for item in raw.split(",") if item.strip()}


def whitelist_cidrs() -> list[str]:
    """内网网段白名单（只豁免频率风控，不豁免脱敏 / 导出上限 / RLS）."""
    raw = os.getenv("BI_GUARD_WHITELIST_CIDRS", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    return [item.strip() for item in raw.split(",") if item.strip()]


def whitelist_roles() -> set[str]:
    raw = os.getenv("BI_GUARD_WHITELIST_ROLES", "")
    return {item.strip() for item in raw.split(",") if item.strip()}


def _setting(db: Any, key: str) -> str:
    try:
        row = db.execute(
            text("SELECT value FROM bi_app_setting WHERE key = :k"), {"k": key}
        ).fetchone()
        return str(row[0]) if row else ""
    except Exception:
        return ""


def whitelist_settings(db: Any) -> dict:
    """后台可配的白名单（IP / 网段 / 角色 / 临时任务），只影响频率风控."""
    ips = {item.strip() for item in _setting(db, "security.guard.whitelist_ips").split(",")
           if item.strip()}
    cidrs = [item.strip() for item in _setting(db, "security.guard.whitelist_cidrs").split(",")
             if item.strip()]
    roles = {item.strip() for item in _setting(db, "security.guard.whitelist_roles").split(",")
             if item.strip()}
    temp: list[dict] = []
    raw = _setting(db, "security.guard.whitelist_temp")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                temp = [item for item in parsed if isinstance(item, dict)]
        except Exception:
            temp = []
    return {"ips": ips, "cidrs": cidrs, "roles": roles, "temp": temp}


def _ip_matches(ip: str, ips: set[str], cidrs: list[str]) -> bool:
    if not ip:
        return False
    if ip in ips:
        return True
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for item in cidrs:
        try:
            if address in ipaddress.ip_network(item, strict=False):
                return True
        except ValueError:
            continue
    return False


_ROLE_CACHE: dict[int, tuple[float, bool]] = {}


def _user_role_whitelisted(db: Any, user_id: int | None, roles: set[str]) -> bool:
    if not user_id or not roles:
        return False
    now = time.monotonic()
    cached = _ROLE_CACHE.get(int(user_id))
    if cached and now - cached[0] < 60:
        return cached[1]
    value = False
    try:
        names = {str(row[0]) for row in db.execute(
            text("SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id "
                 "WHERE ur.user_id = :u"), {"u": int(user_id)}
        ).fetchall()}
        if "account_type" in roles:
            admin = db.execute(text("SELECT account_type FROM users WHERE id = :u"),
                               {"u": int(user_id)}).scalar()
            if str(admin or "") == "admin":
                names.add("admin")
        value = bool(names & roles)
    except Exception:
        value = False
    _ROLE_CACHE[int(user_id)] = (now, value)
    return value


_WL_CACHE: tuple[float, dict] | None = None


def _cached_whitelist_settings(db: Any) -> dict:
    global _WL_CACHE
    now = time.monotonic()
    if _WL_CACHE is not None and now - _WL_CACHE[0] < 5:
        return _WL_CACHE[1]
    cfg = whitelist_settings(db)
    _WL_CACHE = (now, cfg)
    return cfg


def is_frequency_whitelisted(ip: str = "", user_id: int | None = None,
                             db: Any = None) -> bool:
    """只豁免频率风控（计数 / 封禁）；脱敏、导出上限、RLS 仍然生效."""
    if _ip_matches(ip, whitelist(), whitelist_cidrs()):
        return True
    own_db = False
    if db is None:
        try:
            from app.database import SessionLocal

            db = SessionLocal()
            own_db = True
        except Exception:
            return False
    try:
        cfg = _cached_whitelist_settings(db)
        if _ip_matches(ip, cfg["ips"], cfg["cidrs"]):
            return True
        for item in cfg["temp"]:
            try:
                expires = datetime.fromisoformat(str(item.get("expires_at") or ""))
                if expires < datetime.now():
                    continue
            except Exception:
                continue
            kind = str(item.get("kind") or "ip")
            value = str(item.get("value") or "")
            if kind == "ip" and value == ip:
                return True
            if kind == "cidr" and _ip_matches(ip, set(), [value]):
                return True
            if kind == "user" and user_id and value == str(user_id):
                return True
        return _user_role_whitelisted(db, user_id, whitelist_roles() | cfg["roles"])
    finally:
        if own_db:
            db.close()


def work_hours() -> tuple[int, int]:
    raw = os.getenv("BI_GUARD_WORK_HOURS", "8-20")
    try:
        start, end = (int(part) for part in raw.split("-", 1))
        return max(0, start), min(24, end)
    except Exception:
        return 8, 20


def combo_block_enabled() -> bool:
    """组合规则默认只告警；后台把 security.guard.combo.block 设为 1 才阻断."""
    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            raw = _setting(db, "security.guard.combo.block")
        finally:
            db.close()
        return str(raw).strip() in ("1", "true", "True")
    except Exception:
        return (os.getenv("BI_GUARD_COMBO_BLOCK", "0") or "0").strip() == "1"


def config() -> dict:
    start, end = work_hours()
    return {
        "enabled": enabled(), "window_seconds": window_seconds(),
        "max_hits": max_hits(), "ban_seconds": ban_seconds(),
        "whitelist_ips": sorted(whitelist()),
        "whitelist_cidrs": whitelist_cidrs(),
        "whitelist_roles": sorted(whitelist_roles()),
        "work_hours": f"{start}-{end}",
        "combo_block": combo_block_enabled(),
    }


def _invalidate() -> None:
    _blocked_cache.clear()


def _key(ip: str, fp: str, user_id: int | None) -> str:
    return f"{ip}|{fp}|{user_id or 0}"


def is_blocked(ip: str = "", fp: str = "", user_id: int | None = None) -> dict | None:
    """当前请求是否命中封禁（10s 进程内缓存，避免每个请求查库）."""
    if not enabled():
        return None
    # 白名单（本机 / 内网 / 角色 / 临时任务）只豁免频率风控；
    # 脱敏、导出上限、RLS 在各自链路里独立生效，不经过这里。
    if is_frequency_whitelisted(ip, user_id):
        return None
    key = _key(ip, fp, user_id)
    now = time.monotonic()
    cached = _blocked_cache.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            row = db.execute(
                text(
                    "SELECT id, dimension, value, reason, expires_at "
                    "FROM bi_security_block "
                    "WHERE released_at IS NULL AND expires_at > now() "
                    "  AND ( (dimension = 'ip' AND value = :ip) "
                    "     OR (dimension = 'fingerprint' AND value = :fp AND :fp <> '') "
                    "     OR (dimension = 'user' AND value = :uid AND :uid <> '') ) "
                    "ORDER BY expires_at DESC LIMIT 1"
                ),
                {"ip": ip or "", "fp": fp or "",
                 "uid": str(user_id) if user_id else ""},
            ).fetchone()
        finally:
            db.close()
    except Exception:
        row = None
    result = None
    if row is not None:
        result = {"id": int(row[0]), "dimension": row[1], "value": row[2],
                  "reason": row[3], "expires_at": str(row[4] or "")}
    _blocked_cache[key] = (now, result)
    return result


def _create_block(db, *, dimension: str, value: str, hits: int, reason: str) -> bool:
    exists = db.execute(
        text(
            "SELECT 1 FROM bi_security_block WHERE dimension = :d AND value = :v "
            "AND released_at IS NULL AND expires_at > now() LIMIT 1"
        ),
        {"d": dimension, "v": value},
    ).fetchone()
    if exists:
        return False
    row = db.execute(
        text(
            "INSERT INTO bi_security_block (dimension, value, reason, hits, expires_at) "
            "VALUES (:d, :v, :r, :h, now() + (:ban || ' seconds')::interval) "
            "RETURNING id, expires_at"
        ),
        {"d": dimension, "v": value, "r": reason[:300], "h": int(hits),
         "ban": str(ban_seconds())},
    ).fetchone()
    db.commit()
    print(f"[guard] 封禁 {dimension}={value}（{hits} 次 / {window_seconds()}s），"
          f"到期 {row[1]}，原因：{reason[:120]}")
    try:
        from app.middleware.audit import log_audit
        from app.security import security_events

        security_events.record(
            "guard_block", ip=value if dimension == "ip" else "",
            fp=value if dimension == "fingerprint" else "",
            user_id=int(value) if dimension == "user" else None,
            detail={"dimension": dimension, "value": value, "hits": int(hits),
                    "ban_seconds": ban_seconds(), "expires_at": str(row[1]), "reason": reason},
        )
        log_audit(None, "security.guard.block", "security", int(row[0]),
                  {"dimension": dimension, "value": value, "hits": int(hits)})
    except Exception:
        pass
    _invalidate()
    return True


def _is_admin_user(db, user_id: int | None) -> bool:
    if not user_id:
        return False
    try:
        role = db.execute(text("SELECT role FROM users WHERE id = :u"),
                          {"u": int(user_id)}).scalar()
        return str(role or "") in ("admin", "super_admin")
    except Exception:
        return False


def _combo_token_probe(db, *, ip: str, fp: str) -> bool:
    """组合规则 2：令牌伪造/匿名 + 反复越权探测 → 判定为攻击.

    用 `bi_guard_hit` 计数（每次命中都记），不用 `bi_security_event`
    （后者 60 秒内相同事件会去重，看不出「反复」）。
    """
    try:
        row = db.execute(
            text(
                "SELECT count(*) FILTER (WHERE event_type IN "
                "         ('denied_invalid_token', 'denied_anonymous')), "
                "       count(*) FILTER (WHERE event_type = 'denied_forbidden') "
                "FROM bi_guard_hit "
                "WHERE created_at > now() - (:w || ' seconds')::interval "
                "  AND ((:fp <> '' AND fingerprint = :fp) OR (:ip <> '' AND ip = :ip))"
            ),
            {"ip": ip or "", "fp": fp or "", "w": str(window_seconds())},
        ).fetchone()
        return int(row[0] or 0) >= 1 and int(row[1] or 0) >= 3
    except Exception:
        return False


def note(event_type: str, *, ip: str = "", fp: str = "", user_id: int | None = None) -> None:
    """记一次风险命中；窗口内累计到阈值 → 自动封禁 IP / 指纹 / 账号."""
    if not enabled() or event_type not in COUNTED_EVENTS:
        return
    if not (ip or fp or user_id):
        return
    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            # 白名单只豁免频率风控（不计数、不封禁）；组合规则仍然评估
            whitelisted = is_frequency_whitelisted(ip, user_id, db)
            if not whitelisted:
                db.execute(
                    text(
                        "INSERT INTO bi_guard_hit (event_type, ip, fingerprint, user_id) "
                        "VALUES (:t, :ip, :fp, :uid)"
                    ),
                    {"t": event_type, "ip": ip or "", "fp": fp or "", "uid": user_id},
                )
                db.commit()
                row = db.execute(
                    text(
                        "SELECT count(*) FILTER (WHERE ip = :ip AND :ip <> ''), "
                        "       count(*) FILTER (WHERE fingerprint = :fp AND :fp <> ''), "
                        "       count(*) FILTER (WHERE user_id = :uid AND :uid IS NOT NULL) "
                        "FROM bi_guard_hit "
                        "WHERE created_at > now() - (:w || ' seconds')::interval"
                    ),
                    {"ip": ip or "", "fp": fp or "", "uid": user_id,
                     "w": str(window_seconds())},
                ).fetchone()
                threshold = max_hits()
                ip_hits, fp_hits, user_hits = int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)
                reason = f"{event_type} 累计触发"
                if ip_hits >= threshold and ip:
                    _create_block(db, dimension="ip", value=ip, hits=ip_hits, reason=reason)
                if fp_hits >= threshold and fp:
                    _create_block(db, dimension="fingerprint", value=fp, hits=fp_hits,
                                  reason=reason)
                if user_hits >= threshold and user_id:
                    _create_block(db, dimension="user", value=str(user_id), hits=user_hits,
                                  reason=reason)

            # 组合规则 2：伪造令牌 + 反复跨部门探测（管理员账号只告警不封禁，避免锁死运维）
            if _combo_token_probe(db, ip=ip, fp=fp) and not (
                user_id and _is_admin_user(db, user_id)
            ):
                combo_reason = "伪造令牌 + 反复跨部门探测（组合规则）"
                if fp:
                    _create_block(db, dimension="fingerprint", value=fp,
                                  hits=1, reason=combo_reason)
                if user_id:
                    _create_block(db, dimension="user", value=str(user_id),
                                  hits=1, reason=combo_reason)
        finally:
            db.close()
    except Exception as e:
        # 安全卫士失败不能影响业务响应，但必须留痕，别静默失效
        print(f"[guard] 风险命中记录失败：{e}")
        return


# ── 业务高频：只告警，不封禁 ──────────────────────────────
_BUSINESS: dict[str, list[float]] = {}


def observe_business(kind: str, *, ip: str = "", fp: str = "",
                     user_id: int | None = None) -> None:
    """正常高频查询 / 导出只计数并告警，绝不触发封禁."""
    if not enabled():
        return
    window = 60
    limit = _env_int("BI_GUARD_BUSINESS_ALERT", 60)
    now = time.monotonic()
    key = f"{kind}|{ip}|{fp}|{user_id or 0}"
    hits = [ts for ts in _BUSINESS.get(key, []) if now - ts <= window]
    hits.append(now)
    _BUSINESS[key] = hits
    if len(_BUSINESS) > 5000:
        for old in [k for k, v in _BUSINESS.items() if not v or now - v[-1] > window]:
            _BUSINESS.pop(old, None)
    if len(hits) == limit + 1:  # 刚越过阈值写一条，避免刷屏
        try:
            from app.security import security_events

            security_events.record(
                "business_high_frequency", ip=ip, fp=fp, user_id=user_id,
                detail={"kind": kind, "count": len(hits), "window": window},
            )
        except Exception:
            pass


def assess_sensitive_export(db, *, user, ip: str = "", fp: str = "",
                            table: str = "", dashboard_id: int | None = None) -> dict:
    """组合规则 1：陌生指纹 + 非工作时段 + 敏感明细导出 → 告警 / 阻断.

    异地判定按 D4 决策不引 IP 归属地库：用「该用户近 30 天没出现过的指纹」代替异地。
    默认只告警；`security.guard.combo.block=1` 才阻断。
    """
    if not enabled():
        return {"triggered": False, "blocked": False, "off_hours": False,
                "unfamiliar": False}
    start_hour, end_hour = work_hours()
    hour = datetime.now().hour
    off_hours = not (start_hour <= hour < end_hour)
    user_id = getattr(user, "id", None)
    unfamiliar = True
    if user_id and fp:
        try:
            seen = db.execute(
                text(
                    "SELECT count(*) FROM bi_audit_logs "
                    "WHERE user_id = :u AND fingerprint = :fp "
                    "  AND created_at > now() - interval '30 days'"
                ),
                {"u": user_id, "fp": fp},
            ).scalar()
            unfamiliar = int(seen or 0) == 0
        except Exception:
            unfamiliar = True

    triggered = bool(off_hours and unfamiliar and user_id
                     and not is_frequency_whitelisted(ip, user_id, db))
    blocked = False
    if triggered:
        # 管理员账号只告警不封禁：避免组合规则把运维自己锁在门外
        blocked = combo_block_enabled() and not _is_admin_user(db, user_id)
        detail = {"off_hours": off_hours, "unfamiliar": unfamiliar, "blocked": blocked,
                  "table": table, "dashboard_id": dashboard_id}
        try:
            from app.middleware.audit import log_audit
            from app.security import security_events

            security_events.record(
                "guard_combo_alert", ip=ip, fp=fp, user_id=user_id,
                detail={"rule": "unfamiliar_fingerprint_off_hours_export", **detail},
            )
            log_audit(user_id, "security.guard.combo", "security", 0, detail)
        except Exception:
            pass
        if blocked:
            reason = "陌生设备 + 非工作时段 + 明细导出（组合规则）"
            _create_block(db, dimension="user", value=str(user_id), hits=1, reason=reason)
            if fp:
                _create_block(db, dimension="fingerprint", value=fp, hits=1, reason=reason)
    return {"triggered": triggered, "blocked": blocked, "off_hours": off_hours,
            "unfamiliar": unfamiliar}


def list_blocks(*, active_only: bool = True, limit: int = 100) -> list[dict]:
    sql = (
        "SELECT id, created_at, dimension, value, reason, hits, expires_at, "
        "       released_at, released_by FROM bi_security_block "
    )
    if active_only:
        sql += "WHERE released_at IS NULL AND expires_at > now() "
    sql += "ORDER BY created_at DESC LIMIT :limit"
    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            rows = db.execute(text(sql), {"limit": max(1, min(limit, 500))}).fetchall()
        finally:
            db.close()
    except Exception:
        return []
    return [
        {"id": int(r[0]), "created_at": str(r[1] or ""), "dimension": r[2],
         "value": r[3], "reason": r[4] or "", "hits": int(r[5] or 0),
         "expires_at": str(r[6] or ""), "released_at": str(r[7] or "") if r[7] else "",
         "released_by": r[8]}
        for r in rows
    ]


def release(block_id: int, by_user_id: int | None) -> dict:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        row = db.execute(
            text("SELECT dimension, value FROM bi_security_block WHERE id = :i"), {"i": block_id}
        ).fetchone()
        if row is None:
            return {"released": False, "reason": "不存在"}
        db.execute(
            text("UPDATE bi_security_block SET released_at = now(), released_by = :u "
                 "WHERE id = :i AND released_at IS NULL"),
            {"i": block_id, "u": by_user_id},
        )
        # 同时清掉该维度窗口内的命中计数：否则解封后的第一次请求就会重新触发封禁，
        # 「人工解封」等于无效。
        column = {"ip": "ip", "fingerprint": "fingerprint", "user": "user_id"}.get(row[0])
        if column:
            db.execute(
                text(f"DELETE FROM bi_guard_hit WHERE {column}::text = :v AND "
                     "created_at > now() - (:w || ' seconds')::interval"),
                {"v": row[1], "w": str(window_seconds())},
            )
        db.commit()
    finally:
        db.close()
    _invalidate()
    try:
        from app.middleware.audit import log_audit

        log_audit(by_user_id, "security.guard.release", "security", block_id,
                  {"dimension": row[0], "value": row[1]})
    except Exception:
        pass
    return {"released": True, "id": block_id}


def cleanup() -> int:
    """清理 2 天前的命中流水（封禁记录保留，便于追溯）."""
    try:
        from app.database import SessionLocal

        db = SessionLocal()
        try:
            result = db.execute(
                text("DELETE FROM bi_guard_hit WHERE created_at < now() - interval '2 days'")
            )
            db.commit()
            return int(result.rowcount or 0)
        finally:
            db.close()
    except Exception:
        return 0


__all__ = [
    "COUNTED_EVENTS", "cleanup", "config", "enabled", "env_enabled", "is_blocked",
    "list_blocks", "note", "release", "set_enabled",
]
