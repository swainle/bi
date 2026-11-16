/** 新建图表对话框（图2）—— 选择数据源 → 选择图表类型 → 创建新图表 */

import { useEffect, useState } from "react";
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography,
} from "@mui/material";
import client from "../../api/client";
import ChartCatalog, { type CatalogEntry } from "./ChartCatalog";
import type { DatasetBrief } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}

export default function NewChartDialog({ open, onClose, onCreated }: Props) {
  const [datasets, setDatasets] = useState<DatasetBrief[]>([]);
  const [datasetId, setDatasetId] = useState<number | "">("");
  const [charts, setCharts] = useState<CatalogEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    client.get("/bi/semantic/datasets").then((res) => {
      const list: DatasetBrief[] = res.data?.datasets || [];
      setDatasets(list);
      setDatasetId((current) => (current === "" && list.length ? list[0].id : current));
    }).catch(() => setDatasets([]));
    client.get("/bi/components/catalog").then((res) => {
      setCharts(res.data?.charts || []);
      setCategories(res.data?.categories || []);
    }).catch(() => setCharts([]));
  }, [open]);

  const handlePick = async (entry: CatalogEntry) => {
    setCreating(true);
    setError("");
    try {
      const res = await client.post("/bi/components/from-catalog", {
        entry_id: entry.id,
        dataset_id: datasetId || undefined,
        name: entry.label,
      });
      onCreated(res.data.id);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { borderRadius: 3, height: "86vh" } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }}>创建新图表</Typography>
      </DialogTitle>

      <DialogContent sx={{ display: "flex", flexDirection: "column", minHeight: 0, pt: 1 }}>
        {/* ① 选择数据源 */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          <Box sx={{
            width: 18, height: 18, borderRadius: "50%", bgcolor: "#4F46E5", color: "#fff",
            fontSize: 11, display: "grid", placeItems: "center", fontWeight: 700, flexShrink: 0,
          }}>
            1
          </Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A", width: 92 }}>
            选择数据源
          </Typography>
          <TextField
            select size="small" value={datasetId}
            onChange={(e) => setDatasetId(Number(e.target.value))}
            sx={{ width: 280, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
          >
            {datasets.map((d) => (
              <MenuItem key={d.id} value={d.id} sx={{ fontSize: 12.5 }}>
                {d.name}
                {d.conn_mode === "live" && (
                  <Box component="span" sx={{ ml: 1, fontSize: 10.5, color: "#2563EB" }}>直连</Box>
                )}
              </MenuItem>
            ))}
          </TextField>
          {error ? <Typography sx={{ fontSize: 12, color: "error.main" }}>{error}</Typography> : null}
        </Box>

        {/* ② 选择图表类型 */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <Box sx={{
            width: 18, height: 18, borderRadius: "50%", bgcolor: "#4F46E5", color: "#fff",
            fontSize: 11, display: "grid", placeItems: "center", fontWeight: 700, flexShrink: 0,
          }}>
            2
          </Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }}>
            选择图表类型
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, border: "1px solid #EEF3FB", borderRadius: 2.5, p: 2 }}>
          <ChartCatalog
            charts={charts} categories={categories}
            datasetReady={datasetId !== ""} caseName=""
            onPick={handlePick} creating={creating}
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none", fontSize: 12.5 }}>取消</Button>
      </DialogActions>
    </Dialog>
  );
}
