/** 分节标题的图标 —— 面板「图标」下拉里选的 key 映射到图标组件。
 *  之前只有下拉、没有落点（选了画布上没变化），这里补上唯一映射。 */

import {
  BarChartOutlined, CloudOutlined, GridViewOutlined, LightbulbOutlined,
  LocalOfferOutlined, PieChartOutline, TableChartOutlined,
} from "@mui/icons-material";

export const SECTION_ICONS: Record<string, typeof GridViewOutlined> = {
  grid: GridViewOutlined,
  chart: BarChartOutlined,
  pie: PieChartOutline,
  table: TableChartOutlined,
  cloud: CloudOutlined,
  tag: LocalOfferOutlined,
  bulb: LightbulbOutlined,
};
