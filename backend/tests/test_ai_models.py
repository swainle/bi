"""模型「测试连接」的单元测试 —— 只打桩 requests，不发真实请求."""

from __future__ import annotations

import json

import requests

from app.services import ai_models


class _FakeResponse:
    def __init__(self, status: int = 200, payload=None, raw: str | None = None):
        self.status_code = status
        self._payload = payload
        self.text = raw if raw is not None else json.dumps(payload or {}, ensure_ascii=False)

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


def _stub(monkeypatch, response: _FakeResponse) -> dict:
    captured: dict = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs.get("json")
        return response

    monkeypatch.setattr(requests, "post", fake_post)
    return captured


def test_ok_with_content(monkeypatch):
    captured = _stub(monkeypatch, _FakeResponse(payload={
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
    }))
    result = ai_models.test_connection("https://api.deepseek.com/v1", "deepseek-chat", "sk-test")
    assert result["ok"] is True
    assert captured["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert captured["json"]["max_tokens"] == 64


def test_ok_when_only_reasoning_content(monkeypatch):
    """推理模型的正文可能为空，思维链有内容也算连通（此前会被误判为失败）."""
    _stub(monkeypatch, _FakeResponse(payload={
        "choices": [{"message": {"content": "", "reasoning_content": "思考中"}}],
    }))
    result = ai_models.test_connection("https://api.deepseek.com/v1", "deepseek-flash", "sk-test")
    assert result["ok"] is True


def test_error_payload_inside_200(monkeypatch):
    _stub(monkeypatch, _FakeResponse(payload={
        "error": {"message": "Model Not Exist", "type": "invalid_request_error"},
    }))
    result = ai_models.test_connection("https://api.deepseek.com/v1", "not-a-model", "sk-test")
    assert result["ok"] is False
    assert "Model Not Exist" in result["message"]


def test_200_without_choices_shows_body(monkeypatch):
    _stub(monkeypatch, _FakeResponse(payload={"data": []}, raw='{"data": []}'))
    result = ai_models.test_connection("https://api.deepseek.com/v1", "deepseek-chat", "sk-test")
    assert result["ok"] is False
    assert "没有 choices" in result["message"]
    assert '{"data": []}' in result["message"]


def test_empty_reply_is_reported_as_empty(monkeypatch):
    _stub(monkeypatch, _FakeResponse(payload={
        "choices": [{"message": {"content": ""}, "finish_reason": "length"}],
    }))
    result = ai_models.test_connection("https://api.deepseek.com/v1", "deepseek-chat", "sk-test")
    assert result["ok"] is False
    assert "回复为空" in result["message"]


def test_http_error_keeps_status_and_body(monkeypatch):
    _stub(monkeypatch, _FakeResponse(status=401, payload={"error": "unauthorized"}))
    result = ai_models.test_connection("https://api.deepseek.com/v1", "deepseek-chat", "bad-key")
    assert result["ok"] is False
    assert result["message"].startswith("HTTP 401")


# ── 调用顺序 / 回退 ──────────────────────────────────────────
def _cfg(model: str, *, name: str = "", model_id: int | None = None) -> dict:
    return {
        "id": model_id, "name": name or model, "provider": "test",
        "base_url": "http://127.0.0.1:9/v1", "chat_url": "http://127.0.0.1:9/v1/chat/completions",
        "model": model, "api_key": "sk-test", "temperature": 0.3, "max_tokens": 1024,
    }


def test_candidate_order_and_dedup(monkeypatch):
    """库默认 → 库其它启用 → 文件 → 环境变量；同一个模型只留一次."""
    monkeypatch.setattr(ai_models, "_from_db_all", lambda: [_cfg("default"), _cfg("backup")])
    monkeypatch.setattr(ai_models, "_from_json_all", lambda: [_cfg("json"), _cfg("default")])
    monkeypatch.setattr(ai_models, "from_env", lambda: _cfg("env"))
    assert [c["model"] for c in ai_models.candidate_configs()] == ["default", "backup", "json", "env"]


def test_llm_falls_back_when_default_unreachable(monkeypatch):
    from app.services import bi_ai_engine

    monkeypatch.setattr(ai_models, "candidate_configs",
                        lambda: [_cfg("default", name="主模型", model_id=1),
                                 _cfg("backup", name="备用", model_id=2)])
    calls: list[str] = []

    def fake_post(url, **kwargs):
        model = kwargs["json"]["model"]
        calls.append(model)
        if model == "default":
            raise requests.ConnectionError("connection refused")
        return _FakeResponse(payload={"choices": [{"message": {"content": "备用回复"}}]})

    monkeypatch.setattr(requests, "post", fake_post)
    assert bi_ai_engine._call_llm("hi") == "备用回复"
    assert calls == ["default", "backup"]


def test_llm_falls_back_when_default_returns_empty(monkeypatch):
    from app.services import bi_ai_engine

    monkeypatch.setattr(ai_models, "candidate_configs",
                        lambda: [_cfg("default", model_id=1), _cfg("backup", model_id=2)])
    calls: list[str] = []

    def fake_post(url, **kwargs):
        model = kwargs["json"]["model"]
        calls.append(model)
        content = "" if model == "default" else "ok"
        return _FakeResponse(payload={"choices": [{"message": {"content": content}}]})

    monkeypatch.setattr(requests, "post", fake_post)
    assert bi_ai_engine._call_llm("hi") == "ok"
    assert calls == ["default", "backup"]


def test_llm_returns_empty_when_all_unreachable(monkeypatch):
    from app.services import bi_ai_engine

    monkeypatch.setattr(ai_models, "candidate_configs",
                        lambda: [_cfg("default", model_id=1), _cfg("backup", model_id=2)])

    def fake_post(url, **kwargs):
        raise requests.Timeout("timeout")

    monkeypatch.setattr(requests, "post", fake_post)
    assert bi_ai_engine._call_llm("hi") == ""
