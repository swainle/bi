"""看板文档（v2.1）的数据契约.

一个看板 = 页面元素 + 页面参数 + 视图：
    document
      ├─ header   页面头（标题/副标题/统计）
      ├─ views[]  视图（榜单端 / 汇总 / 人气 …）
      └─ items[]  页面元素：
                    chart   数据组件实例（自带 spec；component 只记基础类型，便于追溯）
                    filter  筛选栏实例（产出页面参数）
                    heading 标题元素（编号 + 标题 + 说明）
                    text    文字元素
                    divider 分割线

原则：
    * 组件库只有「类型」（一类一个），差异全部进实例的 spec —— 不在库里复制同类组件
    * 标题 / 文字 / 分割线是页面元素，不进组件库
    * 动作（弹窗/抽屉）自带目标 spec，不依赖库里的某张业务卡
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

KEY_RE = set("abcdefghijklmnopqrstuvwxyz0123456789_-")

ELEMENT_TYPES = ("chart", "filter", "heading", "text", "divider")


def _check_key(v: str) -> str:
    text = (v or "").strip().lower()
    if not text or not set(text) <= KEY_RE:
        raise ValueError(f"元素 key 不合法：{v}")
    return text


class ActionDef(BaseModel):
    """点击动作：打开一个浮层，浮层内容是「一份组件配置」（实例自带，不依赖组件库）."""

    type: Literal["modal", "drawer"] = "modal"
    component: str = ""                # 基础类型 code（可选，便于追溯）
    spec: dict[str, Any] | None = None  # 目标组件配置（优先使用）
    title: str = ""
    params: dict[str, str] = {}         # action 参数：字面量或 "$row.字段"
    overrides: dict[str, Any] = {}      # 覆盖目标 spec（top_n / limit / sort / title）

    @field_validator("component")
    @classmethod
    def _component(cls, v: str) -> str:
        text = (v or "").strip()
        if text and not set(text) <= set("abcdefghijklmnopqrstuvwxyz0123456789._-"):
            raise ValueError(f"动作目标组件 code 不合法：{v}")
        return text


class ItemDef(BaseModel):
    """页面上的一个元素."""

    key: str
    type: Literal["chart", "filter", "heading", "text", "divider", "board"] = "chart"
    component: str = ""                 # 基础类型 code（chart/filter 用）
    spec: dict[str, Any] | None = None  # chart/filter 的完整配置（实例自带）
    title: str = ""
    span: int = 4                       # 流式布局：占 12 列中的几列（既有无位置时的兜底）
    h: int = 260                        # 元素高度 px
    layout: dict[str, Any] | None = None  # 自由画布位置 {x,y,w,h}
    action: ActionDef | None = None        # 主按钮：查看全部 / 查看 TOP10
    row_action: ActionDef | None = None    # 行点击：打开详情抽屉

    # 文本类元素
    text: str = ""
    note: str = ""
    index: str = ""
    icon: str = ""
    size: int = 13
    weight: int = 400
    align: Literal["left", "center", "right"] = "left"

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        return _check_key(v)

    @field_validator("component")
    @classmethod
    def _component(cls, v: str) -> str:
        text = (v or "").strip()
        if text and not set(text) <= set("abcdefghijklmnopqrstuvwxyz0123456789._-"):
            raise ValueError(f"元素 component code 不合法：{v}")
        return text

    @field_validator("span")
    @classmethod
    def _span(cls, v: int) -> int:
        return max(1, min(int(v or 4), 12))

    @field_validator("h")
    @classmethod
    def _h(cls, v: int) -> int:
        return max(30, min(int(v or 260), 900))

    @field_validator("size")
    @classmethod
    def _size(cls, v: int) -> int:
        return max(10, min(int(v or 13), 40))

    @field_validator("weight")
    @classmethod
    def _weight(cls, v: int) -> int:
        return v if v in (400, 500, 600, 700, 800) else 400

    @field_validator("text", "note", "index", "icon")
    @classmethod
    def _text_limit(cls, v: str) -> str:
        return (v or "")[:600]

    @model_validator(mode="after")
    def _need_spec(self):
        if self.type in ("chart", "filter") and not (self.spec or self.component):
            raise ValueError("数据组件元素必须带 spec（实例配置）或 component（基础类型）")
        return self


class GuideDef(BaseModel):
    """参考线（编辑辅助，不影响渲染）."""

    id: str = ""
    axis: Literal["x", "y"]
    pos: float


class CanvasSize(BaseModel):
    width: int = Field(ge=160, le=9007199254740991, strict=True)
    height: int = Field(ge=160, le=9007199254740991, strict=True)


class ViewDef(BaseModel):
    key: str
    title: str = ""
    # items 放「共用内容」（筛选栏）；按平台分开的卡片放 items_map
    items: list[ItemDef] = []
    guides: list[GuideDef] = []
    canvas: CanvasSize | None = None
    # 平台 → 该平台自己那一套卡片（头标卡 / 指标卡 / 图表 / 明细…）。
    # 未配置（没有这个 key）= 单套版面，与旧行为完全一致。
    items_map: dict[str, list[ItemDef]] = {}

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        return _check_key(v)


class DashboardDoc(BaseModel):
    version: float = 2.1
    mode: Literal["flow"] = "flow"
    published: bool = False
    published_at: str = ""
    header: dict[str, Any] = {}
    params: list[dict] = []             # 显式参数（一般由筛选栏元素产出，这里只做覆盖/默认值）
    views: list[ViewDef] = []

    @field_validator("views")
    @classmethod
    def _views(cls, v: list[ViewDef]) -> list[ViewDef]:
        keys = [view.key for view in v]
        if len(keys) != len(set(keys)):
            raise ValueError("视图 key 重复")
        return v

    def all_items(self):
        for view in self.views:
            for item in view.items:
                yield view, item
            for items in (view.items_map or {}).values():
                for item in items:
                    yield view, item


def _is_filter_item(item: ItemDef) -> bool:
    """筛选栏判定：type 之外还认 component（历史文档里 type 存成 chart 的筛选栏）."""
    return item.type == "filter" or "filter" in (item.component or "").lower()


def _shared_filter_items(view: "ViewDef") -> list[ItemDef]:
    """页面级共用元素 —— **只有筛选栏**（其余元素都归当前平台那套）。

    标题 / 文字 / 形状 / 卡片都是「这一平台的这一页」的内容：在拼多多页删掉天猫的标题，
    天猫那边不能跟着消失（2026-11-12 用户实测，所以页面级只留筛选栏）。
    不做「从 items_map 捞回」：那会让用户删掉的筛选栏被渲染端补回来（删除必须生效）。
    """
    return [item for item in view.items if _is_filter_item(item)]


def view_items_for(view: "ViewDef", platform: str = "") -> list[ItemDef]:
    """这一页在「当前平台」下要渲染的元素：筛选栏共用 + 该平台自己那套卡片.

    * 筛选栏永远共用，且不会从平台那套里重复出现；
    * 页面没配 items_map（旧看板）→ 原样返回 items，行为不变；
    * 配了但当前平台还没内容 → 仍然只显示共用部分（筛选栏），卡片为空。
    """
    mapping = view.items_map or {}
    if not mapping:
        return list(view.items)
    shared = _shared_filter_items(view)
    # 旧结构过渡：页面级还挂着标题/形状/卡片时先照常渲染（保存时 heal 会迁进各平台那套），
    # 不能让用户「还没保存就先少一截内容」。
    shared = shared + [item for item in view.items
                       if not _is_filter_item(item) and item.key not in {i.key for i in shared}]
    seen = {item.key for item in shared}

    def platform_items(items: list[ItemDef]) -> list[ItemDef]:
        return [item for item in items
                if not _is_filter_item(item) and item.key not in seen]

    if not platform:
        # 还没选平台：先拿第一套顶着，避免整页只剩一条筛选栏
        first = next((items for items in mapping.values() if items), [])
        return shared + platform_items(first)
    per_platform = mapping.get(platform)
    if per_platform is None:
        # 该平台还没有自己的一套：只给共用筛选栏
        return shared
    return shared + platform_items(per_platform)


#: 页面装饰类元素（标题 / 文字 / 形状）—— 用来判断某个平台那套是不是「已经有自己的标题」
_DECOR_TYPES = ("heading", "text", "divider")


def heal_view_filters(view: "ViewDef") -> "ViewDef":
    """保存期的结构自愈（**编辑过程中不跑**）。

    分平台（有 `items_map`）时：
    1. 页面级 `items` 只留筛选栏；里面残留的其它元素（标题 / 文字 / 形状 / 卡片）是旧结构
       （当时把它们当成整页共用），趁着这次保存**复制进每个还没有这些元素的平台那套**，
       保证切到别的平台不会突然少一截内容；
    2. 平台那套里若混进了筛选栏，统一收回页面级一份（筛选栏是这页唯一的共用元素）；
    3. 平台那套里自己已经有标题/形状的，不再掺旧结构的元素（避免出现两份标题）。

    没有分平台结构（没配 `items_map`）的看板：原样返回，行为不变。
    """
    mapping = {key: list(items) for key, items in (view.items_map or {}).items()}
    if not mapping:
        return view

    shared = [item for item in view.items if _is_filter_item(item)]
    legacy = [item for item in view.items if not _is_filter_item(item)]

    # 旧结构里挂在页面级的非筛选元素：搬到每个还没有它们的平台套里（同 key，各自独立一份）
    if legacy:
        for items in mapping.values():
            keys = {item.key for item in items}
            has_decor = any(item.type in _DECOR_TYPES for item in items)
            for item in legacy:
                if item.key in keys:
                    continue
                if item.type in _DECOR_TYPES and has_decor:
                    continue
                items.append(item)
                keys.add(item.key)

    has_filter = bool(shared)
    cleaned: dict[str, list[ItemDef]] = {}
    for key, items in mapping.items():
        uniq: list[ItemDef] = []
        seen: set[str] = set()
        for item in items:
            if _is_filter_item(item):
                if not has_filter:
                    shared.append(item)
                    has_filter = True
                continue
            if item.key in seen:
                continue
            seen.add(item.key)
            uniq.append(item)
        cleaned[key] = uniq

    return view.model_copy(update={"items": shared, "items_map": cleaned})


def _heal_board_ids(views: list[ViewDef]) -> list[ViewDef]:
    """画板必须有唯一 id（明细表按它引用弹窗区域）：缺的补一个，重复的改成唯一."""
    out: list[ViewDef] = []
    seen: set[str] = set()

    def fix(items: list[ItemDef] | None) -> list[ItemDef]:
        result: list[ItemDef] = []
        for item in items or []:
            if item.type == "board":
                key = (item.key or "").strip()
                if not key or key in seen:
                    n = 1
                    while f"bd_{n:03d}" in seen:
                        n += 1
                    key = f"bd_{n:03d}"
                seen.add(key)
                if key != item.key:
                    item = item.model_copy(update={"key": key})
            result.append(item)
        return result

    for view in views:
        items = fix(view.items)
        items_map = view.items_map
        if items_map:
            items_map = {platform: fix(list_) for platform, list_ in items_map.items()}
        out.append(view.model_copy(update={"items": items, "items_map": items_map}))
    return out


def validate_doc(raw: Any, *, heal: bool = False) -> DashboardDoc:
    """校验文档；`heal=True` 时做保存期结构自愈（调用方只在保存/发布时传）."""
    doc = DashboardDoc(**(raw or {}))
    if not heal:
        return doc
    doc = doc.model_copy(update={"views": _heal_board_ids(doc.views)})
    return doc.model_copy(update={"views": [heal_view_filters(v) for v in doc.views]})


__all__ = ["ActionDef", "ItemDef", "ViewDef", "DashboardDoc", "ELEMENT_TYPES",
           "validate_doc", "view_items_for", "heal_view_filters"]
