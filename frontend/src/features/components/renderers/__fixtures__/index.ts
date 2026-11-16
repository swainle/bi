/** 自动生成，请勿手改 —— 由 scripts/capture_component_fixtures.py 产出。 */
/** 每种组件的真实渲染 payload（来自测试数据集 bi_demo_sku，已脱敏）。 */

import type { RenderPayload } from "../../types";

import area from "./area.json";
import banner from "./banner.json";
import bar from "./bar.json";
import combo from "./combo.json";
import donut from "./donut.json";
import filter from "./filter.json";
import funnel from "./funnel.json";
import gauge from "./gauge.json";
import hbar from "./hbar.json";
import heatmap from "./heatmap.json";
import insight from "./insight.json";
import kpi from "./kpi.json";
import line from "./line.json";
import map from "./map.json";
import nav from "./nav.json";
import pie from "./pie.json";
import radar from "./radar.json";
import rankList from "./rank_list.json";
import scatter from "./scatter.json";
import section from "./section.json";
import table from "./table.json";
import waterfall from "./waterfall.json";
import wordcloud from "./wordcloud.json";

export const fixtures: Record<string, RenderPayload> = {
  area: area as unknown as RenderPayload,
  banner: banner as unknown as RenderPayload,
  bar: bar as unknown as RenderPayload,
  combo: combo as unknown as RenderPayload,
  donut: donut as unknown as RenderPayload,
  filter: filter as unknown as RenderPayload,
  funnel: funnel as unknown as RenderPayload,
  gauge: gauge as unknown as RenderPayload,
  hbar: hbar as unknown as RenderPayload,
  heatmap: heatmap as unknown as RenderPayload,
  insight: insight as unknown as RenderPayload,
  kpi: kpi as unknown as RenderPayload,
  line: line as unknown as RenderPayload,
  map: map as unknown as RenderPayload,
  nav: nav as unknown as RenderPayload,
  pie: pie as unknown as RenderPayload,
  radar: radar as unknown as RenderPayload,
  rank_list: rankList as unknown as RenderPayload,
  scatter: scatter as unknown as RenderPayload,
  section: section as unknown as RenderPayload,
  table: table as unknown as RenderPayload,
  waterfall: waterfall as unknown as RenderPayload,
  wordcloud: wordcloud as unknown as RenderPayload,
};

export const fixtureKinds = Object.keys(fixtures);
