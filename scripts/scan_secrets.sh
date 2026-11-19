#!/usr/bin/env bash
# 推送前密钥扫描：发现疑似凭据就退出 1，阻止发布。
# 用法：
#   bash scripts/scan_secrets.sh            # 扫已跟踪文件（发布前用）
#   bash scripts/scan_secrets.sh --staged   # 只扫暂存区（提交前用）
set -uo pipefail

MODE="${1:-all}"
FAIL=0

# 常见凭据形态（覆盖主流云厂商与 AI 服务）
PATTERNS=(
  'sk-[A-Za-z0-9_-]{20,}'                       # OpenAI / DeepSeek / Anthropic
  'ghp_[A-Za-z0-9]{30,}'                        # GitHub PAT
  'gho_[A-Za-z0-9]{30,}'                        # GitHub OAuth
  'github_pat_[A-Za-z0-9_]{40,}'                # GitHub fine-grained
  'glpat-[A-Za-z0-9_-]{20,}'                    # GitLab
  'AKIA[0-9A-Z]{16}'                            # AWS Access Key
  'xox[baprs]-[A-Za-z0-9-]{10,}'                # Slack
  'AIza[0-9A-Za-z_-]{35}'                       # Google API
  'BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY'  # 私钥
  'eyJhbGciOi[A-Za-z0-9_-]{20,}'                # JWT（真实令牌）
  '(JWT_SECRET|SECRET_KEY|API_KEY|ACCESS_KEY|CLIENT_SECRET|LLM_API_KEY|ADMIN_PASSWORD)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'{}$<]{12,}'  # 硬编码密钥赋值
)

# 允许出现的占位符（文档 / 示例）
ALLOW='example|placeholder|your-|<|\$\{|xxx|\*\*\*|test-|dummy|REDACTED'

# 路径排除
EXCLUDES=( ':!frontend/package-lock.json' ':!*.map' ':!*.min.js' ':!LICENSE' ':!THIRD-PARTY-NOTICES.md' )

# 按模式选择搜索源：暂存区（--cached）或工作区
grep_src() {
  local pat="$1"
  if [ "$MODE" = "--staged" ]; then
    git grep --cached -nIE "$pat" -- "${EXCLUDES[@]}" 2>/dev/null
  else
    git grep -nIE "$pat" -- "${EXCLUDES[@]}" 2>/dev/null
  fi
}

report() {
  local label="$1" hits="$2"
  if [ -n "$hits" ]; then
    echo "✗ [$label] 发现疑似凭据："
    echo "$hits" | head -20 | sed 's/^/    /'
    FAIL=1
  fi
}

echo "== 密钥扫描（模式：${MODE}）=="

for p in "${PATTERNS[@]}"; do
  report "凭据形态" "$(grep_src "$p" | grep -viE "$ALLOW")"
done

# 连接串里的明文口令（排除示例与本地开发默认）
CONN=$(grep_src '://[^:/@[:space:]"]+:[^@[:space:]"$]{6,}@' \
       | grep -viE "$ALLOW|user:password|mingcebi:mingcebi")
report "连接串明文口令" "$CONN"

# 密钥文件本身不该被 Git 跟踪
for f in backend/.env backend/.jwt_secret .env; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "✗ [密钥文件] $f 已被 Git 跟踪，必须移出："
    echo "    git rm --cached $f && echo '$f' >> .gitignore"
    FAIL=1
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "✓ 未发现凭据泄露，可以继续"
  exit 0
fi

echo
echo "处理建议："
echo "  1) 未提交的：删掉或换成占位符，重新 add"
echo "  2) 已提交的：不要改写历史（违反规则四），先轮换该密钥作废，再清理文件"
exit 1
