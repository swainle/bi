"""组件库 —— 可配置、可复用的看板组件资产.

一个组件 = 图表类型(kind) + 数据绑定(binding) + 计算规则(compute) + 界面样式(ui)。
配置存在 bi_component.spec(jsonb)，渲染时经语义层 + 查询引擎取数。

对外 API：
    repository.*     CRUD
    spec.*           规格定义与校验
    compute.*        计算规则（纯函数，可单测）
    resolver.resolve 组件 → 渲染 payload
    seed.ensure_all  内置组件幂等种子
"""

from app.components.repository import (
    Component,
    create_component,
    delete_component,
    get_component,
    list_components,
    update_component,
    upsert_builtin,
)
from app.components.spec import ComponentSpec, ComponentSpecError, validate_kind, validate_spec

__all__ = [
    "Component",
    "ComponentSpec",
    "ComponentSpecError",
    "validate_kind",
    "validate_spec",
    "list_components",
    "get_component",
    "create_component",
    "update_component",
    "delete_component",
    "upsert_builtin",
]
