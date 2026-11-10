/**
 * TipTap 内联编辑器 — 工具栏在卡片内部，紧凑单行
 */
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import {
  FormatBold, FormatItalic, FormatUnderlined, StrikethroughS,
  FormatAlignLeft, FormatAlignCenter, FormatAlignRight,
} from "@mui/icons-material";
import { useEffect, forwardRef, useImperativeHandle } from "react";

export interface TipTapInlineHandle { getEditor: () => Editor | null; }
interface Props { content: string; onChange: (html: string) => void; editing: boolean; onCardAlign?: (dir: "left" | "center" | "right") => void; }

function ToolBtn({ icon, title, active, onClick }: {
  icon: React.ReactNode; title: string; active?: boolean; onClick: () => void;
}) {
  return (
    <Tooltip title={title} arrow>
      <IconButton size="small" onMouseDown={e => { e.preventDefault(); onClick(); }}
        sx={{
          color: active ? "#6366F1" : "#6B7280", p: 0.25,
          borderRadius: 0.75, "&:hover": { bgcolor: "rgba(99,102,241,0.08)" },
        }}>{icon}</IconButton>
    </Tooltip>
  );
}

const TipTapInline = forwardRef<TipTapInlineHandle, Props>(
  ({ content, onChange, editing, onCardAlign }, ref) => {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        UnderlineExt,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Placeholder.configure({ placeholder: "输入文本..." }),
      ],
      content, editable: editing,
      onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    });

    useImperativeHandle(ref, () => ({ getEditor: () => editor }));

    useEffect(() => {
      if (!editor) return;
      if (editing && editor.getHTML() !== content) editor.commands.setContent(content || "");
    }, [editing]); // eslint-disable-line

    useEffect(() => { if (editor) editor.setEditable(editing); }, [editing, editor]);

    if (!editor) return null;

    return (
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {/* ─── Format toolbar — inside card, compact ─── */}
        <Box sx={{
          display: "flex", alignItems: "center", gap: 0.25, px: 0.75, py: 0.15,
          borderBottom: "1px solid", borderColor: "divider", bgcolor: "#FAFBFC",
          flexWrap: "nowrap", overflow: "hidden",
        }}>
          <ToolBtn title="加粗" icon={<FormatBold sx={{ fontSize: 15 }} />} active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolBtn title="斜体" icon={<FormatItalic sx={{ fontSize: 15 }} />} active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolBtn title="下划线" icon={<FormatUnderlined sx={{ fontSize: 15 }} />} active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <ToolBtn title="删除线" icon={<StrikethroughS sx={{ fontSize: 15 }} />} active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()} />
          <Box sx={{ width: 1, bgcolor: "#E5E7EB", mx: 0.3, alignSelf: "stretch" }} />
          {([1, 2, 3] as const).map(lvl => (
            <ToolBtn key={lvl} title={`H${lvl}`} active={editor.isActive("heading", { level: lvl })}
              icon={<Typography sx={{ fontSize: 11, fontWeight: 700, width: 16, textAlign: "center" }}>H{lvl}</Typography>}
              onClick={() => editor.chain().focus().toggleHeading({ level: lvl }).run()} />
          ))}
          <Box sx={{ width: 1, bgcolor: "#E5E7EB", mx: 0.3, alignSelf: "stretch" }} />
          <ToolBtn title="靠左" active={editor.isActive({ textAlign: "left" })}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            icon={<svg width="18" height="18" viewBox="0 0 18 18"><rect x="1" y="3" width="10" height="3" rx="0.5" fill="#374151"/><rect x="1" y="8" width="14" height="3" rx="0.5" fill="#374151" opacity="0.3"/><rect x="1" y="13" width="7" height="3" rx="0.5" fill="#374151" opacity="0.1"/></svg>} />
          <ToolBtn title="居中" active={editor.isActive({ textAlign: "center" })}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            icon={<svg width="18" height="18" viewBox="0 0 18 18"><rect x="4" y="3" width="10" height="3" rx="0.5" fill="#374151"/><rect x="2" y="8" width="14" height="3" rx="0.5" fill="#374151" opacity="0.3"/><rect x="5" y="13" width="8" height="3" rx="0.5" fill="#374151" opacity="0.1"/></svg>} />
          <ToolBtn title="靠右" active={editor.isActive({ textAlign: "right" })}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            icon={<svg width="18" height="18" viewBox="0 0 18 18"><rect x="7" y="3" width="10" height="3" rx="0.5" fill="#374151"/><rect x="2" y="8" width="14" height="3" rx="0.5" fill="#374151" opacity="0.3"/><rect x="10" y="13" width="7" height="3" rx="0.5" fill="#374151" opacity="0.1"/></svg>} />
          <Box sx={{ width: 1, bgcolor: "#E5E7EB", mx: 0.3, alignSelf: "stretch" }} />
        </Box>

        {/* ─── Editor area ─── */}
        <Box onClick={() => editor.commands.focus()} sx={{ flex: 1,
          "& .ProseMirror": {
            height: "100%", overflow: "auto", outline: "none",
            padding: "8px 14px", fontSize: 13, lineHeight: 1.7, color: "#374151",
            "&:focus": { outline: "none" },
            "& p": { margin: "0.2em 0" },
            "& h1": { fontSize: 22, fontWeight: 800, margin: "0.2em 0" },
            "& h2": { fontSize: 17, fontWeight: 700, margin: "0.2em 0" },
            "& h3": { fontSize: 14, fontWeight: 600, margin: "0.2em 0" },
            "& ul, & ol": { paddingLeft: "1.5em", margin: "0.2em 0" },
            "& blockquote": { borderLeft: "3px solid #C7D2FE", paddingLeft: 12, color: "#6B7280", margin: "0.2em 0" },
            "& code": { background: "#F3F4F6", padding: "1px 5px", borderRadius: 4, fontSize: 12 },
            "& pre": { background: "#1E1E2E", color: "#E5E7EB", padding: 12, borderRadius: 6, fontSize: 12, overflow: "auto" },
            "& hr": { border: "none", borderTop: "1px solid #E5E7EB", margin: "0.3em 0" },
            "& p.is-editor-empty:first-of-type::before": { content: "attr(data-placeholder)", color: "#9CA3AF", float: "left", pointerEvents: "none", height: 0 },
          },
        }}>
          <EditorContent editor={editor} />
        </Box>
      </Box>
    );
  }
);

TipTapInline.displayName = "TipTapInline";
export default TipTapInline;
