/** 组件编辑 —— 结构 / 内容 / 筛选 / 榜卡 / 组合 用表单编辑；数据类走画布配字段 */

import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, IconButton, MenuItem, Select, Snackbar, Stack, TextField, Typography,
} from "@mui/material";
import { Add, ArrowBack, Delete, Save } from "@mui/icons-material";
import client from "../api/client";
import SharedFilterFieldsEditor from "../features/components/editor/FilterFieldsEditor";
import { filterWithFields } from "../features/components/split";
import type { ComponentItem, FilterFieldSpec, ComponentSpec } from "../features/components/types";
import { KIND_LABEL, KIND_ROLE } from "../features/components/registry";

const ICONS = ["grid", "chart", "pie", "table", "cloud", "tag", "bulb"];
const FIELD_TYPES: FilterFieldSpec["type"][] = ["select", "segment", "chips", "search"];

const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5, bgcolor: "#fff" } } as const;

export default function ComponentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [component, setComponent] = useState<ComponentItem | null>(null);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState<ComponentSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    client.get(`/bi/components/${id}`)
      .then((res) => {
        setComponent(res.data);
        setName(res.data.name);
        setSpec(res.data.spec);
      })
      .catch(() => setError("组件不存在"));
  }, [id]);

  if (!id) return <Navigate to="/bi/components" replace />;
  if (error) return <Box sx={{ p: 5 }}><Alert severity="error">{error}</Alert></Box>;
  if (!component || !spec) {
    return <Box sx={{ p: 5 }}><Typography sx={{ fontSize: 12.5, color: "text.disabled" }}>加载中…</Typography></Box>;
  }

  const role = KIND_ROLE[component.kind];
  if (role === "data") return <Navigate to="/bi/canvas" replace />;

  const patch = (next: Partial<ComponentSpec>) => setSpec({ ...spec, ...next });
  const patchContent = (next: Partial<ComponentSpec["content"]>) =>
    patch({ content: { ...spec.content, ...next } });
  const patchRank = (next: Partial<ComponentSpec["rank"]>) =>
    patch({ rank: { ...spec.rank, ...next } });
  const patchCombo = (next: Partial<ComponentSpec["combo"]>) =>
    patch({ combo: { ...spec.combo, ...next } });

  const save = async () => {
    setSaving(true);
    try {
      await client.put(`/bi/components/${id}`, { name, spec });
      setToast("已保存");
      window.setTimeout(() => nav("/bi/components"), 700);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast(detail || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const setField = (index: number, next: Partial<FilterFieldSpec>) => {
    const fields = spec.filter.fields.map((f, i) => (i === index ? { ...f, ...next } : f));
    patch({ filter: { ...spec.filter, fields } });
  };

  const addField = () => {
    const seq = spec.filter.fields.length + 1;
    patch({ filter: { ...spec.filter, fields: [
      ...spec.filter.fields,
      { id: `field_${seq}`, label: `筛选 ${seq}`, type: "select", default: "all",
        options: [{ v: "all", t: "全部" }], multiple: false, placeholder: "", width: 0, note: "" },
    ] } });
  };

  const removeField = (index: number) => {
    patch({ filter: { ...spec.filter, fields: spec.filter.fields.filter((_, i) => i !== index) } });
  };

  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2.5 }}>
        <IconButton size="small" onClick={() => nav("/bi/components")}><ArrowBack sx={{ fontSize: 18 }} /></IconButton>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>{component.name}</Typography>
        <Chip size="small" label={KIND_LABEL[component.kind]}
          sx={{ fontSize: 10.5, height: 20, bgcolor: "rgba(79,70,229,0.08)", color: "#4F46E5" }} />
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" size="small" startIcon={<Save sx={{ fontSize: 15 }} />}
          disabled={saving} onClick={save}
          sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, bgcolor: "#4F46E5", px: 2.5 }}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </Box>

      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5}>
          <TextField size="small" label="组件名" value={name} onChange={(e) => setName(e.target.value)}
            sx={{ ...fieldSx, width: 240 }} />
          <TextField size="small" label="标题" value={spec.title}
            onChange={(e) => patch({ title: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
          <TextField size="small" label="副标题" value={spec.subtitle}
            onChange={(e) => patch({ subtitle: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
        </Stack>

        {component.kind === "section" && (
          <Stack direction="row" spacing={1.5}>
            <TextField size="small" label="编号" value={spec.content.index}
              onChange={(e) => patchContent({ index: e.target.value.slice(0, 4) })} sx={{ ...fieldSx, width: 120 }} />
            <Select size="small" value={spec.content.icon}
              onChange={(e) => patchContent({ icon: e.target.value })} sx={{ ...fieldSx, width: 160 }}>
              {ICONS.map((icon) => <MenuItem key={icon} value={icon} sx={{ fontSize: 12.5 }}>{icon}</MenuItem>)}
            </Select>
          </Stack>
        )}

        {component.kind === "insight" && (
          <Box sx={{ border: "1px solid #EEF3FB", borderRadius: 2, p: 1.5, bgcolor: "#fff" }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748B", flex: 1 }}>结论条目</Typography>
              <Button size="small" startIcon={<Add sx={{ fontSize: 14 }} />}
                onClick={() => patchContent({ items: [...spec.content.items, { k: "要点", v: "" }] })}
                sx={{ textTransform: "none", fontSize: 12 }}>添加</Button>
            </Box>
            <Stack spacing={1}>
              {spec.content.items.map((item, index) => (
                <Stack key={index} direction="row" spacing={1} alignItems="center">
                  <TextField size="small" label="标签" value={item.k}
                    onChange={(e) => patchContent({
                      items: spec.content.items.map((x, i) => (i === index ? { ...x, k: e.target.value } : x)),
                    })} sx={{ ...fieldSx, width: 130 }} />
                  <TextField size="small" label="结论（可用 {指标} 占位）" value={item.v} multiline
                    onChange={(e) => patchContent({
                      items: spec.content.items.map((x, i) => (i === index ? { ...x, v: e.target.value } : x)),
                    })} sx={{ ...fieldSx, flex: 1 }} />
                  <IconButton size="small" onClick={() => patchContent({
                    items: spec.content.items.filter((_, i) => i !== index),
                  })}><Delete sx={{ fontSize: 15 }} /></IconButton>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}

        {component.kind === "filter" && (
          <Box sx={{ border: "1px solid #EEF3FB", borderRadius: 2, p: 1.5, bgcolor: "#fff" }}>
            <SharedFilterFieldsEditor
              fields={spec.filter.fields}
              fieldsMap={spec.filter.fields_map}
              columns={[]}
              datasetId={null}
              onChange={(fields) => patch({ filter: filterWithFields(spec.filter, fields) })}
              onFieldsMapChange={(fields_map) => patch({ filter: { ...spec.filter, fields_map } })}
            />
            <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 1 }}>
              这些字段的值会成为看板参数，组件筛选条件用 valueFrom = param:&lt;id&gt; 引用
            </Typography>
          </Box>
        )}

        {component.kind === "rank_list" && (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Select size="small" value={spec.rank.order}
              onChange={(e) => patchRank({ order: e.target.value as ComponentSpec["rank"]["order"] })}
              sx={{ ...fieldSx, width: 190 }}>
              <MenuItem value="value" sx={{ fontSize: 12.5 }}>按原值</MenuItem>
              <MenuItem value="score" sx={{ fontSize: 12.5 }}>按评分</MenuItem>
              <MenuItem value="opportunity" sx={{ fontSize: 12.5 }}>按机会象限</MenuItem>
            </Select>
            <TextField size="small" type="number" label="最多条数" value={spec.rank.max_items}
              onChange={(e) => patchRank({ max_items: Number(e.target.value) })} sx={{ ...fieldSx, width: 108 }} />
            <TextField size="small" label="标签字段" value={spec.rank.tags_key}
              onChange={(e) => patchRank({
                tags_key: e.target.value,
                // 填了标签字段就自动打开「显示标签」，否则配了却看不见
                ...(e.target.value.trim() ? { show_tags: true } : {}),
              })} sx={{ ...fieldSx, width: 140 }} />
            <Button size="small" variant={spec.rank.show_score ? "contained" : "outlined"}
              onClick={() => patchRank({ show_score: !spec.rank.show_score })}
              sx={{ textTransform: "none", fontSize: 12 }}>显示分值</Button>
            <Button size="small" variant={spec.rank.show_tags ? "contained" : "outlined"}
              onClick={() => patchRank({ show_tags: !spec.rank.show_tags })}
              sx={{ textTransform: "none", fontSize: 12 }}>显示标签</Button>
          </Stack>
        )}

        {component.kind === "combo" && (
          <Stack direction="row" spacing={1.5}>
            <TextField size="small" label="柱名称" value={spec.combo.bar_name}
              onChange={(e) => patchCombo({ bar_name: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
            <TextField size="small" label="线名称" value={spec.combo.line_name}
              onChange={(e) => patchCombo({ line_name: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
            <Button size="small" variant={spec.combo.right_axis ? "contained" : "outlined"}
              onClick={() => patchCombo({ right_axis: !spec.combo.right_axis })}
              sx={{ textTransform: "none", fontSize: 12 }}>右轴</Button>
          </Stack>
        )}
      </Stack>

      <Snackbar open={Boolean(toast)} autoHideDuration={2200} onClose={() => setToast("")} message={toast} />
    </Box>
  );
}
