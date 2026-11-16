#!/usr/bin/env bash
# 面板规范自检 —— 交付前跑一遍（对应 AGENTS.md §3.1 与 §3 间距规范）
#
# 检查内容：
#   1) 同一 label 在配置面板里出现几次（>1 需人工确认是否「同一语义两个入口」）
#   2) 同一 spec 字段被几个 onChange 写入（>1 就是两条路径，必须合并）
#   3) 竖排输入组里是否还残留 <Stack spacing={1}> 这类过密行距（浮动标签需 >= 16px）
#
# 用法：bash scripts/ui_rules.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EDITOR="$ROOT/frontend/src/features/components/editor"
fail=0

echo "== 1) label 重名统计（应为 1；>1 需确认是否不同语义）=="
grep -rho 'label="[^"]*"' "$EDITOR"/*.tsx \
  | sed 's/label="//; s/"$//' | sort | uniq -c | sort -rn \
  | awk '{ printf "  %2d  %s\n", $1, substr($0, index($0,$2)) ; if ($1 > 1) dup = 1 }
         END { if (dup) print "  ⚠ 存在重名 label，请逐个确认是否同一语义（同一语义只允许一个入口）" }'

echo
echo "== 2) 同一 spec 字段被写入次数（>1 即两条路径）=="
for field in title subtitle show_title show_meta x_title y_title bar_name line_name note export_scope global_nav; do
  n=$(grep -rho "${field}:" "$EDITOR"/*.tsx | wc -l | tr -d ' ')
  flag=""
  if [ "$n" -gt 1 ]; then flag="  ← 人工确认：是重复入口还是不同字段"; fi
  printf "  %-14s %2d%s\n" "$field" "$n" "$flag"
done

echo
echo "== 3) 过密行距（浮动标签应 >= 16px，即 spacing>=2 / gap>=2）=="
hits=$(grep -rn 'Stack spacing={1}\|Stack spacing={1.25}\|Stack spacing={1.5}' "$EDITOR"/*.tsx || true)
if [ -n "$hits" ]; then
  echo "$hits" | sed 's/^/  /'
  echo "  ⚠ 以上竖排组行距偏小（若组内是纯按钮可忽略）"
else
  echo "  ✓ 没有 spacing 过小的竖排组"
fi

echo
echo "== 4) 类型检查 =="
(cd "$ROOT/frontend" && npx tsc --noEmit) && echo "  ✓ tsc 通过" || { echo "  ✗ tsc 失败"; fail=1; }

echo
if [ "$fail" -eq 0 ]; then
  echo "自检完成（硬门槛只有 tsc；label/字段计数是人工复核清单，重名的逐个过一眼再交付）。"
else
  echo "自检失败：tsc 未通过。"
fi
