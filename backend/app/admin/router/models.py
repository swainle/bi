"""管理后台 · AI 模型配置（/models）。"""

from __future__ import annotations

from app.timezone import time_text, utc_now

from datetime import datetime
from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.admin.permissions import require
from app.database import get_db
from app.middleware.audit import log_audit
from app.models.user import User
from app.services import ai_models

from fastapi import APIRouter

router = APIRouter()

from .common import ModelBody, ModelPatchBody, ModelTestBody, _assert_model_config, _model_rows

@router.get("/models")
def list_models(
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    active = ai_models.default_config()
    return {
        "items": _model_rows(db),
        "active": {
            "model": active["model"] if active else "",
            "base_url": active["base_url"] if active else "",
            "source": "database" if ai_models.from_db() else ("file" if ai_models.from_json_file() else ("env" if ai_models.from_env() else "")),
        },
        # 供应商预设：温度 / 最大输出 / 上下文按各家官方默认值给，用户可再改
        "providers": [
            {"code": "deepseek", "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1",
             "model": "deepseek-chat", "temperature": 1.0, "max_tokens": 8192, "context_window": 131072},
            {"code": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1",
             "model": "gpt-4o-mini", "temperature": 1.0, "max_tokens": 16384, "context_window": 128000},
            {"code": "qwen", "name": "通义千问", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
             "model": "qwen-plus", "temperature": 0.7, "max_tokens": 32768, "context_window": 131072},
            {"code": "moonshot", "name": "Moonshot", "base_url": "https://api.moonshot.cn/v1",
             "model": "moonshot-v1-8k", "temperature": 1.0, "max_tokens": 4096, "context_window": 8192},
            {"code": "custom", "name": "自定义", "base_url": "", "model": "",
             "temperature": None, "max_tokens": None, "context_window": None},
        ],
    }


@router.post("/models")
def create_model(
    payload: ModelBody,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    base = _assert_model_config(payload.base_url, payload.model, payload.api_key)
    from app.services.crypto import encrypt

    if payload.is_default:
        db.execute(text("UPDATE bi_ai_model SET is_default = false WHERE is_default"))
    row = db.execute(
        text(
            "INSERT INTO bi_ai_model (name, provider, base_url, model, api_key_enc, temperature, "
            "max_tokens, enabled, is_default) VALUES (:name, :provider, :base_url, :model, :key, "
            ":temp, :max_tokens, :enabled, :is_default) RETURNING id"
        ),
        {
            "name": payload.name.strip(),
            "provider": (payload.provider or "custom").strip(),
            "base_url": base,
            "model": payload.model.strip(),
            "key": encrypt(payload.api_key.strip()),
            "temp": max(0.0, min(2.0, payload.temperature)),
            "max_tokens": max(64, min(32768, payload.max_tokens)),
            "enabled": payload.enabled,
            "is_default": payload.is_default,
        },
    ).fetchone()
    db.commit()
    log_audit(current_user.id, "admin.model.create", "ai_model", int(row[0]), {"model": payload.model, "base_url": base})
    return {"id": int(row[0]), "message": "模型已保存"}


@router.patch("/models/{model_id}")
def update_model(
    model_id: int,
    payload: ModelPatchBody,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    row = db.execute(text("SELECT * FROM bi_ai_model WHERE id = :id"), {"id": model_id}).fetchone()
    if row is None:
        raise HTTPException(404, "模型不存在")
    current = row._mapping
    data = payload.model_dump(exclude_unset=True)

    sets: list[str] = []
    params: dict = {"id": model_id, "updated_at": utc_now()}
    if "name" in data and data["name"]:
        sets.append("name = :name")
        params["name"] = data["name"].strip()
    if "provider" in data and data["provider"] is not None:
        sets.append("provider = :provider")
        params["provider"] = data["provider"].strip() or "custom"
    if "base_url" in data and data["base_url"] is not None:
        base = _assert_model_config(data["base_url"], data.get("model") or current["model"], "x", require_key=False)
        sets.append("base_url = :base_url")
        params["base_url"] = base
    if "model" in data and data["model"]:
        sets.append("model = :model")
        params["model"] = data["model"].strip()
    if data.get("api_key"):
        from app.services.crypto import encrypt

        sets.append("api_key_enc = :key")
        params["key"] = encrypt(data["api_key"].strip())
    if "temperature" in data and data["temperature"] is not None:
        sets.append("temperature = :temp")
        params["temp"] = max(0.0, min(2.0, float(data["temperature"])))
    if "max_tokens" in data and data["max_tokens"] is not None:
        sets.append("max_tokens = :max_tokens")
        params["max_tokens"] = max(64, min(32768, int(data["max_tokens"])))
    if "enabled" in data and data["enabled"] is not None:
        sets.append("enabled = :enabled")
        params["enabled"] = bool(data["enabled"])
    if data.get("is_default"):
        db.execute(text("UPDATE bi_ai_model SET is_default = false WHERE is_default AND id <> :id"), {"id": model_id})
        sets.append("is_default = true")

    if not sets:
        return {"message": "没有需要保存的修改"}

    sets.append("updated_at = :updated_at")
    db.execute(text(f"UPDATE bi_ai_model SET {', '.join(sets)} WHERE id = :id"), params)
    db.commit()
    log_audit(current_user.id, "admin.model.update", "ai_model", model_id, {k: ("***" if k == "api_key" else v) for k, v in data.items()})
    return {"message": "已保存"}


@router.delete("/models/{model_id}")
def delete_model(
    model_id: int,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    row = db.execute(text("SELECT name, model FROM bi_ai_model WHERE id = :id"), {"id": model_id}).fetchone()
    if row is None:
        raise HTTPException(404, "模型不存在")
    db.execute(text("DELETE FROM bi_ai_model WHERE id = :id"), {"id": model_id})
    db.commit()
    log_audit(current_user.id, "admin.model.delete", "ai_model", model_id, {"name": row[0], "model": row[1]})
    return {"message": "模型已删除"}


@router.post("/models/test")
def test_model(
    payload: ModelTestBody,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    """真实发一次最小请求；带 model_id 时把结果写回该行（卡片上能看到上次测试）."""
    saved = None
    if payload.model_id:
        row = db.execute(text("SELECT * FROM bi_ai_model WHERE id = :id"), {"id": payload.model_id}).fetchone()
        if row is None:
            raise HTTPException(404, "模型不存在")
        saved = row._mapping

    base_url = (payload.base_url or (saved["base_url"] if saved else "") or "").strip()
    model = (payload.model or (saved["model"] if saved else "") or "").strip()
    api_key = (payload.api_key or "").strip()
    if not api_key and saved is not None:
        api_key = ai_models.decrypt_key(saved["api_key_enc"] or "")

    result = ai_models.test_connection(base_url, model, api_key)
    if saved is not None:
        db.execute(
            text(
                "UPDATE bi_ai_model SET last_test_at = now(), last_test_ok = :ok, "
                "last_test_ms = :ms, last_test_error = :err WHERE id = :id"
            ),
            {
                "ok": result["ok"],
                "ms": result["latency_ms"],
                "err": "" if result["ok"] else str(result["message"])[:500],
                "id": payload.model_id,
            },
        )
        db.commit()
    return result
