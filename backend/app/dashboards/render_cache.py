"""整页渲染结果的短时缓存（P1）。

为什么：一个 6 卡看板每打开一次要跑 6 条 SQL；同一批人反复刷新 / 多个大屏轮播时
（50~200 并发）几乎全是重复计算。这里把「整页 payload」缓存十几秒，命中率极高，
而口径延迟最多一个 TTL，看板保存时立刻按看板失效。

边界（不改变业务语义）：
    * key 里带用户（id / role / username）→ 行级权限不同的人不会串数据；
    * key 里带文档 updated_at、视图、请求参数、现场版面 → 只有完全相同的请求才命中；
    * 单卡报错的结果不缓存（避免把一次数据库抖动放大成整页错误，持续 TTL 秒）；
    * Redis 连不上 / 中途掉线都只是「不缓存」，绝不让渲染失败。

旋钮：BI_RENDER_CACHE_TTL（秒，默认 15；0 = 关闭）。
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Any

from app import cache

# key 形态：render:<dashboard_id>:<digest> —— 失效时按 render:<dashboard_id> 前缀删
PREFIX = "render"

# 单飞锁：同一个 key 同时只让一个请求回源计算，其余请求等它写进缓存后直接读
# （缓存过期那一刻 200 个并发会一起回源，没有这把锁就是连接池被瞬间打满）
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_LOCKS_MAX = 1024


def lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            if len(_locks) >= _LOCKS_MAX:  # 只做节流，不做长期存储：满了就换一批
                _locks.clear()
            lock = threading.Lock()
            _locks[key] = lock
        return lock


def ttl() -> int:
    """缓存秒数；0 表示关闭."""
    try:
        return max(0, int(os.getenv("BI_RENDER_CACHE_TTL", "15")))
    except ValueError:
        return 15


def _digest(updated_at: Any, user: Any, view: Any, params: Any, live_items: Any,
            cross_filters: Any = None) -> str:
    payload = {
        "updated_at": str(updated_at or ""),
        "user": [
            getattr(user, "id", None),
            getattr(user, "role", "") or "",
            getattr(user, "username", "") or "",
        ],
        "view": view,
        "params": params or {},
        "items": live_items,
        "cross": cross_filters or [],
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def key_for(dashboard_id: int, *, updated_at: Any, user: Any, view: Any,
            params: Any, live_items: Any = None, cross_filters: Any = None) -> str:
    return f"{PREFIX}:{dashboard_id}:{_digest(updated_at, user, view, params, live_items, cross_filters)}"


def load(key: str) -> dict | None:
    from app.query import metrics

    metrics.incr("render_cache.lookups")
    try:
        value = cache.get(key)
    except Exception:  # Redis 中途掉线：当成没缓存
        return None
    if isinstance(value, dict):
        metrics.incr("render_cache.hits")
        return value
    return None


def store(key: str, payload: dict) -> None:
    seconds = ttl()
    if seconds <= 0:
        return
    from app.query import metrics

    try:
        cache.set(key, payload, ttl=seconds)
    except Exception:  # 缓存写失败不影响这次渲染
        return
    metrics.incr("render_cache.stores")


def invalidate(dashboard_id: int) -> None:
    """看板文档变了（保存 / 删除）→ 这个看板的所有整页缓存立即失效."""
    from app.query import metrics

    try:
        cache.invalidate_prefix(f"{PREFIX}:{int(dashboard_id)}")
    except Exception:
        return
    metrics.incr("render_cache.invalidations")


def has_card_error(payload: dict) -> bool:
    """有一张卡报错就不缓存 —— 错误可能只是瞬时抖动，不该被冻住 15 秒."""
    cards = payload.get("cards")
    if not isinstance(cards, dict):
        return False
    return any(isinstance(card, dict) and card.get("error") for card in cards.values())
