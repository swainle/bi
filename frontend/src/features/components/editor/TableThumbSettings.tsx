/** 查询面板（编辑页中栏）—— 维度 / 指标 / 过滤 / 行限制，对应 spec.binding */

import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Chip, Divider, IconButton, Menu, MenuItem, Stack, Switch, TextField, Typography,
} from "@mui/material";
import { Add, Check, Close, ExpandMore } from "@mui/icons-material";
import ChartOptionsPanel from "./ChartOptionsPanel";
import TableDetailSettings from "./TableDetailSettings";
import { BANNER_TONES } from "../renderers/BannerCard";
import StylePanel from "./StylePanel";
import DataCheckPanel from "./DataCheckPanel";
import { GROUP_CARD_SX, PanelSection, PanelTitle } from "./PanelSection";
import { KIND_LABEL } from "../registry";
import { axisLabels } from "./axisLabels";
import ComputeFields from "./ComputeFields";
import type { BannerStat, ComponentItem, ComponentKind, ComponentSpec, FieldOption, RenderPayload } from "../types";

import { AGG, GRAINS, IMAGE_KEY, NEEDS_DIMENSION, OPS, STRONG_IMAGE_KEY, dash } from "./queryConstants";
import type { Props } from "./queryTypes";

export function TableThumbSettings({
  spec, onChange, dimensionOptions, identifierOptions,
}: {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  dimensionOptions: FieldOption[];
  identifierOptions: FieldOption[];
}) {
  const b = spec.binding;
  const fields = b.dimensions ?? [];
  /* 图片字段的候选 = **所有文字类列**（标识 + 维度），不再只认 role=id：
     直连数据集里「链接 / 主图 / 详情图」这类列往往是 dimension，只认 id 就会一个选项都没有 */
  const seen = new Set<string>();
  const imageOptions = [...(identifierOptions ?? []), ...(dimensionOptions ?? [])]
    .filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)))
    .filter((f) => f.role !== "measure" && f.role !== "time")
    /* 名字像「图 / image / url / 链接」的排前面，挑起来不用翻一长串 */
    .sort((x, y) => (Number(STRONG_IMAGE_KEY.test(y.name)) - Number(STRONG_IMAGE_KEY.test(x.name)))
      || (Number(IMAGE_KEY.test(y.name)) - Number(IMAGE_KEY.test(x.name))));

  const applyThumb = (on: boolean, rawKey: string) => {
    const candidates = imageOptions
      .filter((f) => IMAGE_KEY.test(f.name))
      .sort((x, y) => Number(STRONG_IMAGE_KEY.test(y.name)) - Number(STRONG_IMAGE_KEY.test(x.name)));
    const key = rawKey || candidates[0]?.name || imageOptions[0]?.name || "";
    onChange({
      ...spec,
      table_view: { ...spec.table_view, thumb: on, thumb_key: key },
      binding: { ...b, dimension: null, metric: null, metrics: [], dimensions: fields.filter((name) => name !== key) },
    });
  };

  /* 换绑数据集后旧图片字段可能不在这张表里（例：直连表的「主图ID」留在测试数据集上）：
     留着它这张明细表就只剩一条「未知字段」报错，面板里下拉也是空的。这里直接清掉，
     缩略图保持开启、只是暂时没有图列，不再挡住整张表。 */
  const optionNames = imageOptions.map((f) => f.name).join("|");
  useEffect(() => {
    const key = spec.table_view.thumb_key ?? "";
    if (!key || !optionNames) return;
    if (optionNames.split("|").includes(key)) return;
    onChange({ ...spec, table_view: { ...spec.table_view, thumb_key: "" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.table_view.thumb_key, optionNames]);

  const thumbValue = imageOptions.some((f) => f.name === spec.table_view.thumb_key)
    ? (spec.table_view.thumb_key ?? "")
    : "";

  return (
    <Box sx={{ mt: 1.75, pt: 1.5, borderTop: "1px solid #F1F5FC" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Switch
          size="small" checked={!!spec.table_view.thumb}
          onChange={(e) => applyThumb(e.target.checked, spec.table_view.thumb_key ?? "")}
          sx={{ ml: -0.5 }}
        />
        <Typography sx={{ fontSize: 12.5, color: "#334155" }}>缩略图</Typography>
        {spec.table_view.thumb && (
          <TextField select size="small" label="图片字段" value={thumbValue}
            onChange={(e) => applyThumb(true, e.target.value)}
            sx={{ width: 168, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
            {imageOptions.map((f) => (
              <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12 }}>{f.name}</MenuItem>
            ))}
          </TextField>
        )}
      </Box>
    </Box>
  );
}

