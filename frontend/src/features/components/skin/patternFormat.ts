/** 明细表列的「格式」：d3/Plotly 风格的格式串（`,.1%` / `,.2f` / `,d` …）.
 *
 * 规则（从左到右）：
 *   `+`  正数带正号（负数仍有 -）
 *   `$`  前缀美元符号
 *   `,`  千分位分组
 *   `.N` 小数位
 *   `%`  百分比（值 <=1 视为比例 ×100，与整表「百分比」口径一致）
 *   `f`  定点小数；`d` 整数
 *
 * 例：`,.1%` → 1,234.5%（0.1234 这类比例会先 ×100）；`,d` → 1,235；`$,.1f` → $1,234.6
 */

/** 面板里内置的格式串（顺序即下拉顺序） */
export const COLUMN_FORMATS = [
  ",.1%",
  ",.2%",
  ",.1f",
  ",.2f",
  ",.3f",
  ",d",
  "+,.1%",
  "+,.2%",
  "$,.1f",
] as const;

const PATTERN = /^([+$]{0,2})(,?)(?:\.(\d))?(%|f|d)?$/;

export interface ParsedFormat {
  plus: boolean;
  currency: boolean;
  group: boolean;
  decimals: number;
  kind: "%" | "f" | "d" | "";
}

export function parseFormat(pattern: string | undefined | null): ParsedFormat | null {
  const text = String(pattern ?? "").trim();
  if (!text) return null;
  const match = PATTERN.exec(text);
  if (!match) return null;
  const [, flags, comma, decimals, kind] = match;
  // 只有 `,` 或只有 `+`（没有任何数值类型）不算格式，避免把脏值当格式用
  if (!kind && !decimals) return null;
  return {
    plus: flags.includes("+"),
    currency: flags.includes("$"),
    group: comma === ",",
    decimals: kind === "d" ? 0 : decimals ? Number(decimals) : 0,
    kind: (kind ?? "") as ParsedFormat["kind"],
  };
}

/** 按格式串排版；串不合法返回 null（调用方回落到整表格式） */
export function formatByPattern(value: number, pattern: string | undefined | null): string | null {
  const parsed = parseFormat(pattern);
  if (!parsed) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const scaled = parsed.kind === "%" && Math.abs(number) <= 1 ? number * 100 : number;
  const body = scaled.toLocaleString("zh-CN", {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
    useGrouping: parsed.group,
  });
  const sign = parsed.plus && scaled > 0 ? "+" : "";
  const currency = parsed.currency ? "$" : "";
  const suffix = parsed.kind === "%" ? "%" : "";
  return `${sign}${currency}${body}${suffix}`;
}

/** 下拉里显示的样例（百分比用 0.1234，其它用 1234.56，一眼看出效果） */
export function sampleOf(pattern: string): string {
  const isPercent = pattern.includes("%");
  return formatByPattern(isPercent ? 0.1234 : 1234.56, pattern) ?? pattern;
}
