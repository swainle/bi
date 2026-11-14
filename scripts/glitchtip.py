#!/usr/bin/env python3
"""读取 GlitchTip（自建 Sentry 兼容服务）里的异常，供 agent / 人排查用。

用法：
    python3 scripts/glitchtip.py issues --status unresolved --limit 10
    python3 scripts/glitchtip.py issue PROJECT-4
    python3 scripts/glitchtip.py issue 7 --json
    python3 scripts/glitchtip.py projects

令牌来源（按优先级）：
    --token  >  环境变量 GLITCHTIP_API_TOKEN  >  deploy/glitchtip/.api-token
服务地址：--url  >  GLITCHTIP_URL  >  http://127.0.0.1:8070
组织：    --org  >  GLITCHTIP_ORG  >  org

只依赖标准库。令牌是只读的（org:read / project:read / event:read），
能看异常与堆栈，改不了状态；要改状态请另发带 event:write 的令牌。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TOKEN_FILE = REPO_ROOT / "deploy" / "glitchtip" / ".api-token"
DEFAULT_URL = "http://127.0.0.1:8070"
DEFAULT_ORG = "org"


def die(msg: str) -> None:
    print(f"错误：{msg}", file=sys.stderr)
    raise SystemExit(1)


def load_token(args: argparse.Namespace) -> str:
    if args.token:
        return args.token.strip()
    if os.environ.get("GLITCHTIP_API_TOKEN"):
        return os.environ["GLITCHTIP_API_TOKEN"].strip()
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    die(
        f"没有 API Token。请设置 GLITCHTIP_API_TOKEN，或在 {TOKEN_FILE} 写入令牌：\n"
        "  docker exec glitchtip-web-1 python manage.py shell -c \""
        "from apps.api_tokens.models import APIToken;from apps.users.models import User;"
        "t=APIToken.objects.create(user=User.objects.get(pk=1),label='agent-read');"
        "t.add_permissions(['org:read','project:read','event:read']);print(t.token)\""
    )


def api(
    base: str,
    token: str,
    path: str,
    params: dict | None = None,
    missing_ok: bool = False,
) -> object:
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        if exc.code == 404 and missing_ok:
            return None
        if exc.code == 401:
            die("令牌无效或已失效（HTTP 401）。检查 deploy/glitchtip/.api-token 与容器是否重启过。")
        if exc.code == 403:
            die(f"令牌权限不足（HTTP 403）：{body}")
        die(f"HTTP {exc.code}：{body}")
    except urllib.error.URLError as exc:
        die(f"连不上 {base}：{exc.reason}（GlitchTip 起了吗？cd deploy/glitchtip && docker compose up -d）")
    except TimeoutError:
        die(f"请求超时：{url}")
    return None


def fmt_time(value: str | None) -> str:
    if not value:
        return "-"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return value[:19]


def short_title(text: str, width: int = 86) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= width else text[: width - 1] + "…"


def cmd_issues(base: str, token: str, org: str, args: argparse.Namespace) -> None:
    query = {"unresolved": "is:unresolved", "resolved": "is:resolved"}.get(args.status)
    params = {"limit": args.limit, "sort": "-last_seen"}
    if query:
        params["query"] = query
    data = api(base, token, f"/api/0/organizations/{org}/issues/", params)
    if not isinstance(data, list):
        die(f"接口返回格式异常：{data!r}")
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    if not data:
        print("（没有匹配的异常）")
        return
    rows = []
    for issue in data:
        title = (issue.get("metadata") or {}).get("value") or issue.get("title") or ""
        if issue.get("metadata", {}).get("type"):
            title = f"{issue['metadata']['type']}: {title}"
        rows.append(
            (
                issue.get("shortId", "?"),
                str(issue.get("count", "?")),
                fmt_time(issue.get("lastSeen")),
                issue.get("level", "-"),
                issue.get("status", "-"),
                short_title(issue.get("title") or title),
            )
        )
    headers = ("SHORT ID", "次数", "最后出现", "级别", "状态", "标题")
    widths = [max(len(str(r[i])) for r in rows + [headers]) for i in range(len(headers))]
    line = "  ".join(str(h).ljust(w) for h, w in zip(headers, widths))
    print(line)
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print("  ".join(str(c).ljust(w) for c, w in zip(row, widths)))
    print(f"\n共 {len(rows)} 条 · {base}/project/issues")


def cmd_issue(base: str, token: str, org: str, issue_id: str, as_json: bool) -> None:
    # 短 ID（PROJECT-4）没有直连接口，先用 shortIdLookup 换算成数字 id
    if not str(issue_id).isdigit():
        hits = api(
            base,
            token,
            f"/api/0/organizations/{org}/issues/",
            {"query": issue_id, "shortIdLookup": 1},
        )
        if not isinstance(hits, list) or not hits:
            die(f"找不到 issue {issue_id}（短 ID 形如 PROJECT-4）")
        issue_id = str(hits[0]["id"])
    issue = api(base, token, f"/api/0/issues/{issue_id}/")
    if not isinstance(issue, dict):
        die(f"找不到 issue {issue_id}")
    event = api(
        base, token, f"/api/0/issues/{issue_id}/events/latest/", missing_ok=True
    )
    if as_json:
        print(json.dumps({"issue": issue, "event": event}, ensure_ascii=False, indent=2))
        return

    meta = issue.get("metadata") or {}
    title = issue.get("title") or ""
    if meta.get("type"):
        title = f"{meta['type']}: {meta.get('value', title)}"
    print(f"{issue.get('shortId')} · {issue.get('status')} · {issue.get('count')} 次")
    print(f"最后出现：{fmt_time(issue.get('lastSeen'))}    首次：{fmt_time(issue.get('firstSeen'))}")
    print(f"标题：{short_title(title, 200)}")
    if issue.get("culprit"):
        print(f"culprit：{issue['culprit']}")
    print(f"链接：{base}/project/issues/{issue.get('id')}")

    exception = None
    for entry in (event or {}).get("entries") or []:
        if entry.get("type") == "exception":
            exception = (entry.get("data") or {}).get("values") or []
            break
    if exception:
        first = exception[-1]
        print(f"\n异常：{first.get('type', '')}: {short_title(first.get('value', ''), 300)}")
        frames = (((first.get("stacktrace") or {}).get("frames")) or [])[::-1]
        if frames:
            print("堆栈（内层在上，只显示前 15 帧）：")
            for frame in frames[:15]:
                filename = os.path.basename(str(frame.get("filename") or frame.get("abs_path") or "?"))
                fn = frame.get("function") or "<module>"
                mark = "  " if frame.get("inApp") else "  ·"
                print(f"{mark} {filename}:{frame.get('lineNo', '?')}  {fn}")
    else:
        print("\n（该 issue 暂无事件详情）")


def cmd_projects(base: str, token: str, org: str) -> None:
    data = api(base, token, f"/api/0/projects/")
    if not isinstance(data, list):
        die(f"接口返回格式异常：{data!r}")
    for project in data:
        print(f"{project.get('id')}\t{project.get('slug')}\t{project.get('name')}\t{project.get('platform') or '-'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="读取 GlitchTip 里的异常")
    parser.add_argument("--url", default=os.environ.get("GLITCHTIP_URL", DEFAULT_URL))
    parser.add_argument("--org", default=os.environ.get("GLITCHTIP_ORG", DEFAULT_ORG))
    parser.add_argument("--token", help="API Token（默认读环境变量或 deploy/glitchtip/.api-token）")
    sub = parser.add_subparsers(dest="command")

    p_issues = sub.add_parser("issues", help="列出异常（默认 unresolved）")
    p_issues.add_argument("--status", choices=("unresolved", "resolved", "all"), default="unresolved")
    p_issues.add_argument("--limit", type=int, default=20)
    p_issues.add_argument("--json", action="store_true")
    p_issues.set_defaults(func="issues")

    p_issue = sub.add_parser("issue", help="看单条异常 + 最新事件堆栈（支持 7 或 PROJECT-7）")
    p_issue.add_argument("issue_id")
    p_issue.add_argument("--json", action="store_true")
    p_issue.set_defaults(func="issue")

    p_projects = sub.add_parser("projects", help="列出项目")
    p_projects.set_defaults(func="projects")

    args = parser.parse_args()
    if not getattr(args, "command", None):
        parser.print_help()
        raise SystemExit(0)

    token = load_token(args)
    base = args.url.rstrip("/")
    if args.func == "issues":
        cmd_issues(base, token, args.org, args)
    elif args.func == "issue":
        cmd_issue(base, token, args.org, args.issue_id, args.json)
    else:
        cmd_projects(base, token, args.org)


if __name__ == "__main__":
    main()
