"""AI 模型配置 —— 默认模型解析 + 连接测试.

取值顺序（谁在前面谁生效）：
    1. 数据库 `bi_ai_model`：`is_default` + `enabled` 的那一条（管理后台维护）；
    2. `backend/data/ai_models.json`：老部署留下的文件配置；
    3. 环境变量 `LLM_API_BASE / LLM_API_KEY / LLM_MODEL`。

任何一步出错都只是「跳过这一层」，绝不让 AI 链路因为配置读取失败而报错。
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from app.config import settings
from app.services.crypto import decrypt

_JSON_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "ai_models.json"


def normalize_base_url(value: str) -> str:
    """把 Base URL 收敛成 `http(s)://host[/path]`（去尾斜杠）；非法协议返回空串."""
    url = (value or "").strip().rstrip("/")
    if not url or not url.lower().startswith(("http://", "https://")):
        return ""
    return url


def chat_url(base_url: str) -> str:
    """补全成 chat/completions 端点（用户填到 /v1 或直接填到端点都行）."""
    base = normalize_base_url(base_url)
    if not base:
        return ""
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def decrypt_key(encrypted: str) -> str:
    """解出明文 Key；密文损坏按「没有配置」处理（避免把占位串当 Key 发出去）."""
    if not encrypted:
        return ""
    value = decrypt(encrypted)
    if value.startswith("(") and value.endswith(")"):
        return ""
    return value


def mask_key(key: str) -> str:
    """API Key 掩码：只露前 4 / 后 4，接口与界面都不返回明文."""
    raw = (key or "").strip()
    if not raw:
        return ""
    if len(raw) <= 8:
        return "****"
    return f"{raw[:4]}****{raw[-4:]}"


def _config(
    base_url: str,
    model: str,
    api_key: str,
    temperature: float = 0.3,
    max_tokens: int = 4096,
    provider: str = "",
    name: str = "",
    model_id: int | None = None,
) -> dict | None:
    base = normalize_base_url(base_url)
    model = (model or "").strip()
    key = (api_key or "").strip()
    if not base or not model or not key:
        return None
    return {
        "id": model_id,
        "name": name,
        "provider": provider,
        "base_url": base,
        "chat_url": chat_url(base),
        "model": model,
        "api_key": key,
        "temperature": max(0.0, min(2.0, float(temperature or 0.3))),
        "max_tokens": max(64, min(32768, int(max_tokens or 4096))),
    }


def from_db() -> dict | None:
    """库里默认模型；表还没迁移 / 查询失败都返回 None."""
    try:
        from sqlalchemy import text

        from app.database import SessionLocal

        db = SessionLocal()
        try:
            row = db.execute(
                text(
                    "SELECT id, name, provider, base_url, model, api_key_enc, temperature, max_tokens "
                    "FROM bi_ai_model WHERE enabled AND is_default ORDER BY id LIMIT 1"
                )
            ).fetchone()
        finally:
            db.close()
    except Exception:
        return None
    if row is None:
        return None
    m = row._mapping
    return _config(
        m["base_url"], m["model"], decrypt(m["api_key_enc"] or ""),
        float(m["temperature"] or 0.3), int(m["max_tokens"] or 4096),
        m["provider"] or "", m["name"] or "", int(m["id"]),
    )


def _from_db_all() -> list[dict]:
    """库里所有启用模型，默认模型排第一（连不上时按这个顺序回退）."""
    try:
        from sqlalchemy import text

        from app.database import SessionLocal

        db = SessionLocal()
        try:
            rows = db.execute(
                text(
                    "SELECT id, name, provider, base_url, model, api_key_enc, temperature, max_tokens "
                    "FROM bi_ai_model WHERE enabled ORDER BY is_default DESC, id"
                )
            ).fetchall()
        finally:
            db.close()
    except Exception:
        return []
    configs: list[dict] = []
    for row in rows:
        m = row._mapping
        cfg = _config(
            m["base_url"], m["model"], decrypt(m["api_key_enc"] or ""),
            float(m["temperature"] or 0.3), int(m["max_tokens"] or 4096),
            m["provider"] or "", m["name"] or "", int(m["id"]),
        )
        if cfg:
            configs.append(cfg)
    return configs


def _from_json_all() -> list[dict]:
    if not _JSON_FILE.exists():
        return []
    try:
        models = json.loads(_JSON_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(models, list):
        return []
    ordered = [m for m in models if isinstance(m, dict) and m.get("isDefault")]
    ordered += [m for m in models if isinstance(m, dict) and not m.get("isDefault")]
    configs: list[dict] = []
    for m in ordered:
        if not m.get("enabled") or not m.get("apiKey"):
            continue
        cfg = _config(m.get("baseURL", ""), m.get("model", ""), m.get("apiKey", ""),
                      float(m.get("temperature") or 0.3), 4096, "json", m.get("name", ""))
        if cfg:
            configs.append(cfg)
    return configs


def from_json_file() -> dict | None:
    return (_from_json_all() or [None])[0]


def from_env() -> dict | None:
    return _config(settings.llm_api_base, settings.llm_model, settings.llm_api_key)


def candidate_configs() -> list[dict]:
    """按优先级列出可尝试的模型：库默认 → 库其它启用 → 文件 → 环境变量（同一个模型只留一次）.

    调用方逐个真实请求，前一个连不上（超时 / HTTP 错误 / 空回复）就换下一个。
    """
    candidates: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    env_cfg = from_env()
    for cfg in [*_from_db_all(), *_from_json_all(), *([env_cfg] if env_cfg else [])]:
        key = (cfg["chat_url"], cfg["model"], cfg["api_key"])
        if key in seen:
            continue
        seen.add(key)
        candidates.append(cfg)
    return candidates


def default_config() -> dict | None:
    """当前首选的模型（管理后台的「默认」；没有默认时取第一个启用的）."""
    return (candidate_configs() or [None])[0]


def legacy_chat_config() -> dict | None:
    """给老调用点（`_load_default_llm` 风格，键名 baseURL / apiKey）用的一份配置."""
    cfg = default_config()
    if not cfg:
        return None
    return {
        "baseURL": cfg["base_url"],
        "chat_url": cfg["chat_url"],
        "apiKey": cfg["api_key"],
        "model": cfg["model"],
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
    }


def test_connection(base_url: str, model: str, api_key: str, timeout: int = 15) -> dict:
    """真实发一次最小请求验证连通性；返回 {ok, latency_ms, message}."""
    import requests

    url = chat_url(base_url)
    if not url:
        return {"ok": False, "latency_ms": 0, "message": "Base URL 需要以 http:// 或 https:// 开头"}
    if not (model or "").strip():
        return {"ok": False, "latency_ms": 0, "message": "模型名不能为空"}
    if not (api_key or "").strip():
        return {"ok": False, "latency_ms": 0, "message": "API Key 不能为空"}

    started = time.monotonic()
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"},
            json={
                "model": model.strip(),
                "messages": [{"role": "user", "content": "ping，请只回复 ok"}],
                # 留够 token：推理类模型的思维链也会占额度，8 个 token 常常只剩空 content
                "max_tokens": 64,
                "temperature": 0,
            },
            timeout=timeout,
        )
    except Exception as exc:  # 超时 / DNS / 拒绝连接
        elapsed = int((time.monotonic() - started) * 1000)
        return {"ok": False, "latency_ms": elapsed, "message": f"请求失败：{str(exc)[:240]}"}

    elapsed = int((time.monotonic() - started) * 1000)
    if resp.status_code != 200:
        return {
            "ok": False,
            "latency_ms": elapsed,
            "message": f"HTTP {resp.status_code}：{(resp.text or '')[:240]}",
        }

    body = (resp.text or "")[:240]
    try:
        data = resp.json()
    except Exception:
        data = None
    if not isinstance(data, dict):
        return {"ok": False, "latency_ms": elapsed,
                "message": f"接口返回 200，但不是 JSON：{body}"}
    # 有的网关把错误包在 200 里（如模型名不存在），先把真实原因透出来
    if data.get("error"):
        detail = data["error"]
        if isinstance(detail, dict):
            detail = detail.get("message") or json.dumps(detail, ensure_ascii=False)
        return {"ok": False, "latency_ms": elapsed,
                "message": f"接口返回 200，但返回了错误：{str(detail)[:240]}"}

    choices = data.get("choices") or []
    if not choices:
        return {"ok": False, "latency_ms": elapsed,
                "message": f"接口返回 200，但响应里没有 choices：{body}"}
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") or {}
    # 推理模型的正文可能为空（全在 reasoning_content），只要能取到任一种回复就算连通
    content = str(message.get("content") or "").strip()
    thinking = str(message.get("reasoning_content") or "").strip()
    legacy = str(choice.get("text") or "").strip()
    if not (content or thinking or legacy):
        return {"ok": False, "latency_ms": elapsed,
                "message": f"接口返回 200，但回复为空（模型名或参数可能不对）：{body}"}
    return {"ok": True, "latency_ms": elapsed, "message": f"连接正常（{elapsed}ms）"}


__all__ = [
    "normalize_base_url",
    "chat_url",
    "candidate_configs",
    "decrypt_key",
    "mask_key",
    "from_db",
    "from_json_file",
    "from_env",
    "default_config",
    "legacy_chat_config",
    "test_connection",
]
