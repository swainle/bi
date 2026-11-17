from app import dev


def test_dev_defaults_and_env_file(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("DEBUG=true")
    monkeypatch.delenv("HOST", raising=False)
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.setattr("sys.argv", ["dev"])
    calls = []
    monkeypatch.setattr(dev.uvicorn, "run", lambda *a, **k: calls.append((a, k)))
    dev.main()
    assert calls == [(("app.main:app",), {
        "host": "127.0.0.1", "port": 8300, "reload": True, "env_file": ".env",
    })]


def test_dev_cli_overrides_environment(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PORT", "8400")
    monkeypatch.setattr("sys.argv", ["dev", "--host", "0.0.0.0", "--port", "8500"])
    calls = []
    monkeypatch.setattr(dev.uvicorn, "run", lambda *a, **k: calls.append(k))
    dev.main()
    assert calls[0] == {"host": "0.0.0.0", "port": 8500, "reload": True, "env_file": None}
