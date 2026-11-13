"""把「商品标题 → 产品标题」「品类 → 种类」的字段引用，在演示数据集（20）的绑定处改掉.

只动「binding.dataset_id == 20」的元素（组件库模板 + 绑了演示数据集的画板），
业务数据集（2 / 16 / 21 / 27 / 28 / 37…）里的同名字段一个都不碰。

用法: python prep_rebind.py [--apply]
"""

from __future__ import annotations

import json
import sys

from sqlalchemy import text

from app.database import SessionLocal

DEMO_DATASET = 20
RENAME = {"商品标题": "产品标题", "品类": "种类"}


def convert(node, hits: list[str], active: bool = False):
    if isinstance(node, dict):
        binding = node.get("binding")
        if isinstance(binding, dict) and binding.get("dataset_id") == DEMO_DATASET:
            active = True
        return {k: convert(v, hits, active) for k, v in node.items()}
    if isinstance(node, list):
        return [convert(v, hits, active) for v in node]
    if isinstance(node, str) and active and node.strip() in RENAME:
        hits.append(node.strip())
        return RENAME[node.strip()]
    return node


def main() -> None:
    apply = "--apply" in sys.argv
    db = SessionLocal()
    try:
        rows = db.execute(text("SELECT id, doc::text FROM bi_canvas ORDER BY id")).fetchall()
        changed_docs = []
        for cid, raw in rows:
            if not raw:
                continue
            hits: list[str] = []
            doc = convert(json.loads(raw), hits)
            if hits:
                changed_docs.append((cid, doc, hits))
        comps = db.execute(text("SELECT id, code, spec::text FROM bi_component")).fetchall()
        changed_specs = []
        for cid, code, raw in comps:
            hits = []
            spec = convert(json.loads(raw), hits)
            if hits:
                changed_specs.append((cid, code, spec, hits))
        print(f"画板需改：{len(changed_docs)} 个 / 组件需改：{len(changed_specs)} 个")
        for cid, _doc, hits in changed_docs:
            print(f"  canvas {cid}: {len(hits)} 处 {sorted(set(hits))}")
        for cid, code, _spec, hits in changed_specs:
            print(f"  component {code}: {len(hits)} 处 {sorted(set(hits))}")
        if not apply:
            print("（dry-run，未写库；加 --apply 执行）")
            return
        for cid, doc, _hits in changed_docs:
            backup = db.execute(text("SELECT doc::text FROM bi_canvas WHERE id = :i"), {"i": cid}).scalar()
            with open(f"/tmp/doc{cid}-backup-rebind-20261113.json", "w", encoding="utf-8") as fh:
                fh.write(backup or "{}")
            db.execute(
                text("UPDATE bi_canvas SET doc = CAST(:d AS jsonb), updated_at = now() WHERE id = :i"),
                {"d": json.dumps(doc, ensure_ascii=False), "i": cid},
            )
        for cid, code, spec, _hits in changed_specs:
            backup = db.execute(text("SELECT spec::text FROM bi_component WHERE id = :i"), {"i": cid}).scalar()
            with open(f"/tmp/component-{code}-backup-rebind-20261113.json", "w", encoding="utf-8") as fh:
                fh.write(backup or "{}")
            db.execute(
                text("UPDATE bi_component SET spec = CAST(:s AS jsonb), updated_at = now() WHERE id = :i"),
                {"s": json.dumps(spec, ensure_ascii=False), "i": cid},
            )
        db.commit()
        print("已写库")
    finally:
        db.close()


if __name__ == "__main__":
    main()
