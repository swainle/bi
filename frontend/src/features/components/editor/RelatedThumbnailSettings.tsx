import { useEffect, useState, type ReactNode } from "react";
import { Alert, Autocomplete, Box, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import client from "../../../api/client";
import type { ComponentSpec, FieldOption, RelatedThumbnailSpec } from "../types";

interface ResourceTable { id: number; name: string; table: string; fields: string[] }
const defaults: RelatedThumbnailSpec = {
  enabled: false, local_key: "", dataset_id: null, match_key: "", url_key: "",
  operation: "none", pattern: "", replacement: "",
};
const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12 } };

/** 左说明 + 右控件（说明统一 76 宽） */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>{label}</Typography>
      {children}
    </Box>
  );
}

/** 字段选择：能输入过滤、也能下拉选（字段多的表靠打字更快） */
function FieldAuto({ value, options, onChange, disabled, placeholder }: {
  value: string; options: string[]; onChange: (next: string) => void;
  disabled?: boolean; placeholder?: string;
}) {
  return (
    <Autocomplete
      size="small"
      disabled={disabled}
      options={options}
      value={options.includes(value) ? value : null}
      onChange={(_, next) => onChange(next ?? "")}
      renderInput={(params) => (
        <TextField {...params} size="small" placeholder={placeholder || "输入或选择字段"}
          sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
      )}
      sx={{ flex: 1, minWidth: 0 }}
    />
  );
}

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
      <Row label="关联外部字段">
        <Switch size="small" checked={config.enabled} onChange={(event) => patch({ enabled: event.target.checked })}
          inputProps={{ "aria-label": "关联缩略图" }} sx={{ ml: -0.5 }} />
      </Row>
      {config.enabled && <Stack spacing={1.25} sx={{ mt: 1 }}>
        {!spec.binding.dataset_id && <Alert severity="info">请先绑定当前明细表的数据集</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        <Row label="当前数据集关联字段">
          <FieldAuto value={config.local_key} options={names}
            onChange={(next) => patch({ local_key: next })} />
        </Row>
        <Row label="图片资源表">
          <TextField select size="small" value={target?.id ?? ""} disabled={loading}
            onChange={(event) => patch({ dataset_id: Number(event.target.value), match_key: "", url_key: "" })}
            sx={{ flex: 1, minWidth: 0, ...fieldSx }}>
            {tables.map((table) => <MenuItem key={table.id} value={table.id}>{table.name}（{table.table}）</MenuItem>)}
          </TextField>
        </Row>
        {([["match_key", "资源表关联字段"], ["url_key", "图片地址字段"]] as const).map(([key, label]) => (
          <Row key={key} label={label}>
            <FieldAuto value={config[key]} options={target?.fields ?? []} disabled={!target}
              onChange={(next) => patch({ [key]: next })} />
          </Row>
        ))}
        <Row label="地址转换">
          <TextField select size="small" value={config.operation}
            onChange={(event) => patch({ operation: event.target.value as RelatedThumbnailSpec["operation"] })}
            sx={{ flex: 1, minWidth: 0, ...fieldSx }}>
            <MenuItem value="none">不处理</MenuItem><MenuItem value="prefix">前缀拼接</MenuItem>
            <MenuItem value="replace">文本替换</MenuItem><MenuItem value="regex">正则替换</MenuItem>
          </TextField>
        </Row>
        {(config.operation === "replace" || config.operation === "regex") && (
          <Row label={config.operation === "regex" ? "匹配正则" : "查找文本"}>
            <TextField size="small" value={config.pattern}
              onChange={(event) => patch({ pattern: event.target.value })}
              inputProps={{ maxLength: 512 }}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
          </Row>
        )}
        {config.operation !== "none" && (
          <Row label={config.operation === "prefix" ? "URL 前缀" : "替换内容"}>
            <TextField size="small" value={config.replacement}
              onChange={(event) => patch({ replacement: event.target.value })}
              inputProps={{ maxLength: 2048 }}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
          </Row>
        )}
      </Stack>}
    </Box>
  );
}
