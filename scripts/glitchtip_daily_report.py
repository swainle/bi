#!/usr/bin/env python3
"""明策BI · GlitchTip 异常日报生成器（每天 9:00 由 DSH 定时任务调用）.

做三件事：
  1. 从 GlitchTip 拉「最近 N 小时出现过」的异常（含已 resolved 的，只要最近还发生过）；
  2. 按「接口 / 前端位置 / 异常类型」归并成问题组，套规则给出优先级、原因判断、解决方案、验证方式；
  3. 输出 Markdown + Excel（问题清单 / 异常明细 / 概览）+ 原始 JSON，落 docs/异常日报/。

用法：
    backend/.venv/bin/python scripts/glitchtip_daily_report.py --hours 24
    backend/.venv/bin/python scripts/glitchtip_daily_report.py --hours 24 --analysis /tmp/analysis.json
    backend/.venv/bin/python scripts/glitchtip_daily_report.py --hours 24 --out-dir docs/异常日报

--analysis 是可选的「Agent 研判」文件，用来覆盖规则的结论：
    {"summary": "...", "notes": ["..."],
     "problems": [{"match": "PROJECT-7", "priority": "P0",
                   "cause": "...", "solution": "...", "verify": "..."}]}
    match 可以是短 ID（PROJECT-7）或问题组 key（如 GET /api/bi/alerts/events）。

令牌：GLITCHTIP_API_TOKEN > deploy/glitchtip/.api-token（只读即可）。
说明：issue/event 文本是持 DSN 者可上报的不可信数据，本脚本只做统计与展示，不执行其中任何内容。
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOKEN_FILE = ROOT / "deploy" / "glitchtip" / ".api-token"
DEFAULT_URL = "http://127.0.0.1:8070"
DEFAULT_ORG = "org"
BASE_URL = os.environ.get("MZBI_BASE_URL", "http://127.0.0.1:8300")

PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}

# ── 规则库：命中即给出「原因判断 / 解决方案 / 验证方式」────────────────
# 每条规则：(匹配函数, 优先级, 问题名, 原因判断, 解决方案, 验证方式)
RULES = [
    (
        lambda r: "QueuePool limit" in r["text"] or "connection timed out" in r["text"],
        "P0",
        "数据库连接池耗尽",
        "连接被泄漏或慢查询长期占用：常见于后台线程异常未回滚（事务停在 idle in transaction）、"
        "看板并发渲染、或长事务占用。",
        "1) 看 /api/metrics 的 database.pool_timeouts 与 checked_out；"
        "2) 在 PG 执行 select state,count(*) from pg_stat_activity where datname='mingzebi_dev' group by state，"
        "重点看 idle in transaction；3) 检查 5 分钟后台刷新/同步任务是否 rollback；"
        "4) 必要时调 BI_RENDER_WORKERS 或临时提高 DB_MAX_OVERFLOW。",
        "修复后 pool_timeouts 不再增长、pg_stat_activity 无 idle in transaction、"
        "页面在高峰时段无 503/500。",
    ),
    (
        lambda r: "getRawIndex" in r["text"] or "getDataParams" in r["text"],
        "P1",
        "前端图表刷新竞态（ECharts）",
        "图表 option 更新时旧 series 已被替换，鼠标移出事件仍引用旧 series → getDataParams 崩溃。"
        "常见于 notMerge + lazyUpdate 组合或数据条数骤减。",
        "1) 确认渲染器未使用 lazyUpdate（同步更新）；2) 刷新前后条数变化大的图，更新前 chart.clear()；"
        "3) 在图表容器上避免频繁重挂载。",
        "有 hover 的看板连续刷新 3 次、鼠标移入移出，浏览器无 pageerror / Sentry 无新事件。",
    ),
    (
        lambda r: "address already in use" in r["text"] or "Errno 48" in r["text"],
        "P2",
        "端口被占用（启动冲突）",
        "上一个进程未退出或两个实例同时启动（常见于手动重启后端）。",
        "重启前先 kill $(lsof -nP -iTCP:8300 -sTCP:LISTEN -t)，确认端口释放再启动；"
        "不要同时跑两份 uvicorn。",
        "重启后 lsof 只有 1 个监听进程，接口正常。",
    ),
    (
        lambda r: "UndefinedColumn" in r["text"] or "does not exist" in r["text"],
        "P1",
        "SQL 结构不匹配（列/表不存在）",
        "代码引用了迁移里没有的列/表，或对视图做了只有物理表才有的操作（如 updated_at）。",
        "核对 schema/migrations 与 physical_table；对视图/无 updated_at 的表提前跳过或返回 400；"
        "异常分支必须先 rollback 再记日志。",
        "相关接口返回明确 4xx 而不是 500，且 PG 无 idle in transaction 残留。",
    ),
    (
        lambda r: r["http_status"] == 500 and (r["elapsed"] or 0) >= 25000,
        "P0",
        "接口超时（≥25s）后 500",
        "请求在等数据库连接或下游响应；30s 左右通常是 QueuePool pool_timeout。",
        "先确认同时间窗口的连接池状态与慢查询；连接池耗尽按上一条处理；"
        "确认后前端轮询应退避，后端 503 + Retry-After。",
        "同路径 P95 < 2s，超时窗口不再出现。",
    ),
    (
        lambda r: r["http_status"] in (401, 403),
        "P1",
        "鉴权 / 权限失败",
        "登录态过期、CSRF 缺失、或成员访问了无权限的资源。",
        "确认是否集中出现在令牌过期/多端登录；前端 401 应跳登录、403 应提示无权限；"
        "CSRF 缺失检查 axios 拦截器。",
        "用正常账号复现无 401/403；越权账号得到明确 403 文案。",
    ),
    (
        lambda r: "ECONNREFUSED" in r["text"] or "connection refused" in r["text"].lower(),
        "P1",
        "依赖服务未启动 / 连接被拒绝",
        "数据源、Redis 或下游服务没起，或地址/端口写错。",
        "按连接串确认目标服务与端口；Redis 属可选依赖，断连应降级不阻塞；"
        "数据源失败只影响对应卡片。",
        "服务恢复后重试接口成功；断开时页面给出可读错误而非白屏。",
    ),
    (
        lambda r: r["exc_type"] in ("TypeError", "ReferenceError", "RangeError"),
        "P1",
        "前端 JS 运行时异常",
        "组件拿到空数据/undefined 后继续取值；多为空态或接口字段缺失。",
        "按堆栈定位组件与触发路径；补空值保护与 loading/empty 分支；"
        "接口契约变更时同步前端类型。",
        "按复现步骤操作无控制台异常；空数据时页面正常显示空态。",
    ),
    (
        lambda r: "上报验证" in r["text"] or "GlitchTip 真实上报验证" in r["text"],
        "P3",
        "测试噪音（上报验证）",
        "接入 Sentry/GlitchTip 时故意抛出的验证异常，不是生产问题。",
        "标记 resolved / ignored；不要据此改产品代码。",
        "面板不再出现该条；真实异常仍能正常上报。",
    ),
    (
        lambda r: "ChunkLoadError" in r["text"] or "Importing a module script failed" in r["text"],
        "P1",
        "前端资源加载失败（发布缓存）",
        "发版后旧 chunk 已删除，浏览器仍在请求旧文件名。",
        "确认 index.html 不被缓存、静态资源带 hash；必要时提示用户刷新或加 chunk 重载兜底。",
        "发版后强刷与普通刷新都能打开页面，无 404 chunk。",
    ),
    (
        lambda r: r["http_status"] and r["http_status"] >= 500,
        "P1",
        "接口 5xx",
        "后端未处理异常（见堆栈）或下游失败。",
        "按堆栈定位到具体接口与代码行；补异常分支与错误文案；确认不泄露堆栈。",
        "同参数请求返回预期状态码；Sentry 不再新增。",
    ),
]

UNKNOWN = (
    "P2",
    "待研判",
    "规则库暂未覆盖这类异常，需要看完整堆栈与复现路径。",
    "先取 get_latest_event 的堆栈定位入口函数，再按「复现 → 最小化 → 修复 → 回归」处理。",
    "按复现步骤验证异常不再出现，或明确记录暂不修复的原因。",
)


def die(msg: str) -> None:
    print(f"错误：{msg}", file=sys.stderr)
    raise SystemExit(1)


def load_token(explicit: str | None) -> str:
    if explicit:
        return explicit.strip()
    if os.environ.get("GLITCHTIP_API_TOKEN"):
        return os.environ["GLITCHTIP_API_TOKEN"].strip()
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    die(f"没有 API Token：设置 GLITCHTIP_API_TOKEN 或写入 {TOKEN_FILE}")


def api(base: str, token: str, path: str, params: dict | None = None, missing_ok: bool = False):
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:200]
        if exc.code == 404 and missing_ok:
            return None
        if exc.code == 401:
            die("令牌无效或已失效（HTTP 401）")
        die(f"HTTP {exc.code}：{body}")
    except urllib.error.URLError as exc:
        die(f"连不上 {base}：{exc.reason}（GlitchTip 起了吗？）")
    except TimeoutError:
        die(f"请求超时：{url}")


def fmt_time(value: str | None) -> str:
    if not value:
        return "-"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%m-%d %H:%M")
    except ValueError:
        return value[:16]


def parse_event(issue: dict, event: dict) -> dict:
    rec = {
        "id": str(issue.get("id")),
        "short": issue.get("shortId") or "",
        "count": int(issue.get("count") or 0),
        "first": issue.get("firstSeen") or "",
        "last": issue.get("lastSeen") or "",
        "status": issue.get("status") or "unresolved",
        "level": issue.get("level") or "",
        "title": (issue.get("title") or "").strip(),
        "transaction": (event or {}).get("transaction") or "",
        "path": "",
        "http_status": None,
        "elapsed": None,
        "logger": "",
        "exc_type": "",
        "exc_value": "",
        "permalink": issue.get("permalink") or "",
        "message": "",
    }
    for entry in (event or {}).get("entries") or []:
        if entry.get("type") == "message":
            message = (entry.get("data") or {}).get("message") or ""
            rec["message"] = message
            for key, field in (("path", "path"), ("logger", "logger"), ("exception", "exc_value")):
                m = re.search(r"'%s':\s*'((?:[^'\\]|\\.)*)'" % key, message)
                if m:
                    rec[field] = m.group(1)
            m = re.search(r"'status':\s*(\d+)", message)
            if m:
                rec["http_status"] = int(m.group(1))
            m = re.search(r"'elapsed_ms':\s*([\d.]+)", message)
            if m:
                rec["elapsed"] = float(m.group(1))
        if entry.get("type") == "exception":
            values = (entry.get("data") or {}).get("values") or []
            if values:
                rec["exc_type"] = values[-1].get("type") or ""
                rec["exc_value"] = values[-1].get("value") or rec["exc_value"]
    rec["text"] = " ".join(
        x for x in [rec["title"], rec["exc_value"], rec["transaction"], rec["message"]] if x
    )
    return rec


def group_key(rec: dict) -> str:
    if rec["path"]:
        return rec["path"]
    if "getRawIndex" in rec["text"] or "getDataParams" in rec["text"]:
        return "前端图表 · getRawIndex"
    if "上报验证" in rec["text"] or "GlitchTip 真实上报验证" in rec["text"]:
        return "测试 · 上报验证"
    if rec["transaction"] and "(" in rec["transaction"]:
        return "前端 · " + rec["transaction"].split("(")[0]
    if rec["exc_type"]:
        return "异常 · " + rec["exc_type"]
    return "未分类 · " + (rec["title"][:40] or "未知")


def classify(records: list[dict]) -> tuple[str, str, str, str, str]:
    """一组里任意一条命中规则就采用该结论（规则按严重度从高到低排列）."""
    for match, prio, name, cause, solution, verify in RULES:
        for rec in records:
            try:
                if match(rec):
                    return prio, name, cause, solution, verify
            except Exception:
                continue
    return UNKNOWN


def fetch_records(base: str, org: str, token: str, since: datetime) -> tuple[list[dict], dict]:
    issues = api(base, token, f"/api/0/organizations/{org}/issues/", {"limit": 100})
    if not isinstance(issues, list):
        die(f"异常列表返回格式不对：{str(issues)[:120]}")
    records = []
    for issue in issues:
        last = issue.get("lastSeen")
        if not last:
            continue
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except ValueError:
            continue
        if last_dt < since:
            continue
        event = api(base, token, f"/api/0/issues/{issue['id']}/events/latest/", missing_ok=True)
        records.append(parse_event(issue, event or {}))
    return records, {"total_issues": len(issues)}


def backend_health() -> dict:
    try:
        with urllib.request.urlopen(BASE_URL + "/api/health", timeout=5) as resp:
            health = json.loads(resp.read().decode("utf-8"))
    except Exception:
        health = {"status": "unreachable"}
    metrics = {}
    try:
        with urllib.request.urlopen(BASE_URL + "/api/metrics", timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        metrics = {
            "database": data.get("database") or {},
            "query": data.get("query") or {},
        }
    except Exception:
        pass
    return {"health": health, "metrics": metrics}


def build_groups(records: list[dict], since: datetime) -> list[dict]:
    buckets: dict[str, dict] = {}
    for rec in records:
        key = group_key(rec)
        bucket = buckets.setdefault(key, {
            "key": key,
            "records": [],
            "types": set(),
        })
        bucket["records"].append(rec)
        if rec["exc_type"]:
            bucket["types"].add(rec["exc_type"])

    groups = []
    for bucket in buckets.values():
        recs = bucket["records"]
        rep = max(recs, key=lambda r: (r["count"], r["last"]))
        prio, name, cause, solution, verify = classify(recs)
        total = sum(r["count"] for r in recs)
        first = min((r["first"] for r in recs if r["first"]), default="")
        last = max((r["last"] for r in recs if r["last"]), default="")
        try:
            new_today = datetime.fromisoformat(first.replace("Z", "+00:00")) >= since
        except ValueError:
            new_today = False
        status = "已解决" if all(r["status"] == "resolved" for r in recs) else "未解决"
        groups.append({
            "key": bucket["key"],
            "name": name,
            "priority": prio,
            "cause": cause,
            "solution": solution,
            "verify": verify,
            "count": total,
            "status": status,
            "new_today": new_today,
            "first": first,
            "last": last,
            "records": sorted(recs, key=lambda r: (-r["count"], r["last"])),
            "sample": rep,
        })
    groups.sort(key=lambda g: (PRIORITY_ORDER.get(g["priority"], 9), -g["count"], g["key"]))
    return groups


def apply_analysis(groups: list[dict], analysis: dict) -> None:
    problems = analysis.get("problems") or []
    for item in problems:
        match = str(item.get("match") or "")
        if not match:
            continue
        for group in groups:
            hit = any(
                match in r["short"] or match in r["path"] or match == group["key"]
                for r in group["records"]
            ) or match == group["key"]
            if hit:
                for field in ("priority", "cause", "solution", "verify", "name"):
                    if item.get(field):
                        group[field] = item[field]
                group["agent_note"] = item.get("note") or ""
                break


def sample_text(rec: dict) -> str:
    """示例列：接口类显示「路径 · HTTP 状态 · 耗时」，前端类显示异常标题."""
    if rec["path"]:
        parts = [rec["path"]]
        if rec["http_status"]:
            parts.append(f"HTTP {rec['http_status']}")
        if rec["elapsed"]:
            parts.append(f"{rec['elapsed'] / 1000:.1f}s")
        return " · ".join(parts)
    return (rec["title"] or rec["exc_value"])[:180]


def summary_stats(groups: list[dict], records: list[dict]) -> dict:
    return {
        "groups": len(groups),
        "issues": len(records),
        "events": sum(r["count"] for r in records),
        "unresolved": sum(1 for r in records if r["status"] != "resolved"),
        "p0": sum(1 for g in groups if g["priority"] == "P0"),
        "p1": sum(1 for g in groups if g["priority"] == "P1"),
        "paths": len({g["key"] for g in groups if g["key"].startswith("/")}),
    }


def write_markdown(path: Path, day: str, hours: int, groups: list[dict], stats: dict,
                   health: dict, analysis: dict, since: datetime) -> None:
    lines = [
        f"# 明策BI · 异常日报 · {day}",
        "",
        f"> 统计窗口：最近 {hours} 小时（自 {since.astimezone().strftime('%Y-%m-%d %H:%M')} 起）"
        f" · 数据源：GlitchTip 自建 {DEFAULT_URL}",
        "",
        "## 概览",
        "",
        "| 指标 | 数值 |",
        "| --- | --- |",
        f"| 问题组 | {stats['groups']} |",
        f"| 涉及异常 | {stats['issues']} 条 |",
        f"| 累计事件 | {stats['events']} 次 |",
        f"| 未解决 | {stats['unresolved']} 条 |",
        f"| 高优先级 | P0 {stats['p0']} · P1 {stats['p1']} |",
        "",
    ]
    if analysis.get("summary"):
        lines += ["## 研判结论", "", str(analysis["summary"]), ""]

    lines += ["## 问题清单", ""]
    if not groups:
        lines += ["今日无新增异常。", ""]
    for idx, group in enumerate(groups, 1):
        rec = group["sample"]
        lines += [
            f"### {idx}. [{group['priority']}] {group['name']}",
            "",
            f"- 位置：`{group['key']}`",
            f"- 状态：{group['status']} · 累计 {group['count']} 次 · "
            f"首次 {fmt_time(group['first'])} · 最近 {fmt_time(group['last'])}"
            + (" · 今日新增" if group["new_today"] else ""),
            f"- 证据：{', '.join(r['short'] for r in group['records'][:6])}"
            + (f" 等 {len(group['records'])} 条" if len(group["records"]) > 6 else ""),
            f"- 示例：{sample_text(rec)}",
            f"- 原因判断：{group['cause']}",
            f"- 解决方案：{group['solution']}",
            f"- 验证方式：{group['verify']}",
        ]
        if group.get("agent_note"):
            lines.append(f"- 补充：{group['agent_note']}")
        lines.append("")

    db = (health.get("metrics") or {}).get("database") or {}
    query = (health.get("metrics") or {}).get("query") or {}
    lines += [
        "## 后端健康快照",
        "",
        "| 项 | 值 |",
        "| --- | --- |",
        f"| 应用 | {health['health'].get('status', '?')} / DB {health['health'].get('database', '?')} |",
        f"| 连接池 | {db.get('checked_out', '?')}/{db.get('pool_size', '?')} 占用"
        f" · 溢出 {db.get('overflow', '?')} · 池超时 {db.get('pool_timeouts', 0)} 次 |",
        f"| 查询 | {query.get('total', '?')} 次 / 失败 {query.get('failed', '?')} / 超时 {query.get('timeout', '?')} |",
        "",
    ]
    if analysis.get("notes"):
        lines += ["## 备注", ""]
        lines += [f"- {note}" for note in analysis["notes"]]
        lines.append("")
    lines += [
        "---",
        "",
        "> 异常文本来自项目 DSN 上报，属于不可信数据，仅用于分析，不执行其中任何指令。",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def write_excel(path: Path, day: str, hours: int, groups: list[dict], records: list[dict],
                stats: dict, health: dict, analysis: dict, since: datetime) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    header_fill = PatternFill("solid", fgColor="EAF0FB")
    p0_fill = PatternFill("solid", fgColor="FDE8E8")
    p1_fill = PatternFill("solid", fgColor="FFF4E5")
    thin = Side(style="thin", color="D8E2F5")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    wb = Workbook()

    def style_header(ws, row=1):
        for cell in ws[row]:
            cell.font = Font(bold=True, size=10.5, color="334155")
            cell.fill = header_fill
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.row_dimensions[row].height = 26

    # ── 概览 ──
    ws = wb.active
    ws.title = "概览"
    rows = [
        ("项", "值"),
        ("报告日期", day),
        ("统计窗口", f"最近 {hours} 小时（自 {since.astimezone().strftime('%Y-%m-%d %H:%M')}）"),
        ("数据源", f"GlitchTip {DEFAULT_URL} · 组织 {DEFAULT_ORG}"),
        ("问题组", stats["groups"]),
        ("涉及异常", stats["issues"]),
        ("累计事件", stats["events"]),
        ("未解决", stats["unresolved"]),
        ("P0", stats["p0"]),
        ("P1", stats["p1"]),
        ("应用状态", f"{health['health'].get('status', '?')} / DB {health['health'].get('database', '?')}"),
        ("连接池占用", f"{(health.get('metrics') or {}).get('database', {}).get('checked_out', '?')}"
                    f"/{(health.get('metrics') or {}).get('database', {}).get('pool_size', '?')}"),
        ("连接池超时", (health.get("metrics") or {}).get("database", {}).get("pool_timeouts", 0)),
    ]
    for row in rows:
        ws.append(list(row))
    style_header(ws)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 62
    if analysis.get("summary"):
        ws.append([])
        ws.append(["研判结论", analysis["summary"]])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True)

    # ── 问题清单 ──
    ws = wb.create_sheet("问题清单")
    headers = ["序号", "优先级", "问题", "状态", "累计次数", "窗口内新增", "首次出现", "最近出现",
               "影响位置", "证据（短ID）", "示例", "原因判断", "解决方案", "验证方式"]
    ws.append(headers)
    style_header(ws)
    for idx, group in enumerate(groups, 1):
        rec = group["sample"]
        ws.append([
            idx, group["priority"], group["name"], group["status"], group["count"],
            "是" if group["new_today"] else "否", fmt_time(group["first"]), fmt_time(group["last"]),
            group["key"], ", ".join(r["short"] for r in group["records"][:6]),
            sample_text(rec),
            group["cause"], group["solution"], group["verify"],
        ])
        row = ws.max_row
        if group["priority"] == "P0":
            ws.cell(row=row, column=2).fill = p0_fill
        elif group["priority"] == "P1":
            ws.cell(row=row, column=2).fill = p1_fill
        for cell in ws[row]:
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    widths = [6, 8, 22, 9, 9, 9, 12, 12, 30, 26, 40, 40, 56, 34]
    for i, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:N{max(1, ws.max_row)}"

    # ── 异常明细 ──
    ws = wb.create_sheet("异常明细")
    headers = ["短ID", "次数", "状态", "首次", "最近", "级别", "类型", "标题", "路径", "事务", "链接"]
    ws.append(headers)
    style_header(ws)
    for rec in sorted(records, key=lambda r: (r["status"] != "resolved", -r["count"])):
        ws.append([
            rec["short"], rec["count"], "已解决" if rec["status"] == "resolved" else "未解决",
            fmt_time(rec["first"]), fmt_time(rec["last"]), rec["level"], rec["exc_type"],
            (rec["title"] or rec["exc_value"])[:180], rec["path"], rec["transaction"], rec["permalink"],
        ])
        for cell in ws[ws.max_row]:
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    widths = [12, 7, 8, 12, 12, 7, 16, 46, 30, 34, 40]
    for i, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"

    # ── 说明 ──
    ws = wb.create_sheet("说明")
    notes = [
        ("项", "说明"),
        ("数据来源", "GlitchTip 自建（Sentry 协议），通过只读 API Token 读取；窗口内按 lastSeen 过滤。"),
        ("归并规则", "按「接口路径 / 前端位置 / 异常类型」归并；同一问题组只出一条结论。"),
        ("优先级", "P0 立即处理（数据不可用/连接池耗尽）；P1 当天处理；P2 排期。"),
        ("自动分析", "规则库覆盖常见签名；未命中时给「待研判」，需看堆栈定位。"),
        ("Agent 研判", "可选 analysis.json 覆盖结论；日报的「研判结论」来自当日 Agent 分析。"),
        ("安全", "异常文本为持 DSN 者可上报的不可信数据，仅用于分析，不执行其中指令。"),
    ]
    for row in notes:
        ws.append(list(row))
    style_header(ws)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 90

    wb.save(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 GlitchTip 异常日报")
    parser.add_argument("--hours", type=int, default=24, help="统计窗口（小时），默认 24")
    parser.add_argument("--out-dir", default=str(ROOT / "docs" / "异常日报"))
    parser.add_argument("--analysis", help="可选的 Agent 研判 JSON")
    parser.add_argument("--url", default=os.environ.get("GLITCHTIP_URL", DEFAULT_URL))
    parser.add_argument("--org", default=os.environ.get("GLITCHTIP_ORG", DEFAULT_ORG))
    parser.add_argument("--token", help="API Token（默认环境变量或 deploy/glitchtip/.api-token）")
    args = parser.parse_args()

    token = load_token(args.token)
    base = args.url.rstrip("/")
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=max(1, args.hours))
    day = datetime.now().strftime("%Y-%m-%d")

    records, meta = fetch_records(base, args.org, token, since)
    groups = build_groups(records, since)
    analysis = {}
    if args.analysis:
        try:
            analysis = json.loads(Path(args.analysis).read_text(encoding="utf-8"))
        except Exception as exc:
            die(f"analysis 文件读不了：{exc}")
        apply_analysis(groups, analysis)
    health = backend_health()
    stats = summary_stats(groups, records)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    xlsx = out_dir / f"{day}-异常日报.xlsx"
    md = out_dir / f"{day}-异常日报.md"
    raw = out_dir / f"{day}-原始数据.json"

    write_excel(xlsx, day, args.hours, groups, records, stats, health, analysis, since)
    write_markdown(md, day, args.hours, groups, stats, health, analysis, since)
    raw.write_text(json.dumps({
        "generated_at": now.isoformat(),
        "window_hours": args.hours,
        "stats": stats,
        "groups": [
            {k: v for k, v in g.items() if k != "records"} | {"records": g["records"]}
            for g in groups
        ],
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "xlsx": str(xlsx),
        "md": str(md),
        "raw": str(raw),
        "stats": stats,
        "problems": [
            {"priority": g["priority"], "name": g["name"], "count": g["count"],
             "status": g["status"], "key": g["key"]}
            for g in groups
        ],
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
