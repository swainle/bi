/** 推荐列表的文案纯函数：走势推算 / 解读 / 建议（评分在后端，这里不测） */

import { describe, expect, it } from "vitest";
import type { RecoItem, RecoMeta } from "../types";
import { fmt1, fmtCompact, gapText, wordAdvice, wordInsights, wordTrend } from "../reco/insight";

const item = (patch: Partial<RecoItem> = {}): RecoItem => ({
  rank: 1,
  name: "冻干",
  value: 60000,
  score: 94,
  tags: ["人气高"],
  stats: [],
  ctr: 79,
  cvr: 32.5,
  ds: 12,
  g: 220,
  ...patch,
});

const meta: RecoMeta = { avg_ctr: 54.67, avg_cvr: 19.5, total: 3, max_v: 60000, max_ds: 12 };

describe("数字格式", () => {
  it("不足一万按整数，超过按万/亿收一位", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(12345)).toBe("1.2万");
    expect(fmtCompact(60000)).toBe("6万");
    expect(fmtCompact(123456789)).toBe("1.2亿");
  });

  it("一位小数会去掉多余的 .0", () => {
    expect(fmt1(1.25)).toBe("1.3");
    expect(fmt1(32)).toBe("32");
    expect(fmt1(-2.04)).toBe("-2");
  });
});

describe("与大盘差值的措辞", () => {
  it("差不到 0.5 个百分点算持平", () => {
    expect(gapText(0)).toBe("基本持平");
    expect(gapText(0.4)).toBe("基本持平");
    expect(gapText(-0.49)).toBe("基本持平");
  });

  it("超过半个点给高低方向", () => {
    expect(gapText(2.5)).toBe("高 2.5 个百分点");
    expect(gapText(-1)).toBe("低 1 个百分点");
  });
});

describe("近 N 天走势（按增速推算）", () => {
  const end = new Date(2026, 10, 3);

  it("点数与天数一致，横轴是 M/D", () => {
    const points = wordTrend(item(), 7, end);
    expect(points).toHaveLength(7);
    expect(points[6].k).toBe("11/3");
    expect(points[0].k).toBe("10/28");
  });

  it("正增长的词：旧点低于新点；每个点都是正数", () => {
    const points = wordTrend(item({ g: 200 }), 7, end);
    expect(points.every((point) => point.v >= 1)).toBe(true);
    expect(points[0].v).toBeLessThan(points[points.length - 1].v);
  });

  it("负增长的词：旧点高于新点（增速换算成倍数后反推）", () => {
    const points = wordTrend(item({ g: -40 }), 7, end);
    expect(points[0].v).toBeGreaterThan(points[points.length - 1].v);
  });

  it("同输入同输出（没有随机数）", () => {
    expect(wordTrend(item(), 7, end)).toEqual(wordTrend(item(), 7, end));
  });
});

describe("数据解读", () => {
  it("开头给排名与占比，第二三条给与大盘的对比", () => {
    const lines = wordInsights(item(), meta);
    expect(lines[0]).toContain("No.1");
    expect(lines[0]).toContain("3 个词");
    expect(lines[1]).toContain("点击率");
    expect(lines[1]).toContain("高");
    expect(lines[2]).toContain("支付转化率");
  });

  it("增速与供需比有值才各加一条", () => {
    expect(wordInsights(item(), meta).some((line) => line.includes("搜索增速"))).toBe(true);
    expect(wordInsights(item(), meta).some((line) => line.includes("需求供给比"))).toBe(true);
    const quiet = wordInsights(item({ g: 0, ds: 0 }), meta);
    expect(quiet.some((line) => line.includes("搜索增速"))).toBe(false);
    expect(quiet.some((line) => line.includes("需求供给比"))).toBe(false);
    expect(quiet).toHaveLength(3);
  });

  it("翻倍、蓝海这类结论跟着数值走", () => {
    expect(wordInsights(item({ g: 260 }), meta).join("")).toContain("已翻倍");
    expect(wordInsights(item({ ds: 12 }), meta).join("")).toContain("蓝海缺口");
    expect(wordInsights(item({ ds: 4 }), meta).join("")).toContain("供不应求");
  });

  it("没有大盘基准时也能出文案（不抛错）", () => {
    const lines = wordInsights(item(), null);
    expect(lines[0]).toContain("No.1");
    expect(lines[1]).toContain("0%");
  });
});

describe("建议动作", () => {
  it("双高 → 优先投放", () => {
    const advice = wordAdvice(item(), meta);
    expect(advice).toHaveLength(2);
    expect(advice[0]).toContain("双高");
  });

  it("点击高、转化低 → 先补详情页", () => {
    expect(wordAdvice(item({ ctr: 80, cvr: 5 }), meta)[0]).toContain("补详情页");
  });

  it("点击低、转化高 → 先换主图", () => {
    expect(wordAdvice(item({ ctr: 20, cvr: 40 }), meta)[0]).toContain("换主图");
  });

  it("双低 → 暂不主推", () => {
    expect(wordAdvice(item({ ctr: 10, cvr: 5 }), meta)[0]).toContain("暂不单独主推");
  });
});
