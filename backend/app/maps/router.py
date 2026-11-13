"""地图 GeoJSON —— 前端地图组件按需加载，不进 JS bundle.

约定：
    * 只提供省级边界（`china.json`，坐标保留 3 位小数，gzip 后约 117KB）；
    * 需要登录才能取（与看板接口一致）；
    * 客户端缓存一天（ETag 用文件 mtime + size，重装/升级后自动失效）。
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse

from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/bi/maps", tags=["BI地图"])

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "china.json")


@router.get("/china")
def china_map(request: Request, current_user: User = Depends(get_current_user)):
    if not os.path.exists(_FILE):
        raise HTTPException(404, "地图数据缺失")
    stat = os.stat(_FILE)
    etag = f'W/"china-{int(stat.st_mtime)}-{stat.st_size}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    response = FileResponse(_FILE, media_type="application/json")
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "private, max-age=86400"
    return response


__all__ = ["router"]
