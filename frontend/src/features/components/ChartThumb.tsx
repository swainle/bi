/** 图表类型缩略图 —— 纯手绘 SVG，不依赖图片资源 */

import type { ComponentKind } from "./types";

interface Props {
  kind: ComponentKind;
  size?: number;
}

const BAR = [10, 18, 26, 14, 22];

export default function ChartThumb({ kind, size = 44 }: Props) {
  const w = size;
  const h = size;
  const stroke = "#C7D2FE";
  const fill = "#6366F1";

  const body = (() => {
    switch (kind) {
      case "banner":
        return (
          <>
            <rect x="5" y="10" width="34" height="24" rx="4" fill="#EEF5FE" stroke={stroke} />
            <rect x="9" y="16" width="12" height="4" rx="2" fill={fill} opacity="0.9" />
            <rect x="9" y="23" width="18" height="3" rx="1.5" fill="#93C5FD" />
            <rect x="9" y="28" width="10" height="2.5" rx="1.25" fill={stroke} />
            <rect x="30" y="17" width="5" height="2.5" rx="1.25" fill={fill} opacity="0.7" />
            <rect x="30" y="24" width="5" height="2.5" rx="1.25" fill={fill} opacity="0.45" />
          </>
        );
      case "nav":
        return (
          <>
            <rect x="5" y="14" width="34" height="16" rx="4" fill="#fff" stroke={stroke} />
            <rect x="8" y="19" width="7" height="6" rx="2" fill={fill} opacity="0.9" />
            <rect x="18" y="21" width="5" height="2" rx="1" fill="#94A3B8" />
            <rect x="25" y="21" width="5" height="2" rx="1" fill={stroke} />
            <rect x="32" y="19" width="4" height="6" rx="2" fill="#3B82F6" opacity="0.6" />
          </>
        );
      case "kpi":
        return (
          <>
            <rect x="6" y="12" width="32" height="6" rx="3" fill={fill} opacity="0.85" />
            <rect x="6" y="24" width="22" height="4" rx="2" fill={stroke} />
            <rect x="6" y="32" width="14" height="4" rx="2" fill={stroke} opacity="0.7" />
          </>
        );
      case "table":
        return (
          <>
            <rect x="6" y="8" width="32" height="28" rx="3" fill="#F5F8FE" stroke={stroke} />
            {[16, 24, 32].map((y) => <line key={y} x1="6" y1={y} x2="38" y2={y} stroke={stroke} />)}
            {[16, 26].map((x) => <line key={x} x1={x} y1="8" x2={x} y2="36" stroke={stroke} />)}
          </>
        );
      case "bar":
        return (
          <>
            <line x1="7" y1="36" x2="37" y2="36" stroke={stroke} />
            {BAR.map((v, i) => (
              <rect key={i} x={9 + i * 6} y={36 - v} width="4" height={v} rx="1.5" fill={fill} opacity={0.55 + i * 0.09} />
            ))}
          </>
        );
      case "hbar":
        return (
          <>
            <line x1="7" y1="8" x2="7" y2="36" stroke={stroke} />
            {BAR.map((v, i) => (
              <rect key={i} x="9" y={10 + i * 6} width={v} height="4" rx="1.5" fill={fill} opacity={0.55 + i * 0.09} />
            ))}
          </>
        );
      case "line":
      case "area":
        return (
          <>
            {kind === "area" && <path d="M7 33 L14 24 L21 27 L28 16 L35 20 L35 36 L7 36 Z" fill={fill} opacity="0.18" />}
            <polyline points="7,33 14,24 21,27 28,16 35,20" fill="none" stroke={fill} strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case "pie":
        return (
          <>
            <circle cx="22" cy="22" r="14" fill="#EEF2FF" />
            <path d="M22 22 L22 8 A14 14 0 0 1 34.1 29 Z" fill={fill} />
            <path d="M22 22 L34.1 29 A14 14 0 0 1 10 24 Z" fill={fill} opacity="0.45" />
          </>
        );
      case "donut":
        return (
          <>
            <circle cx="22" cy="22" r="14" fill="none" stroke="#EEF2FF" strokeWidth="9" />
            <path d="M22 8 A14 14 0 0 1 34.1 29" fill="none" stroke={fill} strokeWidth="9" />
            <path d="M22 8 A14 14 0 0 0 10 24" fill="none" stroke={fill} strokeWidth="9" opacity="0.4" />
          </>
        );
      case "scatter":
        return (
          <>
            <line x1="7" y1="36" x2="37" y2="36" stroke={stroke} />
            <line x1="7" y1="8" x2="7" y2="36" stroke={stroke} />
            {[[12, 30], [17, 25], [22, 27], [27, 18], [31, 21], [20, 15]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="2.2" fill={fill} opacity="0.75" />
            ))}
          </>
        );
      case "heatmap":
        return (
          <>
            {Array.from({ length: 16 }).map((_, i) => {
              const x = (i % 4) * 8 + 7;
              const y = Math.floor(i / 4) * 8 + 7;
              return <rect key={i} x={x} y={y} width="7" height="7" rx="1.5" fill={fill} opacity={0.12 + ((i * 7) % 10) / 14} />;
            })}
          </>
        );
      case "wordcloud":
        return (
          <>
            <text x="9" y="20" fontSize="10" fontWeight="700" fill={fill}>词</text>
            <text x="24" y="17" fontSize="7" fill={fill} opacity="0.55">云</text>
            <text x="14" y="31" fontSize="8" fill={fill} opacity="0.75">权重</text>
            <text x="28" y="30" fontSize="5" fill={fill} opacity="0.4">TOP</text>
          </>
        );
      case "funnel":
        return (
          <>
            <path d="M8 9 H36 L32 17 H12 Z" fill={fill} opacity="0.9" />
            <path d="M13 19 H31 L28 26 H16 Z" fill={fill} opacity="0.62" />
            <path d="M17 28 H27 L25 35 H19 Z" fill={fill} opacity="0.38" />
          </>
        );
      case "gauge":
        return (
          <>
            <path d="M9 30 A13 13 0 1 1 35 30" fill="none" stroke="#EEF2FF" strokeWidth="4" strokeLinecap="round" />
            <path d="M9 30 A13 13 0 0 1 27 10.5" fill="none" stroke={fill} strokeWidth="4" strokeLinecap="round" />
            <line x1="22" y1="24" x2="29" y2="14" stroke={fill} strokeWidth="2" strokeLinecap="round" />
            <circle cx="22" cy="24" r="2" fill={fill} />
          </>
        );
      case "radar":
        return (
          <>
            <polygon points="22,8 34,17 30,31 14,31 10,17" fill={fill} opacity="0.14" stroke={fill} strokeWidth="1.2" />
            <polygon points="22,13 29,19 27,27 17,27 15,19" fill="none" stroke={stroke} />
            {[[22, 8], [34, 17], [30, 31], [14, 31], [10, 17]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="1.8" fill={fill} />
            ))}
          </>
        );
      case "waterfall":
        return (
          <>
            <line x1="7" y1="36" x2="37" y2="36" stroke={stroke} />
            <rect x="9" y="27" width="5" height="9" rx="1.2" fill={fill} opacity="0.55" />
            <rect x="16" y="21" width="5" height="6" rx="1.2" fill={fill} opacity="0.7" />
            <rect x="23" y="15" width="5" height="6" rx="1.2" fill={fill} opacity="0.85" />
            <rect x="30" y="11" width="5" height="4" rx="1.2" fill={fill} opacity="0.45" />
            <polyline points="11.5,27 18.5,21 25.5,15 32.5,11" fill="none" stroke={stroke} strokeWidth="1" strokeDasharray="2 2" />
          </>
        );
      case "map":
        return (
          <>
            <path
              d="M7 15 L14 10 L21 12 L27 8 L34 12 L37 19 L33 24 L36 30 L28 36 L20 33 L12 34 L7 28 L10 21 Z"
              fill={fill} opacity="0.16" stroke={fill} strokeWidth="1.1" strokeLinejoin="round"
            />
            {[[16, 20], [24, 16], [27, 26], [18, 28]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="1.9" fill={fill} opacity={0.9 - i * 0.15} />
            ))}
          </>
        );
      case "combo":
        return (
          <>
            <line x1="7" y1="36" x2="37" y2="36" stroke={stroke} />
            {[16, 24, 22, 28].map((v, i) => (
              <rect key={i} x={9 + i * 8} y={36 - v} width="5" height={v} rx="1.5" fill={fill} opacity={0.45 + i * 0.1} />
            ))}
            <polyline points="11,26 19,20 27,22 35,15" fill="none" stroke="#14B8A6" strokeWidth="1.8" strokeLinecap="round" />
          </>
        );
      case "rank_list":
        return (
          <>
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <circle cx="11" cy={11 + i * 7} r="2.6" fill={fill} opacity={0.8 - i * 0.15} />
                <rect x="16" y={9.4 + i * 7} width={16 - i * 2.5} height="3" rx="1.5" fill={stroke} />
                <rect x="34" y={9.4 + i * 7} width="4" height="3" rx="1.5" fill={fill} opacity={0.6} />
              </g>
            ))}
          </>
        );
      case "insight":
        return (
          <>
            {[0, 1, 2].map((i) => (
              <g key={i}>
                <rect x="7" y={9 + i * 10} width="9" height="6" rx="2" fill={fill} opacity={0.3 + i * 0.2} />
                <rect x="18" y={10 + i * 10} width={20 - i * 4} height="3" rx="1.5" fill={stroke} />
                <rect x="18" y={14.5 + i * 10} width={14 - i * 3} height="2.4" rx="1.2" fill={stroke} opacity="0.6" />
              </g>
            ))}
          </>
        );
      case "section":
        return (
          <>
            <rect x="7" y="15" width="10" height="10" rx="3" fill={fill} />
            <rect x="20" y="15.5" width="12" height="3.4" rx="1.7" fill="#334155" />
            <rect x="20" y="21.5" width="8" height="2.6" rx="1.3" fill={stroke} />
            <line x1="7" y1="30" x2="37" y2="30" stroke={stroke} />
          </>
        );
      case "filter":
        return (
          <>
            <rect x="6" y="14" width="14" height="8" rx="3" fill="#fff" stroke={stroke} />
            <rect x="23" y="14" width="15" height="8" rx="3" fill={fill} opacity="0.12" stroke={stroke} />
            <rect x="6" y="26" width="9" height="7" rx="2.5" fill={fill} opacity="0.85" />
            <rect x="18" y="26" width="9" height="7" rx="2.5" fill="#fff" stroke={stroke} />
            <line x1="16.5" y1="18" x2="19" y2="18" stroke={stroke} />
          </>
        );
      default:
        return <rect x="8" y="8" width="28" height="28" rx="6" fill="#EEF2FF" />;
    }
  })();

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="chart thumbnail">
      {body}
    </svg>
  );
}
