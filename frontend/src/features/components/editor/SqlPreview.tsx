/** SQL 预览：格式化（子句换行 + 跳过缩进）+ 语法高亮 + 等宽字体，超宽可水平滚动 */

import { Box } from "@mui/material";

const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET", "HAVING",
  "AND", "OR", "NOT", "AS", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON",
  "SUM", "COUNT", "AVG", "MIN", "MAX", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END",
  "NULL", "DESC", "ASC", "IN", "LIKE", "BETWEEN", "IS", "UNION", "ALL",
]);

const TOKEN = /("[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|\b(?:SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|HAVING|AND|OR|NOT|AS|JOIN|LEFT|RIGHT|INNER|OUTER|ON|SUM|COUNT|AVG|MIN|MAX|DISTINCT|CASE|WHEN|THEN|ELSE|END|NULL|DESC|ASC|IN|LIKE|BETWEEN|IS|UNION|ALL)\b)/gi;

const CLAUSE = /^(SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/i;

/** 主句前换行；SELECT / WHERE 等子句内的逗号后换行并缩进两格 */
function formatSql(sql: string): string {
  const lines: string[] = [];
  const normalized = sql.replace(/\s+/g, " ").trim();
  const chunks = normalized.split(/\s+(?=(?:SELECT|FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b)/i);
  for (const chunk of chunks) {
    const text = chunk.trim();
    if (!text) continue;
    if (!CLAUSE.test(text)) {
      lines.push(text);
      continue;
    }
    // 子句关键字后面（SELECT / WHERE / GROUP BY …）的列表按逗号拆行，缩进两格
    const match = /^([A-Za-z\s]+?)\s+([\s\S]+)$/.exec(text);
    if (!match) {
      lines.push(text);
      continue;
    }
    const [, head, body] = match;
    const items = body.split(/,\s*/);
    if (items.length <= 1) {
      lines.push(`${head} ${body}`);
      continue;
    }
    lines.push(`${head} ${items[0]},`);
    items.slice(1).forEach((item, index) => {
      const last = index === items.length - 2;
      lines.push(`  ${item}${last ? "" : ","}`);
    });
  }
  return lines.join("\n");
}

export function SqlPreview({ sql }: { sql?: string }) {
  const text = formatSql(sql || "");
  const parts = text.split(TOKEN);
  return (
    <Box
      sx={{
        mb: 1.5, p: 1, borderRadius: 1.25, bgcolor: "#0F172A", color: "#CBD5E1",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12, lineHeight: 1.7,
        maxHeight: 180, overflow: "auto",
        whiteSpace: "pre", wordBreak: "normal",
        "&::-webkit-scrollbar": { width: 6, height: 6 },
        "&::-webkit-scrollbar-thumb": { bgcolor: "rgba(255,255,255,0.16)", borderRadius: 3 },
      }}
    >
      {parts.map((part, i) => {
        if (/^"/.test(part)) return <Box component="span" key={i} sx={{ color: "#93C5FD" }}>{part}</Box>;
        if (/^'/.test(part)) return <Box component="span" key={i} sx={{ color: "#86EFAC" }}>{part}</Box>;
        if (/^\d/.test(part)) return <Box component="span" key={i} sx={{ color: "#FCA5A5" }}>{part}</Box>;
        if (KEYWORDS.has(part.toUpperCase())) {
          return <Box component="span" key={i} sx={{ color: "#C4B5FD", fontWeight: 600 }}>{part}</Box>;
        }
        return <Box component="span" key={i}>{part}</Box>;
      })}
    </Box>
  );
}
