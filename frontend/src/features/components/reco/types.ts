/** 推荐列表（reco_list）的类型 —— 与后端 app/components/reco_spec.py + build_reco 对齐.
 *
 * 单独成文件是为了不让 `types.ts` 继续变长（开发规范 §4.1）；
 * `types.ts` 里仍会 re-export，外部照旧 `import type { RecoItem } from "../types"`。
 */

/** 配置段：机会分 + 行内指标 + 详情开关（对应后端 RecoSpec） */
export interface RecoSpec {
  /** 取数用到的列（空 = 从 binding.metric 推导） */
  value_key: string;
  ctr_key: string;
  cvr_key: string;
  ds_key: string;
  g_key: string;
  /** 行内展示的三项指标：空 = 人气 / 支付转化率 / 机会分 */
  stats: { key: string; label: string; format: string }[];
  weights: Record<string, number>;
  score_label: string;
  bar_key: string;
  detail: boolean;
  trend_days: number;
}

/** 一行推荐（后端已算好分数 / 标签 / 三项指标） */
export interface RecoItem {
  rank: number;
  name: string;
  value: number;
  score: number;
  tags: string[];
  stats: { k: string; v: number; f: string; dir: "" | "up" | "down" }[];
  ctr: number;
  cvr: number;
  ds: number;
  g: number;
}

/** 大盘基准：详情弹窗做对比与解读用 */
export interface RecoMeta {
  avg_ctr: number;
  avg_cvr: number;
  total: number;
  max_v: number;
  max_ds: number;
}
