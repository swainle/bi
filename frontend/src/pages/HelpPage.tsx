import { Children, isValidElement, useEffect, useRef, type ReactNode } from "react";
import { Box, Link, List, ListItemButton, ListItemText, Typography } from "@mui/material";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const sources = import.meta.glob<string>("../../../docs/help/*.md", {
  query: "?raw", import: "default", eager: true,
});
const pages = Object.entries(sources).map(([path, content]) => ({
  slug: path.split("/").pop()!.replace(/\.md$/, ""),
  title: content.match(/^#\s+(.+)$/m)?.[1] || path,
  content,
})).sort((a, b) => a.slug === "index" ? -1 : b.slug === "index" ? 1 : a.slug.localeCompare(b.slug));

function headingText(children: ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child)
    ? headingText(child.props.children) : String(child)).join("");
}

export function headingId(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
}

export function helpHref(href: string | undefined): string | undefined {
  if (!href || /^(?:[a-z]+:|\/|#)/i.test(href)) return href;
  return href.replace(/^(?:\.\/)?([\w-]+)\.md(?=#|$)/, "/help/$1");
}

export default function HelpPage() {
  const { slug = "index" } = useParams();
  const { hash } = useLocation();
  const articleRef = useRef<HTMLElement>(null);
  const page = pages.find((item) => item.slug === slug);
  useEffect(() => {
    if (!hash) { articleRef.current?.scrollTo(0, 0); return; }
    try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView(); }
    catch { /* 不合法的外部锚点不影响文档阅读。 */ }
  }, [slug, hash]);

  const heading = (tag: "h1" | "h2" | "h3" | "h4"): Components[typeof tag] => ({ children }) => (
    <Box component={tag} id={tag === "h1" ? slug : headingId(headingText(children))}
      sx={{ scrollMarginTop: 16 }}>{children}</Box>
  );
  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0, gap: 3, flexDirection: { xs: "column", md: "row" } }}>
      <Box component="nav" aria-label="使用说明目录" sx={{ width: { md: 220 }, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 1 }}>使用说明</Typography>
        <List dense disablePadding sx={{ display: { xs: "flex", md: "block" }, flexWrap: "wrap" }}>
          {pages.map((item) => <ListItemButton key={item.slug} component={RouterLink}
            to={`/help/${item.slug}`} selected={slug === item.slug} sx={{ borderRadius: "12px" }}>
            <ListItemText primary={item.title} />
          </ListItemButton>)}
        </List>
      </Box>
      <Box component="article" ref={articleRef} sx={{
        flex: 1, minWidth: 0, overflow: "auto", px: { xs: 0, md: 3 }, pb: 4, lineHeight: 1.8,
        "& h1": { fontSize: 26, mt: 0 }, "& h2": { fontSize: 20, mt: 4 }, "& h3": { fontSize: 17 },
        "& pre": { p: 2, bgcolor: "action.hover", borderRadius: "12px", overflowX: "auto", lineHeight: 1.6 },
        "& code": { fontFamily: "ui-monospace, monospace", fontSize: "0.9em", overflowWrap: "anywhere" },
        "& table": { borderCollapse: "collapse", width: "100%", fontSize: 13 },
        "& th, & td": { border: "1px solid #EEF3FB", p: 1, textAlign: "left" },
        "& th": { bgcolor: "action.hover" },
        "& blockquote": { ml: 0, pl: 2, borderLeft: "3px solid #D8E2F5", color: "text.secondary" },
      }}>
        {page ? <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
          h1: heading("h1"), h2: heading("h2"), h3: heading("h3"), h4: heading("h4"),
          a: ({ href, children }) => <Link href={helpHref(href)}>{children}</Link>,
          table: ({ children }) => <Box sx={{ overflowX: "auto" }}><table>{children}</table></Box>,
        }}>{page.content}</Markdown> : <>
          <Typography variant="h6">文档不存在</Typography>
          <Link component={RouterLink} to="/help">返回使用说明</Link>
        </>}
      </Box>
    </Box>
  );
}
