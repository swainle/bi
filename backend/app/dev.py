"""uv run dev：本地开发入口。"""

import argparse
import os

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="明策BI 开发服务器（自动重载）")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8300")))
    args = parser.parse_args()
    uvicorn.run(
        "app.main:app", host=args.host, port=args.port, reload=True,
        env_file=".env" if os.path.isfile(".env") else None,
    )
