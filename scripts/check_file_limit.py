#!/usr/bin/env python3
"""单文件行数红线检查（默认 300 行，棘轮模式）.

规则（见 docs/开发规范.md §4）：
- 新文件不得超过 LIMIT；
- 存量超限文件只允许变小，不允许变大（基线是棘轮）；
- 文件头 5 行内写 `FILE-LIMIT-EXEMPT: 原因` 可豁免（生成代码 / 迁移 / 种子数据等）；
- `--update` 重写基线，仅在“文件确实变小/拆分”时使用，PR 必须说明原因。

用法：
    python scripts/check_file_limit.py
    python scripts/check_file_limit.py --update
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "scripts" / "file_limit_baseline.json"
LIMIT = 300
MARKER = "FILE-LIMIT-EXEMPT"

CHECK_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".vue"}

# 目录/路径片段：第三方、构建产物、文档、数据、自动生成物不参与
EXCLUDE_PARTS = {
    ".git", "node_modules", ".venv", "venv", "dist", "build", "coverage",
    "__pycache__", ".next", ".turbo", ".storybook-static", "backend/var",
    "docs", "backend/schema/migrations", "__fixtures__",
}


def _excluded(rel: Path) -> bool:
    text = rel.as_posix()
    if any(part in EXCLUDE_PARTS for part in rel.parts):
        return True
    return any(text.startswith(prefix + "/") for prefix in EXCLUDE_PARTS)


def _iter_files():
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in CHECK_SUFFIXES:
            continue
        if path.name.endswith(".d.ts"):
            continue
        rel = path.relative_to(ROOT)
        if _excluded(rel):
            continue
        yield path, rel


def _count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8", errors="ignore").splitlines())


def _exempt(path: Path) -> bool:
    try:
        head = path.read_text(encoding="utf-8", errors="ignore").splitlines()[:5]
    except OSError:
        return False
    return any(MARKER in line for line in head)


def _load() -> dict[str, int]:
    if not BASELINE.exists():
        return {}
    data = json.loads(BASELINE.read_text(encoding="utf-8"))
    return {k: int(v) for k, v in (data.get("files") or {}).items()}


def _save(files: dict[str, int]) -> None:
    BASELINE.write_text(
        json.dumps({"limit": LIMIT, "files": dict(sorted(files.items()))},
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="单文件行数红线检查（棘轮）")
    ap.add_argument("--update", action="store_true", help="重写基线（仅用于文件变小/拆分后）")
    args = ap.parse_args()

    current = {rel.as_posix(): _count(path) for path, rel in _iter_files() if not _exempt(path)}
    over = {p: n for p, n in current.items() if n > LIMIT}

    if args.update:
        _save(over)
        print(f"已写入基线：{len(over)} 个文件超过 {LIMIT} 行（scripts/file_limit_baseline.json）")
        return 0

    baseline = _load()
    if not baseline:
        print("缺少基线文件，请先执行：python scripts/check_file_limit.py --update")
        return 1

    violations: list[str] = []
    warnings: list[str] = []

    for path, lines in sorted(current.items()):
        base = baseline.get(path)
        if lines <= LIMIT:
            if base is not None:
                warnings.append(f"已降至 {LIMIT} 行以内，可执行 --update 移出基线：{path}（{lines} 行）")
            continue
        if base is None:
            violations.append(f"新增/未登记文件超过 {LIMIT} 行：{path}（{lines} 行）→ 请拆分子文件")
        elif lines > base:
            violations.append(f"存量超限文件变长：{path}（{base} → {lines} 行）→ 只允许变小，新增逻辑放子文件")

    for path in sorted(set(baseline) - set(current)):
        warnings.append(f"基线中的文件已不存在/被豁免：{path}（可执行 --update 清理）")

    print(f"检查 {len(current)} 个源文件，红线 {LIMIT} 行；存量超限 {len(over)} 个。")
    for item in warnings:
        print(f"  WARN  {item}")
    for item in violations:
        print(f"  FAIL  {item}")

    if violations:
        print(f"\n失败：{len(violations)} 条；规则见 docs/开发规范.md §4。")
        return 1
    print("通过：没有新增超限，也没有存量变长。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
