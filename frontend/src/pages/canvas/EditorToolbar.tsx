/** 画布编辑器 · 顶栏（看板切换 / AI 与编辑功能区 / 页面页签 / 预览保存发布） */

import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction, SetURLSearchParams } from "react-router-dom";
import { formatChinaTime } from "../../utils/time";
import {
  Box, Button, Chip, CircularProgress, Divider, IconButton, TextField, Typography,
} from "@mui/material";
import {
  AlignHorizontalCenter, AlignHorizontalLeft, AlignHorizontalRight,
  AlignVerticalBottom, AlignVerticalCenter, AlignVerticalTop,
  AutoAwesome, CloudUpload, CropFree, CropSquare, ExpandMore,
  Redo, Save, TextFields, Title as TitleIcon, Tune, Undo, Visibility,
} from "@mui/icons-material";

import AiLayoutBar, { type LayoutOp } from "../../features/components/editor/AiLayoutBar";
import { ShapeIcon } from "../../features/components/shapes";
import type { ComponentItem, ComponentKind, ShapeKind } from "../../features/components/types";
import type { CanvasItem } from "../../features/components/boardTypes";
import type { DashboardDoc } from "../../features/components/types";
import { ALIGN_ACTIONS } from "./spec";
import { DistributeIcon } from "./controls";
import PageTabs, { type EditingPage, type PageMenuState } from "./PageTabs";
import type { DashboardBrief } from "./spec";

type InsertPayload =
  | { type: "chart"; kind: ComponentKind; component?: ComponentItem; label: string }
  | { type: "element"; element: "heading" | "text" | "divider" | "filter" | "board"; label: string }
  | { type: "shape"; shape: ShapeKind; label: string };

export default function EditorToolbar({
  nav, recentDocs, docId, renaming, renameDraft, setRenameDraft, setRenaming, commitRename, setSearch,
  items, selectedKeys, designWidth, fullWidthKinds, applyAiLayout, undo, redo, canUndo, canRedo,
  recommendBusy, insertRecommended, alignSelection, distributeSelection, beginInsertDrag, addElement,
  setShapeAnchor, bleedMask, setBleedMask,
  doc, view, editingPage, setEditingPage, commitPageRename, switchView, setPageMenu, addPage,
  dirty, params, handleSave, handlePublish, saving,
}: {
  nav: NavigateFunction;
  recentDocs: DashboardBrief[];
  docId: number;
  renaming: boolean;
  renameDraft: string;
  setRenameDraft: (v: string) => void;
  setRenaming: (v: boolean) => void;
  commitRename: () => Promise<void>;
  setSearch: SetURLSearchParams;
  items: CanvasItem[];
  selectedKeys: string[];
  designWidth: number;
  fullWidthKinds: ComponentKind[];
  applyAiLayout: (ops: LayoutOp[]) => void;
  undo: (step?: number) => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  recommendBusy: boolean;
  insertRecommended: () => Promise<void>;
  alignSelection: (mode: (typeof ALIGN_ACTIONS)[number]["mode"]) => void;
  distributeSelection: (axis: "x" | "y") => void;
  beginInsertDrag: (payload: InsertPayload) => (event: React.PointerEvent) => void;
  addElement: (type: "heading" | "text" | "divider" | "filter" | "board", at?: { x: number; y: number }) => void;
  setShapeAnchor: (v: HTMLElement | null) => void;
  bleedMask: boolean;
  setBleedMask: Dispatch<SetStateAction<boolean>>;
  doc: DashboardDoc | null;
  view: string;
  editingPage: EditingPage;
  setEditingPage: (v: EditingPage) => void;
  commitPageRename: () => void;
  switchView: (key: string) => void;
  setPageMenu: (v: PageMenuState) => void;
  addPage: () => void;
  dirty: boolean;
  params: Record<string, unknown>;
  handleSave: () => void;
  handlePublish: () => void;
  saving: "save" | "publish" | null;
}) {
  return (
    <>
      {/* 顶栏 */}
      <Box sx={{
        position: "relative", px: 2, height: 52, display: "flex", alignItems: "center", gap: 1,
        bgcolor: "#fff", borderBottom: "1px solid #EEF3FB",
        minWidth: 0, overflowX: "auto", "&::-webkit-scrollbar": { display: "none" },
      }}>
        <Typography onClick={() => nav("/bi/projects")}
          sx={{ fontSize: 12.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
          ← 项目
        </Typography>
        <Box sx={{ width: 8, flexShrink: 0 }} />
        {/* 看板 chip 次要：窄屏先收起，把位置让给页面 */}
        <Box sx={{ display: { xs: "none", xl: "flex" }, alignItems: "center", gap: 1, minWidth: 0, overflow: "hidden", flexShrink: 1 }}>
        {recentDocs.map((d) => (renaming && d.id === docId ? (
          <TextField
            key={d.id}
            size="small"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => { void commitRename(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { void commitRename(); }
              if (e.key === "Escape") { setRenaming(false); }
            }}
            placeholder="项目名称"
            sx={{
              width: 132, flexShrink: 0,
              "& .MuiOutlinedInput-root": { height: 26, borderRadius: 999, fontSize: 11, bgcolor: "#fff" },
              "& .MuiOutlinedInput-input": { py: 0, px: 1.25 },
            }}
          />
        ) : (
          <Chip key={d.id} size="small" label={d.name}
            title={d.id === docId
              ? "点击改名"
              : (d.updated_at ? `最近编辑 ${formatChinaTime(d.updated_at).slice(0, 16)}` : undefined)}
            onDoubleClick={() => { if (d.id === docId) { setRenameDraft(d.name); setRenaming(true); } }}
            onClick={() => {
              if (d.id === docId) { setRenameDraft(d.name); setRenaming(true); return; }
              setSearch({ doc: String(d.id) });
            }}
            sx={{
              fontSize: 11, height: 24,
              bgcolor: d.id === docId ? "rgba(79,70,229,0.1)" : "#fff",
              color: d.id === docId ? "#4F46E5" : "#64748B",
              border: "1px solid", borderColor: d.id === docId ? "rgba(79,70,229,0.35)" : "#E8EEF8",
              cursor: d.id === docId ? "text" : "pointer",
            }} />
        )))}
        </Box>
        <Box sx={{ flex: 1, minWidth: 12 }} />

        {/* 编辑功能区（可拖到画布）：放在文档 chip 与右侧操作之间居中，窄屏也不会压到 chip */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
          <AiLayoutBar
            items={items}
            selectedKeys={selectedKeys}
            designWidth={designWidth}
            fullWidthKinds={fullWidthKinds}
            onApply={applyAiLayout}
            onUndo={undo}
          />
          {/* AI 推荐组件：按当前数据集字段推荐并插入（与「AI 整理」同色系，避免两个功能区两种视觉） */}
          <Button
            size="small"
            disabled={recommendBusy || !doc}
            onClick={() => void insertRecommended()}
            startIcon={recommendBusy
              ? <CircularProgress size={13} color="inherit" />
              : <AutoAwesome sx={{ fontSize: 16 }} />}
            title="按当前数据集的字段推荐组件"
            sx={{
              textTransform: "none", fontSize: 11.5, height: 26, minWidth: 0, px: 1,
              borderRadius: 1.25, color: "#4F46E5", bgcolor: "rgba(79,70,229,0.08)",
              "&:hover": { bgcolor: "rgba(79,70,229,0.14)" },
              "&.Mui-disabled": { color: "#B6B6BF", bgcolor: "transparent" },
            }}
          >
            {recommendBusy ? "推荐中" : "推荐组件"}
          </Button>
          {/* 多选对齐（选中 ≥2 个才出现）：6 向对齐 + 两种等间距，两端固定 */}
          {selectedKeys.length >= 2 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, mr: 0.25 }}>
              {ALIGN_ACTIONS.map((action, index) => (
                <Box key={action.mode} sx={{ display: "flex", alignItems: "center" }}>
                  {index === 3 && <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 0.25, borderColor: "#EEF3FB" }} />}
                  <IconButton
                    size="small"
                    title={action.tip}
                    aria-label={action.tip}
                    onClick={() => alignSelection(action.mode)}
                    sx={{
                      width: 26, height: 26, borderRadius: 1.25, color: "#334155",
                      "&:hover": { bgcolor: "rgba(15,23,42,0.05)" },
                    }}
                  >
                    {action.mode === "left" && <AlignHorizontalLeft sx={{ fontSize: 17 }} />}
                    {action.mode === "hcenter" && <AlignHorizontalCenter sx={{ fontSize: 17 }} />}
                    {action.mode === "right" && <AlignHorizontalRight sx={{ fontSize: 17 }} />}
                    {action.mode === "top" && <AlignVerticalTop sx={{ fontSize: 17 }} />}
                    {action.mode === "vcenter" && <AlignVerticalCenter sx={{ fontSize: 17 }} />}
                    {action.mode === "bottom" && <AlignVerticalBottom sx={{ fontSize: 17 }} />}
                  </IconButton>
                </Box>
              ))}
              <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 0.25, borderColor: "#EEF3FB" }} />
              {([{ axis: "x", tip: "水平等距（两端不动）" }, { axis: "y", tip: "垂直等距（两端不动）" }] as const).map((entry) => (
                <IconButton
                  key={entry.axis}
                  size="small"
                  title={selectedKeys.length >= 3 ? entry.tip : "选 3 个以上才能等距"}
                  aria-label={entry.axis === "x" ? "水平等距" : "垂直等距"}
                  disabled={selectedKeys.length < 3}
                  onClick={() => distributeSelection(entry.axis)}
                  sx={{
                    width: 26, height: 26, borderRadius: 1.25, color: "#334155",
                    "&:hover": { bgcolor: "rgba(15,23,42,0.05)" },
                    "&.Mui-disabled": { color: "#CBD5E1" },
                  }}
                >
                  <DistributeIcon axis={entry.axis} />
                </IconButton>
              ))}
              <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 0.5, borderColor: "#EEF3FB" }} />
            </Box>
          )}
          {([
            { type: "heading", label: "标题", icon: <TitleIcon sx={{ fontSize: 16 }} /> },
            { type: "text", label: "文字", icon: <TextFields sx={{ fontSize: 16 }} /> },
          ] as const).map((entry) => (
            <Button
              key={entry.type}
              size="small"
              onPointerDown={beginInsertDrag({ type: "element", element: entry.type, label: entry.label })}
              onClick={() => addElement(entry.type)}
              startIcon={entry.icon}
              sx={{ textTransform: "none", fontSize: 12, color: "#334155", cursor: "grab", minWidth: 0, px: 1 }}
            >
              {entry.label}
            </Button>
          ))}

          {/* 矩形：PS 式形状下拉（点开选形状，选中即加到视口中央；画布上可任意拖动 / 拉大小） */}
          <Button
            size="small"
            onClick={(event) => setShapeAnchor(event.currentTarget)}
            startIcon={<ShapeIcon kind="rect" size={15} />}
            endIcon={<ExpandMore sx={{ fontSize: 14 }} />}
            sx={{
              textTransform: "none", fontSize: 12, color: "#334155", minWidth: 0, px: 1,
              "& .MuiButton-endIcon": { ml: 0.25 },
            }}
          >
            矩形
          </Button>

          <Button
            size="small"
            onPointerDown={beginInsertDrag({ type: "element", element: "filter", label: "筛选栏" })}
            onClick={() => addElement("filter")}
            startIcon={<Tune sx={{ fontSize: 16 }} />}
            sx={{ textTransform: "none", fontSize: 12, color: "#334155", cursor: "grab", minWidth: 0, px: 1 }}
          >
            筛选栏
          </Button>

          <Button
            size="small"
            onPointerDown={beginInsertDrag({ type: "element", element: "board", label: "画板" })}
            onClick={() => addElement("board")}
            startIcon={<CropSquare sx={{ fontSize: 15 }} />}
            sx={{ textTransform: "none", fontSize: 12, color: "#334155", cursor: "grab", minWidth: 0, px: 1 }}
          >
            画板
          </Button>

          <Divider orientation="vertical" flexItem sx={{ my: 1.75, mx: 0.5, borderColor: "#EEF3FB" }} />

          {/* 视图开关：画布外左右溢出区盖一层浅灰 */}
          <Button
            size="small"
            aria-pressed={bleedMask}
            title="画布外左右溢出区"
            onClick={() => setBleedMask((prev) => !prev)}
            startIcon={<CropFree sx={{ fontSize: 16 }} />}
            sx={{
              textTransform: "none", fontSize: 12, minWidth: 0, px: 1,
              color: bleedMask ? "#4F46E5" : "#334155",
              bgcolor: bleedMask ? "rgba(79,70,229,0.08)" : "transparent",
              "&:hover": { bgcolor: bleedMask ? "rgba(79,70,229,0.12)" : "rgba(15,23,42,0.04)" },
            }}
          >
            溢出区
          </Button>

          <Divider orientation="vertical" flexItem sx={{ my: 1.75, mx: 0.5, borderColor: "#EEF3FB" }} />

          {/* 撤销 / 重做 */}
          <IconButton
            size="small"
            title="撤销（⌘Z）"
            aria-label="撤销"
            disabled={!canUndo}
            onClick={() => undo()}
            sx={{
              width: 28, height: 28, borderRadius: 1.5, color: "#334155",
              "&:hover": { bgcolor: "rgba(15,23,42,0.04)" },
              "&.Mui-disabled": { color: "#CBD5E1" },
            }}
          >
            <Undo sx={{ fontSize: 17 }} />
          </IconButton>
          <IconButton
            size="small"
            title="重做（⇧⌘Z）"
            aria-label="重做"
            disabled={!canRedo}
            onClick={() => redo()}
            sx={{
              width: 28, height: 28, borderRadius: 1.5, color: "#334155",
              "&:hover": { bgcolor: "rgba(15,23,42,0.04)" },
              "&.Mui-disabled": { color: "#CBD5E1" },
            }}
          >
            <Redo sx={{ fontSize: 17 }} />
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, minWidth: 12 }} />

        {doc && (
          <PageTabs
            doc={doc}
            view={view}
            editingPage={editingPage}
            setEditingPage={setEditingPage}
            commitPageRename={commitPageRename}
            switchView={switchView}
            setPageMenu={setPageMenu}
            addPage={addPage}
          />
        )}
        {dirty && <Typography sx={{ fontSize: 11.5, color: "#F59E0B", mr: 1, whiteSpace: "nowrap", flexShrink: 0 }}>未保存</Typography>}
        <Button size="small" startIcon={<Visibility sx={{ fontSize: 15 }} />}
          onClick={() => {
            /* 预览 = 打开发布后的样子：**不塞 view**，让预览页按「首视页」落地
               （塞了 view 就会盖掉首视页，用户改首视页会以为没生效）；
               要看看别的页，在预览里点导航菜单，或地址后加 ?view=页面ID。筛选值照样带上。 */
            const search = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
              if (value === undefined || value === null || value === "" || value === "all") return;
              if (Array.isArray(value)) {
                if (value.length) search.set(`p_${key}`, value.join(","));
              } else {
                search.set(`p_${key}`, String(value));
              }
            });
            nav(`/bi/dashboards/${docId}?${search.toString()}`);
          }}
          sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, whiteSpace: "nowrap", flexShrink: 0 }}>
          预览
        </Button>
        <Button size="small" variant="outlined" startIcon={<Save sx={{ fontSize: 15 }} />}
          disabled={!!saving || !doc || !dirty} onClick={handleSave}
          sx={{
            textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2,
            whiteSpace: "nowrap", flexShrink: 0,
            borderColor: "#D8E2F5", color: "#334155",
            "&:hover": { borderColor: "#B9C8E6", bgcolor: "rgba(79,70,229,0.04)" },
          }}>
          {saving === "save" ? "保存中…" : "保存"}
        </Button>
        <Button size="small" variant="contained" startIcon={<CloudUpload sx={{ fontSize: 15 }} />}
          disabled={!!saving || !doc} onClick={handlePublish}
          sx={{ bgcolor: "#4F46E5", textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2.5, whiteSpace: "nowrap", flexShrink: 0 }}>
          {saving === "publish" ? "发布中…" : "发布我的看板"}
        </Button>
      </Box>
    </>
  );
}
