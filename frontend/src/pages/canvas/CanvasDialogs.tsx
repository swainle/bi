/** 画布编辑器 · 浮层（行详情 / 删除确认 / 页面与形状菜单 / 参考线菜单 / 发布确认 / Toast） */

import { useState, type Dispatch, type SetStateAction } from "react";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  Menu, MenuItem, Snackbar, TextField, Typography,
} from "@mui/material";

import TopListDialog from "../../features/components/board/TopListDialog";
import { SHAPE_KINDS, SHAPE_LABEL, ShapeIcon } from "../../features/components/shapes";
import type { CanvasItem } from "../../features/components/boardTypes";
import type { CanvasSize, DashboardDoc, DocItem, Guide, ShapeKind } from "../../features/components/types";
import type { RenderPayload, SortDir } from "../../features/components/types";
import type { EditingPage, PageMenuState } from "./PageTabs";
import { validBoardSize } from "./boardResize";

export type ToastState = { open: boolean; msg: string; severity: "success" | "error" };
export type DeleteConfirm = { keys: string[]; platforms: string[] } | null;
export type GuideMenuState = { x: number; y: number; id?: string; boardKey?: string } | null;

export default function CanvasDialogs({
  topKey, setTopKey, topSort, setTopSort, docId, view, params, items, toDocItem, cards,
  deleteConfirm, setDeleteConfirm, removeItems,
  pageMenu, setPageMenu, doc, setEditingPage, duplicatePage, copyText, setToast, deletePage,
  shapeAnchor, setShapeAnchor, addShape,
  guideMenu, setGuideMenu, removeGuide, guidesVisible, setGuidesVisible, guides, setGuides, setDirty,
  publishConfirm, setPublishConfirm, persist, saving, agentGenerated, toast, patchItem, canvasSize, onResizeCanvas,
}: {
  topKey: string | null;
  setTopKey: (v: string | null) => void;
  /** 徽标弹窗的默认排序（只在弹窗内生效，关闭即恢复） */
  topSort: { field: string; sort: SortDir } | null;
  setTopSort: (v: { field: string; sort: SortDir } | null) => void;
  docId: number;
  view: string;
  params: Record<string, unknown>;
  items: CanvasItem[];
  toDocItem: (item: CanvasItem) => DocItem;
  /** 看板渲染结果（徽标弹窗直接显示指定明细表） */
  cards: Record<string, RenderPayload>;
  deleteConfirm: DeleteConfirm;
  setDeleteConfirm: (v: DeleteConfirm) => void;
  removeItems: (keys: string[]) => void;
  pageMenu: PageMenuState;
  setPageMenu: (v: PageMenuState) => void;
  doc: DashboardDoc | null;
  setEditingPage: (v: EditingPage) => void;
  duplicatePage: (key: string) => void;
  copyText: (text: string) => void;
  setToast: Dispatch<SetStateAction<ToastState>>;
  deletePage: (key: string) => void;
  shapeAnchor: HTMLElement | null;
  setShapeAnchor: (v: HTMLElement | null) => void;
  addShape: (kind: ShapeKind) => void;
  guideMenu: GuideMenuState;
  setGuideMenu: (v: GuideMenuState) => void;
  removeGuide: (id: string) => void;
  guidesVisible: boolean;
  setGuidesVisible: Dispatch<SetStateAction<boolean>>;
  guides: Guide[];
  setGuides: (v: Guide[]) => void;
  setDirty: (v: boolean) => void;
  publishConfirm: boolean;
  setPublishConfirm: (v: boolean) => void;
  persist: (publish: boolean) => Promise<boolean>;
  saving: "save" | "publish" | null;
  agentGenerated: boolean;
  toast: ToastState;
  patchItem: (key: string, patch: Partial<CanvasItem>) => void;
  canvasSize: CanvasSize;
  onResizeCanvas: (size: CanvasSize) => void;
}) {
  const [resizeBoard, setResizeBoard] = useState<{ key: string; name: string; width: string; height: string } | null>(null);
  const menuBoard = items.find((item) => item.key === guideMenu?.boardKey && item.type === "board");
  const widthValid = !!resizeBoard && validBoardSize(resizeBoard.width);
  const heightValid = !!resizeBoard && validBoardSize(resizeBoard.height);
  return (
    <>
      {/* 删除筛选栏确认：它绑了平台时，删掉会让这些平台的筛选失效 */}
      {topKey && (
        <TopListDialog
          open
          onClose={() => { setTopKey(null); setTopSort(null); }}
          payload={cards[topKey] ?? null}
          sortField={topSort?.field ?? ""}
          sort={topSort?.sort ?? ""}
        />
      )}

      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700, pb: 1 }}>删除筛选栏</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "text.secondary", lineHeight: 1.7 }}>
            这个筛选栏绑定了平台：{deleteConfirm?.platforms.join("、")}。
            删除后这些平台的筛选条件会失效，看板只剩未筛选的数据。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteConfirm(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button color="error" variant="contained" sx={{ textTransform: "none", borderRadius: 2 }}
            onClick={() => { removeItems(deleteConfirm?.keys ?? []); setDeleteConfirm(null); }}>
            删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 页面右键菜单：重命名 / 复制 / 删除 */}
      <Menu
        open={!!pageMenu}
        onClose={() => setPageMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={pageMenu ? { top: pageMenu.y, left: pageMenu.x } : undefined}
        slotProps={{ paper: { sx: { minWidth: 148, borderRadius: 2 } } }}
      >
        <MenuItem sx={{ fontSize: 12.5 }} onClick={() => {
          const target = doc?.views.find((v) => v.key === pageMenu?.key);
          if (pageMenu && target) setEditingPage({ key: pageMenu.key, draft: target.title || target.key });
          setPageMenu(null);
        }}>
          重命名
        </MenuItem>
        <MenuItem sx={{ fontSize: 12.5 }} onClick={() => { if (pageMenu) duplicatePage(pageMenu.key); setPageMenu(null); }}>
          复制页面
        </MenuItem>
        <MenuItem sx={{ fontSize: 12.5 }} onClick={() => {
          if (pageMenu) {
            copyText(pageMenu.key);
            setToast({ open: true, msg: "已复制页面 ID", severity: "success" });
          }
          setPageMenu(null);
        }}>
          复制页面 ID
        </MenuItem>
        <MenuItem
          sx={{ fontSize: 12.5, color: (doc?.views.length ?? 1) > 1 ? "#B91C1C" : undefined }}
          disabled={(doc?.views.length ?? 1) <= 1}
          onClick={() => { if (pageMenu) deletePage(pageMenu.key); setPageMenu(null); }}
        >
          删除页面
        </MenuItem>
      </Menu>

      <Menu
        open={Boolean(shapeAnchor)}
        anchorEl={shapeAnchor}
        onClose={() => setShapeAnchor(null)}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 132, py: 0.5 } } }}
      >
        {SHAPE_KINDS.map((kind) => (
          <MenuItem
            key={kind}
            dense
            onClick={() => { addShape(kind); setShapeAnchor(null); }}
            sx={{ fontSize: 12.5, gap: 1.25, color: "#334155" }}
          >
            <ShapeIcon kind={kind} size={16} />
            {SHAPE_LABEL[kind]}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        open={Boolean(guideMenu)}
        onClose={() => setGuideMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={guideMenu ? { top: guideMenu.y, left: guideMenu.x } : undefined}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 148 } } }}
      >
        {guideMenu?.id ? (
          <MenuItem
            dense
            onClick={() => { removeGuide(guideMenu.id!); setGuideMenu(null); }}
            sx={{ fontSize: 12.5 }}
          >
            删除这条参考线
          </MenuItem>
        ) : [
          <MenuItem key="resize-canvas" dense sx={{ fontSize: 12.5 }} onClick={() => {
            setResizeBoard({ key: "", name: "当前页面画布", width: String(Math.round(canvasSize.width)), height: String(Math.round(canvasSize.height)) });
            setGuideMenu(null);
          }}>调整画布大小…</MenuItem>,
          menuBoard && <MenuItem key="resize-board" dense sx={{ fontSize: 12.5 }} onClick={() => {
            setResizeBoard({ key: menuBoard.key, name: menuBoard.text || "画板", width: String(Math.round(menuBoard.w)), height: String(Math.round(menuBoard.h)) });
            setGuideMenu(null);
          }}>调整画板大小…</MenuItem>,
          <MenuItem
            key="toggle"
            dense
            onClick={() => { setGuidesVisible((v) => !v); setGuideMenu(null); }}
            sx={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 3 }}
          >
            {guidesVisible ? "隐藏参考线" : "显示参考线"}
            <Box component="span" sx={{ fontSize: 11, color: "text.disabled" }}>
              {navigator.platform.includes("Mac") ? "⌘H" : "Ctrl+H"}
            </Box>
          </MenuItem>,
          <Divider key="d1" sx={{ my: 0.5 }} />,
          <MenuItem
            key="clear"
            dense
            disabled={guides.length === 0}
            onClick={() => { setGuides([]); setDirty(true); setGuideMenu(null); }}
            sx={{ fontSize: 12.5 }}
          >
            清除全部参考线
          </MenuItem>,
        ]}
      </Menu>

      <Dialog open={!!resizeBoard} onClose={() => setResizeBoard(null)} maxWidth="xs" fullWidth aria-labelledby="resize-board-title">
        <Box component="form" onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          if (!resizeBoard || !widthValid || !heightValid) return;
          if (!resizeBoard.key) {
            onResizeCanvas({ width: Number(resizeBoard.width), height: Number(resizeBoard.height) });
          } else if (items.some((item) => item.key === resizeBoard.key && item.type === "board")) {
            patchItem(resizeBoard.key, { w: Number(resizeBoard.width), h: Number(resizeBoard.height) });
          }
          setResizeBoard(null);
        }}>
          <DialogTitle id="resize-board-title">{resizeBoard?.key ? "调整画板大小" : "调整画布大小"}</DialogTitle>
          <DialogContent sx={{ pt: "8px !important" }}>
            <Typography sx={{ mb: 2, fontSize: 13, color: "text.secondary" }}>{resizeBoard?.name} · 仅调整边界，组件位置和大小保持不变</Typography>
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField autoFocus required fullWidth label="宽度（px）" type="number" value={resizeBoard?.width ?? ""}
                inputProps={{ min: 160, step: 1 }} error={!!resizeBoard && !widthValid}
                helperText="至少 160 px，整数" onChange={(event) => setResizeBoard((prev) => prev && { ...prev, width: event.target.value })} />
              <TextField required fullWidth label="高度（px）" type="number" value={resizeBoard?.height ?? ""}
                inputProps={{ min: 160, step: 1 }} error={!!resizeBoard && !heightValid}
                helperText="至少 160 px，整数" onChange={(event) => setResizeBoard((prev) => prev && { ...prev, height: event.target.value })} />
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setResizeBoard(null)}>取消</Button>
            <Button type="submit" variant="contained" disabled={!widthValid || !heightValid}>确定</Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* 发布二次确认：草稿转正必须用户自己点 */}
      <Dialog open={publishConfirm} onClose={() => setPublishConfirm(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>发布这个看板？</DialogTitle>
        <DialogContent sx={{ pt: "6px !important" }}>
          <Typography sx={{ fontSize: 13, color: "#4B5563", lineHeight: 1.7 }}>
            {agentGenerated
              ? "这是 Agent 生成的草稿。发布会把它转成正式看板，请确认内容与数据都正确。"
              : "发布后这份看板会出现在「我的看板」。"}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setPublishConfirm(false)}
            sx={{ textTransform: "none", fontSize: 13, color: "#86868B" }}>再看看</Button>
          <Button variant="contained" disabled={!!saving}
            onClick={() => { setPublishConfirm(false); void persist(true); }}
            sx={{ textTransform: "none", fontSize: 13, borderRadius: 2, bgcolor: "#4F46E5", boxShadow: "none" }}>
            确认发布
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={toast.open} autoHideDuration={2400}
        onClose={() => setToast((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={toast.severity} sx={{ borderRadius: 2 }}>{toast.msg}</Alert>
      </Snackbar>
    </>
  );
}
