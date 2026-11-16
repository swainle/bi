"""MCP 入参强校验（R7）—— 按工具 inputSchema 校验，失败不进入业务层.

只实现本仓库工具 schema 用到的子集：
    type / properties / required / additionalProperties / items /
    minimum / maximum / minLength / maxLength / enum
不引入额外依赖；遇到不认识的约束只忽略，不误杀。
"""

from __future__ import annotations

from typing import Any


class SchemaError(ValueError):
    """参数不符合 schema."""


_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
}


def _type_ok(value: Any, expected: str) -> bool:
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    target = _TYPES.get(expected)
    return isinstance(value, target) if target else True


def validate(value: Any, schema: dict, path: str = "arguments") -> None:
    if not isinstance(schema, dict):
        return
    expected = schema.get("type")
    if expected and not _type_ok(value, str(expected)):
        raise SchemaError(f"{path} 应为 {expected}")

    if "enum" in schema and value not in (schema.get("enum") or []):
        raise SchemaError(f"{path} 取值不在允许范围")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < int(schema["minLength"]):
            raise SchemaError(f"{path} 长度不能小于 {schema['minLength']}")
        if "maxLength" in schema and len(value) > int(schema["maxLength"]):
            raise SchemaError(f"{path} 长度不能大于 {schema['maxLength']}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise SchemaError(f"{path} 不能小于 {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            raise SchemaError(f"{path} 不能大于 {schema['maximum']}")

    if isinstance(value, dict):
        props = schema.get("properties") or {}
        for key in schema.get("required") or []:
            if key not in value:
                raise SchemaError(f"缺少必填参数：{key}")
        if schema.get("additionalProperties") is False:
            extra = [key for key in value if key not in props]
            if extra:
                raise SchemaError(f"不支持的参数：{', '.join(extra[:3])}")
        for key, item in value.items():
            if key in props and isinstance(props[key], dict):
                validate(item, props[key], f"{path}.{key}")

    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            validate(item, schema["items"], f"{path}[{index}]")


__all__ = ["SchemaError", "validate"]
