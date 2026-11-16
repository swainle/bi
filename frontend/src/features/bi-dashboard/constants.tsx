// ====== 类型 ======
import {
  AccountBalance, Store, ShoppingCart, MusicNote, Pets as PetsIcon,
} from "@mui/icons-material";

export interface DataRow { [key: string]: string | number }
export type ChartType = "number" | "line" | "bar" | "pie" | "table" | "radar" | "funnel" | "sunburst" | "sankey" | "wordcloud";
export type PanelSize = "sm" | "md" | "lg";

export interface ChartPanel {
  id: string;
  type: ChartType;
  title: string;
  xField: string;
  yField: string;
  size: PanelSize;
  order: number;
}

export interface Template {
  name: string; icon: JSX.Element; category: string;
  data: DataRow[];
  panels: ChartPanel[];
}

// ====== 颜色 & 工具 ======
export const COLORS = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#EF4444", "#06B6D4", "#F97316", "#14B8A6"];
export const fmt = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString();
export const pId = () => "p-" + Date.now();

// ====== 团队共享类型 ======
export interface TeamDashboard {
  id: string; name: string; owner: string; owner_id: number;
  shared: boolean; allowed_users: number[];
  data: DataRow[]; panels: ChartPanel[];
  created_at: number; updated_at: number;
}
export interface UserBrief { id: number; username: string }

// ====== 数据源类型不再在前端硬编码 ======
// 唯一事实来源：后端 `app/sources/types_catalog.py`，经 `GET /bi/sources/types` 下发。
// 前端只负责渲染，避免「界面能选、后端报不支持」的两份清单。

// ====== 电商数据模板 ======
export const TEMPLATES: Template[] = [
  {
    name: "财务总览", icon: <AccountBalance />, category: "财务",
    data: [
      { 月份: "1月", 收入: 1820000, 成本: 1250000, 净利润: 570000, 毛利率: 31.3, 费用率: 18.5 },
      { 月份: "2月", 收入: 1560000, 成本: 1080000, 净利润: 480000, 毛利率: 30.8, 费用率: 19.2 },
      { 月份: "3月", 收入: 2100000, 成本: 1420000, 净利润: 680000, 毛利率: 32.4, 费用率: 17.8 },
      { 月份: "4月", 收入: 1950000, 成本: 1380000, 净利润: 570000, 毛利率: 29.2, 费用率: 20.1 },
      { 月份: "5月", 收入: 2480000, 成本: 1680000, 净利润: 800000, 毛利率: 32.3, 费用率: 17.5 },
      { 月份: "6月", 收入: 3120000, 成本: 2050000, 净利润: 1070000, 毛利率: 34.3, 费用率: 16.2 },
    ],
    panels: [
      { id: pId(), type: "number", title: "总收入", xField: "", yField: "收入", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "净利润", xField: "", yField: "净利润", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "毛利率", xField: "", yField: "毛利率", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "费用率", xField: "", yField: "费用率", size: "sm", order: 3 },
      { id: pId(), type: "line", title: "收入 vs 成本趋势", xField: "月份", yField: "收入", size: "lg", order: 4 },
      { id: pId(), type: "bar", title: "各月净利润", xField: "月份", yField: "净利润", size: "md", order: 5 },
      { id: pId(), type: "pie", title: "费用结构", xField: "月份", yField: "费用率", size: "md", order: 6 },
    ],
  },
  {
    name: "拼多多运营", icon: <Store />, category: "拼多多",
    data: [
      { 日期: "6/1", 浏览量: 8500, 访客数: 3200, 成交额: 28500, 转化率: 4.2, 客单: 89, 退款率: 3.5 },
      { 日期: "6/2", 浏览量: 9200, 访客数: 3600, 成交额: 31200, 转化率: 4.5, 客单: 87, 退款率: 2.8 },
      { 日期: "6/3", 浏览量: 7800, 访客数: 2900, 成交额: 24800, 转化率: 3.8, 客单: 85, 退款率: 4.1 },
      { 日期: "6/4", 浏览量: 10500, 访客数: 4100, 成交额: 35600, 转化率: 5.1, 客单: 87, 退款率: 2.5 },
      { 日期: "6/5", 浏览量: 9800, 访客数: 3800, 成交额: 33000, 转化率: 4.8, 客单: 87, 退款率: 3.2 },
      { 日期: "6/6", 浏览量: 11200, 访客数: 4500, 成交额: 42000, 转化率: 5.5, 客单: 93, 退款率: 2.1 },
      { 日期: "6/7", 浏览量: 8900, 访客数: 3400, 成交额: 29500, 转化率: 4.1, 客单: 87, 退款率: 3.8 },
    ],
    panels: [
      { id: pId(), type: "number", title: "累计成交额", xField: "", yField: "成交额", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "平均转化率", xField: "", yField: "转化率", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "平均客单", xField: "", yField: "客单", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "平均退款率", xField: "", yField: "退款率", size: "sm", order: 3 },
      { id: pId(), type: "line", title: "成交额走势", xField: "日期", yField: "成交额", size: "lg", order: 4 },
      { id: pId(), type: "bar", title: "流量概览", xField: "日期", yField: "浏览量", size: "md", order: 5 },
      { id: pId(), type: "table", title: "运营明细", xField: "", yField: "", size: "lg", order: 6 },
    ],
  },
  {
    name: "天猫经营", icon: <ShoppingCart />, category: "天猫",
    data: [
      { 日期: "6/1", GMV: 158000, UV: 6200, 支付买家: 850, 客单: 186, ROI: 3.2, 推广费: 12000 },
      { 日期: "6/2", GMV: 182000, UV: 7100, 支付买家: 960, 客单: 190, ROI: 3.8, 推广费: 13500 },
      { 日期: "6/3", GMV: 135000, UV: 5800, 支付买家: 720, 客单: 188, ROI: 2.9, 推广费: 14000 },
      { 日期: "6/4", GMV: 210000, UV: 8500, 支付买家: 1100, 客单: 191, ROI: 4.2, 推广费: 15200 },
      { 日期: "6/5", GMV: 195000, UV: 7800, 支付买家: 1020, 客单: 191, ROI: 3.6, 推广费: 14800 },
      { 日期: "6/6", GMV: 245000, UV: 9800, 支付买家: 1280, 客单: 191, ROI: 4.5, 推广费: 16500 },
      { 日期: "6/7", GMV: 178000, UV: 6900, 支付买家: 930, 客单: 191, ROI: 3.4, 推广费: 13800 },
    ],
    panels: [
      { id: pId(), type: "number", title: "累计 GMV", xField: "", yField: "GMV", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "平均 ROI", xField: "", yField: "ROI", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "总推广费", xField: "", yField: "推广费", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "支付买家", xField: "", yField: "支付买家", size: "sm", order: 3 },
      { id: pId(), type: "line", title: "GMV 趋势", xField: "日期", yField: "GMV", size: "lg", order: 4 },
      { id: pId(), type: "bar", title: "UV vs 买家", xField: "日期", yField: "UV", size: "md", order: 5 },
      { id: pId(), type: "pie", title: "日 ROI 分布", xField: "日期", yField: "ROI", size: "md", order: 6 },
    ],
  },
  {
    name: "抖音电商", icon: <MusicNote />, category: "抖音",
    data: [
      { 日期: "6/1", 播放量: 125000, 互动率: 8.5, 成交额: 68000, 粉丝增量: 1200, 直播时长: 6.5, 平均在线: 850 },
      { 日期: "6/2", 播放量: 148000, 互动率: 9.2, 成交额: 82000, 粉丝增量: 1500, 直播时长: 7, 平均在线: 1020 },
      { 日期: "6/3", 播放量: 98000, 互动率: 7.8, 成交额: 55000, 粉丝增量: 850, 直播时长: 5.5, 平均在线: 720 },
      { 日期: "6/4", 播放量: 185000, 互动率: 10.5, 成交额: 105000, 粉丝增量: 2100, 直播时长: 8, 平均在线: 1350 },
      { 日期: "6/5", 播放量: 162000, 互动率: 9.8, 成交额: 92000, 粉丝增量: 1800, 直播时长: 7.5, 平均在线: 1150 },
      { 日期: "6/6", 播放量: 210000, 互动率: 11.2, 成交额: 128000, 粉丝增量: 2500, 直播时长: 8.5, 平均在线: 1580 },
      { 日期: "6/7", 播放量: 142000, 互动率: 8.9, 成交额: 78000, 粉丝增量: 1400, 直播时长: 6, 平均在线: 920 },
    ],
    panels: [
      { id: pId(), type: "number", title: "总播放量", xField: "", yField: "播放量", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "总成交额", xField: "", yField: "成交额", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "平均互动率", xField: "", yField: "互动率", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "新增粉丝", xField: "", yField: "粉丝增量", size: "sm", order: 3 },
      { id: pId(), type: "line", title: "播放 & 成交", xField: "日期", yField: "播放量", size: "lg", order: 4 },
      { id: pId(), type: "bar", title: "直播数据", xField: "日期", yField: "平均在线", size: "md", order: 5 },
      { id: pId(), type: "table", title: "带货明细", xField: "", yField: "", size: "lg", order: 6 },
    ],
  },
  // ====== 拼多多店铺利润 ======
  {
    name: "拼多多店铺利润", icon: <Store />, category: "拼多多",
    data: [
      { 店铺: "店铺A·猫零食主力店", 季度收入: 38500000, 广告费: 8200000, 物流成本: 5600000, 净利润: 12700000, 利润率: 33.0, 订单量: 452000 },
      { 店铺: "店铺B·猫粮专营店", 季度收入: 42800000, 广告费: 9100000, 物流成本: 6200000, 净利润: 14200000, 利润率: 33.2, 订单量: 518000 },
      { 店铺: "店铺C·宠物用品店", 季度收入: 51200000, 广告费: 10800000, 物流成本: 7100000, 净利润: 17500000, 利润率: 34.2, 订单量: 625000 },
      { 店铺: "店铺D·冻干专营店", 季度收入: 28500000, 广告费: 6200000, 物流成本: 4200000, 净利润: 9200000, 利润率: 32.3, 订单量: 328000 },
      { 店铺: "店铺E·综合旗舰店", 季度收入: 65800000, 广告费: 13500000, 物流成本: 8800000, 净利润: 22800000, 利润率: 34.7, 订单量: 782000 },
    ],
    panels: [
      { id: pId(), type: "number", title: "总季度收入", xField: "", yField: "季度收入", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "总净利润", xField: "", yField: "净利润", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "平均利润率", xField: "", yField: "利润率", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "总订单量", xField: "", yField: "订单量", size: "sm", order: 3 },
      { id: pId(), type: "bar", title: "各店季度收入", xField: "店铺", yField: "季度收入", size: "lg", order: 4 },
      { id: pId(), type: "bar", title: "成本结构对比", xField: "店铺", yField: "广告费", size: "md", order: 5 },
      { id: pId(), type: "pie", title: "净利润占比", xField: "店铺", yField: "净利润", size: "md", order: 6 },
      { id: pId(), type: "table", title: "店铺利润明细", xField: "", yField: "", size: "lg", order: 7 },
    ],
  },
  // ====== 拼多多年度汇总 ======
  {
    name: "拼多多年度汇总", icon: <Store />, category: "拼多多",
    data: [
      { 月份: "1月", GMV: 21800000, 推广费: 4500000, ROI: 4.8, 客单: 89, 复购率: 32, 退货率: 4.2 },
      { 月份: "2月", GMV: 19600000, 推广费: 4200000, ROI: 4.7, 客单: 86, 复购率: 30, 退货率: 4.5 },
      { 月份: "3月", GMV: 25200000, 推广费: 5200000, ROI: 4.8, 客单: 91, 复购率: 33, 退货率: 3.8 },
      { 月份: "4月", GMV: 28500000, 推广费: 5800000, ROI: 4.9, 客单: 93, 复购率: 35, 退货率: 3.6 },
      { 月份: "5月", GMV: 32000000, 推广费: 6500000, ROI: 4.9, 客单: 95, 复购率: 36, 退货率: 3.4 },
      { 月份: "6月", GMV: 35800000, 推广费: 7200000, ROI: 5.0, 客单: 97, 复购率: 38, 退货率: 3.2 },
      { 月份: "7月", GMV: 31200000, 推广费: 6400000, ROI: 4.9, 客单: 94, 复购率: 37, 退货率: 3.5 },
      { 月份: "8月", GMV: 34500000, 推广费: 7000000, ROI: 4.9, 客单: 96, 复购率: 38, 退货率: 3.3 },
      { 月份: "9月", GMV: 38000000, 推广费: 7600000, ROI: 5.0, 客单: 98, 复购率: 39, 退货率: 3.1 },
      { 月份: "10月", GMV: 42000000, 推广费: 8400000, ROI: 5.0, 客单: 100, 复购率: 40, 退货率: 2.9 },
      { 月份: "11月", GMV: 65000000, 推广费: 12000000, ROI: 5.4, 客单: 108, 复购率: 45, 退货率: 2.5 },
      { 月份: "12月", GMV: 78000000, 推广费: 14000000, ROI: 5.6, 客单: 112, 复购率: 48, 退货率: 2.2 },
    ],
    panels: [
      { id: pId(), type: "number", title: "年度 GMV", xField: "", yField: "GMV", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "平均 ROI", xField: "", yField: "ROI", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "总推广费", xField: "", yField: "推广费", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "平均客单", xField: "", yField: "客单", size: "sm", order: 3 },
      { id: pId(), type: "number", title: "年末复购率", xField: "", yField: "复购率", size: "sm", order: 4 },
      { id: pId(), type: "line", title: "GMV 月度走势", xField: "月份", yField: "GMV", size: "lg", order: 5 },
      { id: pId(), type: "bar", title: "推广费与 GMV", xField: "月份", yField: "推广费", size: "md", order: 6 },
      { id: pId(), type: "pie", title: "退货率分布", xField: "月份", yField: "退货率", size: "md", order: 7 },
      { id: pId(), type: "table", title: "年度明细", xField: "", yField: "", size: "lg", order: 8 },
    ],
  },
  // ====== 拼多多流量分析 ======
  {
    name: "拼多多流量分析", icon: <Store />, category: "拼多多",
    data: [
      { 渠道: "搜索", 曝光量: 28500000, 点击量: 3420000, 点击率: 12.0, 成交额: 18500000, 转化率: 5.4, 平均排名: 3.2 },
      { 渠道: "推荐", 曝光量: 42000000, 点击量: 3780000, 点击率: 9.0, 成交额: 22000000, 转化率: 5.8, 平均排名: 2.8 },
      { 渠道: "直播", 曝光量: 15800000, 点击量: 2520000, 点击率: 16.0, 成交额: 15200000, 转化率: 6.0, 平均排名: 1.5 },
      { 渠道: "活动页", 曝光量: 12500000, 点击量: 1870000, 点击率: 15.0, 成交额: 9800000, 转化率: 5.2, 平均排名: 4.1 },
      { 渠道: "多多果园", 曝光量: 8200000, 点击量: 1050000, 点击率: 12.8, 成交额: 5200000, 转化率: 5.0, 平均排名: 3.8 },
      { 渠道: "短视频", 曝光量: 19500000, 点击量: 2340000, 点击率: 12.0, 成交额: 12800000, 转化率: 5.5, 平均排名: 2.2 },
      { 渠道: "拼小圈", 曝光量: 4800000, 点击量: 672000, 点击率: 14.0, 成交额: 3500000, 转化率: 5.2, 平均排名: 3.5 },
    ],
    panels: [
      { id: pId(), type: "number", title: "总曝光量", xField: "", yField: "曝光量", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "总成交额", xField: "", yField: "成交额", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "平均点击率", xField: "", yField: "点击率", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "平均转化率", xField: "", yField: "转化率", size: "sm", order: 3 },
      { id: pId(), type: "bar", title: "各渠道曝光量", xField: "渠道", yField: "曝光量", size: "lg", order: 4 },
      { id: pId(), type: "line", title: "渠道成交额", xField: "渠道", yField: "成交额", size: "md", order: 5 },
      { id: pId(), type: "pie", title: "渠道成交占比", xField: "渠道", yField: "成交额", size: "md", order: 6 },
      { id: pId(), type: "table", title: "渠道流量明细", xField: "", yField: "", size: "lg", order: 7 },
    ],
  },
  // ====== 产品部-宠物优选 ======
  {
    name: "产品部·宠物优选", icon: <PetsIcon />, category: "产品部",
    data: [
      { 产品: "鸡肉粒冻干", 月销量: 85000, GMV: 4250000, 好评率: 98.5, 复购率: 45, 退货率: 1.2, 客单: 50, 毛利率: 62 },
      { 产品: "三文鱼冻干", 月销量: 62000, GMV: 3720000, 好评率: 97.8, 复购率: 38, 退货率: 1.5, 客单: 60, 毛利率: 58 },
      { 产品: "猫粮·全价成猫", 月销量: 48000, GMV: 5760000, 好评率: 96.5, 复购率: 52, 退货率: 2.1, 客单: 120, 毛利率: 45 },
      { 产品: "猫粮·幼猫配方", 月销量: 35000, GMV: 4550000, 好评率: 97.2, 复购率: 48, 退货率: 1.8, 客单: 130, 毛利率: 48 },
      { 产品: "猫条·混合口味", 月销量: 120000, GMV: 3600000, 好评率: 98.2, 复购率: 55, 退货率: 0.8, 客单: 30, 毛利率: 68 },
      { 产品: "营养膏·美毛配方", 月销量: 28000, GMV: 1960000, 好评率: 96.8, 复购率: 32, 退货率: 2.5, 客单: 70, 毛利率: 72 },
      { 产品: "猫罐头·金枪鱼", 月销量: 55000, GMV: 2750000, 好评率: 97.5, 复购率: 42, 退货率: 1.6, 客单: 50, 毛利率: 55 },
      { 产品: "猫薄荷玩具", 月销量: 180000, GMV: 1800000, 好评率: 99.1, 复购率: 25, 退货率: 0.5, 客单: 10, 毛利率: 80 },
    ],
    panels: [
      { id: pId(), type: "number", title: "月总 GMV", xField: "", yField: "GMV", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "月总销量", xField: "", yField: "月销量", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "平均好评率", xField: "", yField: "好评率", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "平均毛利率", xField: "", yField: "毛利率", size: "sm", order: 3 },
      { id: pId(), type: "bar", title: "产品销量排行", xField: "产品", yField: "月销量", size: "lg", order: 4 },
      { id: pId(), type: "bar", title: "产品 GMV 对比", xField: "产品", yField: "GMV", size: "md", order: 5 },
      { id: pId(), type: "pie", title: "GMV 产品占比", xField: "产品", yField: "GMV", size: "md", order: 6 },
      { id: pId(), type: "table", title: "产品数据明细", xField: "", yField: "", size: "lg", order: 7 },
    ],
  },
  // ====== 天猫月度复盘 ======
  {
    name: "天猫月度复盘", icon: <ShoppingCart />, category: "天猫",
    data: [
      { 月份: "1月", GMV: 28500000, 访客数: 1850000, 支付转化: 4.2, 客单: 192, 推广费: 2800000, ROI: 10.2, 新客占比: 28 },
      { 月份: "2月", GMV: 25200000, 访客数: 1620000, 支付转化: 4.0, 客单: 188, 推广费: 2500000, ROI: 10.1, 新客占比: 26 },
      { 月份: "3月", GMV: 32500000, 访客数: 2100000, 支付转化: 4.5, 客单: 195, 推广费: 3100000, ROI: 10.5, 新客占比: 30 },
      { 月份: "4月", GMV: 35800000, 访客数: 2280000, 支付转化: 4.6, 客单: 198, 推广费: 3400000, ROI: 10.5, 新客占比: 32 },
      { 月份: "5月", GMV: 42000000, 访客数: 2650000, 支付转化: 4.8, 客单: 202, 推广费: 3900000, ROI: 10.8, 新客占比: 34 },
      { 月份: "6月", GMV: 51500000, 访客数: 3200000, 支付转化: 5.0, 客单: 205, 推广费: 4800000, ROI: 10.7, 新客占比: 36 },
    ],
    panels: [
      { id: pId(), type: "number", title: "半年 GMV", xField: "", yField: "GMV", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "平均 ROI", xField: "", yField: "ROI", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "总访客", xField: "", yField: "访客数", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "新客占比", xField: "", yField: "新客占比", size: "sm", order: 3 },
      { id: pId(), type: "line", title: "GMV 月度趋势", xField: "月份", yField: "GMV", size: "lg", order: 4 },
      { id: pId(), type: "bar", title: "访客与转化", xField: "月份", yField: "访客数", size: "md", order: 5 },
      { id: pId(), type: "table", title: "月度明细", xField: "", yField: "", size: "lg", order: 6 },
    ],
  },
  // ====== 天猫活动分析 ======
  {
    name: "天猫活动分析", icon: <ShoppingCart />, category: "天猫",
    data: [
      { 活动: "618开门红", GMV: 88000000, 访客: 5200000, 新客: 1850000, 推广费: 8200000, ROI: 10.7, 客单: 210, 券使用率: 68 },
      { 活动: "618爆发日", GMV: 125000000, 访客: 7200000, 新客: 2500000, 推广费: 11500000, ROI: 10.9, 客单: 215, 券使用率: 72 },
      { 活动: "99大促", GMV: 55000000, 访客: 3400000, 新客: 980000, 推广费: 5200000, ROI: 10.6, 客单: 198, 券使用率: 62 },
      { 活动: "双11预售", GMV: 98000000, 访客: 6800000, 新客: 2200000, 推广费: 9500000, ROI: 10.3, 客单: 205, 券使用率: 75 },
      { 活动: "双11爆发", GMV: 185000000, 访客: 10500000, 新客: 3800000, 推广费: 17500000, ROI: 10.6, 客单: 220, 券使用率: 78 },
      { 活动: "双12", GMV: 68000000, 访客: 4100000, 新客: 1200000, 推广费: 6200000, ROI: 11.0, 客单: 208, 券使用率: 65 },
      { 活动: "年货节", GMV: 42000000, 访客: 2800000, 新客: 750000, 推广费: 3800000, ROI: 11.1, 客单: 195, 券使用率: 60 },
    ],
    panels: [
      { id: pId(), type: "number", title: "大促总 GMV", xField: "", yField: "GMV", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "平均 ROI", xField: "", yField: "ROI", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "总新客", xField: "", yField: "新客", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "总推广费", xField: "", yField: "推广费", size: "sm", order: 3 },
      { id: pId(), type: "bar", title: "活动 GMV 排行", xField: "活动", yField: "GMV", size: "lg", order: 4 },
      { id: pId(), type: "line", title: "ROI 对比", xField: "活动", yField: "ROI", size: "md", order: 5 },
      { id: pId(), type: "pie", title: "新客增来源", xField: "活动", yField: "新客", size: "md", order: 6 },
      { id: pId(), type: "table", title: "活动复盘表", xField: "", yField: "", size: "lg", order: 7 },
    ],
  },
  // ====== 抖音直播复盘 ======
  {
    name: "抖音直播复盘", icon: <MusicNote />, category: "抖音",
    data: [
      { 场次: "618宠粉专场", 观看人数: 2850000, 峰值在线: 35000, GMV: 12500000, 转化率: 6.2, 千次观看成交: 4385, 新粉: 85000, 互动率: 12.5 },
      { 场次: "新品首发·冻干", 观看人数: 1580000, 峰值在线: 18000, GMV: 6800000, 转化率: 5.8, 千次观看成交: 4304, 新粉: 32000, 互动率: 10.8 },
      { 场次: "周末特卖", 观看人数: 920000, 峰值在线: 12000, GMV: 3800000, 转化率: 5.5, 千次观看成交: 4130, 新粉: 18000, 互动率: 9.5 },
      { 场次: "猫粮专场", 观看人数: 1850000, 峰值在线: 22000, GMV: 8500000, 转化率: 6.0, 千次观看成交: 4595, 新粉: 42000, 互动率: 11.2 },
      { 场次: "双11狂欢夜", 观看人数: 4200000, 峰值在线: 55000, GMV: 22000000, 转化率: 7.5, 千次观看成交: 5238, 新粉: 120000, 互动率: 15.8 },
      { 场次: "年货节直播", 观看人数: 2100000, 峰值在线: 28000, GMV: 9800000, 转化率: 6.5, 千次观看成交: 4667, 新粉: 52000, 互动率: 12.2 },
    ],
    panels: [
      { id: pId(), type: "number", title: "总 GMV", xField: "", yField: "GMV", size: "sm", order: 0 },
      { id: pId(), type: "number", title: "总观看", xField: "", yField: "观看人数", size: "sm", order: 1 },
      { id: pId(), type: "number", title: "平均转化率", xField: "", yField: "转化率", size: "sm", order: 2 },
      { id: pId(), type: "number", title: "新增粉丝", xField: "", yField: "新粉", size: "sm", order: 3 },
      { id: pId(), type: "bar", title: "各场 GMV 排行", xField: "场次", yField: "GMV", size: "lg", order: 4 },
      { id: pId(), type: "line", title: "千次成交趋势", xField: "场次", yField: "千次观看成交", size: "md", order: 5 },
      { id: pId(), type: "pie", title: "GMV 场次占比", xField: "场次", yField: "GMV", size: "md", order: 6 },
      { id: pId(), type: "table", title: "直播数据明细", xField: "", yField: "", size: "lg", order: 7 },
    ],
  },
];

// ====== 默认空状态 ======
export const DEMO_DATA: DataRow[] = [
  { 月份: "1月", 销售额: 82000, 利润: 24000, 订单数: 156 },
  { 月份: "2月", 销售额: 91000, 利润: 28000, 订单数: 172 },
  { 月份: "3月", 销售额: 105000, 利润: 32000, 订单数: 198 },
  { 月份: "4月", 销售额: 98000, 利润: 29000, 订单数: 185 },
  { 月份: "5月", 销售额: 128000, 利润: 41000, 订单数: 234 },
  { 月份: "6月", 销售额: 142000, 利润: 45000, 订单数: 267 },
  { 月份: "7月", 销售额: 136000, 利润: 42000, 订单数: 248 },
  { 月份: "8月", 销售额: 155000, 利润: 48000, 订单数: 289 },
  { 月份: "9月", 销售额: 162000, 利润: 51000, 订单数: 312 },
  { 月份: "10月", 销售额: 148000, 利润: 44000, 订单数: 275 },
  { 月份: "11月", 销售额: 178000, 利润: 56000, 订单数: 345 },
  { 月份: "12月", 销售额: 210000, 利润: 68000, 订单数: 412 },
];

export const DEMO_PANELS: ChartPanel[] = [
  { id: "p1", type: "number", title: "总销售额", xField: "", yField: "销售额", size: "sm", order: 0 },
  { id: "p2", type: "number", title: "总订单数", xField: "", yField: "订单数", size: "sm", order: 1 },
  { id: "p3", type: "number", title: "总利润", xField: "", yField: "利润", size: "sm", order: 2 },
  { id: "p4", type: "number", title: "月均订单", xField: "", yField: "订单数", size: "sm", order: 3 },
  { id: "p5", type: "line", title: "月度趋势", xField: "月份", yField: "销售额", size: "lg", order: 4 },
  { id: "p6", type: "bar", title: "各月对比", xField: "月份", yField: "销售额", size: "md", order: 5 },
  { id: "p7", type: "pie", title: "利润占比", xField: "月份", yField: "利润", size: "md", order: 6 },
  { id: "p8", type: "table", title: "明细数据", xField: "", yField: "", size: "lg", order: 7 },
];
