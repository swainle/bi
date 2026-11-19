/**
 * 渲染器 stories —— 隔离调样式用：不连后端、不依赖看板，直接喂一份 mock payload。
 *
 * 用法：npm run storybook（http://localhost:6006）
 * 新增图表类型时，先在这里加一条 story 调好，再进画布。
 */
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

import BarCard from "./BarCard";
import FunnelCard from "./FunnelCard";
import GaugeCard from "./GaugeCard";
import KpiCard from "./KpiCard";
import PieCard from "./PieCard";
import RankListCard from "./RankListCard";
import TableCard from "./TableCard";
import WaterfallCard from "./WaterfallCard";
import type { RenderPayload, UiSpec } from "../types";

const meta = {
  title: "渲染器/概览",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ui(accent: UiSpec["accent"] = "indigo"): UiSpec {
  return {
    accent, radius: 14, min_height: 260, show_unit: true,
    animate: false, align: "left", columns: 1,
  };
}

function Frame({ width = 712, height = 340, children }: {
  width?: number; height?: number; children: ReactNode;
}) {
  return <div style={{ width, height }}>{children}</div>;
}

const payload = (value: Partial<RenderPayload>): RenderPayload => ({
  title: "示例",
  subtitle: "",
  ...value,
});

export const Kpi: Story = {
  name: "指标卡",
  render: () => (
    <Frame width={260} height={120}>
      <KpiCard
        payload={payload({ kind: "kpi", title: "日销量", value: "26", unit: "单", hint: "前 10 合计 1,234" })}
        ui={ui("indigo")}
      />
    </Frame>
  ),
};

export const Bar: Story = {
  name: "柱状图",
  render: () => (
    <Frame>
      <BarCard
        payload={payload({
          kind: "bar",
          title: "日销量 · 按价格带",
          series: [
            { name: "<20元", value: 66476 },
            { name: "20-40元", value: 58920 },
            { name: "40-60元", value: 41230 },
            { name: "60-80元", value: 28760 },
            { name: "≥80元", value: 14120 },
          ],
          total: 209506,
        })}
        ui={ui("sky")}
      />
    </Frame>
  ),
};

export const Pie: Story = {
  name: "饼图",
  render: () => (
    <Frame>
      <PieCard
        payload={payload({
          kind: "pie",
          title: "品类占比",
          series: [
            { name: "猫咪零食", value: 38 },
            { name: "狗粮", value: 26 },
            { name: "猫粮", value: 18 },
            { name: "猫砂", value: 10 },
            { name: "宠物玩具", value: 8 },
          ],
          total: 100,
        })}
        ui={ui("violet")}
      />
    </Frame>
  ),
};

export const Funnel: Story = {
  name: "漏斗图",
  render: () => (
    <Frame>
      <FunnelCard
        payload={payload({
          kind: "funnel",
          title: "转化漏斗",
          series: [
            { name: "曝光", value: 120000 },
            { name: "点击", value: 48000 },
            { name: "加购", value: 18000 },
            { name: "成交", value: 6200 },
          ],
          total: 192200,
        })}
        ui={ui("teal")}
      />
    </Frame>
  ),
};

export const Gauge: Story = {
  name: "仪表盘",
  render: () => (
    <Frame>
      <GaugeCard
        payload={payload({
          kind: "gauge", title: "目标完成", value: "221,127",
          gauge_value: 221127, max: 250000, unit: "单",
        })}
        ui={ui("teal")}
      />
    </Frame>
  ),
};

export const Waterfall: Story = {
  name: "瀑布图",
  render: () => (
    <Frame>
      <WaterfallCard
        payload={payload({
          kind: "waterfall",
          title: "平台贡献",
          series: [
            { name: "天猫", value: 113779 },
            { name: "拼多多", value: 107348 },
            { name: "京东", value: 52000 },
          ],
          total: 273127,
        })}
        ui={ui("amber")}
      />
    </Frame>
  ),
};

export const RankList: Story = {
  name: "排行列表",
  render: () => (
    <Frame height={380}>
      <RankListCard
        payload={payload({
          kind: "rank_list",
          title: "品牌榜",
          items: [
            { name: "萌维兔", value: 34972, score: 96, tags: ["猫零食", "高增长"], quad: "blue" },
            { name: "示例品牌甲", value: 31240, score: 91, tags: ["狗粮"], quad: "blue" },
            { name: "示例品牌乙", value: 22110, score: 83, tags: ["猫粮"], quad: "pot" },
          ],
          count: 3,
        })}
        ui={ui("indigo")}
      />
    </Frame>
  ),
};

export const Table: Story = {
  name: "明细表",
  render: () => (
    <Frame height={420}>
      <TableCard
        payload={payload({
          kind: "table",
          title: "商品明细",
          rows: [
            { 商品标题: "猫条零食鱼油益生元…", 日销量: 1237, 平台: "天猫" },
            { 商品标题: "高汤鲜肉猫罐头…", 日销量: 1128, 平台: "拼多多" },
            { 商品标题: "冻干鸡胸肉粒…", 日销量: 980, 平台: "天猫" },
          ],
          columns: [
            { key: "商品标题", label: "商品标题", type: "text", align: "left", width: 200 },
            { key: "日销量", label: "日销量", type: "number", align: "right", width: 90 },
            { key: "平台", label: "平台", type: "badge", align: "center", width: 80 },
          ],
          page_size: 10,
        })}
        ui={ui("slate")}
      />
    </Frame>
  ),
};
