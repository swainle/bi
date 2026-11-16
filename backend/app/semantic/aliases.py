"""列名 → 中文展示名（源库英文列拖进卡片时自动起中文标题）.

只覆盖 DM 宽表视图（dm.v_bangdan 等 29 列）的标准列 —— 这些是我们自己定的口径，
英文是给 SQL 用的，中文是给用户看的。数据集里用户手改过名字的不会被覆盖：
规则是「仅当字段名与源列名完全相同（即没有人工命名）时才自动翻译」。
"""

from __future__ import annotations

COLUMN_LABELS: dict[str, str] = {
    # 时间 / 标识
    "dt": "日期",
    "product_id": "链接ID",
    "source_table": "来源表",
    # 维度
    "title": "产品标题",
    "platform": "平台",
    "brand": "品牌",
    "category": "种类",
    "board": "榜单",
    "price_band": "价格带",
    "url": "链接",
    "main_selling_point": "主卖点",
    "sub_selling_point": "副卖点",
    "selling_points": "卖点",
    "pain_point": "痛点",
    # 时间派生
    "listed_at": "上架时间",
    "listed_days": "上架天数",
    "listed_days_src": "原上架天数",
    # 指标
    "price_avg": "均价",
    "sales_lower": "日销量",
    "sales_truncated": "销量截断",
    "sales_tier": "日销量档位",
    "board_rank": "榜单排名",
    "heat_score": "热销指数",
    "top_days": "霸榜天数",
    "bad_review_cnt": "差评数",
    # 关联 id
    "sku_id": "SKU_ID",
    "sku_id_2": "SKU_ID2",
    "review_id": "差评ID",
    "main_image_id": "主图ID",
    "detail_image_id": "详情图ID",
}


def label_for(source_column: str, fallback: str | None = None) -> str:
    """源列名有中文名就用中文名，否则沿用原值."""
    return COLUMN_LABELS.get(str(source_column or "").strip(), fallback or source_column)


def needs_label(name: str, source_column: str) -> bool:
    """只有「没人工命名过」（名字仍等于源列名）才自动翻译."""
    return str(name or "").strip() == str(source_column or "").strip()


__all__ = ["COLUMN_LABELS", "label_for", "needs_label"]
