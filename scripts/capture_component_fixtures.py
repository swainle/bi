"""抓取每种组件的真实渲染 payload，生成前端 Storybook 用的 fixtures.

为什么需要它：
    手写的 mock 数据结构和后端真实输出一定有偏差，会做出「Storybook 里好看、
    画布上塌」的组件。这份脚本走的是组件库卡片墙同一条接口
    （POST /api/bi/components/preview-batch），拿到的就是画布上真正会收到的数据。

数据来源：
    组件模板不写死数据集，preview-batch 会给没绑定数据集的模板临时挂上
    「测试数据集」（bi_demo_sku，已脱敏：平台A/B/C、品牌A~N、31 个省）。
    所以 fixtures 里没有真实经营数据，可以随前端包一起交给外部开发。

用法：
    # 后端已在 127.0.0.1:8300 运行
    DATABASE_URL="postgresql://cavan-m4max@127.0.0.1:5432/mingcebi_dev" \
      backend/.venv/bin/python scripts/capture_component_fixtures.py

    # 自定义后端地址 / 输出目录
    MCBI_BASE_URL="http://127.0.0.1:8301" \
      backend/.venv/bin/python scripts/capture_component_fixtures.py --out /tmp/fixtures
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

DEFAULT_DB = "postgresql://cavan-m4max@127.0.0.1:5432/mingcebi_dev"
DEFAULT_OUT = os.path.join(
    ROOT, "frontend", "src", "features", "components", "renderers", "__fixtures__"
)
DEFAULT_BASE = os.environ.get("MCBI_BASE_URL", "http://127.0.0.1:8300")
BATCH = 40          # preview-batch 单次上限 60，留点余量


def _token() -> str:
    """直接在库里读 admin 签一个 token —— 不走登录接口，不会踢掉浏览器会话."""
    if not os.environ.get("DATABASE_URL"):
        os.environ["DATABASE_URL"] = DEFAULT_DB
    from sqlalchemy import text

    from app.database import SessionLocal
    from app.services.auth import create_access_token

    db = SessionLocal()
    try:
        row = db.execute(
            text("SELECT id, token_version FROM users WHERE username = 'admin'")
        ).fetchone()
    finally:
        db.close()
    if row is None:
        raise SystemExit("数据库里没有 admin 账号，先启动一次后端完成初始化")
    return create_access_token(int(row[0]), int(row[1] or 0))


def _call(method: str, path: str, token: str, body: dict | None = None) -> dict:
    url = DEFAULT_BASE.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    # CSRF 是 double-submit：非幂等方法要 cookie 与 X-CSRF-Token 头一致（服务端只比对两个值）
    csrf = secrets.token_hex(32)
    req.add_header("Cookie", f"csrf_token={csrf}")
    req.add_header("X-CSRF-Token", csrf)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"{method} {url} 失败：HTTP {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"连不上后端 {url}：{exc.reason}\n"
            f"先把后端起起来（见 AGENTS.md §1），或用 MCBI_BASE_URL 指定地址"
        ) from exc


def _pick_one_per_kind(components: list[dict]) -> dict[str, dict]:
    """每种 kind 挑一张模板（优先内置、其次 id 最小的），保证 fixtures 稳定可复现."""
    picked: dict[str, dict] = {}
    for comp in sorted(components, key=lambda c: (not c.get("is_builtin"), c.get("id") or 0)):
        kind = str(comp.get("kind") or "")
        if not kind or kind in picked:
            continue
        picked[kind] = comp
    return picked


def main() -> None:
    parser = argparse.ArgumentParser(description="抓取组件真实 payload 生成 Storybook fixtures")
    parser.add_argument("--out", default=DEFAULT_OUT, help="输出目录")
    parser.add_argument("--base-url", default=None, help="后端地址（默认 127.0.0.1:8300）")
    args = parser.parse_args()

    global DEFAULT_BASE
    if args.base_url:
        DEFAULT_BASE = args.base_url

    token = _token()
    listing = _call("GET", "/api/bi/components", token)
    components = listing.get("components") or []
    if not components:
        raise SystemExit("组件库是空的：先启动一次后端把种子灌进去（MINGCEBI_RESEED=1）")

    picked = _pick_one_per_kind(components)
    print(f"组件库共 {len(components)} 张模板，覆盖 {len(picked)} 种 kind")

    cards: dict[str, dict] = {}
    errors: dict[str, str] = {}
    keys = sorted(picked)
    for start in range(0, len(keys), BATCH):
        chunk = keys[start : start + BATCH]
        items = [
            {"key": kind, "kind": kind, "spec": picked[kind].get("spec") or {}}
            for kind in chunk
        ]
        result = _call("POST", "/api/bi/components/preview-batch", token, {"items": items})
        cards.update(result.get("cards") or {})
        errors.update(result.get("errors") or {})

    out = args.out
    os.makedirs(out, exist_ok=True)

    written: list[str] = []
    for kind in keys:
        payload = cards.get(kind)
        if not payload:
            continue
        # 调试字段不入 fixture：它们指向本机这一次查询，留着只会误导
        payload.pop("sql", None)
        payload.pop("elapsed_ms", None)
        payload.pop("dataset_id", None)
        payload.pop("params_used", None)
        with open(os.path.join(out, f"{kind}.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        written.append(kind)

    # 清理上次残留（kind 被删掉后旧 json 不该继续被引用）
    for name in os.listdir(out):
        if name.endswith(".json") and name[:-5] not in written:
            os.remove(os.path.join(out, name))

    _write_index(out, written)
    _write_meta(out, written, errors)

    print(f"已写入 {len(written)} 个 fixture → {out}")
    if errors:
        print(f"以下 kind 取数失败（未写入）：")
        for kind, message in sorted(errors.items()):
            print(f"  · {kind}: {message}")


def _write_index(out: str, kinds: list[str]) -> None:
    lines = [
        "/** 自动生成，请勿手改 —— 由 scripts/capture_component_fixtures.py 产出。 */",
        "/** 每种组件的真实渲染 payload（来自测试数据集 bi_demo_sku，已脱敏）。 */",
        "",
        'import type { RenderPayload } from "../../types";',
        "",
    ]
    for kind in kinds:
        ident = _ident(kind)
        lines.append(f'import {ident} from "./{kind}.json";')
    lines += [
        "",
        "export const fixtures: Record<string, RenderPayload> = {",
    ]
    for kind in kinds:
        lines.append(f"  {kind}: {_ident(kind)} as unknown as RenderPayload,")
    lines += [
        "};",
        "",
        "export const fixtureKinds = Object.keys(fixtures);",
        "",
    ]
    with open(os.path.join(out, "index.ts"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


def _write_meta(out: str, kinds: list[str], errors: dict[str, str]) -> None:
    meta = {
        "captured_at": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "POST /api/bi/components/preview-batch",
        "dataset": "演示数据集 bi_demo_sku（已脱敏，可外发）",
        "kinds": kinds,
        "errors": errors,
    }
    with open(os.path.join(out, "_meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def _ident(kind: str) -> str:
    """rank_list → rankList，避开保留字."""
    head, *rest = kind.split("_")
    return head + "".join(part.capitalize() for part in rest)


if __name__ == "__main__":
    main()
