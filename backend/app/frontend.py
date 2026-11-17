"""生产镜像中的前端静态文件；开发环境没有构建产物时不挂载。"""

from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        path = path.replace("\\", "/")
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            # 只对前端页面回退，缺失 API、上传文件与静态资源保持 404。
            page = path in (".", "", "login", "bi") or path.startswith("bi/")
            if exc.status_code != 404 or not page or Path(path).suffix:
                raise
            response = await super().get_response("index.html", scope)
        response.headers["Cache-Control"] = (
            "public, max-age=604800, immutable"
            if path.startswith("assets/") else "no-cache"
        )
        return response


def mount_frontend(app: FastAPI, directory: Path) -> None:
    if (directory / "index.html").is_file():
        app.mount("/", FrontendFiles(directory=directory), name="frontend")
