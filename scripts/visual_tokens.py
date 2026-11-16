"""生成视觉回归用的 token 文件（不登录，避免把浏览器里的会话踢下线）.

用法：
    DATABASE_URL="postgresql://cavan-m4max@127.0.0.1:5432/mingzebi_dev" \
      backend/.venv/bin/python scripts/visual_tokens.py [输出路径]

默认输出 /tmp/mzbi_tokens.json；frontend/e2e/visual.spec.ts 会读取它。
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, create_refresh_token  # noqa: E402


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mzbi_tokens.json"
    db = SessionLocal()
    try:
        row = db.execute(
            text("SELECT id, token_version FROM users WHERE username = 'admin'")
        ).fetchone()
    finally:
        db.close()
    if row is None:
        raise SystemExit("数据库里没有 admin 账号，先启动一次后端完成初始化")

    user_id, version = int(row[0]), int(row[1] or 0)
    payload = {
        "access_token": create_access_token(user_id, version),
        "refresh_token": create_refresh_token(user_id, version),
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    os.chmod(out, 0o600)
    print(f"已写入 {out}（用户 {user_id}，24 小时有效）")


if __name__ == "__main__":
    main()
