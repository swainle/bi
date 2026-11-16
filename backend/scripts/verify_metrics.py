"""口径核对：模板的数 vs BI 的数（同一份原始导出 → 两条独立路径）.

模板侧：从 index.html 里取出内联的 TM_DEMAND，按模板 renderDmAll 的公式重算；
BI 侧：直接查 bi_demand_* 与 bi_demand_merged。
两边对不上就 exit 1 —— 这是「数据口径能跟模板对应上」的证据。

用法：
    cd backend && ./.venv/bin/python -m scripts.verify_metrics
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEMPLATE = os.environ.get("BI_TEMPLATE_DIR", os.path.join(REPO_ROOT, "市场部BI看板模板"))


def load_tm_demand() -> dict:
    html = open(os.path.join(TEMPLATE, "index.html"), encoding="utf-8").read()
    match = re.search(r"const TM_DEMAND\s*=\s*(\{.*?\});\s*</script>", html, re.S)
    if not match:
        raise SystemExit("index.html 里没有找到 TM_DEMAND")
    return json.loads(match.group(1))


def template_numbers(D: dict) -> dict:
    """完全按模板 renderDmAll / dmMerged 的算法重算."""
    merged = {}
    for key in ("hot", "grow", "rel"):
        for item in D[key]:
            word = item["w"]
            if word not in merged:
                merged[word] = {**item, "src": [key]}
                continue
            cur = merged[word]
            cur["src"].append(key)
            for field in ("v", "ctr", "cvr", "g", "ds", "buy", "tm"):
                if cur.get(field) is None and item.get(field) is not None:
                    cur[field] = item[field]

    rows = list(merged.values())
    sum_v = sum(r.get("v") or 0 for r in rows)
    avg_ctr = sum(r.get("ctr") or 0 for r in rows) / len(rows) * 100 if rows else 0
    avg_cvr = sum(r.get("cvr") or 0 for r in rows) / len(rows) if rows else 0
    rel = D["rel"]
    sum_buy = sum(x.get("buy") or 0 for x in rel)
    top_ds = max(rel, key=lambda x: x.get("ds") or 0) if rel else None
    top_grow = max(D["grow"], key=lambda x: x.get("g") or 0) if D["grow"] else None
    scar = sum(1 for x in rel if (x.get("ds") or 0) >= 3)
    return {
        "词数": len(rows),
        "搜索人气": sum_v,
        "搜索增速": (top_grow or {}).get("g") or 0,
        "搜索增速词": (top_grow or {}).get("w") or "",
        "点击率": avg_ctr,
        "支付转化率": avg_cvr,
        "需求供给比": (top_ds or {}).get("ds") or 0,
        "需求供给比词": (top_ds or {}).get("w") or "",
        "支付买家数": sum_buy,
        "高缺口词数": scar,
    }


def bi_numbers(db) -> dict:
    agg = db.execute(text("""
        SELECT count(*), sum(v), avg(ctr) * 100, avg(cvr), sum(buy), max(ds)
        FROM bi_demand_merged
    """)).fetchone()
    top_ds = db.execute(text(
        "SELECT word, ds FROM bi_demand_merged WHERE ds IS NOT NULL ORDER BY ds DESC LIMIT 1"
    )).fetchone()
    top_grow = db.execute(text(
        "SELECT word, g FROM bi_demand_grow WHERE g IS NOT NULL ORDER BY g DESC LIMIT 1"
    )).fetchone()
    scar = db.execute(text("SELECT count(*) FROM bi_demand_rel WHERE ds >= 3")).scalar()
    return {
        "词数": agg[0],
        "搜索人气": float(agg[1] or 0),
        "搜索增速": float(top_grow[1] or 0) if top_grow else 0,
        "搜索增速词": top_grow[0] if top_grow else "",
        "点击率": float(agg[2] or 0),
        "支付转化率": float(agg[3] or 0),
        "需求供给比": float(top_ds[1] or 0) if top_ds else 0,
        "需求供给比词": top_ds[0] if top_ds else "",
        "支付买家数": float(agg[4] or 0),
        "高缺口词数": scar,
    }


# 模板截图上的 6 张卡（07-需求端·生意参谋.png / 组件样式/卡片）
SCREENSHOT = {
    "搜索人气": "41.1万",
    "搜索增速": "+546.0%",
    "点击率": "83.8%",
    "支付转化率": "26.9%",
    "需求供给比": "113.7×",
    "支付买家数": "3.0万",
}


def _fmt(label: str, value: float) -> str:
    if label == "搜索人气":
        return f"{value / 10000:.1f}万"
    if label == "搜索增速":
        return f"+{value:.1f}%"
    if label == "点击率":
        return f"{value:.1f}%"
    if label == "支付转化率":
        return f"{value:.1f}%"
    if label == "需求供给比":
        return f"{value:.1f}×"
    if label == "支付买家数":
        return f"{value / 10000:.1f}万"
    return str(value)


def main() -> int:
    D = load_tm_demand()
    expected = template_numbers(D)
    db = SessionLocal()
    try:
        actual = bi_numbers(db)
    finally:
        db.close()

    ok = True
    print(f"{'指标':<10}{'模板':>14}{'BI':>14}{'截图':>12}   结果")
    print("-" * 64)
    for label in ("搜索人气", "搜索增速", "点击率", "支付转化率", "需求供给比", "支付买家数", "词数", "高缺口词数"):
        tpl, bi = expected[label], actual[label]
        same = (tpl == bi) if label in ("词数", "高缺口词数") else abs(tpl - bi) < 1e-6
        shot = SCREENSHOT.get(label, "")
        note = "OK" if same else "DIFF"
        if shot:
            note += f" · 截图 {shot} / BI {_fmt(label, bi)}"
        if not same:
            ok = False
        print(f"{label:<10}{str(round(tpl, 4)):>14}{str(round(bi, 4)):>14}{shot:>12}   {note}")

    print()
    print(f"增速最高词：模板 {expected['搜索增速词']} / BI {actual['搜索增速词']}")
    print(f"供需比最高词：模板 {expected['需求供给比词']} / BI {actual['需求供给比词']}")

    if not ok:
        print("\n[FAIL] 模板与 BI 口径不一致")
        return 1
    print("\n[PASS] 模板与 BI 口径一致")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
