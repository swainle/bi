/** 画布标尺 —— 以画布左上角为零点，按实际尺寸显示刻度和选区范围。 */

import { useEffect, useRef, useState } from "react";

const SIZE = 20;
/** 选区在标尺上的高亮条厚度 */
const BAND = 3;

interface Props {
  axis: "x" | "y";
  /** 标尺可视长度（CSS px） */
  length: number;
  /** 设计坐标 → CSS px */
  scale: number;
  /** 设计坐标 0 在标尺上的位置（CSS px） */
  origin: number;
  /** 内容向上滚动量（CSS px），让刻度跟着内容走 */
  scroll?: number;
  extent?: number;
  /** 选中元素在设计坐标下的起止 */
  span?: [number, number] | null;
}

function pickStep(scale: number) {
  let step = 10;
  while (step * scale < 9) step *= 2;
  return step;
}

export function rulerMarks(length: number, scale: number, origin: number, extent: number) {
  const step = pickStep(scale);
  const major = step * 5;
  const view = Math.min(extent, (length - origin) / scale);
  const marks: { pos: number; value: number; major: boolean }[] = [];
  const start = Math.max(0, Math.floor(-origin / scale / step) * step);
  for (let value = start; value <= view; value += step) {
    const pos = origin + value * scale;
    if (pos < -2 || pos > length + 2) continue;
    marks.push({ pos, value, major: value % major === 0 });
  }
  return marks;
}

export default function CanvasRuler({ axis, length, scale, origin, scroll = 0, extent = 1440, span }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState(0);
  useEffect(() => {
    const root = ref.current?.closest("[data-stage-wrap]");
    const update = (event: Event) => setPan((event as CustomEvent<{ x: number; y: number }>).detail[axis]);
    root?.addEventListener("canvaspan", update);
    return () => root?.removeEventListener("canvaspan", update);
  }, [axis]);
  origin += pan;
  const marks = rulerMarks(length, scale, origin - scroll, extent);

  const from = span ? origin + span[0] * scale - scroll : 0;
  const to = span ? origin + span[1] * scale - scroll : 0;
  const bandFrom = Math.max(0, from);
  const bandTo = Math.min(length, to);
  const hasBand = Boolean(span) && bandTo > bandFrom;

  const width = axis === "x" ? length : SIZE;
  const height = axis === "x" ? SIZE : length;

  return (
    <svg ref={ref} width={width} height={height} style={{ display: "block", pointerEvents: "none" }}>
      <rect x={0} y={0} width={width} height={height} fill="#FBFCFE" />

      {hasBand && (
        <>
          <rect
            x={axis === "x" ? bandFrom : 0}
            y={axis === "x" ? 0 : bandFrom}
            width={axis === "x" ? bandTo - bandFrom : SIZE}
            height={axis === "x" ? SIZE : bandTo - bandFrom}
            fill="rgba(79,70,229,0.08)"
          />
          <rect
            x={axis === "x" ? bandFrom : SIZE - BAND}
            y={axis === "x" ? SIZE - BAND : bandFrom}
            width={axis === "x" ? bandTo - bandFrom : BAND}
            height={axis === "x" ? BAND : bandTo - bandFrom}
            fill="#A5B4FC"
          />
        </>
      )}

      {marks.map(({ pos, value, major: isMajor }) => {
        const inner = isMajor ? 8 : 14;
        const color = isMajor ? "#C7D2E3" : "#DFE7F3";
        return axis === "x" ? (
          <line key={value} x1={pos} x2={pos} y1={SIZE} y2={inner} stroke={color} strokeWidth={1} />
        ) : (
          <line key={value} y1={pos} y2={pos} x1={SIZE} x2={inner} stroke={color} strokeWidth={1} />
        );
      })}

      {marks.filter((m) => m.major).map(({ pos, value }) =>
        axis === "x" ? (
          <text
            key={`t-${value}`}
            x={pos + 3}
            y={8.5}
            fontSize={9}
            fill="#94A3B8"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {value}
          </text>
        ) : (
          <text
            key={`t-${value}`}
            transform={`translate(8.5 ${pos + 3}) rotate(-90)`}
            textAnchor="end"
            fontSize={9}
            fill="#94A3B8"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {value}
          </text>
        ),
      )}
    </svg>
  );
}

export { SIZE as RULER_SIZE };
