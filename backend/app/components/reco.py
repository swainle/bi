"""推荐列表（reco_list）的 payload 计算.

单独成文件：`compute.py` 已经超过 300 行，新增逻辑放子文件（开发规范 §4.1）。
本模块不依赖 compute.py，纯函数、可直接单测（需求端表没有数据也能验收）。
"""

from __future__ import annotations

import math
import re
from typing import Any

from app.components.spec import ComponentSpec

# 机会分权重：与参考模板一致（人气 45% / 转化 30% / 供需缺口 25%）
DEFAULT_WEIGHTS = {"v": 0.45, "cvr": 0.30, "ds": 0.25}


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def as_percent(value: Any) -> float:
    """率值统一成「百分数」：0.79 与 79 都当 79% 处理.

    需求端表里的点击率既可能是比例（0.79）也可能是百分数（79），导入脚本没有统一约定；
    按 <=1 视为比例换算，避免把 79% 显示成 0.79%（也避免机会分权重被压低两个数量级）。
    """
    number = _num(value)
    return number * 100 if 0 <= number <= 1 else number


def stat_defs(spec: ComponentSpec, value_key: str) -> list[dict]:
    """行内三指标的定义：面板没配就按参考页「汇总推荐」出 —— 人气 / 转化率 / 机会分."""
    if spec.reco.stats:
        return [dict(item) for item in spec.reco.stats][:3]
    defs: list[dict] = []
    if value_key:
        defs.append({"key": value_key, "label": value_key, "format": "int"})
    if spec.reco.cvr_key:
        defs.append({"key": spec.reco.cvr_key, "label": spec.reco.cvr_key, "format": "pct"})
    # score 是算出来的，不是数据列；专门留一个保留键给渲染端取
    defs.append({"key": "score", "label": spec.reco.score_label, "format": "score"})
    return defs[:3]


def cell_value(row: dict, key: str, fmt: str, score: float = 0.0) -> float:
    if key == "score":
        return score
    if not key:
        return 0.0
    return as_percent(row.get(key)) if fmt == "pct" else _num(row.get(key))


def reco_tags(value: float, max_v: float, cvr: float, ds: float, growth: float,
              source: Any) -> list[str]:
    """推荐理由标签：与参考模板一致（人气高 / 转化好 / 缺口大 / 在起量 / 多表命中）."""
    tags: list[str] = []
    if max_v and value >= max_v * 0.15:
        tags.append("人气高")
    if cvr >= 30:
        tags.append("转化好")
    if ds >= 3:
        tags.append("缺口大")
    if growth >= 100:
        tags.append("在起量")
    sources = [part for part in re.split(r"[·,/、|\s]+", str(source or "")) if part]
    if len(sources) >= 2:
        tags.append("多表命中")
    return tags[:3]


def build_reco(rows: list[dict], spec: ComponentSpec) -> dict:
    """推荐列表：机会分排序 + 行内三指标 + 详情所需的大盘基准.

    机会分与模板同一口径：人气 45%（按当页最大值开方归一）+ 转化 30%（40% 封顶）+ 供需缺口 25%。
    """
    reco = spec.reco
    dimension = spec.binding.dimension
    value_key = reco.value_key or spec.binding.metric or ""
    weights = {**DEFAULT_WEIGHTS, **{k: float(v) for k, v in (reco.weights or {}).items() if v}}
    defs = stat_defs(spec, value_key)

    values = [_num(row.get(value_key)) for row in rows] if value_key else [0.0] * len(rows)
    demands = [_num(row.get(reco.ds_key)) for row in rows] if reco.ds_key else [0.0] * len(rows)
    conversions = [as_percent(row.get(reco.cvr_key)) for row in rows] if reco.cvr_key else [0.0] * len(rows)
    max_v = max(values) if values else 1.0
    max_ds = max(demands) if demands else 1.0
    log_ds = math.log10(1 + max_ds)

    # 分数先算出来：行内三项指标可能包含「机会分」本身
    scores: list[int] = []
    for index in range(len(rows)):
        raw = 100 * (
            weights["v"] * (math.sqrt(values[index] / max_v) if max_v else 0.0)
            + weights["cvr"] * min(1.0, conversions[index] / 40)
            + weights["ds"] * ((math.log10(1 + demands[index]) / log_ds) if log_ds else 0.0)
        )
        scores.append(max(0, min(100, round(raw))))

    # 大盘基准：行内各项指标各自的均值（率值按百分数算）
    averages: dict[str, float] = {}
    for definition in defs:
        samples = [cell_value(row, definition["key"], definition["format"], scores[index])
                   for index, row in enumerate(rows)]
        averages[definition["key"]] = sum(samples) / len(samples) if samples else 0.0

    items: list[dict] = []
    for index, row in enumerate(rows):
        cells = []
        for definition in defs:
            number = cell_value(row, definition["key"], definition["format"], scores[index])
            direction = ""
            if definition["format"] == "pct":
                direction = "up" if number >= averages.get(definition["key"], 0.0) else "down"
            cells.append({
                "k": definition["label"],
                "v": round(number, 2) if definition["format"] in ("pct", "score") else number,
                "f": definition["format"],
                "dir": direction,
            })
        items.append({
            "name": str(row.get(dimension) or ""),
            "value": values[index],
            "score": scores[index],
            "tags": reco_tags(values[index], max_v, conversions[index], demands[index],
                              _num(row.get(reco.g_key)) if reco.g_key else 0.0,
                              row.get("来源") or row.get("sources")),
            "stats": cells,
            # 详情弹窗直接用这几项，不再二次查库（口径与列表完全一致）
            "ctr": round(as_percent(row.get(reco.ctr_key)), 2) if reco.ctr_key else 0.0,
            "cvr": round(conversions[index], 2),
            "ds": round(demands[index], 2),
            "g": _num(row.get(reco.g_key)) if reco.g_key else 0.0,
        })

    items.sort(key=lambda item: (-item["score"], -item["value"]))
    for rank, item in enumerate(items, start=1):
        item["rank"] = rank

    return {
        "reco_items": items[: spec.binding.top_n],
        "count": len(rows),
        "reco_meta": {
            "avg_ctr": round(sum(
                as_percent(row.get(reco.ctr_key)) for row in rows
            ) / len(rows), 2) if reco.ctr_key and rows else 0.0,
            "avg_cvr": round(sum(conversions) / len(conversions), 2) if conversions else 0.0,
            "total": len(rows),
            "max_v": max_v,
            "max_ds": max_ds,
        },
        "reco_stats": [
            {**definition, "avg": round(averages.get(definition["key"], 0.0), 2)}
            for definition in defs
        ],
        "score_label": reco.score_label,
        "bar_key": reco.bar_key or value_key,
        # 前缀 reco_ 是为了不和明细表的 detail（行详情配置）撞名
        "reco_detail": reco.detail,
        "reco_trend_days": reco.trend_days,
    }


__all__ = ["build_reco", "reco_tags", "as_percent", "DEFAULT_WEIGHTS"]
