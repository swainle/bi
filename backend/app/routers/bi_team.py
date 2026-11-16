"""明策BI团队共享 — 后端 API（用户独立子目录存储）."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/bi/team", tags=["BI团队共享"])

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "bi_team")

def _user_dir(username: str) -> str:
    """用户专有子目录：中文→拼音，英文→小写."""
    if all(ord(c) < 128 for c in username):
        safe = username.lower().strip()
    else:
        try:
            from pypinyin import lazy_pinyin
            safe = "".join(lazy_pinyin(username)).lower().strip()
        except ImportError:
            safe = re.sub(r"[^a-zA-Z0-9]", "_", username).lower()
    d = os.path.join(DATA_DIR, safe)
    os.makedirs(d, exist_ok=True)
    return d

def _get_store(username: str) -> dict:
    path = os.path.join(_user_dir(username), "dashboards.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"dashboards": {}}

def _save_store(username: str, store: dict):
    with open(os.path.join(_user_dir(username), "dashboards.json"), "w") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)

# ====== Models ======

class BiDashboardData(BaseModel):
    name: str = "未命名看板"
    data: list = []
    panels: list = []

class BiDashboardCreate(BaseModel):
    name: str
    data: list = []
    panels: list = []

class BiDashboardUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[list] = None
    panels: Optional[list] = None
    shared: Optional[bool] = None
    allowed_users: Optional[list[int]] = None

class BiDashboardResponse(BaseModel):
    id: str
    name: str
    owner: str
    owner_id: int
    shared: bool
    allowed_users: list[int]
    data: list
    panels: list
    created_at: int
    updated_at: int

class UserBrief(BaseModel):
    id: int
    username: str

# ====== Helpers ======

def _to_response(d: dict) -> BiDashboardResponse:
    return BiDashboardResponse(
        id=d["id"], name=d["name"], owner=d.get("owner", ""),
        owner_id=d.get("owner_id", 0), shared=d.get("shared", False),
        allowed_users=d.get("allowed_users", []),
        data=d.get("data", []), panels=d.get("panels", []),
        created_at=d.get("created_at", 0), updated_at=d.get("updated_at", 0),
    )

# ====== 用户列表 ======

@router.get("/users", response_model=list[UserBrief])
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role == "admin":
        users = db.query(User).filter(User.is_active == True).all()
        return [UserBrief(id=u.id, username=u.username) for u in users]
    return [UserBrief(id=current_user.id, username=current_user.username)]

# ====== 我的看板 ======

@router.get("/my", response_model=list[BiDashboardResponse])
def list_my_dashboards(current_user: User = Depends(get_current_user)):
    store = _get_store(current_user.username)
    result = [_to_response(d) for d in store["dashboards"].values()]
    return sorted(result, key=lambda x: x.updated_at, reverse=True)

# ====== 共享给我的看板 ======

@router.get("/shared-with-me", response_model=list[BiDashboardResponse])
def list_shared_with_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """获取所有用户共享给当前用户的看板."""
    result = []
    users = db.query(User).filter(User.is_active == True).all()
    for u in users:
        if u.username == current_user.username:
            continue
        store = _get_store(u.username)
        for d in store["dashboards"].values():
            if not d.get("shared"):
                continue
            allowed = d.get("allowed_users") or []
            # allowed 为空 → 全团队可见；否则仅指定用户可见
            if len(allowed) == 0 or current_user.id in allowed:
                result.append(_to_response(d))
    return sorted(result, key=lambda x: x.updated_at, reverse=True)

# ====== 创建看板 ======

@router.post("/", response_model=BiDashboardResponse)
def create_dashboard(body: BiDashboardCreate, current_user: User = Depends(get_current_user)):
    store = _get_store(current_user.username)
    did = "bd-" + str(int(time.time() * 1000))
    now = int(time.time())
    item = {
        "id": did, "name": body.name,
        "owner": current_user.username, "owner_id": current_user.id,
        "shared": False, "allowed_users": [],
        "data": body.data, "panels": body.panels,
        "created_at": now, "updated_at": now,
    }
    store["dashboards"][did] = item
    _save_store(current_user.username, store)
    return _to_response(item)

# ====== 更新看板 ======

@router.put("/{dashboard_id}", response_model=BiDashboardResponse)
def update_dashboard(dashboard_id: str, body: BiDashboardUpdate, current_user: User = Depends(get_current_user)):
    store = _get_store(current_user.username)
    d = store["dashboards"].get(dashboard_id)
    if not d:
        raise HTTPException(status_code=404, detail="看板不存在")
    if d["owner_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="仅看板所有者可编辑")

    if body.name is not None: d["name"] = body.name
    if body.data is not None: d["data"] = body.data
    if body.panels is not None: d["panels"] = body.panels
    if body.shared is not None: d["shared"] = body.shared
    if body.allowed_users is not None: d["allowed_users"] = body.allowed_users
    d["updated_at"] = int(time.time())

    store["dashboards"][dashboard_id] = d
    _save_store(current_user.username, store)
    return _to_response(d)

# ====== 删除看板 ======

@router.delete("/{dashboard_id}")
def delete_dashboard(dashboard_id: str, current_user: User = Depends(get_current_user)):
    store = _get_store(current_user.username)
    d = store["dashboards"].get(dashboard_id)
    if not d:
        raise HTTPException(status_code=404, detail="看板不存在")
    if d["owner_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="仅看板所有者可删除")
    del store["dashboards"][dashboard_id]
    _save_store(current_user.username, store)
    return {"ok": True}

# ====== 切换共享 ======

@router.post("/{dashboard_id}/share")
def toggle_share(dashboard_id: str, shared: bool = Query(True), current_user: User = Depends(get_current_user)):
    store = _get_store(current_user.username)
    d = store["dashboards"].get(dashboard_id)
    if not d:
        raise HTTPException(status_code=404, detail="看板不存在")
    if d["owner_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="仅看板所有者可操作")
    d["shared"] = shared
    d["updated_at"] = int(time.time())
    _save_store(current_user.username, store)
    return {"shared": shared, "ok": True}
