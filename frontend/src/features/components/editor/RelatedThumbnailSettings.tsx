import { useEffect, useState } from "react";
import { Alert, Box, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import client from "../../../api/client";
import type { ComponentSpec, FieldOption, RelatedThumbnailSpec } from "../types";

interface ResourceTable { id: number; name: string; table: string; fields: string[] }
const defaults: RelatedThumbnailSpec = {
  enabled: false, local_key: "", dataset_id: null, match_key: "", url_key: "",
  operation: "none", pattern: "", replacement: "",
};
const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } };

export default function RelatedThumbnailSettings({ spec, onChange, fields }: {
  spec: ComponentSpec; onChange: (next: ComponentSpec) => void; fields: FieldOption[];
}) {
  const config = { ...defaults, ...spec.table_view.related_thumb };
  const [tables, setTables] = useState<ResourceTable[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const patch = (next: Partial<RelatedThumbnailSpec>) => onChange({
    ...spec, table_view: { ...spec.table_view, related_thumb: { ...config, ...next },
      ...(next.enabled ? { thumb: false } : {}) },
  });
  useEffect(() => {
    setTables([]); setError("");
    if (!config.enabled || !spec.binding.dataset_id) return;
    let alive = true;
    setLoading(true);
    client.get("/bi/components/thumbnail-tables", { params: { dataset_id: spec.binding.dataset_id } })
      .then((res) => { if (alive) setTables(res.data.tables || []); })
      .catch((err) => { if (alive) setError(err?.response?.data?.detail || "读取同源图片资源表失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [config.enabled, spec.binding.dataset_id]);
  const names = [...new Set(fields.filter((field) => field.role !== "metric").map((field) => field.name))];
  const target = tables.find((table) => table.id === config.dataset_id);
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Switch size="small" checked={config.enabled} onChange={(event) => patch({ enabled: event.target.checked })}
          inputProps={{ "aria-label": "关联缩略图" }} sx={{ ml: -0.5 }} />
        <Typography sx={{ fontSize: 12.5, color: "#334155" }}>关联缩略图</Typography>
      </Box>
      {config.enabled && <Stack spacing={1.25} sx={{ mt: 1 }}>
        {!spec.binding.dataset_id && <Alert severity="info">请先绑定当前明细表的数据集</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        <TextField select size="small" label="当前数据集关联字段" value={names.includes(config.local_key) ? config.local_key : ""}
          onChange={(event) => patch({ local_key: event.target.value })} sx={fieldSx}>
          {names.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="图片资源表" value={target?.id ?? ""} disabled={loading}
          helperText={loading ? "正在读取…" : "选择已接入的同源数据集，保留其行级权限和脱敏规则"}
          onChange={(event) => patch({ dataset_id: Number(event.target.value), match_key: "", url_key: "" })} sx={fieldSx}>
          {tables.map((table) => <MenuItem key={table.id} value={table.id}>{table.name}（{table.table}）</MenuItem>)}
        </TextField>
        {([ ["match_key", "资源表关联字段"], ["url_key", "图片地址字段"] ] as const).map(([key, label]) => (
          <TextField key={key} select size="small" label={label} disabled={!target}
            value={target?.fields.includes(config[key]) ? config[key] : ""}
            onChange={(event) => patch({ [key]: event.target.value })} sx={fieldSx}>
            {target?.fields.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
          </TextField>
        ))}
        <TextField select size="small" label="地址转换" value={config.operation}
          onChange={(event) => patch({ operation: event.target.value as RelatedThumbnailSpec["operation"] })} sx={fieldSx}>
          <MenuItem value="none">不处理</MenuItem><MenuItem value="prefix">前缀拼接</MenuItem>
          <MenuItem value="replace">文本替换</MenuItem><MenuItem value="regex">正则替换</MenuItem>
        </TextField>
        {(config.operation === "replace" || config.operation === "regex") && (
          <TextField size="small" label={config.operation === "regex" ? "匹配正则" : "查找文本"}
            value={config.pattern} onChange={(event) => patch({ pattern: event.target.value })}
            inputProps={{ maxLength: 512 }} sx={fieldSx} />
        )}
        {config.operation !== "none" && (
          <TextField size="small" label={config.operation === "prefix" ? "URL 前缀" : "替换内容"}
            value={config.replacement} onChange={(event) => patch({ replacement: event.target.value })}
            inputProps={{ maxLength: 2048 }} sx={fieldSx}
            helperText={config.operation === "regex" ? "使用 Python 正则，捕获组用 \\1、\\2；结果须为 http(s) URL" : "结果须为 http(s) URL"} />
        )}
      </Stack>}
    </Box>
  );
}
