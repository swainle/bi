/** 组件库（列表页）—— 卡片墙；右上「新建项目」直达画布编辑器 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Chip, IconButton, InputAdornment, Snackbar, Alert, TextField, Typography,
} from "@mui/material";
import { Add, Download, Search, UploadFile } from "@mui/icons-material";
import { exportComponent, importComponentFile } from "../componentFile";
import client from "../../../api/client";
import PreviewThumb from "../board/PreviewThumb";
import ComponentPreviewDialog from "../board/ComponentPreviewDialog";
import type { RenderPayload } from "../types";
import { KIND_LABEL } from "../registry";
import { accentOf } from "../palette";
import type { ComponentItem } from "../types";

export default function ComponentLibraryPage() {
  const nav = useNavigate();
  const [items, setItems] = useState<ComponentItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, RenderPayload>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 点卡片放大查看的组件 */
  const [previewItem, setPreviewItem] = useState<ComponentItem | null>(null);
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: "success" | "error" }>({ open: false, msg: "", severity: "success" });

  const load = useCallback(async () => {
    const res = await client.get("/bi/components", {
      params: { q: keyword || undefined, category: category || undefined },
    });
    setItems(res.data?.components || []);
    setCategories(res.data?.categories || []);
  }, [keyword, category]);

  useEffect(() => { load().catch(() => setItems([])); }, [load]);

  /** 导入组件 JSON：后端按物理表 / 名称找回本地数据集 */
  const importFile = async (file: File) => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await importComponentFile(file);
      await load();
      setToast({
        open: true, severity: "success",
        msg: result.dataset_matched || !result.dataset_name
          ? `已导入「${result.name}」`
          : `已导入「${result.name}」，但本机没有数据集「${result.dataset_name}」，绑定已清空`,
      });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast({ open: true, msg: detail || (err as Error).message || "导入失败", severity: "error" });
    } finally {
      setImporting(false);
    }
  };

  /** 「新建项目」= 建一块空看板，直接进编辑设计（画布） */
  const createProject = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await client.post("/bi/dashboards", {});
      const id = res.data?.id as number | undefined;
      if (!id) throw new Error("no id");
      nav(`/bi/canvas?doc=${id}`);
    } catch {
      setToast({ open: true, msg: "新建项目失败", severity: "error" });
      setCreating(false);
    }
  };

  // 卡片墙预览：一次批量渲染（单张失败不影响整体）
  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    client.post("/bi/components/preview-batch", {
      items: items.map((it) => ({ key: String(it.id), kind: it.kind, spec: it.spec })),
    }).then((res) => {
      if (alive) setPreviews(res.data?.cards || {});
    }).catch(() => {});
    return () => { alive = false; };
  }, [items]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, bgcolor: "#F7F9FD" }}>
      <Box sx={{
        px: 3, py: 1.5, display: "flex", alignItems: "center", gap: 2,
        bgcolor: "#fff", borderBottom: "1px solid #EEF3FB",
      }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>组件库</Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.disabled" }}>
          {items.length} 个卡片 · 分类按图表类型
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="text" size="small" onClick={() => nav("/bi")}
          sx={{ textTransform: "none", fontSize: 12.5, color: "#475569", mr: 0.5 }}
        >
          我的看板
        </Button>
        <input
          ref={fileRef} type="file" accept="application/json,.json" hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
        <Button
          variant="outlined" size="small" startIcon={<UploadFile sx={{ fontSize: 15 }} />}
          onClick={() => fileRef.current?.click()} disabled={importing}
          sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, mr: 0.5, borderColor: "#D8E2F5", color: "#475569" }}
        >
          {importing ? "导入中…" : "导入"}
        </Button>
        <Button
          variant="contained" size="small" startIcon={<Add sx={{ fontSize: 16 }} />}
          onClick={createProject} disabled={creating}
          sx={{ bgcolor: "#4F46E5", textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2.5 }}
        >
          {creating ? "创建中…" : "新建项目"}
        </Button>
      </Box>

      <Box sx={{
        px: 3, py: 1.25, display: "flex", alignItems: "center", gap: 1.25,
        bgcolor: "#fff", borderBottom: "1px solid #EEF3FB", flexWrap: "wrap",
      }}>
        <TextField
          size="small" placeholder="搜索组件"
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 16, color: "text.disabled" }} />
              </InputAdornment>
            ),
          }}
          sx={{ width: 240, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5, bgcolor: "#fff" } }}
        />
        {["", ...categories].map((cat) => {
          const active = category === cat;
          return (
            <Chip
              key={cat || "all"} label={cat || "全部"} size="small"
              onClick={() => setCategory(cat)}
              sx={{
                fontSize: 11.5, height: 24, cursor: "pointer",
                bgcolor: active ? "rgba(99,102,241,0.1)" : "#fff",
                color: active ? "#4F46E5" : "text.secondary",
                border: "1px solid",
                borderColor: active ? "rgba(99,102,241,0.3)" : "#EEF3FB",
                fontWeight: active ? 600 : 400,
              }}
            />
          );
        })}
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
        {items.length === 0 ? (
          <Box sx={{ py: 10, textAlign: "center" }}>
            <Typography sx={{ fontSize: 13, color: "text.disabled" }}>还没有组件</Typography>
          </Box>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", gap: 1.75 }}>
            {items.map((item) => {
              const token = accentOf(item.spec.ui?.accent);
              return (
                <Box
                  key={item.id}
                  onClick={() => setPreviewItem(item)}
                  sx={{
                    position: "relative",
                    bgcolor: "#fff", border: "1px solid #EEF3FB", borderRadius: 3,
                    p: 1.75, cursor: "zoom-in", transition: "all .16s",
                    "&:hover": {
                      borderColor: token.border,
                      boxShadow: "0 10px 26px -18px rgba(15,23,42,0.45)",
                      transform: "translateY(-1px)",
                      "& .export-btn": { opacity: 1 },
                    },
                  }}
                >
                  {/* 导出成 JSON（hover 才出现，不抢点击卡片预览的手感） */}
                  <IconButton
                    className="export-btn"
                    title="导出为组件文件"
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      void exportComponent(item.id, item.name)
                        .then(() => setToast({ open: true, msg: `已导出「${item.name}」`, severity: "success" }))
                        .catch(() => setToast({ open: true, msg: "导出失败", severity: "error" }));
                    }}
                    sx={{
                      position: "absolute", top: 8, right: 8, zIndex: 2,
                      width: 26, height: 26, opacity: 0, transition: "opacity .14s",
                      bgcolor: "rgba(255,255,255,0.92)", border: "1px solid #EEF3FB",
                      "&:hover": { bgcolor: "#fff" },
                    }}
                  >
                    <Download sx={{ fontSize: 15, color: "#64748B" }} />
                  </IconButton>
                  <Box sx={{
                    mb: 1.25, borderRadius: 2, overflow: "hidden",
                    border: "1px solid #F1F5F9", bgcolor: "#FCFDFF",
                  }}>
                    <PreviewThumb item={item} payload={previews[String(item.id)]} height={178} />
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                    <Typography sx={{
                      fontSize: 12.5, fontWeight: 600, color: "#0F172A",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {item.name}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: "text.disabled", whiteSpace: "nowrap" }}>
                      {KIND_LABEL[item.kind]}
                    </Typography>
                  </Box>
                  <Typography sx={{
                    fontSize: 11, color: "text.disabled", mt: 0.25,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {item.category} · {item.description || item.code}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <ComponentPreviewDialog
        item={previewItem}
        payload={previewItem ? previews[String(previewItem.id)] : undefined}
        onClose={() => setPreviewItem(null)}
      />

      <Snackbar open={toast.open} autoHideDuration={2400}
        onClose={() => setToast((t) => ({ ...t, open: false }))} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={toast.severity} sx={{ borderRadius: 2 }}>{toast.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
