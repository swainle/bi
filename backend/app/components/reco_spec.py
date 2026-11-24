"""推荐列表的规格段（RecoSpec）.

单独一个文件是为了不让 `spec.py` 继续变长（开发规范 §4.1：存量 >300 行的文件只减不增）。
这里只有字段与钳制逻辑，不引用 `spec.py`，避免循环导入。
"""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class RecoSpec(BaseModel):
    """推荐列表：机会分 + 行内指标 + 点击详情.

    和 `rank_list` 的区别：榜卡是「按值排个名」，推荐列表是「按机会分给出建议」——
    每行带可点击详情（统计 / 走势 / 大盘对比 / 解读 / 建议），所以字段单独一段。
    """

    # 取数用到的列（空 = 从 binding.metric / metrics 推导）
    value_key: str = ""               # 人气：机会分与进度条的主值
    ctr_key: str = ""                 # 点击率（详情里与大盘均值对比）
    cvr_key: str = ""                 # 支付转化率（机会分权重之一）
    ds_key: str = ""                  # 需求供给比（机会分权重之一）
    g_key: str = ""                   # 搜索增速（详情走势按它推算）

    # 行内展示的三项指标：空 = 人气 / 支付转化率 / 机会分（与参考页汇总推荐一致）
    stats: list[dict] = []
    weights: dict = {}                # 机会分权重 {v, cvr, ds}，缺省 0.45 / 0.30 / 0.25
    score_label: str = "机会分"
    bar_key: str = ""                 # 进度条取值列（空 = value_key）
    detail: bool = True               # 点一行是否弹详情
    trend_days: int = 7               # 详情走势天数（按增速推算，界面会标注）

    @field_validator("stats")
    @classmethod
    def _stats(cls, v: list) -> list:
        out: list[dict] = []
        for item in (v or [])[:3]:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()[:60]
            if not key:
                continue
            out.append({
                "key": key,
                "label": str(item.get("label") or key)[:12],
                "format": str(item.get("format") or "auto")[:8],
            })
        return out

    @field_validator("weights")
    @classmethod
    def _weights(cls, v: dict) -> dict:
        """只收认识的三个键；没写的键留空，由计算侧回落到默认权重。

        写成 0.0 会把「没配」变成「不参与评分」，用户很难发现是自己漏填。
        """
        out: dict[str, float] = {}
        for key in ("v", "cvr", "ds"):
            if key not in (v or {}):
                continue
            try:
                out[key] = max(0.0, min(float(v[key]), 1.0))
            except (TypeError, ValueError):
                continue
        return out

    @field_validator("trend_days")
    @classmethod
    def _days(cls, v: int) -> int:
        return max(3, min(int(v or 7), 30))

    @field_validator("score_label")
    @classmethod
    def _label(cls, v: str) -> str:
        return (v or "机会分")[:8]

    @field_validator("value_key", "ctr_key", "cvr_key", "ds_key", "g_key", "bar_key")
    @classmethod
    def _field(cls, v: str) -> str:
        return str(v or "").strip()[:60]


__all__ = ["RecoSpec"]
