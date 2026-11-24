/** 散点提示框的行拼装（纯函数，便于单测）.
 *
 * 顺序固定：名称 → X → Y → 气泡大小 → 附加字段（逐行）→ 象限 · 机会分。
 * 气泡字段和某条轴是同一列时**不重复显示**（否则 `popularity` 会出现两次）。
 */

export interface ScatterTipPoint {
  name?: string | null;
  x: number;
  y: number;
  quad?: string;
  score?: number;
  sizeValue?: number;
  extras?: { label: string; key: string; value: number }[];
}

export interface ScatterTipOptions {
  xLabel: string;
  yLabel: string;
  sizeKey?: string;
  xKey?: string;
  yKey?: string;
  /** 数值格式化（轴 / 气泡 / 附加字段共用同一口径） */
  format: (value: number) => string;
  /** 象限中文名 */
  quadLabel: (quad?: string) => string;
}

export function scatterTipLines(point: ScatterTipPoint, opts: ScatterTipOptions): string[] {
  const lines = [
    `<b>${point.name ?? ""}</b>`,
    `${opts.xLabel || "x"}：${opts.format(point.x)}`,
    `${opts.yLabel || "y"}：${opts.format(point.y)}`,
  ];
  const sizeIsAxis = Boolean(opts.sizeKey)
    && [opts.xLabel, opts.yLabel, opts.xKey, opts.yKey].some((name) => name && name === opts.sizeKey);
  if (point.sizeValue !== undefined && !sizeIsAxis) {
    lines.push(`${opts.sizeKey || "气泡"}：${opts.format(point.sizeValue)}`);
  }
  for (const row of point.extras ?? []) {
    lines.push(`${row.label || row.key}：${opts.format(Number(row.value))}`);
  }
  if (point.quad) {
    lines.push(`${opts.quadLabel(point.quad)} · 机会分 ${point.score ?? "-"}`);
  }
  return lines;
}
