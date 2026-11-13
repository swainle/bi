/** 语义模型导入（dbt manifest / Looker LookML → 指标口径 + 字段说明）.
 *
 * 两段式：先「预览」拿计划（新建 / 更新 / 无变化 / 跳过原因），确认后再「导入」。
 * 更新走指标版本治理：口径变了自动 +1 版本并取消认证。
 */

import { useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from "@mui/material";
import { UploadFileOutlined } from "@mui/icons-material";
import client from "../../api/client";

interface PlannedMetric {
  name: string; expression: string; format: string; description: string;
  action: "new" | "update" | "unchanged"; note: string;
}
interface PlannedField {
  name: string; description: string; action: "update" | "unchanged";
}
interface SkipItem { name: string; reason: string; }
interface PlanResult {
  format: string;
  metrics: PlannedMetric[];
  fields: PlannedField[];
  skipped: SkipItem[];
  summary: { new: number; update: number; unchanged: number; fields: number; skipped: number };
}

const ACTION_LABEL: Record<string, string> = {
  new: "新建", update: "更新", unchanged: "无变化",
};
const ACTION_COLOR: Record<string, { color: string; bg: string }> = {
  new: { color: "#0E7490", bg: "rgba(8,145,178,0.10)" },
  update: { color: "#B45309", bg: "rgba(245,158,11,0.12)" },
  unchanged: { color: "#64748B", bg: "rgba(100,116,139,0.10)" },
};
const FORMAT_LABEL: Record<string, string> = {
  number: "数值", percent: "百分比", currency: "金额",
};
const th = { fontSize: 11.5, fontWeight: 600, color: "#64748B", py: 0.75, borderColor: "#EEF3FB" };
const td = { fontSize: 12, py: 0.75, borderColor: "#EEF3FB" };

export default function ModelImportDialog({
  datasetId, onClose, onImported,
}: {
  datasetId: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [format, setFormat] = useState<"dbt" | "lookml">("dbt");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPlan(null); setErr(""); setDone(""); };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result || ""));
      setFileName(file.name);
      reset();
    };
    reader.onerror = () => setErr("文件读取失败");
    reader.readAsText(file);
  };

  const preview = async () => {
    if (!content.trim()) return;
    setBusy(true); setErr(""); setDone("");
    try {
      const { data } = await client.post<PlanResult>(
        `/bi/semantic/datasets/${datasetId}/model-preview`,
        { format, content },
      );
      setPlan(data);
    } catch (e: any) {
      setPlan(null);
      setErr(e?.response?.data?.detail || "预览失败");
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await client.post(
        `/bi/semantic/datasets/${datasetId}/model-import`,
        { format, content },
      );
      const parts = [`新建 ${data.created} 个指标`];
      if (data.updated) parts.push(`更新 ${data.updated} 个`);
      if (data.fields_updated) parts.push(`补充 ${data.fields_updated} 条字段说明`);
      setDone(parts.join(" · "));
      setPlan(data.plan || null);
      onImported();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const importable = plan ? plan.summary.new + plan.summary.update + plan.summary.fields : 0;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>导入语义模型</DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        <Tabs value={format} onChange={(_e, v) => { setFormat(v); reset(); }}
          sx={{ minHeight: 34, mb: 1.25, "& .MuiTab-root": { minHeight: 34, fontSize: 12.5, textTransform: "none" } }}>
          <Tab value="dbt" label="dbt manifest.json" />
          <Tab value="lookml" label="Looker LookML" />
        </Tabs>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.25 }}>
          <Button size="small" variant="outlined" startIcon={<UploadFileOutlined sx={{ fontSize: 15 }} />}
            onClick={() => fileRef.current?.click()}
            sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5 }}>
            选择文件
          </Button>
          <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
            {fileName || (format === "dbt" ? "target/manifest.json" : "*.view.lkml")}
          </Typography>
          <input ref={fileRef} type="file" hidden
            accept={format === "dbt" ? ".json,application/json" : ".lkml,.lookml,.view,.txt"}
            onChange={(e) => pickFile(e.target.files?.[0])} />
        </Box>

        <TextField fullWidth multiline minRows={7} maxRows={12} value={content}
          onChange={(e) => { setContent(e.target.value); reset(); }}
          placeholder={format === "dbt"
            ? '{"metrics": {...}, "semantic_models": {...}}'
            : "view: order_fact { measure: gmv_total { type: sum sql: ${gmv} ;; } }"}
          InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12 } }}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />

        {err && <Alert severity="error" sx={{ mt: 1.25, fontSize: 12 }}>{err}</Alert>}
        {done && <Alert severity="success" sx={{ mt: 1.25, fontSize: 12 }}>{done}</Alert>}

        {plan && (
          <Box sx={{ mt: 1.75 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1.25, flexWrap: "wrap" }}>
              <Chip size="small" label={`新建 ${plan.summary.new}`} sx={{ height: 20, fontSize: 11 }} />
              <Chip size="small" label={`更新 ${plan.summary.update}`} sx={{ height: 20, fontSize: 11 }} />
              <Chip size="small" label={`无变化 ${plan.summary.unchanged}`} sx={{ height: 20, fontSize: 11 }} />
              <Chip size="small" label={`字段说明 ${plan.summary.fields}`} sx={{ height: 20, fontSize: 11 }} />
              <Chip size="small" label={`跳过 ${plan.summary.skipped}`} sx={{ height: 20, fontSize: 11 }} />
            </Stack>

            {plan.metrics.length > 0 && (
              <TableContainer sx={{ maxHeight: 240, border: "1px solid #EEF3FB", borderRadius: 1.5, mb: 1.25 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {["指标名", "聚合表达式", "格式", "动作"].map((h) => (
                        <TableCell key={h} sx={{ ...th, bgcolor: "#F8FAFF" }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {plan.metrics.map((m) => {
                      const tone = ACTION_COLOR[m.action];
                      return (
                        <TableRow key={m.name} hover>
                          <TableCell sx={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{m.name}</TableCell>
                          <TableCell sx={{ ...td, fontFamily: "ui-monospace", fontSize: 11.5 }}>{m.expression}</TableCell>
                          <TableCell sx={td}>{FORMAT_LABEL[m.format] || m.format}</TableCell>
                          <TableCell sx={{ ...td, whiteSpace: "nowrap" }}>
                            <Chip size="small" label={ACTION_LABEL[m.action]}
                              sx={{ height: 18, fontSize: 10.5, color: tone.color, bgcolor: tone.bg }} />
                            {m.note && (
                              <Typography component="span" sx={{ ml: 0.75, fontSize: 10.5, color: "#B45309" }}>
                                {m.note}
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {plan.skipped.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 0.5 }}>
                  跳过（{plan.skipped.length}）
                </Typography>
                <Box sx={{ maxHeight: 120, overflow: "auto", pl: 0.25 }}>
                  {plan.skipped.map((s) => (
                    <Typography key={s.name} sx={{ fontSize: 11.5, color: "text.secondary", lineHeight: 1.7 }}>
                      {s.name} — {s.reason}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>关闭</Button>
        <Button variant="outlined" onClick={preview} disabled={busy || !content.trim()}
          sx={{ textTransform: "none", borderRadius: 2 }}>预览</Button>
        <Button variant="contained" onClick={runImport} disabled={busy || !plan || importable === 0}
          startIcon={busy ? <CircularProgress size={14} sx={{ color: "#fff" }} /> : undefined}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>
          {importable ? `导入 ${importable} 项` : "导入"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
