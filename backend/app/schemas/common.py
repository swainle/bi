"""通用 API 响应模型."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """统一 API 成功响应.

    Attributes:
        code: 状态码，0 表示成功.
        data: 响应数据.
        message: 可选消息.
    """

    code: int = 0
    data: T
    message: str | None = None


class PaginatedData(BaseModel, Generic[T]):
    """分页数据容器.

    Attributes:
        items: 数据列表.
        total: 总记录数.
        page: 当前页码.
        limit: 每页数量.
    """

    items: list[T]
    total: int
    page: int
    limit: int
