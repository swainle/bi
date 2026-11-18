import pytest

from app import dev


@pytest.fixture(autouse=True)
def clear_bind_environment(monkeypatch):
    for name in ("HOST", "PORT", "BACKEND_HOST", "BACKEND_PORT"):
        monkeypatch.delenv(name, raising=False)


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
    (tmp_path / ".env").write_text("BACKEND_HOST=127.0.0.2\nBACKEND_PORT=8600")
    monkeypatch.setenv("BACKEND_HOST", "127.0.0.3")
    monkeypatch.setenv("BACKEND_PORT", "8400")
    monkeypatch.setattr("sys.argv", ["dev", "--host", "0.0.0.0", "--port", "8500"])
    calls = []
    monkeypatch.setattr(dev.uvicorn, "run", lambda *a, **k: calls.append(k))
    dev.main()
    assert calls[0] == {"host": "0.0.0.0", "port": 8500, "reload": True, "env_file": ".env"}


@pytest.mark.parametrize("environment, expected", [
    ({}, ("0.0.0.0", 8400)),
    ({"BACKEND_HOST": "127.0.0.2", "BACKEND_PORT": "8500"}, ("127.0.0.2", 8500)),
    ({"HOST": "127.0.0.3", "PORT": "8600"}, ("127.0.0.3", 8600)),
])
def test_dev_bind_configuration(monkeypatch, tmp_path, environment, expected):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("BACKEND_HOST=0.0.0.0\nBACKEND_PORT=8400")
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr("sys.argv", ["dev"])
    calls = []
    monkeypatch.setattr(dev.uvicorn, "run", lambda *a, **k: calls.append(k))
    dev.main()
    assert (calls[0]["host"], calls[0]["port"]) == expected
