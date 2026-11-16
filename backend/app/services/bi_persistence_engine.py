"""
明策BI — 元数据批量持久化引擎 (PG + Redis)

核心能力：
  1. JSONB批量合并写入 — 单SQL批量更新，避免循环
  2. 数据一致性事务包裹 — 布局/配置/筛选三表同事务
  3. 增量更新区分 — 仅坐标变化只更新layout_info
  4. 布局快照存储 — 支持版本回退
  5. Redis布局缓存 — 打开看板秒加载
"""
from __future__ import annotations

import json, time
from typing import Optional
from sqlalchemy import text
from sqlalchemy.orm import Session


def batch_save_dashboard_cards(
    db: Session,
    dashboard_id: int,
    cards: list[dict],       # [{card_id, title, chart_type, layout: {x,y,w,h}, chart_config}]
    version: int = 0,
    user_id: int = 0,
) -> dict:
    """批量持久化看板卡片 — 单事务原子操作"""
    start = time.time()

    try:
        # 乐观锁版本检查
        row = db.execute(text(
            "SELECT version FROM bi_dashboards WHERE id = :did FOR UPDATE"
        ), {"did": dashboard_id}).fetchone()
        if row and row[0] != version and version > 0:
            return {"ok": False, "error": "version_conflict", "server_version": row[0], "your_version": version}

        # 批量准备UPSERT数据
        now = "'now()'"
        values_parts = []
        for card in cards:
            layout = json.dumps(card.get("layout", {}))
            cfg = json.dumps(card.get("chart_config", {}))
            cid = card.get("card_id", "")
            title = card.get("title", "").replace("'", "''")
            ctype = card.get("chart_type", "bar")
            sort = card.get("sort", 0)
            values_parts.append(
                f"('{cid}', '{title}', '{ctype}', CAST('{layout}' AS jsonb), CAST('{cfg}' AS jsonb), {sort}, {dashboard_id}, {now})"
            )

        # 批量UPSERT
        if values_parts:
            sql = f"""
                INSERT INTO bi_dashboard_cards (card_id, title, chart_type, layout_info, chart_config, sort_order, dashboard_id, updated_at)
                VALUES {', '.join(values_parts)}
                ON CONFLICT (card_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    chart_type = EXCLUDED.chart_type,
                    layout_info = EXCLUDED.layout_info,
                    chart_config = EXCLUDED.chart_config,
                    sort_order = EXCLUDED.sort_order,
                    updated_at = {now}
            """
            db.execute(text(sql))

        # 更新看板版本
        new_version = version + 1
        db.execute(text(
            "UPDATE bi_dashboards SET version = :v, updated_at = NOW() WHERE id = :did"
        ), {"v": new_version, "did": dashboard_id})

        db.commit()
        latency = int((time.time() - start) * 1000)

        # 更新 Redis 缓存
        _update_redis_cache(dashboard_id, cards)

        return {"ok": True, "version": new_version, "latency_ms": latency, "cards_saved": len(cards)}

    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}


def incremental_update(
    db: Session,
    card_id: str,
    layout_only: bool = True,
    layout: dict = None,
    chart_config: dict = None,
) -> dict:
    """增量更新 — 仅坐标变化时只更新layout_info"""
    try:
        if layout_only and layout:
            db.execute(text("""
                UPDATE bi_dashboard_cards
                SET layout_info = CAST(:layout AS jsonb), updated_at = NOW()
                WHERE card_id = :cid
            """), {"layout": json.dumps(layout), "cid": card_id})
        elif chart_config:
            db.execute(text("""
                UPDATE bi_dashboard_cards
                SET chart_config = CAST(:cfg AS jsonb), updated_at = NOW()
                WHERE card_id = :cid
            """), {"cfg": json.dumps(chart_config), "cid": card_id})
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}


def save_layout_snapshot(
    db: Session,
    dashboard_id: int,
    cards: list[dict],
    snapshot_name: str = "",
) -> dict:
    """保存布局快照到 history 表，支持版本回退"""
    try:
        db.execute(text("""
            INSERT INTO bi_dashboard_snapshots (dashboard_id, snapshot_name, cards_data, created_at)
            VALUES (:did, :name, CAST(:data AS jsonb), NOW())
        """), {"did": dashboard_id, "name": snapshot_name or f"Snapshot_{int(time.time())}", "data": json.dumps(cards)})
        db.commit()
        return {"ok": True, "snapshot_name": snapshot_name}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}


def load_cached_layout(dashboard_id: int) -> Optional[list[dict]]:
    """从 Redis 读取缓存布局"""
    try:
        from app.services.redis_client import get_redis
        r = get_redis()
        data = r.get(f"bi:layout:{dashboard_id}")
        if data:
            return json.loads(data)
    except Exception:
        pass
    return None


def _update_redis_cache(dashboard_id: int, cards: list[dict]):
    """更新 Redis 布局缓存"""
    try:
        from app.services.redis_client import get_redis
        r = get_redis()
        r.setex(f"bi:layout:{dashboard_id}", 3600, json.dumps(cards))
    except Exception:
        pass


def batch_delete_cards(db: Session, card_ids: list[str]) -> dict:
    """批量删除卡片"""
    try:
        if card_ids:
            ids = ", ".join(f"'{cid}'" for cid in card_ids)
            db.execute(text(f"DELETE FROM bi_dashboard_cards WHERE card_id IN ({ids})"))
        db.commit()
        return {"ok": True, "deleted": len(card_ids)}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}
