/**
 * 推荐列表的纯函数：走势推算 / 数据解读 / 建议动作.
 *
 * 为什么放在前端：这三段是**文案规则**，只依赖列表里已有的数字（评分、均值、排名），
 * 不查库、不改数据；放在这里可以单测，也避免为了几句中文再写一个接口。
 * 评分本身（机会分）在后端算，前端不重算 —— 见 components/compute.build_reco。
 */

import type { RecoItem, RecoMeta } from "../types";

/** 数字：小于 1 万直接显示整数，超过按 万 / 亿 收一位 */
export function fmtCompact(value: number): string {
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  if (abs >= 1e8) return `${(number / 1e8).toFixed(1).replace(/\.0$/, "")}亿`;
  if (abs >= 1e4) return `${(number / 1e4).toFixed(1).replace(/\.0$/, "")}万`;
  return String(Math.round(number));
}

/** 一位小数，去掉多余的 .0 */
export function fmt1(value: number): string {
  return (Number(value) || 0).toFixed(1).replace(/\.0$/, "");
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** 与大盘差值的措辞：差不到 0.5 个百分点算持平，避免「高 0.1pt」这种噪声 */
export function gapText(gap: number): string {
  if (Math.abs(gap) < 0.5) return "基本持平";
  return gap > 0 ? `高 ${fmt1(gap)} 个百分点` : `低 ${fmt1(Math.abs(gap))} 个百分点`;
}

export interface TrendPoint {
  /** 横轴标签：M/D */
  k: string;
  v: number;
}

/**
 * 近 N 天走势：**按当前人气 + 搜索增速推算**，不是历史真实值.
 *
 * 需求端表只有单个统计周期（period_start / period_end），没有按天粒度；
 * 这里沿用参考模板的推算口径，界面上必须标注「按增速推算」，不能当成实测数据卖。
 */
export function wordTrend(
  item: Pick<RecoItem, "name" | "value" | "g">,
  days = 7,
  end: Date = new Date(),
): TrendPoint[] {
  const growth = (Number(item.g) || 0) / 100;
  const total = 1 + clamp(growth, -0.5, 3);
  const seed = String(item.name ?? "").length * 7.3;
  const base = Number(item.value) || 1000;
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(end.getTime() - i * 864e5);
    const back = i / Math.max(1, days - 1);
    const noise = 1 + 0.04 * Math.sin(seed + (days - i) * 1.7);
    points.push({
      k: `${date.getMonth() + 1}/${date.getDate()}`,
      v: Math.max(1, Math.round((base / Math.pow(Math.max(0.12, total), back)) * noise)),
    });
  }
  return points;
}

/** 数据解读：3–5 条，每条一句完整的话 */
export function wordInsights(item: RecoItem, meta?: RecoMeta | null): string[] {
  const total = meta?.total || 0;
  const rank = item.rank || 0;
  const ctrGap = (Number(item.ctr) || 0) - (Number(meta?.avg_ctr) || 0);
  const cvrGap = (Number(item.cvr) || 0) - (Number(meta?.avg_cvr) || 0);

  const lines = [
    `搜索人气 ${fmtCompact(item.value)}，在本次筛选的 ${total} 个词里排 No.${rank}`
      + `（前 ${Math.max(1, Math.round((rank / Math.max(1, total)) * 100))}%）。`,
    `点击率 ${fmt1(item.ctr)}%，比大盘均值 ${fmt1(meta?.avg_ctr || 0)}% ${gapText(ctrGap)}。`,
    `支付转化率 ${fmt1(item.cvr)}%，比大盘均值 ${fmt1(meta?.avg_cvr || 0)}% ${gapText(cvrGap)}。`,
  ];
  if (Number(item.g) > 0) {
    const growth = Number(item.g);
    lines.push(
      `搜索增速 +${fmt1(growth)}%，`
        + (growth >= 200 ? "已翻倍，属类目里起量最快的词之一。"
          : growth >= 100 ? "翻倍增长，需求在扩张。"
            : "保持增长，可继续观察两周。"),
    );
  }
  if (Number(item.ds) > 0) {
    const demand = Number(item.ds);
    lines.push(
      `需求供给比 ${fmt1(demand)}×，`
        + (demand >= 10 ? "想买的远多于能买到的，是明显蓝海缺口。"
          : demand >= 3 ? "供不应求，适合优先承接。"
            : demand >= 1 ? "供需大致平衡。" : "供给过剩，靠差异化而非缺口取胜。"),
    );
  }
  return lines;
}

/** 建议动作：按「点击率 / 转化率」是否高于大盘，四象限给两句 */
export function wordAdvice(item: RecoItem, meta?: RecoMeta | null): string[] {
  const ctrGap = (Number(item.ctr) || 0) - (Number(meta?.avg_ctr) || 0);
  const cvrGap = (Number(item.cvr) || 0) - (Number(meta?.avg_cvr) || 0);
  if (ctrGap >= 0 && cvrGap >= 0) {
    return [
      "双高：优先投放，标题与主图沿用当前组合。",
      "可把该词放进新品标题前 12 字，抢占第一波曝光。",
    ];
  }
  if (ctrGap >= 0 && cvrGap < 0) {
    return [
      "点击强、转化弱：先补详情页与价格带，转化不达标不要加预算。",
      "主图已够吸睛，问题多出在后三屏的信息与信任背书。",
    ];
  }
  if (ctrGap < 0 && cvrGap >= 0) {
    return [
      "承接好、点击弱：优先换主图与标题前缀，这份流量接得住。",
      "主图建议突出规格与卖点数字，标题补一个具体使用场景。",
    ];
  }
  return [
    "两项都低于均值：暂不单独主推，作为长尾词补充即可。",
    "若要打，先小预算测点击率，再决定是否放量。",
  ];
}
