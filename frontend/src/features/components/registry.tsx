/** 渲染器注册表 —— 新增一种图表只改这里 + 加一个 renderer 文件 */

import type { ComponentKind, ComponentRole, RenderPayload, TableColumn, UiSpec } from "./types";
import KpiCard from "./renderers/KpiCard";
import BarCard from "./renderers/BarCard";
import HbarCard from "./renderers/HbarCard";
import LineCard from "./renderers/LineCard";
import AreaCard from "./renderers/AreaCard";
import PieCard from "./renderers/PieCard";
import HeatmapCard from "./renderers/HeatmapCard";
import WordCloudCard from "./renderers/WordCloudCard";
import FunnelCard from "./renderers/FunnelCard";
import GaugeCard from "./renderers/GaugeCard";
import RadarCard from "./renderers/RadarCard";
import WaterfallCard from "./renderers/WaterfallCard";
import MapCard from "./renderers/MapCard";
import TableCard from "./renderers/TableCard";
import ScatterCard from "./renderers/ScatterCard";
import ComboCard from "./renderers/ComboCard";
import RankListCard from "./renderers/RankListCard";
import RecoListCard from "./renderers/RecoListCard";
import InsightCard from "./renderers/InsightCard";
import SectionCard from "./renderers/SectionCard";
import FilterCard from "./renderers/FilterCard";
import BannerCard from "./renderers/BannerCard";
import NavCard, { type NavPayload, type NavUi } from "./renderers/NavCard";

export interface RendererProps {
  payload: RenderPayload;
  ui: UiSpec;
  /** 缩略图模式：不画标题/注释/坐标轴文字 */
  compact?: boolean;
  /** 表格：行点击 */
  onRowClick?: (row: Record<string, unknown>) => void;
  /** KPI / 榜卡：整卡点击 */
  onClick?: () => void;
  /** 指标卡：右上角徽标点击（打开独立的 TOP N 榜单弹窗） */
  onTopList?: () => void;
  /** 当前所在页面 key（导航卡推导「当前页」高亮） */
  currentPage?: string;
  /** 导航卡挂了页面的菜单项被点击 → 切到那一页（预览页接） */
  onNavigate?: (page: string) => void;
  /** 明细表卡自带的「导出 CSV」（成品页接，导这张表的数据集） */
  onExport?: () => void;
  /** 图表联动：点击类目（柱 / 饼 / 漏斗 / 排行项）→ 交叉筛选其他卡片 */
  onSliceClick?: (name: string) => void;
}

type Renderer = (props: RendererProps) => JSX.Element;

export const RENDERERS: Record<ComponentKind, Renderer> = {
  kpi: KpiCard,
  bar: BarCard,
  hbar: HbarCard,
  line: LineCard,
  area: AreaCard,
  pie: (props: RendererProps) => <PieCard {...props} />,
  donut: (props: RendererProps) => <PieCard {...props} donut />,
  heatmap: HeatmapCard,
  wordcloud: WordCloudCard,
  funnel: FunnelCard,
  gauge: GaugeCard,
  radar: RadarCard,
  waterfall: WaterfallCard,
  map: MapCard,
  table: TableCard,
  scatter: ScatterCard,
  combo: ComboCard,
  rank_list: RankListCard,
  reco_list: RecoListCard,
  insight: InsightCard,
  section: (props: RendererProps) => <SectionCard payload={props.payload} ui={props.ui} compact={props.compact} />,
  filter: FilterCard,
  banner: BannerCard,
  nav: (props: RendererProps) => (
    <NavCard
      payload={props.payload as unknown as NavPayload}
      ui={props.ui as unknown as NavUi}
      compact={props.compact}
      currentPage={props.currentPage}
      onNavigate={props.onNavigate}
    />
  ),
};

export const KIND_LABEL: Record<ComponentKind, string> = {
  kpi: "指标卡",
  bar: "柱状图",
  hbar: "排行条形",
  line: "折线图",
  area: "面积图",
  pie: "饼图",
  donut: "环形图",
  heatmap: "热力矩阵",
  wordcloud: "词云",
  funnel: "漏斗图",
  gauge: "仪表盘",
  radar: "雷达图",
  waterfall: "瀑布图",
  map: "地图",
  table: "明细表",
  scatter: "散点图",
  combo: "柱线组合",
  rank_list: "排行列表",
  reco_list: "推荐列表",
  insight: "结论卡",
  section: "分节标题",
  filter: "筛选栏",
  banner: "头标卡",
  nav: "导航菜单卡",
};

/** 组件角色：左侧面板分组、编辑器面板差异都看它 */
export const KIND_ROLE: Record<ComponentKind, ComponentRole> = {
  kpi: "data", bar: "data", hbar: "data", line: "data", area: "data",
  pie: "data", donut: "data", heatmap: "data", wordcloud: "data", table: "data",
  scatter: "data", combo: "data", rank_list: "data", reco_list: "data",
  funnel: "data", gauge: "data", radar: "data", waterfall: "data", map: "data",
  insight: "content", section: "structure", filter: "param", banner: "content", nav: "content",
};

export const ROLE_LABEL: Record<ComponentRole, string> = {
  data: "数据组件",
  content: "内容组件",
  structure: "结构组件",
  param: "筛选组件",
};
