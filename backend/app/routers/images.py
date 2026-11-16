"""素材图接口 —— 缩略图按「ID」找图.

查找顺序（每个图片根目录都试一遍）：
    1. {root}/{ID}.png|jpg…                   单文件
    2. {root}/{ID}/                           同名文件夹，取自然排序第一张
    3. {root}/{product_id}/主图/              商品目录下的「主图」
    4. {root}/拼多多_商品ID_{product_id}/主图/ 素材包那种层级
    5. {root}/{product_id}/{ID}/              再退一层

ID 形如 608759849830_main / 608759849830_detail，product_id 取前面的数字部分。

图片根目录默认 {upload_dir}/images；需要额外目录时用环境变量：
    MINGZEBI_IMAGE_DIRS=/路径/素材A:/路径/素材B
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import settings

router = APIRouter(prefix="/bi/images", tags=["BI素材图"])

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
SAFE_NAME = re.compile(r"^[-\w\u4e00-\u9fa5]{1,120}$")
_NAME_SPLIT = re.compile(r"(\d+)")
_PRODUCT_ID = re.compile(r"^(\d{6,})")


def _natural_key(path: Path):
    """"主图1" < "主图02" < "主图10"：数字段按数值比."""
    parts = []
    for token in _NAME_SPLIT.split(path.name):
        if not token:
            continue
        parts.append((0, int(token)) if token.isdigit() else (1, token.lower()))
    return parts


def _roots() -> list[Path]:
    dirs = [str(Path(settings.upload_dir) / "images")]
    extra = os.getenv("MINGZEBI_IMAGE_DIRS", "").strip()
    if extra:
        dirs.extend(part for part in re.split(r"[;:]", extra) if part.strip())
    out: list[Path] = []
    for item in dirs:
        path = Path(item).expanduser()
        if path not in out:
            out.append(path)
    return out


def _first_image(folder: Path) -> Path | None:
    if not folder.is_dir():
        return None
    files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    if not files:
        return None
    files.sort(key=_natural_key)
    return files[0]


def _candidates(root: Path, name: str):
    product_id = _PRODUCT_ID.match(name)
    pid = product_id.group(1) if product_id else name
    yield root / name                          # 单文件（带扩展名）
    yield root / name                          # 同名目录
    yield root / pid / "主图"
    yield root / f"拼多多_商品ID_{pid}" / "主图"
    yield root / f"拼多多_商品ID_{pid}" / name
    yield root / pid / name
    yield root / pid
    yield root / f"{pid}_main"


@router.get("/{name}")
def first_image(name: str):
    """返回该 ID 对应文件夹里序号最小的那张图；没有就 404（前端显示占位框）."""
    target = name.strip()
    if not SAFE_NAME.match(target):
        raise HTTPException(400, "图片名不合法")

    has_ext = Path(target).suffix.lower() in IMAGE_EXTS

    for root in _roots():
        for candidate in _candidates(root, target):
            if has_ext and candidate.is_file():
                return FileResponse(candidate, headers={"Cache-Control": "public, max-age=600"})
            found = _first_image(candidate)
            if found:
                return FileResponse(found, headers={"Cache-Control": "public, max-age=600"})
        if not has_ext:
            for ext in IMAGE_EXTS:
                single = root / f"{target}{ext}"
                if single.is_file():
                    return FileResponse(single, headers={"Cache-Control": "public, max-age=600"})

    raise HTTPException(404, "图片不存在")


__all__ = ["router"]
