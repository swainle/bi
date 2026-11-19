"""uv run dev：本地开发入口。"""

import argparse
import os

import uvicorn
from dotenv import dotenv_values


def main():
    env_file = ".env" if os.path.isfile(".env") else None
    config = dotenv_values(env_file) if env_file else {}
    parser = argparse.ArgumentParser(description="明策BI 开发服务器（自动重载）")
    parser.add_argument("--host", default=(
        os.getenv("BACKEND_HOST") or os.getenv("HOST")
        or config.get("BACKEND_HOST") or config.get("HOST") or "127.0.0.1"
    ))
    parser.add_argument("--port", type=int, default=(
        os.getenv("BACKEND_PORT") or os.getenv("PORT")
        or config.get("BACKEND_PORT") or config.get("PORT") or "8300"
    ))
    args = parser.parse_args()
    uvicorn.run(
        "app.main:app", host=args.host, port=args.port, reload=True,
        env_file=env_file,
    )
