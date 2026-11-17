from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.frontend import mount_frontend


def test_frontend_routes_and_missing_resources(tmp_path):
    (tmp_path / "index.html").write_text("<html>明策BI</html>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app-123.js").write_text("console.log('ok')")
    app = FastAPI()

    @app.get("/api/livez")
    def livez():
        return {"status": "alive"}

    mount_frontend(app, tmp_path)
    with TestClient(app) as client:
        for url in ("/", "/login", "/bi", "/bi/canvas?doc=1", "/bi/view/1"):
            response = client.get(url)
            assert response.status_code == 200, url
            assert "明策BI" in response.text
            assert response.headers["cache-control"] == "no-cache"
        asset = client.get("/assets/app-123.js")
        assert asset.status_code == 200
        assert "immutable" in asset.headers["cache-control"]
        assert client.get("/api/livez").json() == {"status": "alive"}
        for url in ("/api/missing", "/uploads/missing.png", "/assets/missing.js", "/bi/missing.js", "/.env", "/../.env"):
            assert client.get(url).status_code == 404
        assert client.post("/bi/canvas").status_code == 405
        assert client.head("/bi/canvas").status_code == 200


def test_development_without_frontend_build(tmp_path):
    app = FastAPI()
    mount_frontend(app, tmp_path)
    with TestClient(app) as client:
        assert client.get("/bi").status_code == 404
