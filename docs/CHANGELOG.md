# 明策BI · 更新日志

> 功能与界面的改动日记。**只在顶部追加，不改历史**。
> 每条写清四件事：**改了什么 · 为什么 · 涉及文件 · 怎么验证**。
> 类型只用：`新增` / `优化` / `修复` / `重构` / `数据`。
> 同一个功能的多轮打磨合并成一条，后续改动在条末追「· 迭代」。
> 交付顺序：改代码 → `tsc --noEmit` → 真机截图自检（对齐 / 折行 / 溢出 / 空态）→ 写这里。

---
## 2026-11-23 · 优化：组合图「图例文字」挪到首选项

- 「柱名称 / 线名称」（就是图例和提示框里显示的两个系列名）原来藏在「通用 · 文字」里，
  现在放到 **附加 · 首选项**、紧跟「柱 / 线」开关：`柱 / 线 → 柱名称 → 线名称 → 组件元素`。
- 同一语义只保留一个入口：文字区里那两行已删除。
- 空值时占位提示「默认 = 左轴/右轴指标名」，不留空输入框。
- **文件**：`frontend/src/features/components/editor/ChartOptionsPanel.tsx`。
- **怎么验证**：doc5 临时组合图（验完已还原）—— 面板实测 `首选项 | 柱 / 线 | 右轴 | 曲线平滑 | 柱名称 | 线名称 | 组件元素 | …`，
  两行取值 `上榜榜单数 / 总销量`。`tsc --noEmit` 0。

---
## 2026-11-23 · 新增：组合图左右 Y 轴分别设置刻度/格式 + 提示框跟随格式

- **附加 · 坐标轴**（组合图）：`左Y最大 / 左Y最小 / 左Y格式 / 右Y最大 / 右Y最小 / 右Y格式 / 标签旋转`，
  右轴格式多一个「同左轴」选项。
- 后端 `ChartSpec` 新增 `y2_min / y2_max / y2_format`（前端类型同步）；渲染时左轴用 `y_min/y_max/label_format`、
  右轴用 `y2_*`（空则回落左轴）。
- **提示框**：原来用 ECharts 默认 formatter（显示原始精度，且格式不受设置影响）；
  现在柱按左轴格式、线按右轴格式格式化，名字仍取「柱名称 / 线名称」。
- **文件**：`backend/app/components/spec.py`、`frontend/src/features/components/types.ts`、
  `editor/ChartOptionsPanel.tsx`、`renderers/ComboCard.tsx`。
- **怎么验证**：doc5 临时组合图（`y_min=0, y_max=10, label_format=int, y2_min=0, y2_max=2000000, y2_format=w`，验完已还原）——
  面板实测 `左Y最大 / 左Y最小 / 左Y格式 整数 / 右Y最大 / 右Y最小 / 右Y格式 万 / 标签旋转`；
  截图 `docs/_selfcheck/2026-11-23-combo-axes.png`：左轴 0~10、右轴 0.0万~200.0万。`tsc --noEmit` 0。
  （提示框需要在页面上悬停看一眼，自动化没抓。）

---
## 2026-11-23 · 修复：组合图 X 轴类目名大部分不显示

- **原因**：`xAxis.axisLabel` 带了 `hideOverlap: true`。品牌名这类长类目互相重叠，ECharts 就把大部分标签直接隐藏，
  所以只有零星几个名字露出来（用户截图里就是这样）。
- **修复**：去掉 `hideOverlap`，改 `interval: 0`（全部显示）+ `overflow: "truncate", width: 64`（超长省略号），
  完整名字在 tooltip 里看；需要更多字符就把「标签旋转」调 30/45。
- **文件**：`frontend/src/features/components/renderers/ComboCard.tsx`。
- **怎么验证**：doc5 临时组合图（横轴 `brand_name`，左轴 `COUNT_DISTINCT(rank_name)`，右轴 `SUM(daily_deal)`，验完已还原）——
  截图 `docs/_selfcheck/2026-11-23-combo-xlabels.png`：8 个品牌名全部出现（超长截断），右轴刻度也在。`tsc --noEmit` 0。

---
## 2026-11-23 · 修复：点击弹窗的过滤真的生效了（并加可见标记）

- 排查结论：过滤逻辑本身没问题，**问题是弹窗那张明细表里没有图表用的维度列**（doc5 的 `tt_table` 没有 `platform_code`），
  过滤命中 0 行 → 上一版为了不弹空表退回全量 → 看起来「没筛选」。
- 现在：过滤生效时弹窗顶部显示一枚小胶囊 `week_key = 2026-W47`，一眼能看出「这次是按什么筛的」；
  命中 0 行仍退回全量（避免空表）。
- **文件**：`frontend/src/features/components/board/TopListDialog.tsx`（另有 PieCard / ComboCard 上报列名、DashboardPage 兜底）。
- **怎么验证**：doc5 临时环形图（维度 `week_key`，`top.table_key=tt_table`，验完已还原）—— 实际点击扇区后
  胶囊显示 `week_key = 2026-W47`，弹窗表格只出现该周的行（每页 10 条）。`tsc --noEmit` 0。

---
## 2026-11-23 · 修复：点图表弹窗没有按点击值过滤明细表

- **过滤列来源改稳**：原来取 `item.spec.binding.dimension`（可能为空），现在由卡片自己报渲染用的列
  （`payload.dimension_label`），页面再用 `dimension / dimensions[0]` 兜底。
- **明细表没有这一列时退回全量**：过滤后 0 行就显示全部，不再弹一个空表
  （实测 doc5 的 `tt_table` 列是 `item_id / product_title / bad_cnt_30d / daily_deal / week_key / listed_date …`，
  **没有 `platform_code`** —— 用环形图的 `platform_code` 去过滤必然 0 行）。
- **文件**：`renderers/PieCard.tsx`、`renderers/ComboCard.tsx`、`viewer/DashboardPage.tsx`、`board/TopListDialog.tsx`。
- **怎么验证**：`tsc --noEmit` 0；`/render` 实测 `pie.dimension_label = platform_code`、`tt_table.rows[0]` 的列名如上（无 platform_code）。
  ⚠️ 画布点击我的自动化点不到（canvas 坐标不稳），需要你点一下确认；要真正看到过滤效果，
  弹窗指向的明细表里必须**有和图表相同的维度列**（例如都按 `week_key`）。

---
## 2026-11-23 · 修复：组合图折线 Y 轴刻度不显示 + 删除「不受筛选器影响」

- **组合图右轴刻度**：`yAxis[1]` 少了 `position: "right"`，ECharts 会把它叠在左轴上，看起来「没有刻度」。
  现在右侧独立显示（并去掉原来窄卡就整条隐藏的逻辑，只保留 compact 场景隐藏）。
- **删除「不受筛选器影响」**：环形图 / 组合图首选项里的开关、后端 `ignore_filters` 字段与 `_render_card` 的跳过逻辑全部移除，
  恢复「筛选器对所有组件生效」。
- **文件**：`frontend/src/features/components/renderers/ComboCard.tsx`、`editor/ChartOptionsPanel.tsx`、
  `editor/QueryPanel.tsx`、`types.ts`、`backend/app/components/spec.py`、`backend/app/dashboards/render.py`。
- **怎么验证**：doc5 临时环形图 + 组合图（验完已还原）——
  带 `cross_filters=[platform_code=tmall]` 时环形图 series = `["tmall"]`（筛选重新生效）；
  组合图截图 `docs/_selfcheck/2026-11-23-combo-right-axis.png`：左轴 0~500,000、右轴 0~15 都在。
  `tsc --noEmit` 0、`vitest` 55 项通过。

---
## 2026-11-23 · 新增：筛选字段「影响组件」范围（齿轮按钮 + 组件树勾选）

- 筛选栏每张字段卡的折叠箭头左边多了一个 **齿轮**：点开是「影响组件」对话框，树状列出**本页组件**（页面 → 组件），
  前面带复选框；不勾就不影响那个组件。全勾 = 影响全部（存空数组，语义等同默认）。
- 数据：`FilterFieldSpec.targets: string[]`（空 = 全部）。后端 `_page_filters` 把 `targets` 带到每条过滤条件上，
  `_render_card` 只对被勾中的卡片应用该条件。
- **文件**：`backend/app/components/spec.py`、`backend/app/dashboards/render.py`、
  `frontend/src/features/components/types.ts`、`editor/FilterFieldsEditor.tsx`、
  `pages/canvas/panels.tsx`、`pages/canvas/MiddleConfigPane.tsx`。
- **怎么验证**：doc5 临时造了一张筛选字段（`column=platform_code`，默认 `tmall`，`targets=["tmp_f1"]`）+ 两张柱图（验完已还原）——
  `/render` 实测：`tmp_f1 → ["tmall"]`（被过滤）、`tmp_f2 → ["tmall","jd","douyin","pdd"]`（不受影响）。`tsc --noEmit` 0。
  ⚠️ 齿轮对话框的交互我还没在界面上点过，麻烦你点开确认一眼。

---
## 2026-11-23 · 优化：明细表「字段 · 添加字段」改成拖拽自动输入框

- 原来是「＋ 添加字段」虚线按钮 + 弹出分组菜单；现在换成 `AxisInput`：能把左侧字段/指标直接拖进来，
  也能打字过滤后回车添加（选项 = 指标 / 列 / 标识 里还没选中的字段）。
- 样式与其它拖拽框一致：浅紫底 `rgba(99,102,241,0.05)` + 虚线边 + 「拖到这里」。
- 顺带删掉不再需要的菜单、`anchor` / `dropField` 状态和 `Menu`、`MenuItem`、`Check` 引用。
- **文件**：`frontend/src/features/components/editor/TableFieldsEditor.tsx`。
- **怎么验证**：doc1 明细表 —— 展开「字段」后实测存在 `placeholder=拖到这里` 的输入框，
  计算样式 `bg=rgba(99,102,241,0.05)`、`border=dashed`。`tsc --noEmit` 0。

---
## 2026-11-23 · 新增：环形图 / 柱线组合「不受筛选器影响」+ 点击弹窗按点击值过滤

- **首选项 · 不受筛选器影响**：环形图（含饼图）和柱线组合的首选项里新增开关，**默认开启**；
  写 `binding.ignore_filters`（`null` = 按类型默认：`pie / donut / combo` 视为 true，其它图表仍受筛选器控制）。
  后端在 `_render_card` 里据此跳过页面筛选 / 联动筛选。
- **点击弹窗过滤**：点扇区或柱子时把点击值带到弹窗，明细表按**卡片维度列**过滤（例如横轴 `week_key`，就只看该周的行）；
  不需要额外配置项。弹窗关闭时清空。
- **文件**：`backend/app/components/spec.py`（`ignore_filters`）、`backend/app/dashboards/render.py`（跳过筛选）、
  `frontend/src/features/components/editor/ChartOptionsPanel.tsx`、`editor/QueryPanel.tsx`、`types.ts`、
  `renderers/PieCard.tsx`、`renderers/ComboCard.tsx`、`board/TopListDialog.tsx`、`viewer/DashboardPage.tsx`。
- **怎么验证**：doc5 临时环形图两张（验完已还原），带 `cross_filters=[{platform_code: tmall}]` 渲染：
  默认卡 series = `tmall, jd, douyin, pdd`（不受影响），显式 `ignore_filters: false` 的卡 series = `tmall`（受影响）。
  `tsc --noEmit` 0；`pytest -k "render or component or spec"` 71 项通过。
  ⚠️ 预览页「点扇区 → 弹窗只剩该值行」需要你点一下确认（画布点击我的自动化抓不到）。

---
## 2026-11-23 · 新增：柱线组合图也能「点击弹窗」弹明细表

- 面板 **附加 → 点击弹窗**：开关 + 弹出明细表 + 排序列 + 排序（复用指标卡徽标弹窗那套 `KpiTopSettings`，
  `hideBadge` + 开关文案「点击弹窗」，和环形图完全一致的配置方式）。
- 后端 `payload.top` 的返回条件加上 `combo`（原来只有 kpi / pie / donut）。
- 渲染侧 `ComboCard` 新增 `onTopList`：点柱子或线就弹窗；没配弹窗时点击无副作用。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`、`renderers/ComboCard.tsx`、
  `backend/app/components/resolver.py`。
- **怎么验证**：doc5 临时组合图（`top.enabled=true` + `table_key=tt_table`，验完已还原）——
  `/render` 返回 `payload.top = {enabled:true, table_key:"tt_table", …}`（改前恒为 null）；`tsc --noEmit` 0。
  预览页「点柱子弹明细表」的端到端点击仍需你点一下确认（和环形图一样，我的自动化没抓到画布点击）。

---
## 2026-11-23 · 新增：柱线组合排序可「按 X 轴」

- 排序分区多了一行 **排序依据**：`按数值` / `按 X 轴`（写 `binding.order_by_dimension`）。
  选「按 X 轴」后不再按值重排，X 轴保持维度顺序（时间/类目这类有序轴必须这样）。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（复用后端已有的 `order_by_dimension`）。
- **怎么验证**：doc5 临时组合图，`order_by_dimension: true`（验完已还原）—— `/render` 返回
  `error: ""`，series 顺序 `douyin, jd, pdd, tmall`（维度顺序，而不是按值 desc 的 tmall 在前）。`tsc --noEmit` 0。
- **未做**：组合图「左右轴用同一个字段」。SQL 需要一个不冲突的列别名（`xxx__line`），
  涉及 resolver 的 `_metric_items` / 请求 metrics 别名 / compute 的 `build_combo` 取值三处，我没在没验证的情况下改。

---
## 2026-11-23 · 新增：筛选栏日期控件加入「本周」

- 日期控件的快捷选项在「昨日」和「上周」之间加了 **本周**：取 **本周一 → 今天**（不把未来几天算进去）。
- `dateShortcutRange` 的 `weeks` 参数现在是可选的「第 N 个自然周」（`0` = 本周，`1` = 上周），
  日选项（今日/昨日/近 7 日…）走原来的天数口径，不受影响。
- **文件**：`frontend/src/features/components/renderers/FilterBar.tsx`、
  `__tests__/dateShortcuts.test.ts`（补 3 条本周用例）。
- **怎么验证**：`vitest dateShortcuts` 7 项通过 —— `2026-11-20`（周五）本周 = `11-16~11-20`、
  周一当天 = `11-16~11-16`、周日 = 整周 `11-16~11-22`；`tsc --noEmit` 0。

---
## 2026-11-23 · 修复：明细表弹窗「产品卖点 / 差评痛点标签」选不了字段（真因）

- **上一轮的改动撤回**：给 5 个附加区块加的「关联字段」行去掉了（多一个配置项，用户确认不需要）。
- **真因**：`blockFieldsOf()` 只给 `trend / reviews / skus` 三块接了关联表字段的 hook，
  `sell_tags`（产品卖点）和 `pain_tags`（差评痛点标签）**没有自己的 hook，一律回落到 skus 那张关联表的字段**
  → 选了关联表，字段下拉里还是别的表的列，看起来「选不了」。
- **修复**：新增 `blkSell` / `blkPain` 两个 `useDatasetFields` hook，并在 `blockFieldsOf` 里按 key 分发。
- **文件**：`frontend/src/features/components/editor/TableDetailSettings.tsx`。
- **怎么验证**：`tsc --noEmit` 0；临时把 doc1 明细表的 `blocks.sell_tags.dataset_id` 指到数据集 12（测试评论，验完已还原）——
  展开「产品卖点」实测看到 `关联表 / 标签字段` 两行、自动输入框正常渲染。
  字段候选是否等于所选关联表的列，需要你在界面上点一下确认（我这边只验证到行渲染）。

---
## 2026-11-23 · 修复：柱线组合「左轴聚合」的自定义 SQL 框跑到了右轴下面

- 原来左轴的自定义 SQL 输入框渲染在指标拖拽区**之后**，而右轴（线）/右轴聚合也在这个区域里，
  于是「左轴的 SQL」被排到了右轴两行下面（对应关系看着是反的）。
- 现在把这块挪进拖拽区、紧跟「左轴聚合」：`横轴 → 左轴（柱）→ 左轴聚合 → [SQL] → 右轴（线）→ 右轴聚合`。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`。
- **怎么验证**：doc5 临时组合图（左轴聚合 = 自定义 SQL，验完已还原）—— 实测行顺序
  `横轴（分类）/ 左轴（柱）/ 左轴聚合 / 右轴（线）/ 右轴聚合`，SQL 输入框 `top=592`，右轴行 `top=710`（框在上方）。`tsc --noEmit` 0。

---
## 2026-11-23 · 修复：明细表弹窗「产品卖点 / 差评痛点标签」没法指定关联字段

- **问题**：抽屉里每个附加区块（近30天差评数 / 差评明细 / 产品 SKU / 产品卖点 / 差评痛点标签）都能选「关联表」，
  但面板只给前几个留了 `关联字段`（`key_field`）—— 产品卖点 / 差评痛点标签 **没有这一行**。
  渲染侧 `BlockRows` 的 join 列取 `cfg.key_field || 明细表的 key_field`，没配就退回主表列名，
  关联表里那列叫别的名字时查询为空 —— 看起来就像「没用指定的关联表」。
- **修复**：5 个附加区块统一补上「关联字段」行（选项来自所选关联表的字段），和「关联表」紧挨着。
- **文件**：`frontend/src/features/components/editor/TableDetailSettings.tsx`。
- **怎么验证**：`tsc --noEmit` 0；面板里每个附加区块展开后应为「关联表 → 关联字段 → 其余字段」。
  ⚠️ 这两块在 doc1 的明细表里本来就没配过，我这边没能复现出真实取数，需要你刷新后在出问题的那张卡上确认；
  若仍为空，把卡片名给我，我直接查那次 `/query` 请求的参数。

---
## 2026-11-23 · 优化：柱线组合把「组件元素」并进 附加 · 首选项

- 原来「组件元素」那行开关是「首选项」分区外面的兄弟节点（视觉上像另一组）；现在并进**首选项**里面：
  `首选项 → 柱 / 线（右轴·曲线平滑）→ 组件元素（标题·说明·数值·网格·图例）`。
- 实现：`ChartOptionsPanel` 新增 `mode="elements"`（只画那排开关），组合图在「首选项」里嵌一层；
  独立的开关块对组合图的 prefs 模式关闭，避免重复。
- **文件**：`frontend/src/features/components/editor/ChartOptionsPanel.tsx`。
- **怎么验证**：doc5 临时组合图（验完已还原）—— 附加实测
  `首选项 | 柱 / 线 | 右轴 | 曲线平滑 | 组件元素 | 标题 | 说明 | 数值 | 网格 | 图例 | 坐标轴 | …`。`tsc --noEmit` 0。

---
## 2026-11-23 · 新增：柱线组合「右轴聚合」也支持自定义 SQL

- 右轴聚合下拉多了一项 **自定义 SQL**；选中后在**该行下方**出现 SQL 输入框（和左轴的自定义 SQL 同一套样式与提示），
  表达式写在 `binding.metrics[0].expression`，切换右轴字段时保留。
- 后端 `_metric_items` 原来只透传「名称 / 聚合 / 格式」，现在 `agg == "CUSTOM"` 时把 `expression` 一起下发给查询编译器
  （`compiler` 本来就支持自定义聚合表达式，缺的只是这一层透传）。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`、`backend/app/components/resolver.py`。
- **怎么验证**：doc5 临时组合图，右轴 = `rank_position` + 自定义 `MAX("rank_position")`（验完已还原）——
  面板实测 `右轴聚合 | 自定义 SQL`，下方 SQL 框值 `MAX("rank_position")`；
  `/render` 返回 `error: ""`，SQL 实测
  `SELECT "platform_code", SUM("daily_deal") AS "daily_deal", MAX("rank_position") AS "rank_position" FROM …`。`tsc --noEmit` 0。

---
## 2026-11-23 · 优化：柱线组合「左轴聚合 / 右轴聚合」+ 首选项「柱 / 线」说明行

- **聚合改名**：组合图的数据区里，柱的聚合行叫 **左轴聚合**（其它图表仍是「聚合」）。
- **右轴聚合按需出现**：只有绑了「右轴（线）」字段才显示这一行（没绑时不再占一行、也不再被误改）。
- **首选项排版**：`右轴` / `曲线平滑` 前面补 **柱 / 线** 说明，说明在左、两个选项在右水平排列（和面板其它行一致）。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`、`editor/ChartOptionsPanel.tsx`。
- **怎么验证**：doc5 临时组合图（验完已还原）—— 数据区实测
  `横轴（分类） | 左轴（柱） | 左轴聚合 SUM | 右轴（线） | 右轴聚合 AVG`；
  附加实测 `首选项 | 柱 / 线 | 右轴 | 曲线平滑 | 组件元素(标题/说明/数值/网格/图例) | 坐标轴`。`tsc --noEmit` 0。

---
## 2026-11-23 · 优化：柱线组合「右轴（线）」改成拖拽自动输入框

- 「数据 · 右轴（线）」原来是下拉选择，现在和左轴一样用 `AxisInput`：能把左侧指标拖进来、也能打字过滤，
  样式统一浅紫底 `rgba(99,102,241,0.05)` + 虚线边 + 「拖到这里」；清空 = 不画线（`metrics: []`），保留原来的聚合方式。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`。
- **怎么验证**：doc5 临时组合图（验完已还原）—— 三行实测
  `左轴（柱） auto=true bg=rgba(99,102,241,0.05) border=dashed`、
  `右轴（线） auto=true bg=rgba(99,102,241,0.05) border=dashed`、`右轴聚合 auto=false border=solid`。`tsc --noEmit` 0。

---
## 2026-11-23 · 优化：柱线组合「右轴」归到数据 + 新增 附加·首选项（右轴 / 曲线平滑 / 组件元素）

- **数据**：横轴（分类）/ 左轴（柱）/ 聚合 / **右轴（线）** / **右轴聚合** —— 右轴的两个配置从「附加」搬进「数据」，
  和纵轴放在同一组（`binding.metrics[0]` 口径不变）。
- **附加 · 首选项**：右轴、曲线平滑（原来挤在「通用 · 文字」里的「柱 · 线」分区），下面接「组件元素」
  （标题 / 说明 / 数值 / 网格 / 图例）。
- **坐标轴**单独一个分区（Y 最小 / Y 最大 / 数值格式 / 标签旋转），和柱状图一致。
- **实现**：`ChartOptionsPanel` 的 `mode` 增加 `"prefs"`（只画「首选项 · 柱/线」+「组件元素」）；
  `axis` 模式不再顺带画那排开关，柱状图的「组件元素」也改成独立一行，避免标题重复。
- **文件**：`editor/ChartOptionsPanel.tsx`、`editor/QueryPanel.tsx`。
- **怎么验证**：doc5 临时组合图 + doc1 柱状图（验完都已还原）——
  `通用(数据: 横轴（分类）/左轴（柱）/聚合/右轴（线）/右轴聚合 · 过滤 · 排序 · 运算 · 外观 · 文字)`
  `附加(首选项: 右轴·曲线平滑 + 组件元素: 标题·说明·数值·网格·图例 | 坐标轴: Y 最小/Y 最大/数值格式/标签旋转)`；
  柱状图「附加(坐标轴 | 组件元素)」无重复标题。`tsc --noEmit` 0。截图 `docs/_selfcheck/2026-11-23-combo-panel.png`。

---
## 2026-11-23 · 优化：需要「填字段」的控件改成自动输入框（可打字过滤）

- **环形图 / 指标卡 · 点击弹窗 · 排序列**：从 `<TextField select>` 改成 `Autocomplete`，
  选项仍是弹出那张明细表的列（显示列名、写回列 key），支持输入过滤；选中后仍自动带「降序」。
- **明细表 · 缩略图 · 关联外部字段**：`当前数据集关联字段`、`资源表关联字段`、`图片地址字段` 三处
  从下拉改成自动输入框（新增局部组件 `FieldAuto`：能输入过滤、能下拉选、未绑资源表时置灰）。
- **文件**：`editor/KpiTopSettings.tsx`、`editor/RelatedThumbnailSettings.tsx`。
- **怎么验证**：`tsc --noEmit` 0。面板里这几行默认折叠，展开「点击弹窗」「缩略图」后：
  排序列鼠标点开应有输入光标+下拉建议，缩略图三行同理（我自动化里这两段是折叠态，没读到 DOM 行，麻烦你展开看一眼）。

---
## 2026-11-23 · 优化：环形图配置面板改版（去掉小标题 / 说明+选项水平排 / 组件元素 / 点击弹窗）

- **去掉「环形」小标题**：内径 / 起始角 / 标签内容 / 文字位置 直接排在「图形」分区里。
- **说明 + 选项水平排列**：`文字位置`（图形上 / 图形旁 / 图形外）从「标题 + 一排按钮」改成 `Row`，
  三个按钮等宽、间距 8；`组件元素`（标题 / 说明 / 数值 / 图例 / 分隔 / 玫瑰图）同样收进一个 `Row`，标签在左、开关在右。
- **新增「点击弹窗」**（附加里的独立分区）：开关 + 弹出明细表 + 排序列 + 排序，
  复用指标卡徽标弹窗那套组件（`KpiTopSettings` 加了 `hideBadge` / `switchLabel` 两个参数，指标卡行为不变）。
- **后端**：`resolver` 原来只给 `kind == "kpi"` 返回 `payload.top`，现在 `pie / donut` 也返回，
  前端据此把扇区点击接到弹窗（`PieCard` 新增 `onTopList`，有弹窗配置时优先走弹窗、否则维持原来的联动筛选）。
- **文件**：`editor/ChartOptionsPanel.tsx`、`editor/QueryPanel.tsx`、`editor/KpiTopSettings.tsx`、
  `renderers/PieCard.tsx`、`backend/app/components/resolver.py`。
- **怎么验证**：doc5 临时环形图（验完已删除并还原）—— 面板实测
  `附加 | 图形 | 内径 % | 起始角 | 标签内容 | 文字位置[图形上·图形旁·图形外] | 组件元素[标题·说明·数值·图例·分隔·玫瑰图] | 点击弹窗 | 点击弹窗(开关) | 弹出明细表 | 排序列 | 排序`；
  `/render` 返回 `payload.top = {enabled:true, table_key:"tt_table", …}`（原来 pie 恒为 null）。
  `tsc --noEmit` 0、`pytest` 67 项、`vitest` 54 项通过。截图 `docs/_selfcheck/2026-11-23-donut-panel.png`。
- **待确认**：预览页点扇区弹明细表的端到端点击我在自动化里没抓到（选择器没定位到卡片），逻辑已接通，麻烦你点一下确认。

---
## 2026-11-23 · 优化：环形图「图形旁」去掉引导线 + 百分比颜色跟随扇区

- **引导线**：`文字位置 = 图形旁` 不再画引导线（上一版刚给它加过，用户要求回到贴边无线的样子）；
  只有 `图形外` 才画折线（34 + 22，`#CBD5E1`）。
- **百分比配色**：标签富文本改为按 `dataIndex` 取 `DONUT` 调色板（`v0…v7`），
  「名称+百分比」和「仅百分比」两种模式都走同一条路，百分比颜色与所在扇区一致；名称保持灰色。
- **文件**：`frontend/src/features/components/skin/pieOption.ts`。
- **怎么验证**：临时环形图（doc5，验完已删除并还原；`platform_code` + `daily_deal`，`label_layout=beside`）
  截图 `docs/_selfcheck/2026-11-23-donut-beside.png` —— 标签贴边无线，且 `tmall 68%`=橙、`jd 22%`=绿、
  `douyin 10%`=紫，百分比颜色与所在扇区一致；`tsc --noEmit` 0、`vitest` 54 用例通过。

---
## 2026-11-23 · 修复：饼图 / 环形图在数值列返回字符串时整卡报错（int + str）

- **现象**：新建环形图（只选维度、没选指标那种）卡片直接显示
  `unsupported operand type(s) for +: 'int' and 'str'`，series / total 全空。
- **原因**：`compute.build_payload` 末尾对 series 做 `sum(item.get("value") or 0 …)`，
  某些驱动把数值列当字符串返回时，`0 + "12"` 直接 TypeError（前面的地图 / 漏斗分支都用了 `_num()`，这两处漏了）。
- **修复**：series 的 `value` 统一过 `_num()` 再求和（词云拆词那条路一并处理）。
- **文件**：`backend/app/components/compute.py`。
- **怎么验证**：临时给 doc5 加环形图（验完已删除并还原）—— 修复前 `payload.error = "unsupported operand …"`、
  `series: []`；修复后 `error: ""`、`series` 正常返回数组。`pytest -k "compute or component or render"` 67 项通过。

---
## 2026-11-23 · 优化：环形图/饼图补「附加」分栏 + 「图形旁」标签加指示线

- **面板**：环形图 / 饼图原来没有「附加」，饼图参数（内径 / 起始角 / 标签内容 / 文字位置）和显示开关都挤在「通用」里。
  现在：**通用** = 数据 / 过滤 / 排序 / 运算 / 外观 / 文字；**附加** = 图形（上面那些参数 + 标题/说明/数值/图例/分隔/玫瑰图）。
  实现同柱状图：`ChartOptionsPanel` 的 `mode` 增加 `"pie"`（`all` / `text` / `axis` / `pie`），同一份代码不复制。
- **指示线**：`label_layout = beside`（图形旁）原来把引导线设成透明，标签离图形很近却看不出从哪块引出来；
  现在**图形旁也画引导线**（短：12 + 8），图形外保持 34 + 22。
- **文件**：`editor/ChartOptionsPanel.tsx`、`editor/QueryPanel.tsx`（`hasSpecial` 加 pie/donut + 附加里的「图形」分区）、
  `skin/pieOption.ts`。
- **怎么验证**：临时给 doc5 加环形图（验完已删除并还原）—— 面板顺序实测
  `通用(数据/过滤/排序/运算/外观/文字) → 附加(图形: 环形/内径/起始角/标签内容/文字位置 + 显示开关)`。
  `tsc --noEmit` 0；`vitest` 12 文件 54 用例通过。

---
## 2026-11-23 · 修复：自定义 SQL 返回文本时「运算 > 后缀」不生效

- **现象**：聚合用 CASE 返回 `'20-40'` 这类文本后，`运算 > 后缀`（如「 元」）加了没反应。
- **原因**：`compute.fmt_number` 先按「数字格式」走 `float(value)`；文本值转换失败时**直接原样返回**，
  把 `prefix / suffix` 丢掉了（`text` / `date` 格式那条路是正常的，所以切格式能生效）。
- **修复**：非数字值同样套前后缀（空值 `-` 除外）。
- **文件**：`backend/app/components/compute.py`。
- **怎么验证**：`fmt_number('20-40','int',suffix=' 元')` → `20-40 元`；`fmt_number('-','int',suffix=' 元')` → `-`；
  `fmt_number(1234.5,'int',decimals=1,suffix=' 元')` → `1,234.5 元`；`pytest -k "compute or format or component"` 62 项通过。

---
## 2026-11-23 · 修复：自定义聚合表达式可以「背着指标」引用别的列（含公式字段）

- **问题（原则性）**：聚合选「自定义 SQL」后，表达式是自由文本，换指标不会改它。
  于是出现「指标 = `final_price`，表达式 = `MAX("price_band")`」这种配置 —— 卡片实际按 `price_band` 聚合，
  界面上却看不出来；`price_band` 还是公式字段时，后端会把它展开成 `__computed` 子查询，
  看起来就像「聚合默认拿公式字段当数据来源」。
- **修复①（行为）**：换指标时，自定义表达式里的列名**自动跟着换成新指标**（`MAX("price_band")` → `MAX("rank_position")`），
  聚合口径不再悄悄跑偏。
- **修复②（校验）**：表达式引用的列 ≠ 当前指标时，输入框标红并提示
  「表达式引用的是 "x"，和当前指标 "y" 不一致 —— 这个聚合会按前者计算」（后端已报错时优先显示后端错误）。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（`retargetExpr` / `pickMetric` / 表达式校验）。
- **怎么验证**：doc1 指标卡 —— 表达式 `MAX("price_band")` 时后端报「未知字段：price_band」（该数据集无此列）；
  把指标从 `final_price` 换成 `rank_position`，表达式实测自动变成 `MAX("rank_position")`。`tsc --noEmit` 0。
  截图 `docs/_selfcheck/2026-11-23-custom-sql-guard.png`。

---
## 2026-11-21 · 修复：「数据」区输入框宽度不一致

- **原因**：纵轴（指标）外面多包了一层拖拽区，带 `p: 0.25`（左右各 2px），所以纵轴的输入框比横轴窄 4px；
  另外「粒度」「聚合」两行是普通 TextField，右边没有给拖拽框留 26px 占位，比上下行宽一截。
- **修复**：拖拽区 `p: 0`；「粒度」「聚合」两行补 26px 占位。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`。
- **怎么验证**：doc1 柱状图展开「数据」—— 横轴 / 纵轴输入框都是 `left 337 / right 523`（完全一致）。`tsc --noEmit` 0。

---
## 2026-11-21 · 优化：导航菜单卡「首视页 / 全页面展示」归到 附加 · 首选项

- 原来这两项各占一个分区（附加 ① 首视页、② 全页面展示），现在合成一个 **首选项** 分区，两行在里面：
  `首视页`（下拉）+ `全页面展示`（开关）。后续再加「默认页 / 打开方式」之类的卡片级行为也往这里放。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（nav 分支）。
- **怎么验证**：doc5 导航菜单卡 —— 附加段实测 `附加 | 首选项 | 首视页 | 全页面展示 | 品牌 | 菜单项 | …`。`tsc --noEmit` 0。
  截图 `docs/_selfcheck/2026-11-21-nav-options.png`。

---
## 2026-11-21 · 修复：面板分组之间的间隙不统一

- **原因**：四套间距规则混用 —— `PanelSection` 有 `mt 16 + mb 16`（flex 容器里不折叠 → 相邻两节 32）、
  `Slot` 只有 `mb 16`、`通用/附加` 大标题 `mt 16 + mb 8`、`运算` 自带 `mt 12` 且没有下边距；
  另外柱状图「附加 · 坐标轴」里还套了一层重复的「坐标轴」标题。
- **修复**：统一成 **每个块只保留下边距 16**：`PanelSection` 去掉 `mt`、大标题改 `mt 0 / mb 16`、
  `运算` 改 `mt 0 / mb（展开 8 / 收起 16）`；柱状图 `mode="axis"` 时不再画内层「坐标轴」标题。
- **文件**：`editor/PanelSection.tsx`、`editor/QueryPanel.tsx`、`editor/ComputeFields.tsx`、`editor/ChartOptionsPanel.tsx`。
- **怎么验证**：doc1 柱状图实测相邻标题间距 `16 / 16 / 16 / … / 16`（「排序→外观」中间夹着「运算」一行，
  属正常块高，不是间距）；重复的「坐标轴」标题已消失。`tsc --noEmit` 0。
  截图 `docs/_selfcheck/2026-11-21-panel-spacing.png`。

---
## 2026-11-21 · 修复：「附加」里的分区标题没有折叠按钮

- **原因**：`PanelSection` 的 `collapsible` 默认是 `false`，而「附加」里的分区（坐标轴 / 列 / 缩略图 / 统计 …）
  都没显式传 `collapsible` → 标题没有箭头、也点不动；只有「通用」里的分区显式开了。
- **修复**：`PanelSection` 改成默认 `collapsible = true` / `defaultOpen = true`；
  「通用」里的数据 / 外观 / 文字显式传 `defaultOpen={false}`，保持默认收起（上一轮的约定不变）。
- **文件**：`editor/PanelSection.tsx`、`editor/QueryPanel.tsx`、`editor/ChartOptionsPanel.tsx`。
- **怎么验证**：doc1 柱状图 —— 面板里 `折叠箭头` 共 7 个（通用 6 个 + 附加的坐标轴 1 个）；
  通用只露出标题、附加的坐标轴默认展开且带箭头。`tsc --noEmit` 0。
  截图 `docs/_selfcheck/2026-11-21-panels-collapsed.png`。

---
## 2026-11-21 · 优化：「通用」下的配置栏默认折叠

- `PanelSection` / `Slot` 的 `defaultOpen` 默认值从 `true` 改成 `false`，`ComputeFields`（运算）的展开状态也默认收起 ——
  选中组件后，通用区只列 `数据 / 过滤 / 排序 / 运算 / 外观 / 文字` 六行标题，点哪行展开哪行。
- 附加里的分区（坐标轴、菜单项、右侧统计等）不受影响，仍是展开状态。
- **文件**：`editor/PanelSection.tsx`、`editor/Slot.tsx`、`editor/ComputeFields.tsx`。
- **怎么验证**：doc1 柱状图 —— 面板实测 `通用 | 数据 | 过滤 | 排序 | 运算 | 外观 | 文字 | 附加 | 坐标轴`（数据/运算的行都不出现）；
  点「数据」后横轴/纵轴才出现。`tsc --noEmit` 0。截图 `docs/_selfcheck/2026-11-21-panels-collapsed.png`。

---
## 2026-11-21 · 优化：拖拽输入框统一浅紫色 + 横轴 / 纵轴改成水平「说明 + 输入」

- **横轴 / 纵轴水平排列**：不再是标签在上、控件在下的槽位，改成 `说明（左） + 输入框（右）`；
  时间维度时的「粒度」也换成同样的 Row。
- **所有拖拽自动输入框统一浅紫**：底色 `rgba(99,102,241,0.05)`（拖入中 0.10）、`1px dashed #C7D2FE`
  （拖入中 `#818CF8`）、文字紫色 `#4F46E5`；空态文案统一成 **「拖到这里」**。
  涉及：图表横轴 / 纵轴（`AxisInput`）、头标卡统计「字段」、筛选字段「绑定字段」。
- **文件**：`editor/AxisInput.tsx`、`editor/QueryPanel.tsx`、`editor/FilterFieldsEditor.tsx`。
- **怎么验证**：doc1 柱状图 —— 横轴 / 纵轴两行实测 `horizontal=true`、`placeholder="拖到这里"`、
  `bgcolor=rgba(99,102,241,0.05)`、`border-style=dashed`。`tsc --noEmit` 0。
  截图 `docs/_selfcheck/2026-11-21-bar-axis-input.png`。

---
## 2026-11-21 · 优化：柱状图补上「附加」配置分栏（坐标轴 / 显示开关搬过去）

- 之前柱状图没有「附加」，坐标轴（Y 最小 / Y 最大 / 柱宽 / 数值格式 / 标签旋转）和一排显示开关
  （标题 / 说明 / 数值 / 网格 / 图例）都挤在「通用 · 文字」下面。
- 现在：**通用** = 数据 / 过滤 / 排序 / 运算 / 外观 / 文字；**附加** = 坐标轴（含那排显示开关）。
- 实现方式：`ChartOptionsPanel` 加 `mode` 参数（`all` / `text` / `axis`）——柱状图在「通用」只画文字、
  在「附加」只画坐标轴，同一份代码不复制。
- **文件**：`editor/ChartOptionsPanel.tsx`、`editor/QueryPanel.tsx`（`hasSpecial` 加 `bar` + 附加里的坐标轴分区）。
- **怎么验证**：doc1 柱状图 —— 面板顺序实测 `通用(数据/过滤/排序/运算/外观/文字) → 附加(坐标轴: Y 最小 / Y 最大 / 柱宽 /
  数值格式 / 标签旋转 + 标题/说明/数值/网格/图例)`，坐标轴位置索引在「附加」之后。`tsc --noEmit` 0。
  截图 `docs/_selfcheck/2026-11-21-bar-extra-axis.png`。

---
## 2026-11-21 · 优化：头标卡统计项卡片（删除挪到标签行 / 字段可拖入 / 单位下拉 / 数值改默认值）

- **删除按钮**从头标右侧挪到「标签」输入框右边（和筛选字段卡一致），常显垃圾桶图标；头标只留「色条 + 标签名 + 折叠箭头」。
- **字段**改成能输入、能选、**能拖入**的输入框（复用 `AxisInput`），样式同拖入框；未绑定时右侧留 26px 占位，换状态宽度不跳。
- **单位**改成下拉：内置 `个 / 件 / 台 / 单 / 人 / 家 / 天 / 条 / 次 / 笔 / 元 / 万元 / 亿 / 万 / % / ‰` + 「无单位」；
  老文档里的自定义单位会在下拉里补一项，不会一保存就丢。
- **「数值」改名「默认值」**：没有绑定字段时才出现（静态展示用）。
- **文件**：`editor/QueryPanel.tsx`（`BANNER_UNITS`）、`editor/AxisInput.tsx`（常驻占位 + gap 与 Row 对齐）。
- **怎么验证**：临时给 doc5 加头标卡（验完已删除并还原）—— 行顺序 `标签(带🗑) → 字段(虚线可拖) → 单位(下拉显示「个」) → 默认值`，
  四行输入框实测 `left 350 / right 510`；删除按钮 2 个（两张统计卡各一个）。`tsc --noEmit` 0。
  截图 `docs/_selfcheck/2026-11-21-banner-stat-card.png`。

---
## 2026-11-21 · 优化：图表横轴 / 纵轴改成「说明 + 输入框」（可拖入），标签旋转改下拉

- **横轴 / 纵轴 = 说明 + 输入框**：原来维度槽是「下拉 + ✕」、指标槽是普通下拉；现在统一成
  能输入、能选、也能**把左侧字段拖进来直接绑定**的输入框（新组件 `editor/AxisInput.tsx`），
  样式沿用原来的拖入框：未绑虚线 `#CBD5E1`、已绑 `#C7D2FE` + 淡紫底 + 紫色字、拖入中 `#6366F1`；已绑时右侧有 ✕ 清除。
- **标签旋转改下拉**：`自动 / 30° / 45° / 90°`（原来是四个 ToggleButton）。
- **文件**：`editor/AxisInput.tsx`（新增）、`editor/QueryPanel.tsx`、`editor/ChartOptionsPanel.tsx`。
- **怎么验证**：doc1 柱状图 —— 面板数据区是「横轴（分类）/ 纵轴（数值）」两行输入框；
  往横轴输入框派发 `{kind:"field", name:"brand"}` 的 drop → 值变成 `brand`（事件确实到达）；
  坐标轴里「标签旋转」是下拉。截图 `docs/_selfcheck/2026-11-21-bar-axis-input.png`。`tsc --noEmit` 0。
- **还没做**（等确认）：① 柱状图的「附加」配置分栏（现在坐标轴 / 显示开关仍在「通用 · 文字」下面）；
  ② 「图标配置是多选输入框」这条没看懂指的是哪个配置项。

---
## 2026-11-21 · 优化：头标卡按「通用 / 附加」分组 + 统计项卡片对齐导航菜单卡样式

- **通用** = `外观`（高度 / 圆角 / 阴影 / 描边 / 线宽 / 深浅，原来是面板底部一个 `mt:3` 裸块）。
- **附加** = `标题文案`（顶部小字 / 大标题 / 强调段 / 副标题 / 底色）+ `右侧统计`。
- **统计项卡片**改成导航菜单卡 / 筛选字段同一套：
  色条 + 标签名 + 删除（垃圾桶）+ 折叠箭头，点标题收起该卡；
  行顺序 = `标签 / 字段 / 聚合 / 单位`（绑定字段时才有「聚合」，静态数值时出「数值」），
  后面接 `格式` 与可折叠的 `运算`。
- **输入框等宽**：原来「聚合 / 格式」限宽 160、「单位」限宽 140，现在全部跟第一行等宽 ——
  实测 `标签 / 字段 / 单位` 都是 `left 350 / right 544`。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（banner 分支 + `bannerFolded`）。
- **怎么验证**：临时给 doc5 加一张头标卡（验完已删除并还原文档）——
  面板顺序 `头标卡 | 通用 | 外观(高度/圆角/阴影/描边/线宽/深浅) | 附加 | 标题文案(顶部小字/大标题/强调段/副标题/底色) | 右侧统计`，
  统计卡头标显示「在架产品 / 月销量」，行是 标签 → 字段 → 单位 → 数值。
  截图 `docs/_selfcheck/2026-11-21-banner-stat-card.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 优化：导航菜单卡「附加」重排 + 导出 / 状态各自独立配置栏

- **附加顺序**（用户指定）：① 首视页（下拉）→ ② 全页面展示（开关）→ ③ 品牌 → ④ 菜单项 → ⑤ 按钮 → ⑥ 导出 → ⑦ 状态。
- **删掉「灰字状态」「绿色徽标」**：状态统一由新的「状态」配置栏管 —— 状态功能下拉，暂时只有「时间」
  （显示当前时间，前端每 10 秒刷一次；「不显示」可关）。
- **导出独立配置栏**：`显示按钮`（开关）/ `文字` / `样式`（主 / 次）+ 原来的 `导出范围`。
  导出按钮由这份配置生成；`actions` 里历史遗留的「导出…」按钮不再单独渲染，避免出现两个导出。
  点导出按钮靠后端标记触发（`export: true`），不再靠「文案里有没有导出两个字」猜。
- **后端**：`NavSpec` 新增 `export_visible` / `export_label` / `export_kind` / `status`；`compute.build_content(nav)` 透传；
  `seed_base` 模板同步（`meta` / `badge` / `actions` 清空、`status=time`、导出默认开），
  组件库 `base.nav`（id 22）已按同一套更新（`meta`/`badge` 已清空）。
- **文件**：`backend/app/components/spec.py`、`compute.py`、`seed_base.py`；
  `frontend/src/features/components/types.ts`、`renderers/NavCard.tsx`、`editor/QueryPanel.tsx`、`viewer/DashboardPage.tsx`。
- **怎么验证**：doc5 导航菜单卡 —— 面板顺序实测
  `附件：首视页 → 全页面展示 → 品牌 → 菜单项 → 按钮 → 导出(显示按钮/文字/样式/导出范围) → 状态(时间/不显示)`，
  「灰字状态」「绿色徽标」都不再出现；把导出文字改成「下载数据」→ 卡片按钮同步变字；关「显示按钮」→ 按钮消失；
  卡片状态显示当前时间（`数据同步 · 2026-11-21 20:47`）。`tsc --noEmit` 0；`pytest tests/test_component_seed.py` 14 passed。
- 后端改了 `spec.py` / `compute.py` / `seed_base.py`：dev 服务会自动重载，**前端刷新页面**即可。

---
## 2026-11-21 · 优化：导航菜单卡面板按「通用 / 附加」两大分组

- **通用** = `外观`（高度 / 圆角 / 阴影 / 描边 / 线宽 / 深浅，来自 StylePanel）。
  原来是挂在面板最底部的一个 `mt: 3` 裸块，现在提到通用里、独立成可折叠分区。
- **附加** = `品牌` / `菜单项`（含首视页）/ `右侧状态` / `按钮` / `导出`。
- 数据 / 过滤 / 排序 / 运算 / 文字对导航菜单卡不成立 → 按「空分组不显示」的口径不渲染。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（nav 分支）。
- **怎么验证**：doc5 导航菜单卡，面板文本顺序实测
  `导航菜单卡 | 通用 | 外观(高度/圆角/阴影/描边/线宽/深浅) | 附加 | 品牌(品牌名/强调尾段/品牌标记配色) | 菜单项 …`。
  截图 `docs/_selfcheck/2026-11-21-nav-panel-groups.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 新增：画板刷新后自动选回上次最后选中的组件

- 选中组件时把 key 写进 `localStorage`（`mzbi:canvas:last-selected:<docId>`，按看板分开），
  刷新 / 重新进画板时自动选中回来，右侧配置面板直接可用，不用再找一遍。
- **只恢复一次**：恢复后用户再点、再取消都听用户的，不会被反复拉回去。
- 存的 key 在当前页元素里找不到（元素被删 / 切了页面）就静默跳过，不报错、不空白。
- **文件**：`frontend/src/pages/CanvasBoardPage.tsx`（`lastKeyPref` / `restoredRef` + 两个 effect）。
- **怎么验证**：`/bi/canvas?doc=1` 点明细表 → `localStorage['mzbi:canvas:last-selected:1'] = c_mwonh8e228`；
  刷新后中栏依然是「元素 c_mwonh8e228」，明细表面板已展开。截图 `docs/_selfcheck/2026-11-21-canvas-restore-selection.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 优化：导航菜单卡「菜单项」四项调整（垃圾桶 / 对齐 / 色卡 / 首视页）

- **删除按钮改垃圾桶**：`Close(✕)` → `DeleteOutline`，并且常显（不受卡片 hover 规则隐藏）。
- **输入框宽度对齐**：「标签」行右侧固定 6px 状态点占位 + 26px 垃圾桶，另两行留等宽空位 ——
  实测「标签」「跳转页面」输入框都是 `left 350 / right 496`。
- **「圆点」改颜色卡片组**：从下拉改成 7 个颜色圆点（灰 / 靛蓝 / 天蓝 / 青绿 / 琥珀 / 玫红 / 紫），
  点一下即选、选中项描边高亮；并把它挪到卡片**最后一行**。
- **「首视页」上收为卡片级下拉**：不再每项一个开关，放到「菜单项」列表下面，
  值 = 被标 `active` 的那一项的页面；选别的页面会自动取消其余项。没有菜单项挂页面时，
  下拉里给一条禁用提示「先在菜单项里选「跳转页面」」。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（`NAV_TONE_DOTS` / `firstPage` / `firstPageOptions`）。
- **怎么验证**：doc5 导航菜单卡 —— 4 个垃圾桶图标、28 个颜色圆点（4×7）、末尾「首视页」下拉；
  把「市场总览」的跳转页面设为 `temp` 后，首视页下拉出现「市场总览」选项，选中后值变为「市场总览」。
  截图 `docs/_selfcheck/2026-11-21-nav-item-config.png`。`tsc --noEmit` 0。
- · 迭代：「标签」输入框右侧那个 6px 状态小圆点去掉（用户要求），其余行占位改成 26px
  （Row 自带 8px gap，`8 + 26` 正好等于「标签」行的 `8 + 删除按钮26`），
  实测「标签」「跳转页面」输入框仍是 `left 350 / right 510` 对齐；小圆点数量 0。

---
## 2026-11-21 · 优化：导航菜单卡「菜单项」补上和筛选字段一样的折叠头标

- **容器本来就一致**：菜单项和筛选字段卡都直接用 `GROUP_CARD_SX`，实测都是
  `bg #FBFCFE / 1px solid #EEF3FB / radius 16px / padding 12px / gap 14px`；
  真正差的是筛选字段有可折叠头标（色条 + 字段名 + 箭头），菜单项没有。
- **现在菜单项也加**：`色条 + 标签名 + 箭头`，点标题收起 / 展开这一项（箭头旋转 90°）；
  收起时卡片只留头标一行，长菜单不用一路往下滚。
- 折叠状态只在前端内存（按索引记），不写文档、不影响看板。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（nav 分支 + `NAV_ITEM_ACCENTS` / `navFolded`）。
- **怎么验证**：doc5 导航菜单卡 —— 面板依次是「市场总览 / 榜单端 / 需求端 / 竞品端」四张卡；
  点「市场总览」标题 → 它的 `标签 / 圆点 / 跳转页面` 三行收起（其余三项不变），再点展开复原。
  截图 `docs/_selfcheck/2026-11-21-nav-item-fold.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 重构：筛选字段卡去掉「分套依据 / 数据字段」，数据集与绑定字段改成输入下拉

- **卡片顺序**（用户指定）：`名称 / 控件 / 宽度 / 数据集 / 绑定字段 / 默认值`（+ 选项），一列到底、左说明对齐。
- **删「分套依据」开关**：动手前查过 doc1 / doc5，`items_map`、`fields_map`、`split` 字段、`dataset_map` **都没有**，
  没有任何数据依赖它；连带的「数据集 + 添加平台」映射块也从卡片里移除。
- **删「数据字段」拖入框**：换成常显的 **「数据集」+「绑定字段」两个可输入下拉**（`Autocomplete`，输入即过滤），
  不要按钮、不弹窗、不折叠 —— 选字段即写回 `column` 并重新取该列候选值。
- **宽度**从卡片底部挪到「控件」下面。
- 「数据集」下拉可换（写 `spec.binding.dataset_id`）：画布侧经
  `MiddleConfigPane → panels.tsx` 透传 `onDatasetChange`；组件库编辑页没有数据集上下文，该项置灰只读。
- **文件**：`editor/FilterFieldsEditor.tsx`、`pages/canvas/panels.tsx`、`pages/canvas/MiddleConfigPane.tsx`。
- **怎么验证**：`/bi/components/23/edit` 卡片顺序实测
  `名称 / 控件 / 宽度 / 数据集 / 绑定字段(平台) / 默认值 / 选项 3`；「绑定字段」按钮数量 **0**；
  `.MuiAutocomplete-root` 10 个（5 个字段 × 2）；页面里不再出现「分套依据」「数据字段」。
  截图 `docs/_selfcheck/2026-11-21-filter-bind-inline.png`。`tsc --noEmit` 0。
- 遗留：`PlatformMap` 组件现在没有引用了（保留未删，等确认不再需要平台映射再清理）。
- · 迭代：数据集 / 绑定字段两行右侧补 26px 占位（和删除按钮同宽），六行输入框右边缘对齐 ——
  实测 `名称 / 控件 / 宽度 / 数据集 / 绑定字段 / 默认值` 都是 `left 650 / right 1080 / width 430`。
- · 迭代：「绑定字段」除了输入/选择，还能**把左侧字段直接拖进来绑定**，并沿用原拖入框的视觉
  （`1px dashed #CBD5E1`，已绑定 `#C7D2FE` + 淡紫底 + 紫色字，拖入中 `#6366F1` 高亮），未绑定时占位文案
  「把左侧字段拖进来（或输入选择）」。验证：对输入框派发 `{kind:"field",name:"品牌"}` 的 drop，
  值从 `平台` 变成 `品牌`，边框计算样式 `1px dashed rgb(199,210,254)` / `radius 8px`。
  截图 `docs/_selfcheck/2026-11-21-filter-bind-drag.png`。

---
## 2026-11-21 · 优化：筛选字段卡「删除」挪到名称行右侧、输入框统一等宽

- **删除按钮**从「宽度」行尾移到「名称」输入框右侧，并**保持常显**（不受卡片 hover 才显示的规则影响，
  否则挪过去等于看不见）。
- **其余行右侧留 26px 等宽空位**（small IconButton 的实际宽度），所以
  `名称 / 控件 / 数据字段 / 默认值 / 宽度` 五个输入框左右边缘完全对齐。
- 「宽度」不再单独限宽 120，跟其它输入框等宽。
- **文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **怎么验证**：`/bi/components/23/edit` 实测五行 `.MuiOutlinedInput-root` 都是 `left 650 / right 1080 / width 430`；
  删除按钮 `opacity: 1`、距名称输入框 8px。截图 `docs/_selfcheck/2026-11-21-filter-card-rows.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 优化：筛选字段卡改成「说明 + 输入」竖排六行

- **之前**：「名称 / 控件」横排两列、「默认值 / 宽度」横排两列，标签是 11px 灰字贴在输入框上方，
  和全站「76px 左说明 + 右控件」的规矩不一致。
- **现在**：一列到底，竖向依次 —— **名称 / 控件 / 分套依据 / 数据集（配了平台映射才出现）/ 数据字段 / 选项 / 默认值 / 宽度**，
  左边缘统一对齐 76px；输入框圆角统一 8px（原来 12px）。
- 「切换数据集」标签简化为「数据集」；数据字段的拖入框撑满剩余宽度（`flex: 1`）。
- **文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`（删掉不再使用的 `label()` 小工具）。
- **怎么验证**：`/bi/components/23/edit` 实测字段卡文本顺序
  `名称 → 控件(下拉) → 分套依据 → 数据字段(已绑定：平台) → 选项 3 → 默认值 → 宽度`，左边缘一条线。
  截图 `docs/_selfcheck/2026-11-21-filter-card-rows.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 优化：筛选栏字段卡容器对齐「导航菜单卡 · 菜单行」

- **之前**：筛选栏每个字段是自己画的白底卡 + 投影（`#E8EEF9` 边 / 内距 10 / 行距 8），
  和别处「重复项卡片」（导航菜单卡的菜单行、按钮行）不是一套。
- **现在**：直接复用同一个共享容器 `GROUP_CARD_SX` —— `#FBFCFE` 浅底、`1px #EEF3FB`、圆角 16、
  内距 12、行距 14，删除类图标按钮同样是 hover / focus 才出现（同一套破坏性操作规范）。
- **保留**：拖拽排序需要的 `position: relative`、拖动中 `opacity .4`、落点提示线。
- **文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **怎么验证**：组件库 `/bi/components/23/edit`（筛选栏，6 个字段）计算样式实测
  `bg rgb(251,252,254)` / `border 1px rgb(238,243,251)` / `radius 16px` / `padding 12px` / `gap 14px`，
  与菜单行一致。截图 `docs/_selfcheck/2026-11-21-filter-card-container.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 优化：分节标题面板按「通用 / 附加」分组

- **改成什么**：分节标题不再平铺一堆控件，跟其它组件同一套骨架 ——
  **通用** = 外观（颜色 / 高度）；**附加** = 标题 / 编号 / 图标 / 说明。
- **空分组不显示**：数据 / 过滤 / 排序 / 运算 / 文字对分节标题不成立（它不产数据、ChartOptionsPanel 对它返回 null），
  这五组直接不渲染，不占位置。
- 顺手去掉分组之间那条 `Divider`（两个大标题已经足够分隔），并清掉因此不再使用的 import。
- **文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（section 分支）。
- **怎么验证**：真机 doc 1 选分节标题 —— 面板文本依次为
  「分节标题 | 通用 | 外观 | 颜色 | 高度 | 附加 | 标题 | 编号 | 图标 | 说明」，五个空分组一个都不出现。
  截图 `docs/_selfcheck/2026-11-21-section-panel-groups.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 修复：分节标题「图标」下拉选了没反应

- **现象**：组件 > 分节标题，在面板「图标」里选了网格 / 饼图等，画板上的分节标题没有任何变化。
- **原因**：这个配置项**只有写没有读** —— 面板写 `spec.content.icon`、`sectionPayload` 也把它带进 payload，
  但 `SectionCard` 压根没用 `payload.icon`，永远只画编号数字（`NUMERAL[index]`）。属于「配了不生效」的死配置。
- **修复**：新增 `renderers/sectionIcon.tsx`（key → 图标组件唯一映射：网格 / 图表 / 饼图 / 表格 / 词云 / 标签 / 结论），
  `SectionCard` 在 `payload.icon` 有值时画图标、否则仍画编号；底块渐变仍随外观主色。
- **文件**：`frontend/src/features/components/renderers/sectionIcon.tsx`（新增）、
  `frontend/src/features/components/renderers/SectionCard.tsx`、`__tests__/SectionCard.test.ts`（补用例）。
- **怎么验证**：画布上选分节标题 → 面板图标当前值「网格」，卡片里是 `GridViewOutlinedIcon`；
  改选「饼图」→ 立刻变 `PieChartOutlineIcon`；改回「默认」→ 图标消失、编号 `1` 回来。
  查看页 `/bi/dashboards/1` 也能看到该图标（`GridViewOutlinedIcon` 1 个，服务端 payload 本来就带 icon）。
  截图 `docs/_selfcheck/2026-11-21-section-icon.png`。`tsc --noEmit` 0；`vitest` SectionCard 3 用例通过。

---
## 2026-11-21 · 新增：画板外的控件不铺在页面上（只在弹窗里出现）

- **需求**：想拿一张明细表当弹窗内容时，可以把它拖到画板外（溢出区）放着 —— 页面上不显示，点指标卡徽标才弹出来。
- **做法**：查看页渲染时跳过「中心点落在画板范围（`canvas.width × canvas.height`）之外」的元素；
  编辑态（含 `?edit=1`）照常显示，否则拖出去就再也找不到它了。
- **不受影响**：服务端照旧渲染这些元素，所以徽标弹窗 / 行详情仍能拿到数据（`cards[key]` 一直在）。
- **文件**：`frontend/src/features/viewer/DashboardPage.tsx`（`outsidePage` 计算 + 渲染过滤）。
- **怎么验证**：把 doc 1 的明细表临时挪到 `x=1700`（画板宽 1504）—— 查看页 `table` 0 个、正文无 `item_id`；
  点指标卡 TOP10 徽标 → 弹窗里 `table` 1 个；`?edit=1` 仍显示 1 个；还原后查看页恢复 1 个、库内 `layout` 回到 `{x:300,y:368}`。
  截图 `docs/_selfcheck/2026-11-21-offpage-hidden.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 优化：指标卡「右上胶囊」文本挪到「附加 · 徽标弹窗」

- **改了什么**：改胶囊文字原来要去「外观」找「徽标」，现在放在指标卡「附加」区最上面（「徽标弹窗」之上），
  标签叫「右上胶囊」，placeholder =「如 TOP10（留空则不显示）」。
- **为什么**：胶囊就是弹窗的入口，两件事拆在两个分区不好找。
- **单一入口**：同时删掉「外观」里的旧「徽标」输入，避免两条路径写出不一致的值。
- **不影响行为**：仍写 `spec.ui.badge`；留空 = 不显示胶囊；配了徽标弹窗时胶囊可点、带 `›`。
- **文件**：`frontend/src/features/components/editor/KpiTopSettings.tsx`（新增 Row）、
  `frontend/src/features/components/editor/StylePanel.tsx`（删除旧 Row）。
- **怎么验证**：真机 doc 1 指标卡 —— 输入框存在且值 `TOP10`；改成「看明细」卡片胶囊即时变并保留 `›`；
  面板内不再有第二个「徽标」入口；改回 `TOP10` 后库内 `spec.ui.badge` 仍为 `TOP10`（未留脏数据）。
  截图 `docs/_selfcheck/2026-11-21-kpi-capsule-config.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 修复：徽标弹窗点周围空白关不掉

- **现象**：弹出的明细表四周看着是空的，点下去却没反应，只能再想别的办法退出。
- **原因**：Dialog 的 Paper 虽然 `bgcolor: transparent`，仍是铺满视口（左右各让 32px）的实心盒子；
  点击落在 Paper 上不会冒到遮罩，`onClose` 的 backdropClick 自然不触发。
- **修复**：Paper 设 `pointerEvents: "none"`，只给表格那一层 `pointerEvents: "auto"` ——
  空白处点击穿透到遮罩 → 关闭；表格内部点击、点行弹抽屉都不受影响。
- **文件**：`frontend/src/features/components/board/TopListDialog.tsx`
- **怎么验证**：真机（doc 1 / 指标卡 TOP10 徽标）—— 点 (45,500) 空白：`elementFromPoint` 命中 `MuiDialog-container`，
  弹窗从「有表格」变 0；点表格内部 (840,470)：仍为 1；点行：抽屉打开（`.MuiDrawer-root` = 1）。
  截图 `docs/_selfcheck/2026-11-21-topl-dialog-blank-close.png`、`2026-11-21-topl-dialog-row-drawer.png`。`tsc --noEmit` 0。

---
## 2026-11-21 · 新增：指标卡徽标弹窗可指定「排序列 + 排序」（只作用于弹窗）

- **面板（指标卡 · 附加）**：「弹出明细表」下面新增「排序列」与「排序」两行。
  「排序列」候选 = 弹出那张明细表**实际渲染出来的列**（取看板渲染结果的 `columns`，显示列名、存列 key）；
  「排序」是三态：`不指定` / `降序` / `升序`。选了列会自动落到「降序」，避免「选了列却没生效」的错觉。
- **只影响弹窗**：配置存在 `spec.top.sort_field` + `spec.top.sort`，弹窗打开时作为 `TableCard` 的 `initialSort`；
  弹窗关闭即卸载（状态不写回文档），页面上的明细表完全不受影响。
- **弹窗内仍可手动改**：列头点击排序保持可用，点了就以手动结果为准（`initialSort` 只是初值）。
- 列已不存在（模板改了列）时自动忽略该排序，不报错、不空白。
- 文件：`backend/app/components/spec.py`（`sort: Literal["", "desc", "asc"]`，默认 `""`）、
  `frontend/src/features/components/types.ts`（`SortDir`）、`editor/KpiTopSettings.tsx`（两个下拉）、
  `board/TopListDialog.tsx`（`sortField` / `sort` → `initialSort`）、`renderers/TableCard.tsx`（沿用已有 `initialSort`）、
  `pages/canvas/CanvasStage.tsx`、`CanvasBoardPage.tsx`、`CanvasDialogs.tsx`、`MiddleConfigPane.tsx`、`viewer/DashboardPage.tsx`（排序值透传）。
- 验证：`tsc --noEmit` 通过；`npm test` 12 文件 53 用例全绿；
  `python -c "TopListSpec()"` 默认 `sort''`、`TopListSpec(sort='asc')` 解析正确；`pytest tests/test_component_seed.py` 14 项通过。
  后端 `spec.py` 有改动，**需重启后端**再刷新页面。

---

## 2026-11-21 · 修复：图片预览被抽屉盖住（预览必须压在最前）

- **现象**：在明细表行详情抽屉的「商品图片」里点图放大，整张预览图被右侧抽屉盖掉一截（大约 560px），
  只露出左边一部分，底部工具栏也被压住。
- **原因**：预览用的是 MUI Dialog 默认 `z-index: 1300`，而抽屉 / 画板浮层是 `1500` —— 层级反了。
- **修复**：图片预览统一抬到 `zIndex: 2000`（抽屉 1500 之上）：
  `ProductDetail.tsx` 的 `ImageViewer`（抽屉里点图放大）+ `TableCard.tsx` 的缩略图看大图（同一个语义，一起统一）。
- **验证**：抽屉里点图 → 全屏预览铺满视口，抽屉区域中心点命中的是预览层（`elementFromPoint` 不再是抽屉）；
  表格缩略图点开 → Dialog `z-index: 2000`、中心点命中 `IMG`；两张截图存 `docs/_selfcheck/2026-11-21-image-preview-top.png`、
  `2026-11-21-thumb-preview-top.png`。`tsc --noEmit` 0。
- 水印层（`WatermarkOverlay`，z 9999）仍在预览之上 —— 属于数据水印/防截屏，不动。

---

## 2026-11-21 · 修复：明细表列头升序 / 降序失效（上一轮去「查看更多」时带掉的）

- **原因**：列头点击排序以前挂在 `payload.more` 上（「查看更多」默认开，所以能点）；上一轮把「查看更多」删掉后，
  只剩 `table_view.sortable` 这个「从无面板入口、默认 false」的条件 → 列头点了没反应。
- **现在**：列头**始终可点** —— 第一次点降序、再点升序（带 ↑ / ↓ 指示 + `aria-sort`）；
  排序针对**已取回的全部行**（≤2000），排完自动回到第 1 页，翻页保持这份顺序。
- **空值处理**：排序时空值固定排最后（升序 / 降序都不占第一页）；
  顺手修了「空数值列显示成 0」——`Number("") = 0` 把空值格式化成 0，现在显示「—」（418 个空 `daily_deal` 之前全显示 0）。
- **清掉废弃字段**：删除 `table_view.sortable`（后端 spec / 渲染 payload / 前端类型 / 新增卡片默认值 / 组件库那一行），
  旧文档里残留的该字段读取时忽略。
- **为什么**：用户反馈「明细表列头升序降序的功能呢」——这是上一轮改动的回归，排序是明细表的标配件，不该有隐藏开关。
- **涉及文件**：`renderers/TableCard.tsx`、`components/types.ts`、`pages/canvas/spec.ts`、`editor/TableDetailSettings.tsx`；
  `components/spec.py`、`components/compute.py`。
- **怎么验证**：真机（`daily_deal`：9700…3，另 418 个空值）——降序首行 9700、升序首行 3、升序最后一页全是「—」、
  第 3 页点列头回到第 1 页；文本列 `product_title` 降 / 升切换，另一列 `aria-sort` 回到 `none`。
  `tsc --noEmit` 0；`pytest` 全绿；`vitest` 131 passed（`mylayout` 计时基准在忙时超阈值，与本改动无关，单跑通过）。
  截图：`docs/_selfcheck/2026-11-21-table-header-sort.png`。

---

## 2026-11-21 · 新增：明细表卡内分页（去掉「查看更多」）

- **分页条（新增）**：明细表底部统一改成卡内分页 —— 左「共 N 条」，右「每页 10/20/50/100 条」+ `‹ 1 2 3 … ›`
  （页码当前页高亮、首末页固定、中间省略；上一页 / 下一页在边界置灰）。组件：`frontend/src/features/components/renderers/PageBar.tsx`，
  页码序列纯函数在 `pagerItems.ts`（单测 `__tests__/pager.test.ts`）。
- **去掉「查看更多」**：删除卡片右下「查看更多 →」按钮 + 92vw 全表弹窗，以及 `onMore / onLoadAll / onTableMore`
  整套拉全量链路（`TableCard` / `registry` / `DashboardPage` / `BoardCard` / `BoardSurface` / `BoardViewer` / `CanvasStage` / `BiViewPage`）。
  后端 `/bi/dashboards/{id}/rows` 接口保留（不再被界面调用，避免影响外部脚本）。
- **面板「行限制」→「每页条数」**：明细表的中栏面板不再有「行限制」，改成「每页条数」（3–200，默认 10，落 `table_view.page_size`）；
  其它图表仍是「行限制」。页脚下的每页条数可临时切换（只影响本次浏览，不改文档）。
- **后端行为**：明细表一次取到上限 2000 行（原来按 `binding.top_n` 截断成 10 行，再靠「查看更多」拉全量），
  `build_table` 不再截断、也不再下发 `more / more_label`；分页在前端做（`resolver._request_for` / `compute.build_table`）。
  spec 里的 `more / more_label` 保留只为兼容旧文档（默认 `False`，读取时忽略）。
- **为什么**：用户要求「明细表不需要查看更多，添加分页组件」。行限制 + 查看更多是同一件事的两套入口，按 §3.1 收敛成一个分页条。
- **涉及文件**：`TableCard.tsx`、`PageBar.tsx`、`pagerItems.ts`、`__tests__/pager.test.ts`、`QueryPanel.tsx`、`registry.tsx`、
  `DashboardPage.tsx`、`BoardCard/BoardSurface/BoardViewer`、`CanvasStage.tsx`、`BiViewPage.tsx`、`sizes.ts`、`types.ts`（前端）；
  `components/compute.py`、`components/resolver.py`、`components/spec.py`、`components/seed_base.py`、`components/seed_pages.py`、
  `tests/test_table_sort.py`、`tests/test_related_thumbnail.py`（后端）。
- **组件库同步**：`base.table`（`bi_component` id=2）`table_view.more` 改 `false`、`more_label` 清空、描述改「卡内分页」；
  `seed_base` 模板同口径（下次重灌种子也是新的）。
- **怎么验证**：`tsc --noEmit` 0；`uv run pytest -q` 全绿（`test_table_sort` / `test_related_thumbnail` 两条旧「按行限制截断」断言同步改成新口径）；
  `npm test` 132 passed（新增分页 4 条；`mylayout` 计时基准偶发超 10ms 与本改动无关）；
  真机 1440×900：成品页 10 行 / 共 2000 条 / 无「查看更多」、点第 2 页首行序号 11、每页 50 条变 50 行；
  编辑器选中明细表 → 面板「每页条数」且无「行限制」、卡内可翻页；组件库缩略图页脚正常缩放；
  接口：`page_size=20` 落库并下发，非法值 `999→200`、`1→3`（超范围按 spec 夹取，字符串给错误卡不 500）。
  截图：`docs/_selfcheck/2026-11-21-table-pagination*.png`、`2026-11-21-table-library-card.png`。
- **注意（性能）**：每张明细表卡一次返回最多 2000 行（原来 10 行 + 按需拉全量），一张页上多张明细表时响应体会变大；
  真要按页取数（LIMIT/OFFSET + 真总数）属二期，本次按「前端翻页」口径交付。
- **· 迭代（顺手修）**：`__tests__/tableHeaderInput.test.ts` 之前是红的（面板把「列头名称」并入字段行后，输入框从 `label` 改成
  `placeholder="显示名称"`），已按新结构更新断言。
- **· 迭代（对齐）**：分页条整行统一 24px 行高 —— 文字 / 下拉框 / 页码 / 箭头用同一个行盒、同一条基线。
  改前实测：下拉框里的「10」比其它文字高 2.3px、页码数字低 0.8px（最大偏差 2.33px）；改后各元素基线都是 24.62px。
  省略号从「…」字符换成 `MoreHoriz` 图标（字符压在基线上、看着偏低），下拉箭头从实心三角换成 `ExpandMore`（与左右箭头同款），
  页码方块 24×24、圆角 8px；明细表不再向左外扩 4px，页脚与表格、卡片标题落在同一条左缘（303.51px）。
  验证：canvas 文本度量各元素基线一致 + 真机 3x 截图；成品页 / 编辑器卡内翻页回归 2/2 通过。

---
## 2026-11-20 · 新增：右侧抽屉弹窗壳子 DrawerShell（独立组件，暂未接看板）

- **DrawerShell（新增）**：`frontend/src/components/common/DrawerShell.tsx` —— 看板弹窗的通用右侧抽屉容器。
  标题栏（标题 + 副标题 + 关闭）+ 半透明遮罩 + 滑入滑出动画 + 独立滚动内容区 + 可选 loading；
  宽 780 可配置、`96vw` 响应式、左缘圆角 `12px`；`open/onClose/title/subtitle/width/loading/children` 由调用方控制，
  调用方保持挂载、只切 `open` 即可获得退出动画（MUI Drawer 原生过渡，不整棵卸载）。
- **Story（新增）**：`frontend/src/components/common/DrawerShell.stories.tsx` —— `Common/DrawerShell` 两个 story
  （Default / Loading），storybook 里直接看打开/关闭/滚动/loading。
- **验证**：`tsc --noEmit` 通过；`build-storybook` 编译通过；Playwright DOM 断言 **13/13 通过**
  （初始关闭 / 打开 / 宽度 780 / 标题 / 副标题 / 关闭按钮 / 遮罩 rgba(15,23,42,.5) / 圆角 12px / 内容区滚动 /
  ESC 关闭 / 点遮罩关闭 / 关闭按钮关闭 / loading spinner）。截图存 `docs/_selfcheck/drawershell-*.png`（不入库）。
- **· 迭代（接入明细表）**：明细表「点击行弹出」已接入 —— `TableCard.tsx` 点行改弹 `DrawerShell`（标题取行标识列值、
  内容空壳占位），替换掉原来的「画板弹窗」（画板先不用）；`TableDetailSettings.tsx` 隐藏「弹窗画板」「弹出位置」，
  保留「点击行弹出」开关 + 「行标识列」；后端 `detail` 字段结构不变；编辑器内联面板同步置空。
  Playwright 正反 **6/6 通过**（初始无抽屉 / 点行弹出 / 标题=行标识列 / 空壳占位 / 关闭消失 / 未启用不弹）。
- **· 迭代（商品详情模板）**：抽屉内容从空壳换成商品详情 —— `ProductDetail.tsx`（新增）：标题 + 行标识 +
  平台/品牌/品类/榜单标签 + 4 指标卡（热卖价/日销量/热销指数/霸榜天数）+ 差评云（痛点拆词）+ 卖点云（主/副卖点）+ 差评数；
  按数据集字段自动映射（中/英文都认，有则渲染、无则跳过），用「行标识列」取完整一行（`GET /datasets/{id}` + `POST /datasets/{id}/query` columns）。
  `TableCard.tsx` 抽屉内容改用它（传 dataset_id + row + key_field）。
  验证：`tsc --noEmit` 通过；真实环境（看板 1 / 数据集 10）点行 → 抽屉弹出、标题/标签/指标卡渲染 **5/5 通过**；
  数据集 10 的 hot_index/on_rank_days/bad_cnt/brand_name 本身为空 → 显示 —，无卖点/痛点字段 → 词云不显示（部分降级）。
  · 迭代（样式）：按演示截图重排 —— 头部（标题 + 链接ID + 关闭按钮）、差评云（词云 + 「字号大=提及越多」说明）、
  卖点云（主/副卖点两个卡片）、近30天每日差评数区块；缺数据的区块统一显示空态。
  · 迭代（字段可配置）：明细表「弹窗」配置下新增「抽屉字段」14 项下拉（标题/平台/品牌/品类/榜单/排名/热卖价/
  日销量/热卖指数/霸榜天数/差评数/差评云（痛点）/主卖点/副卖点），可选数据集字段或「（自动匹配）」；
  存 `table_view.detail.fields`（后端 `TableDetailSpec.fields`），`ProductDetail` 优先按配置取列、未配置回退字段名自动匹配。
  验证：`tsc --noEmit` 通过；编辑器面板出现「抽屉字段」（14 项）；临时给看板 1 配置 fields 后点行 → 抽屉按配置渲染（PUT 200），
  验证后已恢复原 doc（restore 200）。
  · 迭代（词云组件）：差评云 / 主卖点 / 副卖点改用词云组件（`WordCloudCard`）；
  明细表「弹窗」配置下新增「词云」区（每块：拆词符 + 主题色，6 套主题色可选），
  存 `table_view.detail.wordclouds`（后端 `TableDetailSpec.wordclouds`）；无频次数据时按词序给权重（仅字号示意）。
  验证：`tsc --noEmit` 通过；编辑器面板出现「词云」（3 块 × 拆词符 + 主题色）。
  · 迭代（词云关联他表）：每个词云新增「关联表 / 关联字段 / 词字段 / 权重字段」，可从其他数据集按明细表行值取数；
  存 `table_view.detail.wordclouds[块]`（后端 `TableDetailSpec.wordclouds`）；没配关联表时回退当前数据集字段。
  验证：`tsc --noEmit` 通过；面板 3 块词云均出现关联表下拉 + 关联字段/词字段/权重字段；
  临时配置关联表=数据集10、关联字段=product_title、词字段=item_id → 点行，抽屉差评云显示该行 item_id（100293054147），验证后恢复原 doc。
  · 迭代（权重字段接入）：「权重字段」已参与字号（关联表每行按权重累加，没配则按词序）。
  验证：`tsc --noEmit` 通过；关联表=数据集10 / 词字段=platform_name / 权重字段=final_price → 抽屉差评云显示「京东」，验证后恢复原 doc。
  · 迭代（输入框统一）：明细表配置面板的 TextField / Select 全部改成可输入下拉（Autocomplete）——左说明 + 输入框内灰色默认值；
  涉及 `LeftDatasetPane`（数据集）、`QueryPanel`（排序字段 / 排序）、`StylePanel`（数字格式）、`TableDetailSettings`（词云关联表 / 主题色 / 拆词符 / 关联字段）。
  验证：`tsc --noEmit` 通过；面板 `.MuiSelect-select` 数量 **0**，Autocomplete **37** 个。
  · 迭代（文本输入框样式）：列头名称 / 卡片标题 / 右上说明 改为「左说明 + 右输入框」（字号 12、圆角 2）；
  数字框（行限制 / 高度）保留原生上下箭头不变。
  验证：`tsc --noEmit` 通过；面板 3 个文本输入框均为左说明，`input[type=number]` 2 个（行限制 / 高度）。
  · 迭代（设计界面不弹 + 数字框左说明）：设计界面（画布编辑器）点明细表行不再弹抽屉，成品页照旧弹；
  行限制 / 高度改为「左说明 + 数字输入框」（保留上下箭头），说明宽度统一 76（列头 / 卡片标题 / 右上说明 / 排序字段 / 行限制 / 数字格式 / 高度边缘对齐）。
  验证：`tsc --noEmit` 通过；设计界面点行后 `.MuiDrawer-paper` 数量 0；`input[type=number]` 2 个。
  · 迭代（圆角统一 + 每字段一行）：配置界面所有输入框圆角统一 **8px**（与自动补全框一致）；
  排序字段 / 行限制 / 排序、数字格式 / 高度 / 徽标 改为纵向「一行一个配置字段」；缩略图「图片字段」改可输入下拉。
  验证：`tsc --noEmit` 通过；面板输入框 computed `borderRadius` 全部 8px（non-8px 为空）。
  · 迭代（配置分区折叠）：明细表配置分区（字段 / 列头名称 / 缩略图 / 弹窗 / 运算 / 文字）默认展开、点标题收起（箭头旋转）；
  `Slot` / `PanelSection` 增加 `collapsible` + `defaultOpen` 选项（事件不冒泡到右侧操作）。
  验证：`tsc --noEmit` 通过；面板 8 个折叠箭头；点「弹窗」标题后内容收起、再点恢复（1 → 0 → 1）。
  · 修复（Vite 崩溃）：`frontend/vite.config.ts` 的 `server.watch.ignored` 增加 `**/*.tmpdir/**`、`**/*.tmp`、`**/.tmp-*`，
  避免 Windows 下写文件工具的临时文件被 chokidar 监听到 `EBUSY` 导致 vite 进程退出。
  验证：启动 vite 后写一次 `src` 文件，vite 仍返回 HTTP 200（不再崩）。
  · 迭代（去掉多余「计算」标题 + 过滤折叠 + 运算左说明）：QueryPanel 去掉包着过滤 / 排序 / 运算的「计算」外层标题；
  过滤 Slot 加折叠；运算（换算 / 小数位 / 乘数 / 加数 / 前缀 / 后缀）改为「左说明 + 输入框」纵向排列，圆角 8px。
  验证：`tsc --noEmit` 通过；面板无「计算」标题、过滤可折叠（ExpandMore 9 个）、运算 6 个字段齐全。
  · 迭代（外观折叠）：「外观」分区（StylePanel）包可折叠标题，默认展开、点标题收起；去掉 banner / nav 分支内部重复的「外观」标题。
  验证：`tsc --noEmit` 通过；面板「外观」可折叠（ExpandMore 10 个），点标题内容收起 / 恢复（1 → 0 → 1）。
  · 迭代（颜色卡组）：去掉颜色卡组上方的「外观」标题，改为「颜色」说明 + 颜色选项（左说明 76，与其它字段边缘对齐）。
  验证：`tsc --noEmit` 通过；面板出现「颜色」说明。
  · 迭代（排序分组）：排序字段 / 行限制 / 排序 收进「排序」折叠分组（默认展开，点标题收起）。
  验证：`tsc --noEmit` 通过；点「排序」标题后排序字段收起 / 恢复（1 → 0 → 1），ExpandMore 11 个。
  · 修复（面板间距不一致）：`Slot` 的 `mb 1.75` → `2`、`PanelSection` 的 `mt 3` → `2`（统一 16px）；
  去掉「外观」和「文字」之间多余的 `Divider`。
  验证：`tsc --noEmit` 通过；各配置分区标题间距统一。
  · 修复（文字与缩略图贴死）：缩略图外包 `Box sx={{ mt: 2 }}`，补上「文字」分组和「缩略图」之间的 16px 间隔（原先「文字」没有下边距、「缩略图」只有下边距，两者贴在一起）。
  验证：`tsc --noEmit` 通过；面板中「文字」与「缩略图」不再贴死。
  · 修复（列头名称与过滤之间多出间距）：去掉「计算区」外层 `Box` 的 `mt: 3`（24px），统一走 `Slot` 的 16px。
  验证：`tsc --noEmit` 通过；「列头名称 → 过滤」与其它分区同为 16px。
  · 迭代（抽屉字段精简）：去掉「抽屉字段」里的 差评云（痛点）/ 主卖点 / 副卖点（14 → 11 项）；词云没配关联表时回退改用默认字段名。
  验证：`tsc --noEmit` 通过；「抽屉字段」不再出现「差评云（痛点）」，词云区「差评云 / 主卖点 / 副卖点」保留。
  · 迭代（开关说明对齐）：缩略图的「关联字段」「关联外部字段」、弹窗的「点击行弹出」三个开关统一为「左说明（宽 76）+ 右开关」。
  验证：`tsc --noEmit` 通过；面板三个说明齐全，开关 3 个。
  · 迭代（行标识对齐）：弹窗区「行标识」改为「左说明（宽 76）+ 右可输入下拉」，与其它字段左边缘对齐。
  验证：`tsc --noEmit` 通过；面板出现「行标识」说明。
  · 新增（抽屉附加区块）：抽屉增加「近 30 天差评数」（柱状图）「差评明细」「产品 SKU」三个区块，可从关联表按行标识取数；
  明细表配置面板新增「附加区块」配置（每块：关联表 / 关联字段 / 日期 / 数值 / 评分 / 标签 / 内容 / 规格 / 价格）；
  存 `table_view.detail.blocks`（后端 `TableDetailSpec.blocks`）。
  验证：`tsc --noEmit` 通过；面板出现「附加区块」（近30天差评数 / 差评明细 / 产品 SKU）。
  注意：后端 `TableDetailSpec` 新增了 `blocks` 字段，需**重启后端**才会保存进库。
  · 新增（卖点 / 痛点标签区块）：抽屉增加「产品卖点」「差评痛点标签」两个标签区块
  （从关联表按行标识取标签字段，拆词后横向排列）；附加区块配置支持这两块（关联表 / 关联字段 / 标签字段 / 拆词符）。
  验证：`tsc --noEmit` 通过；面板出现「产品卖点」「差评痛点标签」。
  · 迭代（差评柱状图用组件）：近 30 天差评数改用柱状图组件 `BarCard` 渲染（rose 红柱 + 日期分类轴 + 虚线网格 + 顶部值），不再自绘 div 柱。
  验证：`tsc --noEmit` 通过；空数据时显示空态，有数据时走 `BarCard`（payload series = 日期/数值）。
  · 迭代（差评柱状图参数）：近30天差评数改为「关联表 + 维度/指标 + 图表参数（柱宽 / 网格 / 颜色）」，
  去掉「日期字段 / 数值字段」；`TrendChart` 用 `BarCard` 的 `chart` 参数（bar_width / show_grid）+ `ui.accent`。
  验证：`tsc --noEmit` 通过；面板出现「维度 / 指标 / 柱宽 / 网格 / 颜色」，「数值字段」不再出现。
  · 迭代（差评柱状图 X/Y 轴）：近30天差评数改为「X轴（维度）+ Y轴函数（内置聚合 COUNT/SUM/AVG/MAX/MIN/COUNT_DISTINCT）+ Y轴字段」，
  查询走语义层 `dimensions + metrics`（按 X轴分组、Y轴聚合）；「维度 / 指标」改名「X轴 / Y轴」。
  验证：`tsc --noEmit` 通过；面板出现 X轴 / Y轴函数 / Y轴字段。
  · 迭代（trend 颜色用圆点）：近30天差评数的「颜色」改成颜色圆点组（点选 7 套配色，再点取消）。
  验证：`tsc --noEmit` 通过；面板出现颜色圆点（title=rose 等）。
  · 迭代（X轴日期）：近30天差评数查询加日期过滤（X轴日期 ≥ 今天-30天）；柱状图日期标签去掉年份（2024-09-20 → 09-20）。
  验证：`tsc --noEmit` 通过；聚合查询生成 `GROUP BY 日期`，日期过滤进 WHERE。
  · 新增（X轴写 SQL 表达式）：X轴 / Y轴 支持直接写 SQL（如 `to_char(listed_date,'MM-DD')` / `COUNT(*)`）；
  维度表达式走后端 `compile_dimension_expression`（sqlglot 白名单 + 只读网关 + PG 方言），生成 `SELECT 表达式 AS dim ... GROUP BY 表达式`；
  Y轴写聚合表达式走 metrics CUSTOM。
  验证：后端 `compile_dimension_expression` 生成 `TO_CHAR(...)`，builder 生成 `GROUP BY TO_CHAR(...)`；普通字段维度不变。
  注意：后端改动需**重启后端**。
  · 迭代（近30天差评数还原选字段）：X轴 / Y轴 改回「选字段」（X轴字段 / Y轴函数 / Y轴字段），不再要求写 SQL；
  查询恢复为 `dimensions=[X轴] + metrics=[{Y轴字段, Y轴函数}]`；后端表达式能力保留但不再启用。
  验证：`tsc --noEmit` 通过；面板出现 X轴字段 / Y轴函数 / Y轴字段。
  · 迭代（差评柱状图空态）：无数据时不再显示「暂无每日差评数据」文字，改为空白柱状图框架（坐标轴 + 网格，由 `BarCard` 空态渲染）。
  验证：`tsc --noEmit` 通过；看板抽屉里无数据时「暂无每日差评数据」不再出现，区块框架保留。
  · 迭代（差评柱状图空态回退）：近30天差评无数据时恢复上一版的空容器（「暂无每日差评数据」），
  不再画空白柱状图框架；`BarCard` 空态恢复「暂无数据」。
  验证：`tsc --noEmit` 通过；看板抽屉里无数据时「暂无每日差评数据」重新出现。
  · 迭代（差评空态文案）：空态文字改为「近30天无差评」。
  · 迭代（差评明细评分）：评分直接显示字段文本，不再额外拼「★」，避免字段本身带星时重复。
  · 新增（差评明细分页）：差评明细列表改为前端分页，默认每页 10 条；底部显示「共 N 条 · 第 X/Y 页」+ 左右翻页按钮，单页时隐藏分页条；无数据仍为空容器。
  验证：`tsc --noEmit` 通过。
  · 迭代（差评明细分页对齐）：分页条改为右对齐（文本「共 N 条 · 第 X/Y 页」+ 翻页按钮都在右侧）。
  · 新增（产品 SKU 分页）：产品 SKU 列表改为前端分页，默认每页 10 行；底部右对齐「共 N 条 · 第 X/Y 页」+ 翻页按钮；
  价格为空不显示 ¥，字段值自带 ¥ 时不再重复拼接。
  验证：`tsc --noEmit` 通过；抽屉里 SKU 12 条显示「共 12 条 · 第 1/2 页」，价格 `¥6.89` 正常。
  · 优化（过滤条件行）：过滤条件改为一行 = 字段（补全输入）+ 运算符（下拉）+ 值（输入）+ 减号（删除），行内直接编辑；
  「把字段拖到这里过滤」拖拽容器始终存在（拖入 / 点击即加一行，不再用「添加」弹层）；输入框圆角统一 8px。
  验证：`tsc --noEmit` 通过；面板拖拽容器常在，点击后新增一行（字段 / 值 / 减号），拖拽容器仍保留。
  · 优化（字段栏 + 过滤行宽度）：明细表字段改为一行一个 = 字段胶囊 + 显示名称输入框（显示名称即表格列头），删除「列头名称」栏；
  过滤行宽度改为 3:1:1:1（字段 : 运算符 : 值 : 减号）。
  验证：`tsc --noEmit` 通过；面板「列头名称」不再出现，字段行带「显示名称」输入框。
  · 优化（过滤容器样式 + 箭头）：过滤拖拽容器改为与「添加字段」一致的虚线框（12.5 字号、hover 反馈、圆角一致）；
  过滤运算符下拉框隐藏下拉箭头。
  验证：`tsc --noEmit` 通过；`.MuiSelect-icon` display 为 none（两个运算符下拉都不显示箭头）。
  · 优化（过滤行比例）：过滤条件行宽度改为 3 : 1.5 : 1 : 0.5（字段 : 运算符 : 值 : 减号）。
  · 优化（抽屉词云空态）：差评云 / 主卖点 / 副卖点无数据时显示空白词云占位（170 高白卡），不再整块隐藏；
  空白占位不显示「暂无数据」文字。
  验证：`tsc --noEmit` 通过；抽屉里「暂无数据」不再出现，差评云 / 卖点云标题与空白占位都在。
  · 优化（抽屉词云空态文案）：无数据时改用「近30天无差评」同款空容器（虚线框 + 浅底），
  文字分别为「暂无差评 / 暂无主卖点 / 暂无副卖点」。
  验证：`tsc --noEmit` 通过；抽屉里三个空态文字都出现。
  · 优化（过滤容器文案）：拖拽容器文字改为「＋ 添加条件」（与「＋ 添加字段」一致）。
  · 优化（字段行宽度）：字段胶囊与显示名称输入框宽度 1:1（胶囊 `flex: 1`，去掉 `maxWidth 200` 限制）。
  · 修复（胶囊文字省略）：胶囊里字段名改为 `flex: 1` + `minWidth: 0`，过长时用「…」截断；
  删除按钮 `flexShrink: 0` 固定在胶囊右端，不被文字挤走。
  · 新增（抽屉商品图片页）：抽屉左上角标题「商品详情」，右侧加切换按钮（图片图标），点一下切到「商品图片」页：
  主图 / SKU图 / 详情图 三块图片，从当前行自动取图片字段（主图 / main_image / image…），取不到显示「暂无主图」等空态。
  验证：`tsc --noEmit` 通过；抽屉标题出现「商品详情」，切换按钮 1 个，切过去后主图 / SKU图 / 详情图都在。
  · 迭代（抽屉标题 + 切换按钮）：切换按钮改为双向箭头（SwapHoriz）并放在标题旁边；标题不加粗（fontWeight 400）。
  · 迭代（商品图片橱窗）：主图 / SKU图 / 详情图 三组改为横向滚动橱窗（88×88 正方形图片），点击图片弹出放大预览；
  无真实图片时用内联 SVG 演示图占位（每组 3 张），不依赖网络。
  验证：`tsc --noEmit` 通过；抽屉切到商品图片后 9 张图（3 组 × 3 张），点图后 Dialog 打开。
  · 迭代（商品图片缩略图网格）：由横向滚动改为缩略图网格平铺（每行自适应、正方形最小 56px、hover 描边），点击放大预览。
  · 迭代（抽屉标题切换 + 缩略图放大）：切换后标题改为「商品图片」（返回改回「商品详情」）；商品图片页缩略图放大 3 倍（56 → 168px）。
  · 迭代（商品图片横向滚动）：恢复横向滚动橱窗，演示图每组 5 张（168px），一屏放不下时出现水平滚动条。
  · 新增（图片放大预览组件）：仓库内没有现成的 lightbox / 图片预览依赖，自写 `ImageViewer`——
  全屏深色遮罩，左键拖动平移、滚轮缩放（0.3 ~ 8 倍）、右上角关闭按钮。
  验证：`tsc --noEmit` 通过；实测滚轮后 scale 1 → 1.45，拖动后 translate 变化，关闭按钮存在。
  · 新增（图片组展开/收起）：三组图片标题右侧加展开箭头（展开/收起两态）——收起时横向滚动；
  展开后主图 / SKU图缩略图尺寸不变、自动换行显示全部，详情图满宽纵向排列（等比例放大）。
  验证：`tsc --noEmit` 通过；展开后主图/SKU图仍 166px、详情图 524px（满宽）。
  · 优化（预览点击空白关闭）：放大预览时点击空白处（未拖动）关闭；拖动（位移 ≥ 5px）与滚轮缩放照常生效。
  验证：`tsc --noEmit` 通过；实测点空白后 Dialog 1 → 0。
  · 重构（明细表弹窗配置分组）：弹窗下改成 11 个独立可折叠块（差评云 / 主卖点 / 副卖点 / 近30天差评数 / 差评明细 / 产品SKU / 产品卖点 / 差评痛点标签 / 主图 / SKU图 / 详情图）；
  图片块参考缩略图「关联外部字段」配置（关联表 / 关联字段 / 图片字段），存 `detail.images`；抽屉图片页读配置字段。
  后端 `TableDetailSpec` 同步新增 `images`。
  验证：`tsc --noEmit` 通过；面板 11 个块标题都在（21 个折叠箭头）；后端 spec 导入正常。
  注意：后端改动需**重启后端**。
  · 修复（关联外部字段样式）：缩略图「关联外部字段」的配置项（当前数据集关联字段 / 图片资源表 / 资源表关联字段 / 图片地址字段 / 地址转换 / 匹配正则 / URL 前缀）改为「说明 + 输入框」左说明样式，圆角统一 8px。
  验证：`tsc --noEmit` 通过；面板这三类说明都在。
  · 新增（图片地址转换）：主图 / SKU图 / 详情图的图片配置增加「地址转换」（不处理 / 前缀拼接 / 文本替换 / 正则替换 +
  匹配正则 / URL 前缀 / 替换内容），抽屉图片按配置转换图片地址（`detail.images[x].operation/pattern/replacement`）。
  验证：`tsc --noEmit` 通过；面板「地址转换」出现 3 次（三个图片块各一）。
  · 新增（图片筛选字段）：图片配置增加「筛选字段」+「匹配内容」——选筛选字段后出现匹配内容下拉（去重值来自该字段查询），
  抽屉图片按「筛选字段 = 匹配内容」从关联表取图（`detail.images[x].filter_field / filter_value`）。
  验证：`tsc --noEmit` 通过；面板「筛选字段」出现 3 次；未选筛选字段时不显示「匹配内容」。
  · 修复（缩略图 hover 边框被遮挡）：横向滚动容器 `overflow-x: auto` 会把 `overflow-y` 也变成 auto，
  导致 hover 的 2px 外发光在上下边缘被裁剪；容器加上下 padding（pt 4px / pb 6px）后不再遮挡。
  验证：`tsc --noEmit` 通过；图片条 padding 4/6px，hover `box-shadow 0 0 0 2px` 正常显示。
  · 迭代（左侧光晕遮挡）：图片条再补左内边距（`pl` 4px），第一张图左侧 hover 光晕不再被裁。
  验证：图片条 padding-left 4px。
  · 新增（预览工具栏）：放大预览底部加工具栏（上一张 / 页码 / 下一张 / 下载），左右切换循环、切换后重置缩放与位置；下载走 `a[download]`。
  验证：`tsc --noEmit` 通过；抽屉实测上一张/下一张/下载都存在，点下一张页码 3/200 → 4/200。
  · 修复（预览页码按分组）：图片查询补上关联字段过滤（`key_field = 当前行 item_id`），预览页码只算当前商品该分组的图片；
  此前只按 `file_type` 过滤，导致每组返回全表 200 张。
  验证：`tsc --noEmit` 通过；主图组 3 张，页码 3/3。
  · 优化（抽屉默认态）：点行打开抽屉默认「商品详情」（打开时重置视图，不保留上次的图片页）；商品图片页的「详情图」默认展开。
  验证：`tsc --noEmit` 通过；打开抽屉标题为「商品详情」，切到图片页后详情图有「收起」按钮（已展开）。
  · 新增（明细表标题搜索）：表格配置增加「搜索」开关；开启后标题右侧显示搜索框，按所有列模糊过滤（忽略大小写），
  「共 N 条」随过滤结果更新。后端 `TableViewSpec.search` + payload `search`。
  验证：`tsc --noEmit` 通过；面板「搜索 / 标题搜索」出现。
  注意：后端改动需**重启后端**。
  · 重构（面板通用/特有分区 + 说明+输入样式）：所有组件配置面板统一为「通用（数据 / 过滤 / 排序 / 运算 / 外观 / 文字）+ 组件特有」两层；
  所有配置项改为「左说明 76 + 右控件」（输入框圆角 8px），涉及 QueryPanel（43 处）、ChartOptionsPanel（14 处）、StylePanel（14 处）、TableDetailSettings、RelatedThumbnailSettings；新增共享 `Row` / `fieldSx`（`editor/Row.tsx`）。
  验证：`tsc --noEmit` 通过；明细表面板出现「通用 / 明细表」分区、24 个折叠箭头。
  · 迭代（面板通用区）：通用改为大号加粗文字（可读性更好、不折叠）；口径组件去掉「查看 SQL」黑底 SQL；
  明细表不显示空的「数据」分组；指标区为「指标 + 聚合 + 自定义 SQL」说明+输入。
  验证：`tsc --noEmit` 通过；通用 fontWeight 700、无「查看 SQL」、明细表无「数据」分组。
  · 迭代（口径 → SQL）：删除口径组件（DataCheckPanel 不再使用），面板顶部默认显示黑底 SQL（`payload.sql`）。
  验证：`tsc --noEmit` 通过；面板无「口径」，黑底 SQL 默认显示。
  · 迭代（指标卡数据区）：指标卡的数据改为「指标 / 聚合 / 自定义 SQL」三行「说明 + 输入」，不再用槽标题；
  选「自定义 SQL」后出现自定义 SQL 输入框（等宽字体）。
  验证：`tsc --noEmit` 通过；指标卡面板出现「指标 / 聚合」。
  · 迭代（指标卡指标输入）：指标改为可输入下拉（Autocomplete），去掉删除按钮；自定义 SQL 仅在选「自定义 SQL」时出现，
  占满整行（含说明宽度）、无左侧说明、下方带说明文字；「数据」分组可折叠。
  验证：`tsc --noEmit` 通过；面板出现「数据 / 指标」，指标为可输入下拉。
  · 迭代（面板默认展开 + 空分组隐藏）：所有配置栏默认展开（运算区也默认展开）；
  空分组隐藏——指标卡不再显示空的「排序 / 行限制」，明细表不显示「数据」，分节标题不显示「文字」。
  验证：`tsc --noEmit` 通过；指标卡面板无「排序 / 行限制」、「运算」默认展开。
  · 迭代（指标卡特有 + 间距）：徽标弹窗从「外观」移到「指标卡」特有分组（放最后）；`PanelSection` 补 `mb: 2`，
  修复折叠后相邻分区（PanelSection 无 mb、Slot 无 mt）间距为 0 的问题。
  验证：`tsc --noEmit` 通过；指标卡面板「指标卡 / 徽标弹窗」都在。
  · 迭代（面板两大栏）：配置面板分「通用 / 附加」两个大栏，组件特有配置统一放「附加」（不再用组件名当标题）。
  验证：`tsc --noEmit` 通过；面板「通用 / 附加」都在，「特有」不再出现。
  · 迭代（附加同层级）：附加与通用同级（大号加粗 Typography，都不折叠）。
  验证：`tsc --noEmit` 通过；通用 / 附加均为 `P`、`fontWeight 700`。
  · 新增（SQL 预览）：面板顶部 SQL 改为格式化 + 语法高亮（关键词紫、标识符蓝、字符串绿、数字红），
  等宽字体（ui-monospace / Menlo / Consolas）、字号 12（原 10），最大高度 160 可滚动。
  验证：`tsc --noEmit` 通过；SQL 已按子句换行，fontFamily 等宽、fontSize 12px。
  · 迭代（SQL 缩进 + 水平滚动）：子句换行、`SELECT / WHERE` 内逗号换行并缩进两格；`whiteSpace: pre` + `overflowX: auto`，
  超宽可水平滚动、不自动折行，最大高度 180。
  验证：`tsc --noEmit` 通过；whiteSpace=pre、overflowX=auto、scrollWidth > clientWidth（可横向滚动）。
  · 迭代（自定义 SQL 字体）：自定义 SQL 输入框改用代码字体（ui-monospace / SFMono-Regular / Menlo / Consolas），字号 12。
  验证：`tsc --noEmit` 通过；textarea 字体为 ui-monospace……
  · 重构（徽标弹窗用明细表组件）：`TopListDialog` 的表格渲染改为 `TableCard`（与看板明细表同款：列头 / 缩略图 / 序号 / 条数 / 滚动条）；
  保留标题、口径说明、加载 / 错误 / 空态。
  验证：`tsc --noEmit` 通过。
  · 迭代（徽标弹窗无外层 + 行详情）：弹窗去掉白色外框（Paper 透明），直接显示明细表；
  后端 `top-list` 返回 `detail`（沿用页面明细表的行详情配置），弹窗内点行可弹抽屉。
  验证：`tsc --noEmit` 通过。
  · 修复（弹窗透明边框 + 抽屉层级）：Dialog Paper 去掉 `border` / `outline`（透明边框消失）；
  `DrawerShell` 的 `ModalProps.sx.zIndex` 提到 **1500**（抽屉压在弹窗之上，不再被遮挡）。
  验证：`tsc --noEmit` 通过。
  · 迭代（弹窗彻底无框）：Dialog Paper 加 `backdropFilter: none`（去毛玻璃），去掉标题 / 子标题 / 关闭按钮，
  只保留明细表（点遮罩或表内关闭即退出）。
  验证：`tsc --noEmit` 通过。

---

## 2026-11-17 · 发布：v0.3.0 —— 板块化收敛落地版 · 脱敏收口

- **版本与治理**：`docs/仓库操作规范.md` 更名为 **`docs/发布github仓库操作规范.md`**（内容全量保留，补「Gitea 镜像推送」步骤、
  当前版本改 `v0.3.0`、发布记录补 v0.2.0 / v0.3.0 两行）；README 文档表补「第三方依赖许可清单」入口、修正两处规范链接
  （原链接指向已改名的旧文件，是断链）；MCP `serverInfo.version` 同步 `0.3.0`。
- **脱敏（仓库规则一 · 推送前零残留）**：词云示例数据 6 处「颗粒碎末多」/ 3 处「猫不爱吃」、品牌榜示例 2 个真实品牌、
  3 处代码注释里的真实商品 ID / 差评词 → 全部换合成替身（`700000000001` / 示例品牌甲·乙 / 粉末偏多 / 宠物不爱吃）。
  涉及 `frontend/src/features/components/renderers/__fixtures__/wordcloud.json`、`Renderers.stories.tsx`、
  `frontend/src/features/components/editor/QueryPanel.tsx`、`backend/app/components/seed_base.py`、`backend/app/routers/images.py`。
- **验证**：`pytest` **344 passed**；前端 `tsc + build` 通过；`vitest` **58 passed**；
  `scripts/check_file_limit.py` 528 个源文件 / 82 个存量超限且**无新增、无变长**；`scripts/scan_secrets.sh` 退出码 0（全历史无命中）；
  22 词脱敏自查在源码域 **0 残留**。
- **诚实的边界**：`docs/DATA-POLICY.md`、规范与更新日志里仍出现词表本身（规则的定义，不是数据），按规则保留；
  历史提交里的真实品牌名/差评词不清洗（规则四「历史永不删除」+ 更新日志「只加不改」），要彻底清除需仓库所有者决定是否改写历史。

---
## 2026-11-17 · 新增：商用开发规范 + 依赖许可台账 + 文件行数棘轮门禁

- **`docs/开发规范.md`（新增）**：把五条硬规则落成文件 —— ① 开源合规（MIT 优先；GPL/AGPL/SSPL/Commons Clause/未知许可禁止；
  Apache/BSD 留声明；MPL/LGPL 评审登记）；② 模块化开发（一块一目录、单向依赖、公开出口）；③ 500+ 人商用工程质量
  （鉴权/事务/超时/分页/索引/审计/可观测）；④ **单文件 ≤300 行**（新增硬限制、存量只减不增、拆分方法）；
  ⑤ 故障隔离（子页面崩不连坐父级；前端 ErrorBoundary、后端单卡隔离、失败注入验收）。
- **`docs/第三方依赖许可清单.md`（新增）**：前端 28 个直接依赖全部 MIT/Apache-2.0/ISC；后端灰名单
  `psycopg2-binary`(LGPL with exceptions) / `certifi`(MPL-2.0) / `orjson`(MPL-2.0 AND Apache/MIT) 已登记；
  **中国地图 GeoJSON 来源许可标记为待核**（上线前必须补齐）。新增依赖必须登记。
- **`scripts/check_file_limit.py` + `scripts/file_limit_baseline.json`（新增）**：300 行棘轮检查 ——
  新文件超限直接失败；存量超限文件只允许变小、不允许变大；文件头 `FILE-LIMIT-EXEMPT: 原因` 可豁免
  （生成代码/迁移/种子/纯类型）。当前基线 **82 个存量文件**（含本次拆分后仍偏大的 `DashboardPage` 等），
  后续只减不增。已接入 CI（`python scripts/check_file_limit.py`）。
- **指针**：`AGENTS.md` 顶部与 `README.md` 文档表已加「开发规范」入口；README 的「仓库操作规范」链接同步为
  用户改名后的 `docs/发布github仓库操作规范.md`。
- **验证**：`python scripts/check_file_limit.py` 通过（528 个源文件 / 82 个存量超限）；临时新增 302 行文件会被拦下；
  `tsc` 不受影响（本次只加文档/脚本/CI）。诚实的边界：**存量 82 个文件不在本次强行拆到 300 行以内**，
  按规范「只减不增」逐步收敛。

---
## 2026-11-17 · 检查：前端拆分后的功能回归

- **范围**：登录/看板/数据集/数据源/SQL/模板库/团队/测试数据集/组件库/组件编辑/画布编辑/看板查看/分享查看/项目/审计/MCP
  共 16 条路由 + 管理后台 9 个分区；并做了数据集抽屉（字段/指标/权限/预览、字段/指标弹窗）、看板收藏/导出菜单、
  画布切「明细表」再 `⌘Z` 撤销、属性面板深链选中、组件编辑（内容组件）等交互。
- **结果**：**0 console error / 0 pageerror / 0 个 4xx·5xx 响应**；页面均无错误边界；`tsc` / `build` / `npm test` 58 passed。
- **发现并修复一个既有隐性 bug**：`DashboardPage` 的 `Inspector` 在 `spec.ui` 缺失时读 `spec.ui.accent` 直接崩
  （`?edit=1&select=<旧卡片>` 深链触发；拆分类重构前代码同样如此，不是拆分引入）。
  已改为 `ui = spec?.ui ?? DEFAULT_UI`，`patchUi` 与强调色回显同源，深链选中散点图后属性面板正常渲染、无报错。
- **说明**：`/bi/components/:id/edit` 对数据类组件会重定向到画布（`KIND_ROLE === "data"`，设计如此），
  内容类组件（如结论卡 id=106）编辑页字段完整、可保存。

---
## 2026-11-17 · 重构：剩余板块批量收敛 + 三个千行前端文件拆分

- **后端（9 个板块一次收敛，旧路径全部保留 re-export 垫片）**：
  B05 可观测 → `app/observability/`（sentry / metrics / slowlog / router / errors）；
  B09 血缘 → `semantic/lineage.py`；B10 数据集安全 → `security/dataset/`（rules / scope / masking / access）；
  B14 查询 API → `query/api.py`；B19 模板市场 → `app/templates/`（market / share_links）；
  B22 通知 → `app/notifications/`；B32 RBAC → `app/rbac/`（permissions / seed / models）；
  B34 安全卫士 → `security/guard/`（core / watch）；B37 入口守卫 → `security/nav/`。
- **前端（板块归位 + 千行文件拆分）**：
  B24 应用壳 → `features/shell/`（App / TopBar / BiSideNav / ThemeContext / ProtectedRoute）；
  B27 组件库页 → `features/components/pages/`；B31 MCP 页 → `features/mcp/`；
  B28 看板查看 → `features/viewer/`，`DashboardPage` **1544 → 1129**（LayersPanel / ToolbarButton / HeadingElement / TextElement / Inspector / OverlayHost / utils）；
  `DatasetPanel` **1790 → 307**（`dataset/` 下 12 个模块）；`QueryPanel` **1226 → 942**（queryTypes / queryConstants / TableFieldsEditor / TableThumbSettings / Slot）。
- **顺手修掉两个既有隐性 bug**：`dashboards/router.py` 的 `DashboardDoc` 未导入（字符串注解，暂不触发）；
  `semantic/router.py` 的 `text` 未导入（直连数据集未选部门时会 NameError）——补上 import。
- **测试适配**：`test_metrics.py` / `test_query_governance2.py` / `test_observability.py` 的 import 指向新模块
  （`app.observability.*`），否则 monkeypatch 打不中真实实现。
- **验证**：OpenAPI **253 / 304 零差异**；`pytest` **344 passed**；`pyflakes app` 真实 undefined name **0**；
  重启后 `/api/health` / `/api/auth/me` / `/api/admin/monitor/{summary,activity}` / `/api/admin/models` /
  `/api/metrics` / `/api/bi/semantic/datasets` / `/api/bi/components` / `/api/report` 全部 200，看板 57 渲染 200；
  前端 `tsc` / `build` / `npm test` **58 passed**；工作台 / 看板查看 / 编辑器 / 管理后台 / 组件库 / MCP 六个页面打开正常、
  **0 console error**；截图 `docs/_selfcheck/split-frontend-all.png`。

---
## 2026-11-17 · 重构：B38 AI 引擎收敛到 `app/ai/engine/`

- **改动**：`services/bi_ai_engine.py`、`bi_ai_phase2.py`、`bi_ai_phase3.py`、`bi_ai_agent.py`、
  `ai_models.py`、`ai_quota.py` 六个文件 → `app/ai/engine/`
  （`core` / `phase2` / `phase3` / `agent` / `models` / `quota`）；旧 services 路径全部保留 re-export 垫片。
- **测试适配**：`tests/test_ai_models.py` 的 monkeypatch 目标改为 `app.ai.engine.models`（真实模块），
  并把 `core.py` 内部的 `candidate_configs` 导入切到新路径——否则 monkeypatch 打不中。
- **验证**：OpenAPI **253 / 304 零差异**；`pytest` **344 passed**；`pyflakes` 引擎包 **0 undefined**；
  重启后 `/api/bi/engine/ai/{knowledge,audit,kb/metrics}` 200、`ai/sql/validate` 200（`{"valid":true}`）、
  `/api/admin/models` 200；看板 57 渲染 200；垫片与真实实现同一函数对象
  （`ai_models.candidate_configs is models.candidate_configs`、`bi_ai_engine._call_llm is core._call_llm`）；
  `candidate_configs()` 实跑返回 1 条候选。

---
## 2026-11-17 · 重构：B33 审计收敛到 `app/audit/`

- **改动**：`middleware/audit.py`、`middleware/audit_context.py`、`middleware/audit_user.py`、
  `security/security_events.py`、`admin/monitor.py` 五处 → `app/audit/`
  （`log` / `context` / `user_middleware` / `events` / `monitor`）；旧路径全部保留 re-export 垫片，
  30 处 `log_audit`、5 处 `security_events` 的 import 一行没动。
- **验证**：OpenAPI **253 / 304 零差异**；`pytest` **344 passed**；`pyflakes` audit 包 **0 undefined**；
  重启后 `/api/admin/monitor/{summary,activity,guard}` 全部 200；看板 57 渲染 200；
  `log_audit` 真实写入 `bi_audit_logs`（测试行 3085，验证后已删除），且 `app.middleware.audit.log_audit is app.audit.log.log_audit` 为真（垫片指向同一实现）。

---
## 2026-11-17 · 重构：B03 认证收敛到 `app/auth/` + `features/auth/`

- **后端**：`routers/auth.py`(303) + `services/auth.py`(215) + `middleware/auth.py`(131) → `app/auth/`
  （`router.py` / `service.py` / `deps.py`）。三个旧路径改成**只 re-export 的兼容垫片**，31 处 `get_current_user`
  与 2 处 `hash_password` 的 import 一行没动；`routers/auth.py` 额外转发 `get_current_user`（历史代码从那里取）。
- **前端**：`contexts/AuthContext.tsx`(147) + `hooks/useAuth.ts` → `features/auth/{AuthContext,useAuth}.tsx`；
  10 处 `useAuth` 与 2 处 `AuthContext` 的 import 已切到新路径，旧垫片删除。
- **怎么验证**：
  · `openapi.json` 前后对比 **253 条路径 / 304 operation 0 差异**；`pytest` **344 passed**；`pyflakes` auth 包 **0 undefined**；
  · 重启后端：`/api/health` 200；`/api/auth/me`、`/quick-perms`、`/departments`、`/csrf-token` 全部 200；
    错误密码登录返回 **401**（路由与校验链真实生效）；看板 57 `/render` 200；
  · 前端 `tsc` / `build` / `npm test` **58 passed**；登录页、看板、管理后台打开正常、**0 console error**；
    截图 `docs/_selfcheck/split-auth-b03.png`。
- **回滚**（本次未提交）：`git checkout -- backend/app/routers/auth.py backend/app/services/auth.py backend/app/middleware/auth.py frontend/src/contexts/AuthContext.tsx frontend/src/hooks/useAuth.ts && rm -rf backend/app/auth frontend/src/features/auth`，
  再 `git checkout -- frontend/src/App.tsx ...`（10 处 import 改动的文件）。

---
## 2026-11-17 · 重构：CanvasBoardPage 与 admin/router 拆分（第一刀，行为不变）

- **CanvasBoardPage**：3403 → **2658** 行，抽出 3 个页面级模块（纯搬移，无逻辑改动）：
  `pages/canvas/spec.ts`（315 行：spec 构造 / 文档转换 / 平台分套判定）、
  `pages/canvas/controls.tsx`（137 行：三栏分栏 hook / 收起条 / 分栏手柄 / 对齐图标）、
  `pages/canvas/panels.tsx`（328 行：筛选字段编辑器 / 文字与形状配置面板）。
  页面仍是唯一编排者（状态、快捷键、保存、渲染），后续再按「顶栏 / 三栏 / 弹窗」拆子组件与 hooks。
- **admin/router.py**：1677 行 → `admin/router/` 包（8 个文件）：`common`（数据范围 / 角色部门断言 / 请求模型）、
  `overview`、`users`、`departments`、`registrations`、`roles`、`models`、`ops`；`__init__.py` 组装同一个
  `router`（prefix `/admin`）、按原顺序 include，URL / operationId / 注册顺序不变。
- **顺手修掉一个既有 bug**：`/api/admin/meta` 在 `data_scope=self` 分支里引用了不存在的 `user`（应为 `current_user`），
  这类账号打开用户管理会 500 —— 拆包时被 pyflakes 抓到并修复。
- **怎么验证**：
  · `tsc --noEmit`、`npm run build`、`npm test` **58 passed**；
  · 编辑器 `?doc=57` 打开正常（4 张图表渲染、左中右三栏在、0 console error），截图 `docs/_selfcheck/split-canvas-final.png`；
  · 管理后台 `/bi/admin` 打开正常（概览数字/分区菜单/最近错误），截图 `docs/_selfcheck/split-admin-page.png`；
  · `openapi.json` 拆分前后：**253 条路径 / 304 个 operation 0 差异**；`pytest` **344 passed**；`pyflakes` 两包 **0 undefined**；
  · 重启后端：`/api/health` 200；`/api/admin/{overview,meta,users,departments,registrations,permissions,roles,models,ops}` 全部 200；
    看板 57 `/render` 200。
- **回滚**（本次未提交）：`git checkout -- frontend/src/pages/CanvasBoardPage.tsx backend/app/admin/router.py && rm -rf frontend/src/pages/canvas backend/app/admin/router`。
- **· 迭代（同日，第二刀）**：`CanvasBoardPage` 2658 → **2270**（累计 3403 → 2270，-33%），继续抽出
  `pages/canvas/PageTabs.tsx`(82)、`CanvasDialogs.tsx`(219)、`LeftDatasetPane.tsx`(90)、
  `MiddleConfigPane.tsx`(203)、`ChartRailPane.tsx`(53)、`types.ts`；页面只剩状态 / 快捷键 / 顶栏 / 画布舞台。
  验证：`tsc` / `build` / `npm test` 58 passed；编辑器打开 4 张图表、点卡片中栏出现「横轴」、发布确认弹窗可开可关、
  **0 console error**；截图 `docs/_selfcheck/split-canvas-step2.png`。
- **· 迭代（同日，第三刀）**：`CanvasBoardPage` 2270 → **2005**（累计 3403 → 2005，-41%），抽出
  `pages/canvas/EditorToolbar.tsx`(362)：看板切换 / 新建改名、AI 整理与推荐、6 向对齐与等距、元素与形状按钮、
  溢出区开关、撤销重做、页面页签、预览/保存/发布。页面只剩画布舞台、状态与快捷键。
  验证：`tsc` / `build` / `npm test` 58 passed；编辑器 4 张图表、点卡片中栏正常、「矩形」下拉能开、发布确认能开、
  **0 console error**；截图 `docs/_selfcheck/split-canvas-step3.png`。
- **· 迭代（同日，第四刀 / 完成）**：`CanvasBoardPage` 2005 → **1646**（累计 3403 → 1646，**-52%**），抽出
  `pages/canvas/CanvasStage.tsx`(280：标尺 / 吸附 / 参考线 / 拖拽舞台)、`useCanvasHistory.ts`(136：撤销重做快照栈 +
  拖拽一步 + ⌘Z)、`useCanvasClipboard.ts`(101：复制粘贴 / ⌥拖复制)。页面只剩状态机、页面与保存编排。
  验证：`tsc` / `build` / `npm test` 58 passed；编辑器 4 张图表、点卡片中栏正常、⌘C 复制提示出现、
  撤销按钮初始正确置灰、**0 console error**；截图 `docs/_selfcheck/split-canvas-final2.png`。
- **下一步**：CanvasBoardPage 组件层已拆完（12 个模块）；如需更薄可选抽 pages / persist hooks。之后 B03 认证 → B33 审计 → B38 AI 引擎（见架构说明 §9.4）。

---
## 2026-11-17 · 修复：架构说明补充「板块落地状态」，明确 44 块 ≠ 44 个目录

- **问题**：`docs/BI架构与板块化扩展说明.md` 的 §2.3 写了「一块一目录」，读起来像「已经按 44 块拆完」；
  实际只有 22 块有目录承载（其中 5 个目录是多块共享），16 块仍跨 2 处以上，3 块是单文件，3 块是交付类。
  文件级拆分目前只完成了 `bi_engine` 一处。
- **改法**：新增 §9.4「板块落地状态（审计）」：22 / 3 / 16 / 3 分类 + 16 块待收敛清单（当前落点、规模、收敛方向）
  + 建议顺序；顶部加「44 块是逻辑职责，不是 44 个文件夹」提示；§2.3 第 1 条标为「目标」并引用 §9.4。
- **为什么**：文档必须能当验收依据，不能把「地图」写成「现状」；后续按 §9.4 逐块收敛时直接勾表。
- **涉及文件**：`docs/BI架构与板块化扩展说明.md`、`docs/更新日志.md`。
- **怎么验证**：§9.4 的数字按当前代码目录统计（`find backend/app -maxdepth 1 -type d` = 20 个域目录、
  `frontend/src/features` = 4 个功能域）；16 块列出的文件与行数逐一核对存在；表格列数 / 目录锚点自检通过。
- **· 迭代（同日）**：补充「拆分建议」——**不建议 44 块逐一建目录**，物理模块保持 ~18 个，44 块继续作为治理口径；
  只拆三类：千行级热点文件、跨 3 处以上且无单一归属的板块（B03/B32/B33/B38）、每次改动要同时开 3 个以上文件的链路；
  B01/B02/B14/B22/B37/B42–B44 保持现状。

---
## 2026-11-17 · 重构：bi_engine 单文件拆成 13 个模块（URL / 行为不变）

- **改了什么**：`backend/app/routers/bi_engine.py`（4219 行 / 95 个端点，混装 11 个域）拆成包
  `backend/app/routers/bi_engine/`：`common`（公共件：读库 / 校验 / 缓存 / 刷新线程 / 脱敏 / LLM 委托）、
  `analysis`、`tables`、`templates`、`ops`、`access`、`governance`、`query`、`dashboards`、`imports`、
  `import_clean`、`ai`、`editor`。`__init__.py` 负责组装同一个 `router`（prefix `/bi/engine`）并按原顺序 include，
  `from app.routers import bi_engine; bi_engine.router` 的用法完全不变；`_refresh_once / ACCEL_MAP / FUNC_META / TEMPLATE_MAP`
  仍可从包上导入。原文件在 import 时启动的 5 分钟增量刷新线程与 `_cache.start_auto_refresh(120)` 一并保留。
- **为什么**：4219 行单文件、95 个端点、11 个域混在一起，改一处要先读一大片；按板块化（架构说明 §3/§8）拆开，
  后续只动对应模块，降低误改风险。
- **涉及文件**：`backend/app/routers/bi_engine/`（新增 14 个文件）、删除 `backend/app/routers/bi_engine.py`、
  `docs/BI架构与板块化扩展说明.md`（§1.1 / B38 / §9.1 / §9.3 同步）、`AGENTS.md`（`bi_engine/common.py` 路径）。
- **怎么验证（行为等价）**：
  · `openapi.json` 拆分前后对比：**253 条路径 / 304 个 operation 完全一致**（path、method、operationId、summary、tags、参数 0 差异）；
  · `pytest` **344 passed**；`pyflakes` 拆分包 **0 undefined name**；
  · 重启后端：`/api/health` 200、`/api/readyz` database up；11 个端点冒烟（functions / tables / templates / cache/stats /
    pool / dashboards / monitor / sync/logs / cluster/guide / accelerate/status / masks / ai/kb/metrics）全部 200；
  · 看板 57 `/render` 200（4 张卡、0 报错）；前端局域网 `10.0.20.34:5300` 200；
  · 后台刷新线程已启动（`Thread-1 (_auto_refresh_loop)`）。
- **回滚**：`git checkout -- backend/app/routers/bi_engine.py && rm -rf backend/app/routers/bi_engine`（本次改动未提交）。

---
## 2026-11-17 · 新增：架构与板块化扩展说明（44 个板块地图）

- **改了什么**：新增 `docs/BI架构与板块化扩展说明.md`，把项目按「稳定内核 + 可插拔板块」重新梳理：
  · 架构总览（运行时拓扑 / 五层依赖 / 请求链路 / 7 个后台任务）；
  · 44 个板块地图（平台底座 5 · 数据接入 5 · 查询执行 4 · 展现 9 · 前端 8 · 治理安全 6 · AI 与 Agent 4 · 交付 3），
    每块给职责 / 代码根 / 入口 / 依赖；
  · 板块契约 10 条、依赖铁律 5 条、四层数据契约（语义 → QueryObject → ComponentSpec → DashboardDoc）；
  · 七层安全边界与错误语义、审计留痕点；
  · 新增板块 8 步（模板 + 4 处注册清单 + DoD 验收表）与五类扩展的文件级清单（图表/数据源/治理/前端页/MCP 工具）；
  · 成熟度矩阵、8 个真实缺口、7 个候选板块（含「板块注册表」把 4 处手工注册收敛成 1 处）。
  README 文档区与「技术架构」段加了入口。
- **为什么**：后续功能一律按板块扩展（前端的组件库、后端的权限、安全卫士都各算一块），
  需要一份说清「系统由哪些块组成、块之间怎么连、新块怎么加」的地图，避免改动时靠翻代码猜边界。
- **涉及文件**：`docs/BI架构与板块化扩展说明.md`（新增）、`README.md`、`docs/更新日志.md`。
- **怎么验证**：文中 139 处代码路径逐一核对存在（占位符除外）；数字按当前代码校准
  （253 个 API 路径 / 88 张表 / 61 个迁移 / 23 类组件 / 44 个板块 / 22 个权限码 / 15 类数据源 / 17 个 MCP 工具 /
  `pytest` 344 passed）；§8 五类扩展的落点与 `AGENTS.md` §5、迁移目录、`main.py` 注册逐项对齐。

---
## 2026-11-16 · 重构：项目英文名 MingzeBI → MingceBI（全仓同步）

- **改了什么**：项目英文标识统一改为 `MingceBI` / `mingcebi` / `MINGCEBI`，缩写 `MZBI → MCBI`。中文名「明策BI」不变。
  范围：前端包名 `mingcebi-frontend`、后端日志标签 / 占位邮箱 / SMTP 默认发件人、数据库 `mingzebi_dev → mingcebi_dev`
  （`ALTER DATABASE … RENAME`，数据零改动）、RLS 只读角色 `mzbi_rls → mcbi_rls` 与策略前缀 `mcbi_dept_scope`、
  `application_name=mingcebi-api`、MCP serverInfo、地图注册名、localStorage / 剪贴板标记、环境变量（`MINGCEBI_*`、`MCBI_*`）、
  Helm chart 目录 `deploy/helm/mingcebi`（chart / 模板 / 镜像仓库 / NOTES）、compose 容器与库名、CI 库名、
  README / AGENTS / LICENSE / COPYRIGHT / docs / 回归脚本。历史条目里的旧名一并按名称替换（结论与数字未改）。
- **兼容处理（防丢数据 / 丢设置）**：
  · `services/crypto.py`：新密文带 `v2:` 前缀走新密钥；无前缀的历史密文回退旧密钥解密，历史 Key / 口令仍可读；
  · 主题模式：优先读 `mingcebi_theme_mode`，缺则一次性迁移旧键 `mingzebi_theme_mode`（深色模式不丢）；
  · 系统剪贴板：粘贴同时接受旧标记 `mingzebi:1` 的元素（改名瞬间复制的内容还能粘）；
  · 迁移 `063_rename_rls_objects.sql`：存量库把旧 RLS 角色 / 策略就地改名（幂等，不删策略、不动数据）。
- **为什么**：项目英文名定为 MingceBI，避免目录 / 库 / 部署清单里两个名字并存。
- **涉及文件**：`backend/app/**`（config / database / crypto / rls_backstop / security_events / mcp / notifications / services / routers）、
  `backend/schema/migrations/063_rename_rls_objects.sql`、`backend/.env(.example)`、
  `frontend/src/**`（ThemeContext / CanvasBoardPage / client / MapCard）、`frontend/package.json`、
  `deploy/helm/mingcebi/**`、`docker-compose*.yml`、`.github/workflows/ci.yml`、`scripts/**`、
  `README.md`、`AGENTS.md`、`docs/**`。
- **验证**：库已改名（`psql -l` 只剩 `mingcebi_dev`）并以后端连新库启动，`/api/health` 200、`/api/readyz` database up；
  看板 57 / 58 `/render` 200（4 / 15 张卡，0 报错）；`pg_stat_activity` 里应用连接为 `mingcebi-api`；
  `mcbi_rls` 角色存在、迁移 063 已应用；crypto 新密文往返 + 旧密文回退各验一次；
  `pytest -q` **344 passed**、`npm test` **58 passed**、`npm run typecheck`、`npm run build` 通过；
  `helm lint` 通过，默认 / worker+ingress+hpa 两套 `helm template` 均能渲染。
- **注**：`frontend/storybook-static/`、`frontend/test-results/`、`docs/异常日报/`（均 gitignore）里是旧名时期的历史产物，
  未回改，重新生成即自动更新；远端仓库 GitHub / Gitea 名称未动。

---
## 2026-11-15 · 修复：窄/矮卡片里图表文字压叠、控件溢出

- **现象**（全类型验收页 224×104 一档暴露）：`bar` 的刻度叠成一团、`combo` 双轴刻度互压且柱顶数值串成一行、
  `waterfall` 柱顶数值叠字、`heatmap` 类目名与格内数字连成一片、`gauge` 的「151,880」压在弧线上、
  `funnel` 被压成一条线、`hbar` 一条都画不出来、`filter` 的控件串到卡片外面。
- **根因**（共性，不是单卡写错）：
  · 224×104 的卡去掉内边距和标题后，**图体只剩约 39px**，而各卡的 `grid.top` 固定 26px、刻度数固定 → 标签全挤进 9px；
  · `CardShell` 的右上说明是 `flexShrink: 0`，窄卡上把标题挤成 0 宽、说明自己顶到左边；
  · `FilterCard` / `HbarCard` 没有按可用高度裁内容；`GaugeCard` 数字固定 26px，比圆环内圈还宽。
- **改法**：
  · 新增 `skin/CardFit.tsx`（统一口径：图体高 < 56 → 不画轴/图例/数值标签/色阶条；宽 < 320 → 只做防重叠、
    每格 < 52px 不画数值标签）+ `fitChart(option, box)`；接入 `bar / line / area / scatter / combo / waterfall /
    heatmap / funnel / radar / pie`；
  · 新增 `skin/useBoxSize.ts` 量图体（用 `clientWidth/Height`，缩略图外层有 `transform: scale()`，
    `getBoundingClientRect` 拿到的是缩放值）；
  · `GaugeCard` 图体 < 56px 时退化成一行大数字（不再画看不清的半个圆环）；
    `HbarCard` 按实测高度决定画几条；`FilterCard` 按实测宽高决定放几个控件并裁掉溢出；
  · `CardShell` 宽度 < 300 时不再显示右上说明，把位置让给标题。
- **丝滑度**：尺寸测量走 `ResizeObserver`，`setState` 前先比较宽高（没变就不重渲染），
  避免 23 张卡各自抖动；`fitChart` 是纯函数，宽松尺寸**原样返回**，大卡观感零改动。
- **涉及文件**：`skin/CardFit.tsx`、`skin/useBoxSize.ts`、`skin/CardShell.tsx`、
  `renderers/{Bar,Line,Scatter,Combo,Waterfall,Heatmap,Funnel,Radar,Pie,Gauge,Hbar,Filter}Card.tsx`、
  `__tests__/cardFit.test.ts`、`docs/组件开发规范.md`（补 5.1 收敛口径）、
  `.github/PULL_REQUEST_TEMPLATE.md`（补组件四尺寸验收区块）。
- **验证**：`tsc --noEmit` 通过；`npm test` **58 passed**（新增 6 条 `cardFit` 单测：宽松原样返回 /
  矮卡全收敛 / 窄卡保留类目只防重叠 / 每格太挤不画数值 / 纯函数不改原对象）；`npm run build-storybook` 通过；
  逐屏截图 `docs/_selfcheck/fixture-tightest-224.png`、`fixture-compact.png` —— 23 张卡在 224×104 与 compact
  下无压叠、无溢出，`bar/combo/line/area/scatter/waterfall` 退化为干净迷你图，`gauge` 大数字，`funnel` 正常分层，
  `hbar` 画满 1 条（compact 下 4 条）。
- **注**：CI 的 `Build Storybook` 门禁本来就已存在（`.github/workflows/ci.yml` 第 55 行），未新增。

---

## 2026-11-15 · 新增：组件开发外发所需的「规范 + 数据契约 + 真实 fixture」

- **需求**：项目要交给外部/新招的开发接手，组件库希望按模块分包出去（前端渲染器给他做，
  后端组件口径留在自己手里），同时要能本地自测、验完再合回来，不能一上来给整包后端源码。
- **改动**：
  · `docs/组件开发规范.md` —— 可直接发给开发的外发规范：A/B/C 三类任务边界（哪些能接、
    哪些必须回来找后端）、目录与注册方式、`RendererProps` 契约、设计令牌、**四档尺寸验收
    （224×104 必测）**、五种边界、`compact` 模式、`onSliceClick` 联动、7 条禁止事项、
    开发流程、自检清单、PR 四栏模板、交付清单。
  · `docs/组件数据契约.md` —— **代替后端源码**：逐 kind 说明 `payload` 真实结构
    （series 族 / kpi / gauge / table / heatmap / combo / rank_list / scatter / wordcloud /
    funnel / map + section/insight/banner/nav/filter），带真实样例和 8 条易错点
    （`value` 是格式化字符串 vs `raw_value` 是数值、日期列不是数值列、`total` 不是 series 求和、
    `width:0` 是自适应等）。
  · `scripts/capture_component_fixtures.py` —— 走组件库卡片墙同一条接口
    `POST /api/bi/components/preview-batch` 抓真实 payload，写成
    `frontend/src/features/components/renderers/__fixtures__/<kind>.json` + `index.ts` + `_meta.json`；
    自动清理已消失的 kind；失败按 kind 报告。**数据来自脱敏的测试数据集 `bi_demo_sku`，
    不含真实经营数据，可随前端包一起外发。**
  · `FixtureDemo.stories.tsx`（Storybook「组件验收/全类型」）—— 用真实 fixture 把每种 kind
    按四档验收尺寸并排摆开，另有两个视图：`224×104 最挤尺寸总览`（最常塌的场景）、
    `compact 缩略图模式`。
- **为什么走接口而不是直接调函数**：`preview-batch` 是卡片墙在用的同一条链路，
  单张失败不影响其它、且会自动给未绑数据集的模板挂上测试数据集，抓出来的数据与画布完全一致。
- **涉及文件**：`docs/组件开发规范.md`、`docs/组件数据契约.md`、
  `scripts/capture_component_fixtures.py`、
  `frontend/src/features/components/renderers/FixtureDemo.stories.tsx`、
  `frontend/src/features/components/renderers/__fixtures__/`（23 个 kind，140KB）。
- **验证**：23/23 kind 抓到 fixture，无失败；`kpi.json` 实数 `raw_value=151880 / value="151,880"`、
  `bar.json` 真实分档 `≥80元 59691 / 20-40元 33595 / 40-60元 22699`（来自 `bi_demo_sku`）；
  `tsc --noEmit` 通过；`npm run build-storybook` 通过（`FixtureDemo.stories` 产物 50KB）。
- **用法**：给开发的人只需 `cd frontend && pnpm install && npm run storybook`（:6006），
  不需要 Python / 数据库 / 后端；重新抓 fixture 用
  `backend/.venv/bin/python scripts/capture_component_fixtures.py`。

---

## 2026-11-15 · 修复：预览页点指标卡徽标报「明细表至少需要一个字段」

- **现象**：预览（`/bi/dashboards/58?p_platform=天猫`）点「TOP10」→ 弹窗标题退回「TOP 榜单」、0 条，
  报「明细表至少需要一个字段（点「+ 添加字段」）」。
- **原因**：那张卡保存下来的 `spec.top.dim` 是**空串**（早期候选没加载时打开过开关，只落了开关和指标）。
  弹窗按空维度拼表格 → 没有维度、只剩一个指标，表格校验直接拒绝。
- **改法**（后端 `/top-list`）：
  · 维度为空时依次兜底：`top.dim` → 卡片自己的 `binding.dimension` → **本页明细表的第一列**
    （优先「…标题 / …名称」这类文本列，排行通常按商品走）；
  · 全都拿不到才报明确的 400「弹窗没有配置排名维度：面板里选一个」；
  · 前端 `KpiCard`：`payload.top.enabled` 时才画右上角的「›」——不能点的徽标不该有可点的暗示。
- **验证**：真实看板 666（主视图 + 天猫套共 6 张指标卡）预览页点徽标 → 弹窗「日销量 TOP10 /
  `MAX(日销量) · 10 条 · 同分 16 条按名称排序`」，10 行、列沿用明细表、链接列可点开二维码
  （截图 `docs/_selfcheck/kpi-top-preview-fixed.png`）；其余 5 张没配弹窗的徽标不再显示「›」且点击无动作；
  `pytest` 344 passed、`npm test` 52 passed、`tsc` 通过。

---

## 2026-11-15 · 新增：明细表「查看更多」弹窗里点行也能弹行详情

- **需求**：明细表开了「点击行弹出」后，卡片本体点行会弹画板；但点「查看更多」打开的全量弹窗里，
  行点击没有反应（用户要求这里也支持）。
- **改法**（`TableCard.tsx`）：把「点行 → 按画板弹详情」抽成 `openRowDetail(row)`，卡片本体与「查看更多」弹窗共用；
  弹窗里点行会**先关掉弹窗**再弹详情（否则详情被压在下面），行上给 `cursor: pointer`。
  编辑器里走右侧内联面板，成品页走右侧抽屉，与卡片本体行为完全一致。
- **涉及文件**：`frontend/src/features/components/renderers/TableCard.tsx`。
- **怎么验证**（临时看板 454，已删除：画板里放一张指标卡 + 明细表开启行弹出 + 查看更多）：
  · 编辑器：点「查看更多」→ 弹窗 180 行 → 点第 2 行 → 弹窗关闭、右侧打开行详情面板；
  · 成品页：同样操作 → 抽屉打开，标题就是该行 `产品id = 634916920054`，画板里的指标卡显示该行 日销量 200
    （截图 `docs/_selfcheck/table-more-row-detail.png`）；
  · 没开「点击行弹出」的表格：弹窗行点击不动作（保持原样）；
  · `tsc` 通过、`npm test` 52 passed。
- **· 迭代（同日，用户要求「查看更多」别关、行详情叠在它上面右上角）**：
  上一版点行会先把「查看更多」关掉（不然抽屉被压在弹窗下面）。用户要边看边点下一条，改成：
  · 成品页：「查看更多」**保持打开**，行详情抽屉层级抬到 1500、悬浮在右侧，再点下一条直接换内容；
  · 抽屉的 Modal 根节点设 `pointer-events: none`（纸面自己恢复可点）+ `hideBackdrop`，所以底下的行还能继续点，
    不会被半透明遮罩挡住；
  · 编辑器里行详情是画布内的内联面板（在弹窗下面），仍然先把弹窗关掉再打开。
  · 验证：真实数据连续点第 2、3 行，弹窗始终在、抽屉标题由 `634916920054` 换成 `1012508376391`
    （截图 `docs/_selfcheck/table-more-row-detail-stack.png`）；`tsc` 通过、`npm test` 52 passed。

---

## 2026-11-15 · 修复：TOP 弹窗「条数对不上」—— 并列改成可配（默认严格前 N）

- **现象**：配置「前 10」，弹窗里却是 **16 行**（并列全展示），用户认为条数对不上。
- **改法**：`TopListSpec` 新增 `ties`：
  · `strict`（**新默认**）：严格返回前 N 条，同分按维度名升序，弹窗头部写「10 条 · 同分 16 条按名称排序」；
  · `all`：并列全部展示，头部写「前 10 并列共 16」。
  面板「徽标弹窗」里加了「并列」下拉（严格前 N 条 / 并列全部展示），口径行也会带上说明。
- **验证**（临时看板 452 / 453，已删除）：同一份数据 `strict` 返回 10 行、`all` 返回 16 行；
  真机弹窗分别显示 10 / 16 行，头部文案与设置一致（截图 `docs/_selfcheck/kpi-top-strict.png`、`kpi-top-all-ties.png`）；
  `pytest` 344 passed、`npm test` 52 passed、`tsc` 通过。

---

## 2026-11-15 · 优化：指标卡 TOP 弹窗改成沿用本页「明细表」的列（没有明细表才用默认列）

- **需求**：TOP 弹窗原来只有「产品标题 / 日销量 / 附列」，和页面上的明细表长得不一样；
  用户要它**照这一页的明细表来**（列顺序、列名、类型、缩略图、序号列），页面上没有明细表时才退回弹窗自己的配置。
- **后端**（`/bi/dashboards/{id}/top-list`）：
  · 先在本页找明细表（按 `component` 解析 kind，画布上它是 `type=chart + base.table`，不能只看 type；
    优先取和这张指标卡同一个数据集的）；
  · 找到就照它的 `binding.dimensions` 顺序 + `table_view`（列定义 / 缩略图 / 序号列）重建弹窗列，
    多出来的属性列统一按 `MAX()` 取（不能塞进 GROUP BY，否则一个产品在多条榜单里会被拆行）；
  · 缩略图列同样按 `MAX()` 取，且 `table_view.thumb` 在内部关掉（否则 resolver 会把它当原始列再拼一次，GROUP BY 冲突）；
  · 返回 `source: "table" | "default"`、`thumb / thumb_key / index_column`，前端据此决定要不要画缩略图列与序号列。
- **顺带**：`semantic/compiler.py` 里「标识字段只能计数」放宽为 **计数 / MIN / MAX**
  （排行里要带出 `产品id`、`sku_id` 这类值，`MAX` 是「取其中一个」，SUM/AVG 仍然拒绝）。
- **前端**：弹窗支持缩略图列（复用 `TableCard` 导出的 `Thumb` + `thumbSourcesOf`，图片规则与明细表一致）、
  序号列可关、列宽按明细表配置给 `minWidth`；表头/数值仍然右对齐 + tabular-nums。
- **涉及文件**：`backend/app/dashboards/router.py`、`backend/app/semantic/compiler.py`、
  `frontend/src/features/components/renderers/TableCard.tsx`（导出缩略图工具）、
  `frontend/src/features/components/board/TopListDialog.tsx`。
- **验证**（临时看板 450，已删除；页面放一张带缩略图的「链接ID」明细表 + 一张日销量指标卡）：
  · 接口 `source=table`、`thumb=true / thumb_key=主图_id`，列顺序与明细表一致
    （产品id / 上架时间 / 产品标题 / 平台 / 种类 / 榜单 / 日销量 / 热销指数 / 霸榜天数 / 差评数 / 链接）；
  · 真机弹窗与明细表观感一致、16 条并列全展示（截图 `docs/_selfcheck/kpi-top-uses-table.png`）；
  · 页面上没有明细表时 `source=default`，退回「维度 + 指标 + 附列」；
  · `pytest` 344 passed、`npm test` 52 passed、`tsc` 通过。
- **· 迭代（同日，用户反馈「链接的字段没有一样显示」）**：弹窗里的 `链接` 列原来只是把整串 URL 铺出来，
  而明细表里它是「打开 ⌗」胶囊（点了转二维码）。
  · 现在弹窗对 `http(s)://…` 的单元格渲染同一套胶囊 + 同一个 `QrCodeDialog`（点开是「用手机扫一扫，打开链接 …」）；
  · 弹窗宽度从 `lg` 放宽到 `xl`：像「链接ID」这种 11 列 + 缩略图的明细表，1920 屏下能一屏排完，
    不用再横向拖才能看到 `链接`；窄屏仍是横向滚动。
  · 验证：真机 16 行都出现「打开」胶囊（16 个），点第一行 → 二维码弹窗显示该商品链接；
    截图 `docs/_selfcheck/kpi-top-link-column.png`；`tsc` 通过、`npm test` 52 passed。

---

## 2026-11-15 · 修复：TOP10 和第 N 名并列时只给 10 条（漏掉的 6 条取决于排序）

- **疑问**：用户拿「测试-01」原始数据核对 TOP10，怀疑对不上。
- **核对**：`select title from bi_demo_sku where sales_lower=(select max(sales_lower) from bi_demo_sku)`
  共 **16 条**并列 2000；接口只返回 10 条 —— 漏哪 6 条完全由排序规则决定，用户自然对不上账。
  （顺带发现展开并列的实现写错了：用负值比较，导致把 180 条全返回；已修。）
- **改法**：第 N 名若并列，**把并列的全部一起给**（上限 200 条防极端），标题行如实写
  `SUM(日销量) · 前 10 并列共 16`；排序仍是「指标降序 + 维度名升序」，同一份数据结果稳定。
- **验证**（临时看板 449，已删除）：
  · 接口 `requested=10 / count=16 / tied=16`，16 条标题与数据库「并列最大值」那 16 条**集合完全一致**；
  · 真机弹窗 16 行、头部显示「前 10 并列共 16」（截图 `docs/_selfcheck/kpi-top-with-ties.png`）；
  · `pytest` 344 passed、`npm test` 52 passed、`tsc` 通过。

---

## 2026-11-15 · 优化：TOP10 面板把「排行公式」写出来（前 N 条 + 聚合默认 SUM）

- **疑问**：面板里只有「聚合 SUM/AVG/MIN/MAX/COUNT」，用户问「取前十该选哪个、有没有排序公式」。
- **口径**：排序不是靠聚合实现的 —— 弹窗固定按所选指标**从大到小取前 N**；聚合只决定「每一行算哪个数」。
  「日销量前十」→ 聚合选 **SUM（合计）**；MAX/AVG 只在「一个产品多行」时才和 SUM 不同；
  COUNT 是数行数，不是销量，别选。
- **改法**：面板「条数」改为「前 N 条」，下面补一行口径说明「SUM(日销量) 从大到小 · 前 10」；
  新开「徽标弹窗」时聚合默认取 **SUM**（以前会继承卡片的 COUNT/MAX，拿来排名看不懂）。
- **核实**：测试-01 里每个产品只有 1 行，所以 SUM/MAX/AVG 结果相同；TOP10 全是 2,000 是该数据集
  `日销量` 上限就是 2000、且 16 个 SKU 并列所致，不是算错。
- **验证**：面板实机截图 `docs/_selfcheck/kpi-top-ranking-formula.png`；`npm test` 52 passed、`tsc` 通过。

---

## 2026-11-15 · 优化：TOP10 弹窗补「口径 + 并列」说明，并列顺序稳定

- **疑问**：用户看到 TOP10 十行全是 `2,000`，怀疑数据是不是假的。
- **核实**：数据是真的 —— 演示 CSV 里 `日销量` 上限就是 2000，**有 16 个 SKU 并列 2000**，所以前 10 名看起来一样；
  排序本身没错（SQL `ORDER BY SUM(日销量) DESC`）。
- **顺手修两处**（都与「能不能一眼看懂」有关）：
  1. **并列顺序不稳定**：只按指标排序时，同分那批由数据库给顺序，每次打开可能换一批人。
     现在接口取全量后在服务端补一次「指标降序 + 维度名升序」，同一份数据每次看到的 10 条完全一致；
  2. **看不出是并列**：弹窗副标题改为显示口径与并列数 —— `SUM(日销量) · 10 条 · 并列 16`；
     卡片上的 `180` 是 `COUNT(日销量)`（行数），和弹窗的 SUM 本来就是两套口径，现在一眼能对上。
- **验证**（临时看板 448，已删除）：
  · 无筛选：10 行、`并列 16`、按名称稳定排序；页面筛选「种类=猫咪零食」→ 10 行全是猫咪零食；
    「种类=狗狗零食」→ 10 行全是狗狗零食（页面筛选确实作用到弹窗）；
  · 真机截图 `docs/_selfcheck/kpi-top-meta.png`；`pytest` 344 passed、`npm test` 52 passed、`tsc` 通过。

---

## 2026-11-15 · 新增：指标卡右上角徽标可点开「独立 TOP N 榜单」

- **需求**：指标卡原来只是一块静态数字，右上角「TOP10 ›」纯装饰。现在这个徽标可以点，
  点开是一个**独立的 TOP N 明细弹窗** —— 它按卡片里单独配的「维度 + 指标 + 聚合」自己算一遍
  （例如卡片显示 `COUNT(日销量)=180`，弹窗里按 `SUM(日销量)` 排出前 10 个产品），
  与卡片上那个数字互不影响，也不改页面任何状态。
- **后端**：
  · `ComponentSpec.top`（`TopListSpec`：enabled / title / dim / metric / agg / top_n / columns / page_size，带范围与去重校验）；
  · KPI 渲染结果下发 `payload.top`，前端据此决定徽标能否点；
  · 新接口 `POST /bi/dashboards/{id}/top-list`：读文档里这张卡的配置 → 用页面筛选（与卡片同口径）现算一次
    排行明细。附加列统一按 `MAX()` 取属性（不能塞进 GROUP BY，否则一个产品在多条榜单里会被拆成多行）。
  只读、不落库、不动参数。
- **前端**：
  · `KpiCard` 徽标：`top.enabled` 时变成可点（hover 变紫、active 微缩、`stopPropagation` 不触发整卡跳转）；
  · 新组件 `TopListDialog`：标题 + 条数 + 表头浅蓝底 / 数值右对齐 / 序号列 / 行悬停，加载与失败都有明确状态；
  · 编辑器画布与成品页都能点（编辑器会把「未保存的现场版面」一起带上，改完面板立刻可验证）；
  · 面板（外观区）新增「徽标弹窗」：开关 + 标题 + 排名维度 + 指标 + 聚合 + 条数 + 附列（多选）；
    打开开关时自动带默认值（维度优先「…标题」列、指标取卡片指标、条数从徽标 `TOP10` 里读）。
  · 组件库「指标卡」模板默认带上 `TOP10` 弹窗配置（同步了 `seed_base` 与库里的行）。
- **· 迭代（同日，用户反馈「徽标弹窗里排名维度/指标点开没有可选值」）**：两处。
  1. **面板没拿到字段候选**：`StylePanel` 新增的三个候选参数只接到了「导航卡 / 头标卡」两个入口，
     指标卡走的是最后那个通用入口（漏接）→ 排名维度/指标/附列三个下拉全是空的。
     已在通用入口补上 `metricOptions / dimensionOptions / identifierOptions`。
  2. **早期打开的弹窗配置缺省**：开关在「候选还没加载完」时打开过，`dim/metric` 会留空 → 一点就报「没有配置指标」。
     现在面板打开时若已启用但缺维度/指标，自动补默认值（维度优先「…标题」列、指标取卡片指标、聚合沿用卡片聚合）。
  · 验证：真机（666 · 天猫·榜单概况 的指标卡）排名维度 20 项、指标 6 项、附列 19 项（自动排除已选维度）；
    自动补齐后「排名维度 = 产品标题」，点 TOP10 正常弹出 10 行明细（截图 `docs/_selfcheck/kpi-top-options-fixed.png`）。
- **涉及文件**：`backend/app/components/{spec,resolver,seed_base}.py`、`backend/app/dashboards/router.py`、
  `backend/tests/test_component_seed.py`、`frontend/src/features/components/{types.ts,registry.tsx}`、
  `renderers/KpiCard.tsx`、`board/{TopListDialog,BoardCard,BoardSurface}.tsx`、
  `editor/{StylePanel,QueryPanel}.tsx`、`pages/{CanvasBoardPage,DashboardPage}.tsx`。
- **怎么验证**（临时看板 447，已删除）：
  · `render` 返回 `payload.top`（enabled/top_n/columns 齐全），徽标可点；
  · `top-list` 返回 `日销量 TOP10`、10 行，列 = 产品标题 / 日销量 / 上架时间 / 品牌 / 榜单 / 价格带 / 差评数，
    按日销量倒序；
  · 真机（编辑器 + 成品页各点一次）：弹窗正常打开、10 行、无控制台报错（截图 `docs/_selfcheck/kpi-top-dialog.png`）；
  · `pytest backend/tests` **344 passed**、`npm test` 52 passed、`tsc` 通过。

---

## 2026-11-15 · 修复：指标卡的右上装饰圆不随卡片缩小（还把 TOP10 徽标盖住了）

- **现象**：指标卡拉到很小时（224 / 160 / 120 宽），右上角那团浅色半圆还是固定 92px，
  相对卡片显得又大又突兀，且因为画在内容之上，把「TOP10 ›」徽标的左半边盖住了。
- **改法**（`KpiCard.tsx`）：装饰圆改成 `width: min(92px, 45%)` + `aspect-ratio: 1`，
  偏移改用自身尺寸的百分比 `translate(28%, -33%)` —— 大卡保持 92px 原样，小卡按比例缩小；
  同时给它 `z-index: 0`、内容层 `z-index: 1`，装饰永远在徽标和数字下面。
- **涉及文件**：`frontend/src/features/components/renderers/KpiCard.tsx`。
- **怎么验证**（临时看板 446，已删除；同一批卡片四种尺寸 224×104 / 160×80 / 320×160 / 120×60）：
  · 224 宽：圆 92px、徽标完整（与改前一致）；
  · 160 宽：圆 72px；120 宽：圆 54px —— 不再压住徽标（截图 `docs/_selfcheck/kpi-small-adaptive-circle.png`）；
  · 320 宽：仍是 92px，不会跟着放大；
  · `tsc` 通过、`npm test` 52 passed。

---


## 2026-11-15 · 修复：组件库全面体检 —— 种子脚本静默失效 / 假数字 / 换数据集就报错

**体检方法**：把 23 个模板逐条**真渲染**（`preview-batch` 同一条链路），核对每个字段是否真的在数据集里、
每种 kind 的数据形状（rows/series/items/value/matrix）、再把模板搬到另一张数据集（榜单端-天猫，`日销量` 是文本列）重跑一遍。

**查出来 4 个真问题（都已修）**：

1. 🚨 **种子模块 import 就崩，被静默吞掉**：`seed_base` 里 `_spec("词云")["chart"]` 直接 `KeyError`，
   `bootstrap.ensure_components()` 又用 `except: print("跳过")` 兜着 → **组件库种子从来没跑过**，
   库里永远是旧版本，改模板永远不生效（这才是「看着有、其实没接上」的根源）。
   改：修掉 KeyError；`ensure_components` 失败时打全栈 + 写进「错误日志」，不再静默；
   新增 `backend/tests/test_component_seed.py`（11 条：能被 import / 每个模板过校验 / code 不重复 / 时间模板保持时序 …）。
2. **头标卡的 36 / 14 / 6 是写死的字符串**：换任何数据集都显示这三个假数字。
   改：绑到真实列按当前筛选聚合 —— 在榜 SKU = `COUNT(产品id)`、竞品品牌 = `COUNT_DISTINCT(品牌)`、覆盖种类 = `COUNT_DISTINCT(种类)`。
   实测（测试-01）：180 / 14 / 6，与数据一致。
3. **结论卡只有一句占位文案**（«这条结论可以引用 {指标} 占位符»，且没绑指标）。
   改：绑 `日销量 SUM` + `热销指数 AVG`，两句文案用真占位符 → 实测「当前筛选下累计日销量 151,880 / 热销指数平均 6,526」，
   且随页面筛选实时变。
4. **时间粒度换月后横轴显示 ISO 串**（`2026-05-01T00:00:00+08:00`）：
   后端把时间维度原样丢给前端。改：`resolver._format_time_dimension()` 按粒度格式化（月 → `2026-05`、日 → `2026-05-04`、
   小时 → `… 13:00`、季度 → `2026-Q2`）；折线 / 面积模板默认粒度给到 `month`，缩略图不再是 180 个点挤成一片锯齿。

**顺带修的「换数据集就红字」**：模板带着 `SUM(日销量)` 拖到 `日销量` 是文本列的数据集上，16/23 张会报
「字段是文本列，SUM 用不了」。现在落卡片时按目标数据集的字段角色判断：**文本/标识列上的 SUM/AVG/MIN/MAX 自动退化成 COUNT**
（数值列与数据集指标不动）。用「榜单端-天猫」实测：18 张数据卡 0 报错。

- **涉及文件**：`backend/app/components/{seed_base,resolver}.py`、`backend/app/bootstrap.py`、
  `backend/tests/test_component_seed.py`（新增）、`frontend/src/pages/CanvasBoardPage.tsx`（`pruneSpecFields` 类型退化）。
- **验证**：`preview-batch` 23 张全部有图（0 errors）；组件库页面真机截图 `docs/_selfcheck/component-library-audit.png`；
  看板「666」主视图 15 卡 / 页面2 6 卡渲染 0 报错（时间格式改动未影响历史看板）；
  `pytest backend/tests` **341 passed**、`npm test` 52 passed、`tsc` 通过。

---


## 2026-11-15 · 新增：筛选栏「逐级筛选」——下游下拉只列当前条件下有数据的值

- **口径**：筛选栏原来是「各字段独立取全量候选 + 条件 AND 叠加」；现在按**面板里的字段顺序当层级**，
  下游字段的候选值用**上游条件**真的查一遍（`SELECT DISTINCT 列 WHERE 上游条件`），
  上游一变，下游只留「确实有数据」的值；原来选中的值若已不存在，自动退回「全部」。
- **后端**：卡片渲染结果里带上 `dataset_id`（平台分套切表后是目标表）——
  前端要按「这页卡片真正读的表」去取候选值，不能拿 spec 里那个（切换前的）。
- **前端**：`FilterBar` 新增 `datasets?: number[]`；逐级取数走 `/bi/semantic/datasets/{id}/query`
  （带上游 filters，权限 / RLS / 列脱敏照旧生效），多数据集结果合并去重、按值排序、上限 200；
  250ms 防抖 + 60s 结果缓存（键含数据集/列/上游条件），失败自动退回配置里的静态选项。
  每页数据集由各页从「卡片 payload 的 dataset_id」汇总传给筛选栏（画布经 BoardSurface → BoardCard 透传）。
- **顺带修**：下拉在「没选值」时原来回落显示第一个选项（看着像选中了、其实没过滤）→ 现在显示「全部」。
- **涉及文件**：`backend/app/components/resolver.py`、`frontend/src/features/components/renderers/FilterBar.tsx`、
  `frontend/src/features/components/board/{BoardCard,BoardSurface}.tsx`、
  `frontend/src/pages/{CanvasBoardPage,DashboardPage}.tsx`。
- **怎么验证**（临时看板 444，已删除）：
  · 筛选栏依次为 平台 / 种类 / 榜单（数据集 测试-01）：初始「榜单」32 个选项（31 + 全部）；
    选「种类 = 猫咪零食」后变成 **18 个**（后端同口径实测 31 → 17）；
  · 再选「榜单 = 冻干猫零食畅销榜」，把种类改成「狗狗零食」→ 榜单自动回到「全部」，表格 40 行（狗狗零食全量），
    不会出现「榜单还挂在猫的榜上、结果 0 行」；
  · 另外两页（666 页面2 / 成品页）筛选栏标签恢复真实：没选值就是「全部」，不再假装选着第一个选项；
  · `pytest` 330 passed、`npm test` 52 passed、`tsc` 通过。
- **代价**：每次筛选变更会多 1~N 条轻量 distinct 查询（按字段数 × 本页数据集数，去抖 + 60s 缓存兜底）；
  大表上若 distinct 慢，可把 `fetchCandidates` 的 `limit` 调小或改成后端一次性返回。
- **· 迭代（同日，用户发现「平台下拉里多出一个『拼多多』」）**：第一版把**本页所有卡片的数据集**都查了一遍再合并，
  而不同数据集的同名列口径并不一样（`测试-01.平台` 是 平台A/B/C，榜单端表里是 拼多多/天猫），
  合并后下拉就会冒出本表根本没有的值。改为**只按「本页主数据集」取候选值** —— 卡片最多的那张排在第一位
  （画布 `filterDataIds` / 成品页 `pageDatasets` 都按卡片数降序），`FilterBar` 只用第一个；
  某个字段在主数据集里没有这一列时查询失败 → 退回配置里的静态选项，不会串词表。
  · 验证（真机，看板 666 主视图）：平台下拉恢复为 `全部 / 平台A / 平台B / 平台C`（不再有 拼多多）；
    逐级收窄照常：种类选「乌龟食品」后价格带 5 → 4 项（`60-80元` 消失）；`tsc` 通过。

---


## 2026-11-15 · 修复：筛选栏选了值卡片不动（筛选字段被「空壳」顶掉 / 筛选栏被当成卡片）

- **现象**：筛选栏上「平台 = 平台A、品牌 = 品牌A、日期 = 2026-11-13」都选着值，明细表却还是全量 180 条、日期也不过滤；
  界面上没有任何报错，看不出哪里没生效。
- **根因（两条，都实测复现）**：
  1. **同 id 的筛选字段被空壳顶掉**：`collect_param_defs` 把当前页所有筛选栏的字段按 id 合并，后者直接覆盖前者。
     页面上只要多出一条筛选栏（旧栏没删 / 复制文档留下的副本 / 分套里的旧副本），它那条**没绑字段**（`column` 空）
     就会把已经配好的过滤条件整页顶掉 —— 表现为「选了值，SQL 里却连 WHERE 都没有」。
  2. **筛选栏 type 不是 filter 时整条不算数**：后端只认 `item.type == "filter"`，而历史文档 / 从组件库拖进来的
     筛选栏可能存成 `type=chart, component=base.filter`（前端 `isFilterBarItem` 早就按同一口径兜底了，后端漏了）
     → 参数一个都不进入渲染，卡片自然纹丝不动。
- **改法**：
  1. 新增 `merge_param_def()`：同 id 合并时**绑了列的那条优先**，空壳不能覆盖（后者绑了列仍然后者覆盖，保持原语义）；
  2. 新增 `is_filter_item()`：`type=filter` / `component=base.filter` / `component=*.filter` 都算筛选栏；
     `collect_param_defs` 用它收集字段，`render_dashboard` 也不再把这种筛选栏当普通卡片渲染；
  3. 前端筛选字段卡：没绑字段（`column` 空）时头标加一枚「未绑定」标记（悬停说明「选了什么都不会过滤卡片」），
     不用点开卡片就能看出哪一项是空的；搜索框（走关键词）不算；
  4. `+ 添加` 的字段 id 改成 `nextFieldId()` 生成，不会因为「删一个再加一个」而撞 id（撞了会互相覆盖参数）。
- **涉及文件**：`backend/app/dashboards/render.py`、`backend/tests/test_cross_filters.py`（新增 2 条合并优先级回归）、
  `frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **怎么验证**（真实数据，看板 id 442 临时复现 → 已软删）：
  · 造两条筛选栏（后一条 `column` 空）+ `平台=平台A & 日期=2026-11-13`：修复前 SQL 无 WHERE、10 行全量；
    修复后 SQL 带 `WHERE platform = … AND listed_at BETWEEN …`、0 行（13 号本来没数据）；
  · 筛选栏存成 `type=chart + base.filter`：修复前参数不生效，修复后同样带 WHERE，且不再多渲染一张空卡；
  · 看板「666」页面2（平台/上架时间/搜索）：6 张卡 SQL 全部带 `WHERE platform = … AND listed_at BETWEEN …`，未回归；
  · `pytest backend/tests` **330 passed**、`tsc` 通过；面板标记截图见 `docs/_selfcheck/filter-unbound-tag.png`。
- **· 迭代（同日，用户反馈「都是同一个数据集，时间筛选还是没反应」）**：根因是那个「时间」字段
  **压根没绑字段**（面板头标显示「未绑定」），筛选栏却照样给了一个看起来能用的日期控件 —— 选了值自然什么都不发生。
  从「加字段」这条路上把它堵掉：
  1. **「+ 添加」改成挑字段**：点开直接列当前数据集的字段（时间 / 维度 / 指标 / 标识 分组，已绑的置灰打勾），
     点一下就加进来**且已绑定**（时间字段自动用「日期」控件、候选值顺手拉好）；
  2. **控件改成「日期」时自动挂时间列**：字段还没绑、数据集又只有一个时间列（如「上架时间」）→ 直接绑上；
  3. **老配置自愈**：打开面板时，已经是「日期」但没绑字段的，也按上面规则自动补绑定；
  4. **筛选栏不再摆死控件**：没绑字段的项（搜索框、平台入口除外）不在筛选栏渲染 ——
     宁可少一个控件，也不给人一个「选了没反应」的假控件。
  · 验证：临时看板（已删除）里把「时间」控件从「下拉」改成「日期」→ 自动显示「已绑定：上架时间」，
    筛选栏出现日期控件，选 13 号后 `params.f_t = 2026-11-13`、明细表 0 行；
    「+ 添加」里点「品牌」→ 立即「已绑定：品牌」且筛选栏出现可用的品牌下拉（截图 `docs/_selfcheck/filter-add-field-menu.png`）；
    `tsc` 通过、`npm test` 52 passed。


---

## 2026-11-15 · 优化：词云「词少时字自适应变大」（≤6 个词按行铺满，不再缩成一撮小字）

- **现象**：弹窗里那张差评云只有 2 个词（`分量不足` / `颗粒碎未多`），却缩在卡片正中小小两只，
  四周大片空白；有的卡还只露出一个词。
- **根因（两条）**：
  1. 字号只按「首尾值的差距」映射（`ratio=(v-min)/(max-min)` 再取 sqrt）。两三个词值相等时 ratio 恒为 0，
     全部落到 `minSize`（12px 档），所以看着像 8 号字；
  2. 词少时仍走「中心向外螺旋」，第一个词占住正中，第二个词只能挤上方那一小条，挤不下就被丢掉 —— 于是出现「只显示一个词」。
- **改法**（`WordCloudCard.tsx`）：
  1. **≤6 个词改「居中按行铺」**（`rowsPack`）：一行放不下就换行、整体垂直居中，并整体逐级缩小直到全部放得下
     —— 每个词都在、且尽量大；极端窄卡再兜底放最大的那个词，绝不留整片空白。
  2. **词少时字号按面积均分**：`sparse`（≤2 个词 = 1，≥12 个词 = 0）参与字号上限与下限，
     `avg = sqrt(可用宽 × 可用高 × 0.55 / (1.2 × 总字数))`，2 个词能撑到卡片一半高。
  3. **权重完全相同（COUNT 计数、两词同值）**：词少时按「头名」统一画，不再一律掉到最小号。
  4. 词多的卡（≥12 个）路径与字号公式完全不动，视觉与原来一致。
- **涉及文件**：`frontend/src/features/components/renderers/WordCloudCard.tsx`。
- **怎么验证**（真机实测，看板「666」→ 明细表点行弹出）：
  · 同一张差评云：修复前 `分量不足 12.x px / 颗粒碎末多 12.x px`（且 446×128 那张只排出一个词）；
    修复后两张词等大 `29.8 px`、宽卡 `45.6 px` 并排一行，四周留白随之收掉（截图
    `docs/_selfcheck/wordcloud-sparse-after.png`）；
  · 主视图 30 词的长词云字号与修复前一致（最大 28px、尾部 12.7px），没有连带变化；
  · `npx tsc --noEmit` 通过、`npm test` 52 passed。

---

## 2026-11-15 · 修复：明细表「弹窗画板」认不到画板 —— 打开「点击行弹出」点行没反应

- **现象**：明细表面板「弹窗 → 弹窗画板」是空的（看起来没识别到页面上那块画板）；成品页点表格行没有任何反应。
- **根因**：
  1. 画板的候选标签只取画板元素自己的名字（默认都叫「画板」），跨页时看不出是哪一块；`board_key` 为空时
     下拉也不给占位文案，整格看起来就是「什么都没有」。
  2. 更关键：`TableCard` 点行时先按 `detail.board_key` 找画板，找不到就 `return` —— **静默什么都不做**。
     「点击行弹出」开着、画板没选的状态因此完全无反馈；开关本身也不会顺手补上画板（行标识列会补）。
- **改法**：
  1. `TableDetailSettings`：打开「点击行弹出」时自动挂上第一块画板（与自动补行标识列同一套路）；
     面板打开时若已开启但画板为空，也自动补上并写回 spec；
  2. `CanvasBoardPage.boardOptions`：标签带页面名 —— `弹窗 · 画板`，多页多块画板能分辨（同 key 去重不变）；
  3. `TableCard` 兜底：没选画板时，当前页**只有一块**画板就直接用它（多块不猜，交给面板选），
     避免「点了行毫无反应」。
  4. 数据修复：`666` 天猫明细表 `table_view.detail.board_key`（原为空）补成画板 `bd_mwhsdx6661`，
     改前 doc 备份到 `/tmp/canvas58-doc-backup-20261115-201448.json`。
- **涉及文件**：`frontend/src/features/components/editor/TableDetailSettings.tsx`、
  `frontend/src/pages/CanvasBoardPage.tsx`、`frontend/src/features/components/renderers/TableCard.tsx`。
- **怎么验证**：
  · 编辑器：另一张明细表（`c_mwdakfsn86`，原本没开弹窗）打开「点击行弹出」→ 下拉立刻显示 `弹窗 · 画板`（截图
    `docs/_selfcheck/table-detail-board-panel.png`）；
  · 成品页 `/bi/dashboards/58`：点「链接ID」明细表第 1 行 → 右侧弹窗按画板内容铺出 4 张指标卡 + 词云 + 柱状图，
    标题是当前行的 `60875984002`，组件按 `产品id` 过滤（截图 `docs/_selfcheck/table-detail-popup-board-after.png`）；
  · `npx tsc --noEmit` 通过。

---

## 2026-11-15 · 修复：明细表拖进字段不显示 —— 缩略图残留字段把整张表打成「未知字段」

- **现象**：看板「666」主视图（天猫）的明细表拖字段进去，面板里字段加上了、卡片却只有一句
  `天猫：未知字段：主图ID（数据集 测试-01）`；面板「缩略图 → 图片字段」下拉也是空的，看不出问题在哪。
- **根因（两条，都实测复现）**：
  1. **缩略图字段残留**：这张明细表的 `table_view.thumb_key` 还是直连表（数据集 27）的 `主图ID`，
     卡片已换到「测试-01」（数据集 20，字段叫 `主图_id`）。`resolver._request_for` 把缩略图列无脑塞进
     `columns` 去取图，`compile_query` 找不到这一列就抛错 → 整张卡只剩一条报错（字段本身是对的，
     错的是这个「挂载用」的旧列）。
  2. **直连查询结果缓存被删了一半**：`live.py` 上一次性能改动把 `_cache_key / _cache / clear_cache` 删了，
     但 `run_live` 里还在调用它们 → 所有直连数据集（拼多多那套卡）报 `name '_cache_key' is not defined`，
     整页多出 3 张死卡。
- **改法**：
  1. `resolver`：新增 `_prune_aux_refs()`，取数前按**当前数据集**把「辅助列」引用清空 —— 缩略图字段 /
     图表轴 / 排行取值列 / 表格列配置；缺了就降级（少一列 / 轴回落），**用户显式绑定的维度/指标仍照旧
     报「未知字段」**（那是有意提示，不能静默吞掉）。`resolve()` 与渲染共用这一处，平台分套切表也覆盖。
  2. `live.py`：按 AGENTS 口径补回直连结果缓存（键含 `dataset_id`，60s / 200 条），与新的「连不上短缓存」
     并存；`clear_cache` 一并恢复。
  3. 前端 `TableThumbSettings`：面板打开时，若 `thumb_key` 已不在当前数据集的图片字段候选里，自动清空
     并写回 spec（缩略图保持开启、只是暂时没有图列）；下拉值也按「有效才显示」兜底，不再出现空下拉。
- **涉及文件**：`backend/app/components/resolver.py`、`backend/app/query/live.py`、
  `backend/tests/test_aux_refs.py`（新增 5 条纯函数回归）、`frontend/src/features/components/editor/QueryPanel.tsx`。
- **怎么验证**：
  · 接口：`POST /bi/dashboards/58/render`（platform=天猫）**16 卡 0 报错**；明细表 `11 列 / 10 行 / thumb=主图_id`；
    修复前同一请求是 `未知字段：主图ID` + 3 张 `_cache_key` 死卡。
  · 进程内：`resolve()` 传入 `thumb_key=主图ID` + 数据集 20 → 正常返回 10 行（缩略图列被静默摘掉）；
    换成 `主图_id` → SQL 里照旧带 `main_image_id`，表头不多一列。
  · 真机（Playwright + 真实账号）：从左侧字段栏**拖**「品牌」进明细表 → 卡片立刻多一列并有数据；
    面板里把图片字段重选成 `主图_id` 后，行首缩略图正常出图（截图 `docs/_selfcheck/detail-table-thumb-field-after.png`、
    `dashboard-666-detail-table-after.png`）。
  · `pytest backend/tests` **327 passed**；`npm test` 52 passed；`bash scripts/ui_rules.sh` tsc 通过。

---

## 2026-11-15 · 修复：直连数据源不可达时整页渲染被前端 15s 掐断，看起来像「绑定数据集没效果」

- **现象**：看板「666」主视图切了数据集（测试-01）后，卡片全是「暂无数据」，面板里口径显示「0 行」，
  像绑定没生效。
- **根因（实测链路，不是猜）**：
  1. 主视图是平台分套页，13 张卡绑在 3 个**直连**数据集（`直连-榜单端-天猫` 等）→ 源库 `192.168.31.10:5432`
     跨网段不可达（`nc` 75s 无响应）；
  2. `app/query/live.py::source_tables` 里 `inspect(eng)` 在**构造 Inspector 时就连库**，而它在 try 之外，
     裸抛 8s 超时、也不进任何缓存 → 每张卡各等一遍，整页 render 从 32s 起（实测 curl 32.0s）；
  3. 前端 axios 默认 `timeout: 15000`，render 调用没覆盖 → 15.6s 时 `net::ERR_ABORTED` 掐断请求，
     `catch` 里 `setCards({})` 把卡片全清空 → 满屏「暂无数据」，且**没有任何报错提示**。
- **绑定本身是好的**：实测切换数据集确实写进了卡片（`binding.dataset_id: 20`），单卡用 测试-01 + 热销指数
  查得 `SELECT MAX("heat_score") FROM bi_demo_sku` = **8751**。问题全在渲染链路。
- **改法**：
  1. `live.py`：`inspect(eng)` 包进 try；新增「连不上短缓存」`BI_LIVE_FAIL_TTL`（默认 60s）——
     同一数据源失败后 60s 内直接失败，不再让每张卡各等 8s；连上即清除；
  2. 失败文案压成一句人话：`数据源连接失败：192.168.31.10:5432（超时）`（区分超时 / 拒绝 / 库不存在 / 认证失败）；
     `resolver._execute_dataset` 不再重复叠一层数据集名；
  3. 前端：编辑画布与成品页的 render 超时 15s → **120s**；渲染失败**不再清空卡片**，改为弹提示保留上次结果；
  4. 卡片报错最多显示两行、超出省略（`title` 看全文），不让长报错把卡片撑花。
- **涉及文件**：`backend/app/query/live.py`、`backend/app/components/resolver.py`、
  `frontend/src/pages/CanvasBoardPage.tsx`、`frontend/src/pages/DashboardPage.tsx`、
  `frontend/src/features/components/board/BoardCard.tsx`。
- **怎么验证**：主视图 render **32.0s → 8.0s**（14 张死卡各自给出「数据源连接失败…」）；
  同看板「页面2」（全 测试-01）**33ms、7 卡 0 报错、有数 151,880**；
  `backend/.venv/bin/python -m pytest tests` **319 passed**；`tsc --noEmit` 通过；
  截图 `docs/_selfcheck/dashboard-666-main-after-fix.png` / `dashboard-666-page2-after-fix.png`。
- **仍待她拍板**：主视图那 13 张卡还指着不可达的库 —— 要么把 `192.168.31.10` 的库恢复，
  要么把这批卡重新绑到本地测试数据集（改内容属于她的看板，等确认再动）。

---

## 2026-11-15 · 新增：数据源列表加连通性状态点（绿 / 红 / 灰，点一下重测）

- **改了什么**：数据源名称后面加一个 8px 圆点，与「数据集」页直连数据集的连通性圆点同一套视觉——
  绿 = 连得上、红 = 连不上、灰 = 正在检测；悬停显示失败原因与检测时刻，**点一下立即重测**，
  其余时候走 30 秒缓存（进页面不会每次都把源库连一遍）。
- **后端**：新增 `GET /api/bi/sources/status`（`refresh=1` 强制重探），只读探测、最多 4 路并发、进程内 30 秒缓存；
  新建 / 编辑 / 删除数据源、以及行内「测连通」都会同步这条缓存 —— 编辑对话框里测的「临时配置」不写缓存，
  避免改错端口测一次就把已存数据源标红。
- **顺带**：驱动报错统一压成一句话（去掉 SQLAlchemy 的 `(Background on this error at: …)` 尾巴、
  `(psycopg2.OperationalError)` 前缀与驱动的缩进换行），圆点 tooltip 和「测连通」提示都不再是一堆英文噪音。
- **涉及文件**：`backend/app/sources/router.py`（status 端点 + 缓存同步）、
  `backend/app/sources/repository.py`（`clean_probe_error`，`test_source` 复用它）、
  `frontend/src/features/bi-dashboard/DataSources.tsx`（圆点 / tooltip / 保存与测连通后刷新）、
  `backend/tests/test_source_urls.py`（3 条 `clean_probe_error` 单测）。
- **怎么验证**：
  · `pytest backend/tests/test_source_urls.py` 20 passed；`bash scripts/ui_rules.sh` 的 tsc 通过；
  · 真机（Playwright + 真实账号）：4 个真实数据源圆点全绿；临时坏端口数据源圆点红，
    悬停显示「连接失败 / connection to server at "127.0.0.1", port 5999 failed: Connection refused … / 19:53:13 检测 · 点击重测」；
    点圆点重测后圆点数量与状态不变、页面不报错；
  · 接口层：手动「测连通」一次后立刻 `GET /status`（0.02s 返回，证明走了缓存）且 `checked_at` 就是这次测试的时刻，
    失败原因已是一句话；带 body 的临时配置测完不污染缓存；
  · 截图 `docs/_selfcheck/数据源-状态点.png`、`docs/_selfcheck/数据源-状态点提示.png`；
    验证用的临时数据源（坏端口那个）已删除，`bi_source` 仍为原 4 条。

## 2026-11-15 · 新增：数据源支持编辑（改主机 / 端口后直接重连，不用删了重建）

- **改了什么**：
  1. 数据源列表操作列加「编辑」（铅笔图标，位置在「测连通」与「删除」之间）；点开预填名称、类型（只读）、
     主机、端口、数据库、用户名、归属部门，保存即写库并刷新列表；
  2. 密码字段在编辑态叫「新密码」——**留空 = 保持原密码**，改主机时不用重新输密码；
  3. 连接串数据源（地址列显示 URI）编辑态只给「新连接串」，右侧「改用主机连接」把连接串显式清空、切回主机 + 端口模式；
     只改名不会把连接串写空（旧 `update_source` 在 payload 缺 `uri` 时按空串覆盖，会把 URI 清掉，一并修掉）；
  4. 编辑弹窗里的「测试连接」按「已存配置 + 本次修改」测（`POST /bi/sources/{id}/test` 支持 body），
     先验证再保存，且**不落库**；
  5. 后端补校验：空名 / 重名拒绝（原先空名能写进库），返回带 `dept_name`；`dept_id` 只有真的换部门才校验数据范围
     （原样提交不会被自己看不到的旧部门挡住）；
  6. 顺带修掉冷启动直链丢视图：`/bi?view=datasource` 在 `/auth/me` 还没回来时被判成「无权限」，
     会把 `view` 参数抹掉、落到「我的看板」（刷新也回不去）；现在等权限到位再判定。
- **为什么**：数据库那边换了主机 IP 时，只能删掉数据源再重建 —— 已接入表、直连数据集、归属部门全部连带重配。
  编辑一下地址就能续用原来的数据源（引擎池按「id + 连接串指纹」自动换池，直连数据集 / 已接入表下次取数即走新地址）。
- **行为说明**：已接入表里已有的数据仍来自旧地址，需要时点该表的「重新同步」重拉（编辑数据源不会偷偷覆盖历史数据）。
- **涉及文件**：`backend/app/sources/repository.py`（`apply_source_overrides`、`update_source`）、
  `backend/app/sources/router.py`（PATCH 部门校验 + 测连通接受 overrides）、
  `backend/tests/test_source_urls.py`（3 条合并逻辑单测）、
  `frontend/src/features/bi-dashboard/DataSources.tsx`（`CreateSourceDialog` → 复用的 `SourceFormDialog`、编辑入口）、
  `frontend/src/pages/BiDashboardPage.tsx`（权限未就绪时不裁 URL）、`scripts/source_edit_check.py`（新增回归）。
- **怎么验证**：
  · `scripts/source_edit_check.py` **34/34**（真实接口 + 真源库）：错端口连不上 → 改端口后测连通成功、读到源库表清单；
    带 body 测未保存地址报错且库里端口不变；空名 / 重名 400；部门可改可清回全局；只改名保住 URI、显式清空才切主机模式；
    列表与审计都不含密码 / 连接串原文；
  · `backend/.venv/bin/python -m pytest backend/tests/test_source_urls.py` 17 passed；`bash scripts/ui_rules.sh` 的 tsc 通过；
  · 逐屏截图 `docs/_selfcheck/数据源-编辑入口.png` / `数据源-编辑弹窗.png` / `数据源-编辑测连通失败.png` /
    `数据源-编辑连接串.png` / `数据源-编辑改用主机.png` / `数据源-编辑保存.png`；
  · 真机（Playwright，真实账号）把临时数据源改端口 5999 测连通报 `连接失败…port 5999`（弹窗不关、不落库），
    改回 5432 + 改名保存后列表立刻显示新名称与 toast「已更新「…」」；
  · 直链冷启动连开 3 次都稳定落在「数据源」且 `?view=datasource` 不被抹掉（未鉴权时仍回落到「我的看板」）；
  · 验证用的临时数据源 / 部门 / 审计行已清场（`bi_source` 仍为原 4 条）。

---

## 2026-11-15 · 优化：去掉界面上多余的草稿提示（项目页标签 + 画布提示条）

- **改了什么**：
  1. 项目页卡片左上角的「草稿 / 草稿 · Agent 生成」标签去掉，卡片只留缩略图、名称与悬浮的更多操作；
  2. 画布编辑器顶部那条琥珀色草稿提示条整条移除（含「当前是草稿，发布后会出现在「我的看板」」文案、
     重复的「发布」按钮，以及其中的「用 AI 整理版面」——它与编辑功能栏的「AI 整理」是同一接口的重复入口）；
  3. 提示条里的「AI 推荐组件」**没有随条删除**，迁到编辑功能栏，紧跟「AI 整理」右侧：
     同样的紫色胶囊样式、同样的 11.5px/26px 规格，点击后按当前数据集字段推荐并整排插入页面底部
     （一次插入 = 一个撤销步，带「推荐中」进行态）。
- **为什么**：用户两次要求「项目这里不需要显示草稿的标签」「这里也不需要显示」——未发布状态属于编辑器内部语义，
  常驻的琥珀条只是噪音；画布右上角本来就有「发布我的看板」主按钮，重复的「发布」也一起收掉。
  保留「推荐组件」入口是为了不把 A4（按字段推荐组件）做成无入口的死功能。
- **影响面**：`我的看板` 只拉 `published_only=1`（本来不会有草稿）；发布二次确认弹窗保留
  （Agent 生成的看板仍会说明来源，发布依旧只能用户自己点）；`/bi/ai/layout`、`/bi/ai/recommend` 两个接口
  都仍有真实入口。
- **涉及文件**：`frontend/src/pages/ProjectsPage.tsx`（去标签与孤立的 `agent_generated` 字段）、
  `frontend/src/pages/CanvasBoardPage.tsx`（去提示条与重复的 `tidyDraftLayout`；新增编辑功能栏「推荐组件」胶囊，
  `aiDraftBusy` 收敛为布尔 `recommendBusy`）。
- **怎么验证**：`npx tsc --noEmit` 通过；截图 `docs/_selfcheck/projects-no-draft-badge.png`、
  `docs/_selfcheck/canvas-no-draft-bar-top.png` / `canvas-no-draft-bar.png`（提示条位置不再留白，画布紧接功能栏）；
  真机点「推荐组件」→ `/api/bi/ai/recommend` **200**、toast「已插入 4 个推荐组件」、画布真实出现
  3 张等分卡 + 1 张整宽明细表，且未保存到看板（`未保存` 状态，无数据污染）；断言页面已无「当前是草稿」文案。

---

## 2026-11-15 · 优化：导出功能改为角色权限开关（R16）

- **背景**：导出能力此前只有后端权限码与审计，管理后台的权限页虽然能看到「明细导出 / 汇总导出」，
  但和 AI / MCP 权限混在一起，不够直观；管理员想临时关闭某个角色的导出，需要在一堆权限里找。
- **改法**：
  1. 角色权限页新增独立的「数据导出」分组，把「明细导出 / 汇总导出」提到显眼位置；
  2. 勾选 = 打开导出，取消 = 关闭导出；提供「全部开启 / 全部关闭」快捷按钮；
  3. 关闭后：前端看不到导出按钮（看板页导出菜单、数据预览页 Excel、导航卡 CSV），
     直接调用导出接口返回 403；管理员角色始终可用；
  4. 权限保存后由后端实时重算（`role_permission`），其他账号刷新页面或切回标签页自动刷新（60 秒节流）；
  5. 导出开关变更写 `admin.role.update` 审计，可追溯谁在什么时候改了哪个角色。
- **涉及文件**：`frontend/src/features/admin/RolesPanel.tsx`、
  `scripts/export_permission_check.py`（新增回归）。
- **验证**：`export_permission_check.py` **15/15**（真实角色 / 真实账号：关 → 403、开 → 200、
  只开明细 → 汇总仍 403、全部关闭 → 恢复 403、管理员不受影响、审计落库）；
  截图 `docs/_selfcheck/export-permission-toggle-20261115.png`；`tsc --noEmit` 通过。

---

## 2026-11-15 · 新增：水印身份化 / Prompt 注入防护 / Agent 死循环 / 卫士 v2 / MCP 生产化 / 敏感字段 / AI 配额（R3–R14）

- **背景**：方案 v1 中 R3–R14 仍是缺口：水印只显示日期、AI 与 MCP 无注入防护、Agent 可空转、
  卫士只有单指标阈值、MCP 入参不校验 / 无幂等 / 无配额、敏感字段靠人工配置、AI 无成本上限。
- **改法**：
  1. **R3 水印身份化**：新增 `app/security/watermark.py`，水印文本 = 用户名 · 部门 · 时间 · 请求号；
     页面 Canvas（`WatermarkOverlay`）覆盖看板与数据预览页；整页导出 HTML / PDF / PNG 注入同一份
     平铺 SVG 水印；Excel 概览写导出人 / 部门 / 请求号并设置打印页眉；明细导出首行写身份说明。
     请求号取后端 `X-Request-Id`（`request.state.request_id`），审计与文件可互相回溯。
  2. **R1 收尾**：前端按权限隐藏导出入口与菜单项（xlsx 要明细权限、pdf/png/html 要汇总权限）；
     导航卡 CSV 导出无明细权限时直接提示并拒绝。
  3. **R5 Prompt 注入**：新增 `app/security/prompt_guard.py`，分 attack / suspicious 两级；
     AI 提示词（`_call_llm` 统一入口）与 MCP 工具参数命中攻击规则直接 400 并写安全事件，
     疑似只告警；MCP 工具返回内容二次清洗，防止数据夹带指令回流模型。
  4. **R6 死循环**：新增 `app/mcp/loop_guard.py`，单会话步数上限、同工具同参数重复、连续相同结果
     三种中断；`task_id` 批量任务豁免；真实 MCP 链路命中返回 429 / `-32010`。
  5. **R4 卫士 v2**：新增组合规则（陌生指纹 + 非工作时段 + 明细导出 → 默认告警、可配置阻断；
     伪造令牌 + 反复越权探测 → 直接阻断）；白名单分级（IP / 网段 / 角色 / 临时任务，只豁免频率风控）；
     正常高频查询 / 导出只写 `business_high_frequency` 告警，绝不封禁；管理员账号组合规则只告警不封禁。
  6. **R7–R11 MCP 生产化**：按 `inputSchema` 做 JSON Schema 子集校验；写工具 `idempotency_key` 幂等；
     终止型失败自动回收本会话未发布草稿；客户端 QPS / 用户每日调用配额 + 失败率熔断；
     目录删除 6 个未实现工具，`limit` 统一上限 5000。
  7. **R12 令牌治理**：`scopes` 真正限制可用工具；授权记录设备名 / 最近 IP / UA；每人活跃授权上限 5；
     `DELETE /mcp/grants/mine` 一键撤销、管理员可撤销指定用户；访问令牌默认 30 分钟；服务账号与个人授权分离。
  8. **R13 敏感字段**：新增 `app/security/sensitive_fields.py`，薪资 / 成本 / 手机 / 身份证 / 邮箱 /
     地址 / 密码字段新建数据集时默认脱敏（导出 / AI / MCP 共用同一套规则），手工关闭写审计。
  9. **R14 AI 配额**：新增 `app/services/ai_quota.py` + `bi_ai_usage`，每用户每日调用次数 / token 预算，
     超限 429 并写 `ai.quota.blocked` 审计与安全事件。
- **涉及文件**：`backend/app/security/watermark.py`、`backend/app/security/prompt_guard.py`、
  `backend/app/security/sensitive_fields.py`、`backend/app/mcp/loop_guard.py`、`backend/app/mcp/validate.py`、
  `backend/app/mcp/limits.py`、`backend/app/mcp/orchestration.py`、`backend/app/services/ai_quota.py`、
  `backend/app/security/guard.py`、`backend/app/security/security_events.py`、
  `backend/app/middleware/security_watch.py`、`backend/app/middleware/logging.py`、
  `backend/app/mcp/auth.py`、`backend/app/mcp/gateway.py`、`backend/app/mcp/router.py`、
  `backend/app/mcp/tools.py`、`backend/app/reports/generate.py`、`backend/app/reports/router.py`、
  `backend/app/routers/bi_engine.py`、`backend/app/semantic/router.py`、`backend/app/semantic/router_items.py`、
  `frontend/src/components/WatermarkOverlay.tsx`、`frontend/src/hooks/useWatermarkText.ts`（新增）、
  `frontend/src/api/client.ts`、`frontend/src/pages/DashboardPage.tsx`、`frontend/src/pages/BiViewPage.tsx`、
  迁移 `054_mcp_governance.sql`、`055_mcp_production.sql`、`056_ai_quota.sql`，
  回归脚本 `watermark_check.py`、`prompt_injection_check.py`、`agent_loop_check.py`、
  `security_guard_v2_check.py`、`mcp_token_check.py`、`mcp_production_check.py`、
  `sensitive_field_check.py`、`ai_quota_check.py`。
- **验证**：水印 **23/23**、Prompt 注入 **16/16**、Agent 死循环 **10/10**、卫士 v2 **14/14**、
  令牌治理 **15/15**、MCP 生产化 **14/14**、敏感字段 **11/11**、AI 配额 **4/4**；
  全场景攻击模拟 **52/52（0 缺口）**；既有回归：MCP 网关 **15/15**、MCP 写工具 **34/34**、
  安全卫士 **10/10**、开关 **9/9**、操作监控 **32/32**、部门隔离 **12/12**、RLS **16/16**、
  外发通道 **7/7**、权限矩阵 **207/207**、数据归属 **15/15**；`pytest` **316**；`tsc --noEmit` 通过；
  页面水印截图 `docs/_selfcheck/watermark-20261115.png`。

---

## 2026-11-15 · 新增：外发通道管控（R2，报表 / 告警）

- **背景**：定时报表与告警允许任意邮箱、任意 Webhook，只校验看板可读；
  等于绕过导出管控定时把数据发到外部邮箱，同时存在 SSRF（可填内网 / 云元数据地址）。
- **改法**：
  1. 新增 `app/security/outbound.py`：邮件与 Webhook 统一校验，按「管理员 / 普通用户」分级；
  2. 普通用户邮件只能发**自己邮箱域名**或 `BI_OUTBOUND_EMAIL_DOMAINS` 白名单；
     外部收件人仅管理员可配；
  3. 普通用户 Webhook / 钉钉 / 企微只能发 `BI_OUTBOUND_WEBHOOK_HOSTS` 白名单；
     管理员可配外部地址，但仍受 SSRF 限制；
  4. SSRF：发送前解析域名，拒绝回环 / 内网 / 链路本地 / 广播 / 元数据地址；
     确有内网 Webhook 的，显式加入 `BI_OUTBOUND_ALLOW_PRIVATE_HOSTS`；
  5. 发送不跟随重定向（防 302 跳内网）；
  6. 报表订阅、告警规则的外发配置写审计（`report.subscription.outbound` / `alert.rule.outbound`），
     目标脱敏（邮箱只留域名、Webhook 去掉 query）；操作监控标为敏感动作。
- **涉及文件**：`backend/app/security/outbound.py`（新增）、`backend/app/notifications.py`、
  `backend/app/reports/router.py`、`backend/app/alerts/router.py`、`backend/app/admin/monitor.py`、
  `backend/tests/test_outbound.py`（新增）、`scripts/outbound_channel_check.py`（新增回归）、
  `docker-compose.yml`（外发白名单环境变量）。
- **验证**：`outbound_channel_check.py` **7/7 通过**（成员外部邮箱 403、本公司邮箱 200、
  外部 Webhook 403、管理员外部邮箱 200、元数据/回环地址 400、审计落库）；
  `pytest` **316**、操作监控 **32/32**、安全卫士 **10/10**、开关 **9/9**、MCP 网关 **15/15**。

---

## 2026-11-15 · 修复：指纹包含 IP 导致换 IP 绕过封禁（D6）

- **背景**：全场景模拟发现指纹 = `sha256(IP + UA + 设备号 + 语言)`，攻击者换 IP 后指纹同时变化，
  IP 与指纹两个封禁维度一起失效，只剩账号维度。
- **改法**：
  1. 指纹升级 v2：有设备号时 = `sha256(设备号 + UA + 语言)`，**不再混入 IP**；
  2. 没有设备号（curl / 脚本 / MCP 客户端）时仍混入 IP，避免所有同类客户端撞成同一指纹造成误杀；
  3. 外部数据库会话采样（`db_external_session`）同样按 v2 口径生成；
  4. 历史封禁按原指纹保留到期，不做数据迁移。
- **涉及文件**：`backend/app/security/security_events.py`、
  `backend/tests/test_security_fingerprint.py`（新增 3 项单测）、
  `scripts/security_attack_simulation.py`（D6 改为必须拦截）。
- **验证**：模拟脚本 **52/52 通过，0 个已知缺口**（同设备换 IP 仍被指纹拦截）；
  `pytest` **304**、操作监控 **32/32**、安全卫士 **10/10**、安全卫士开关 **9/9**、MCP 网关 **15/15**。

---

## 2026-11-14 · 修复：伪造 X-Forwarded-For 绕过安全卫士白名单（F2）

- **背景**：全场景模拟发现安全卫士直接取 XFF 第一个地址作为客户端 IP；攻击者自带
  `X-Forwarded-For: 127.0.0.1` 就能命中白名单，完全不计数、不封禁。
- **改法**：
  1. 新增 `BI_TRUSTED_PROXIES`（IP / CIDR，逗号分隔），默认只信任 `127.0.0.1,::1`；
  2. 解析顺序改为「只有直连对端是可信代理才采信 XFF」：从右往左跳过可信代理，
     第一个不可信地址才是真实客户端；非可信来源直接忽略 XFF；
  3. nginx 反代改为**覆盖** `X-Forwarded-For`（`$remote_addr`），不再追加客户端自带的头；
  4. compose 固定子网 `172.28.0.0/16` 并加入默认可信代理，避免升级后所有用户显示成 nginx IP。
- **涉及文件**：`backend/app/middleware/security_watch.py`、`frontend/nginx.conf`、
  `docker-compose.yml`、`scripts/security_attack_simulation.py`（F2/F2b/F2c/F2d）。
- **验证**：模拟脚本 **51/51 通过**（非可信来源忽略 XFF、可信代理解析最右真实 IP、
  伪造前置 `127.0.0.1` 无法绕过、按真实 IP 计数与封禁）；`pytest` **301**、
  操作监控 **32/32**、安全卫士 **10/10**、MCP 网关 **15/15**。

---

## 2026-11-14 · 修复：导出鉴权（H1，模拟实测发现）

- **背景**：全场景模拟发现 `bi:data:export:summary/detail` 只是权限表里的空码，
  `GET /api/bi/engine/export/{table}` 与 `POST /api/bi/reports/export/{id}` 只校验登录/看板可读，
  普通成员可以直接导出明细 Excel。
- **改法**：
  1. 表格导出 `GET /api/bi/engine/export/{table}` 挂 `bi:data:export:detail`，无权限 403；
  2. 整页导出按格式分开授权：`xlsx` → `bi:data:export:detail`，`html/pdf/png` → `bi:data:export:summary`；
  3. 两处导出都写审计：`data.export.detail` / `data.export.summary`（含表/看板、行数、格式、IP/指纹）；
  4. 操作监控补充动作标签，并把 `data.export` 纳入敏感动作；
  5. 前端整页导出失败时提示「没有导出权限，请联系管理员开通」，不再误报「没有查看权限」。
- **涉及文件**：`backend/app/routers/bi_engine.py`、`backend/app/reports/router.py`、
  `backend/app/admin/monitor.py`、`frontend/src/pages/DashboardPage.tsx`、
  `scripts/security_attack_simulation.py`（H1 系列改为鉴权断言）。
- **验证**：模拟脚本 **47/47 通过**（成员明细导出 403、管理员导出 200、导出审计落库、无 id 列的表可导出）；
  真实看板整页导出：管理员 xlsx/html 200，普通成员 403；`pytest` **301**、
  操作监控 **32/32**、MCP 网关 **15/15**、MCP 写工具 **34/34**；`tsc` 干净。
- **迭代（H2）**：导出不再固定 `ORDER BY id`；按 `column_types` 判断，有 `id` 才排序，
  无 `id` 的表（如 `bi_demo_sku`）正常导出，不再 500。
- **仍保留**：客户端 CSV 导出（导航卡 / 明细表卡）走普通查询接口，暂未受导出权限约束，
  与报表订阅外发一起在 R2 处理。

---

## 2026-11-14 · 修复：查询契约 SQL 注入（C4，模拟实测发现）

- **背景**：全场景攻防模拟发现，普通成员可通过 `POST /api/bi/query/run` 的
  `metrics[].expression` 注入子查询（实测 `(SELECT 42)` 返回 42），同类问题还存在于
  `subquery`、`query_builder` 的 `agg/order_by/limit/joins.on`，以及指标公式落库接口。
- **改法**：
  1. `routers/bi_query.py::_parse`：HTTP 入口拒绝用户自带 `subquery` 与 `metrics[].expression`；
     自定义 SQL 片段只允许语义层在服务端按数据集配置生成；
  2. `query_builder` 全面结构化校验：聚合只允许 `SUM/AVG/MIN/MAX/COUNT/COUNT_DISTINCT`，
     `limit` 必须是 1~5000 的整数，`order_by` 只接受「列名 + ASC/DESC」，
     JOIN 类型白名单，`ON` 只接受 `标识符 = 标识符 [AND ...]`；
  3. `POST /metrics` 落库前、`/metrics/execute/{id}` 执行前统一走
     `validate_metric_expression`（禁止子查询/写操作/危险函数）；执行接口补登录校验；
  4. 不改变正常链路：语义层编译、MCP 查询、看板渲染仍使用服务端生成的表达式。
- **涉及文件**：`backend/app/routers/bi_query.py`、`backend/app/routers/bi_engine.py`、
  `scripts/security_attack_simulation.py`（新增 C4b–C4h 注入用例）。
- **验证**：`security_attack_simulation.py` **43/43 通过**（C4 系列全部从 GAP 变为 PASS）；
  `pytest` **301**、MCP 网关 **15/15**、MCP 写工具 **34/34**、部门隔离 **12/12**、
  操作监控 **32/32**；正常 `query_builder`、指标创建/执行实测 200。

---

## 2026-11-14 · 新增：安全卫士管理员开关（后台可启停，立即生效）

- **背景**：安全卫士原先只能通过环境变量 `BI_GUARD_ENABLED` 启停，改完要重启进程；演练、排障、灰度时不够灵活。
- **改法**：
  1. 新增运行时配置表 `bi_app_setting`（迁移 `053_security_guard_switch.sql`），键 `security.guard.enabled`；
  2. 开关优先级：**数据库设置 > 环境变量 > 默认开启**；5 秒进程内缓存，切换后立即失效缓存并清空封禁判定缓存；
  3. 管理接口 `PUT /api/admin/monitor/guard/config`（`bi:audit:view`，`{enabled: bool}`），
     非法类型 400；启停写审计 `security.guard.toggle`；
  4. 「操作监控 → 安全卫士」卡片右上角新增「启用」开关；关闭时弹二次确认，说明已有封禁会暂停、重新开启后恢复；
  5. 关闭只停止「计数 + 拦截」，安全事件、审计、监控流水照常记录；已有封禁记录保留不删除。
- **涉及文件**：`backend/schema/migrations/053_security_guard_switch.sql`、`backend/app/security/guard.py`、
  `backend/app/admin/monitor.py`、`frontend/src/features/admin/MonitorPanel.tsx`、
  `scripts/security_guard_switch_check.py`（新增回归）。
- **验证**：`scripts/security_guard_switch_check.py` **9/9 通过**（普通成员切换 403、关闭后不拦截不计数、
  开启后恢复封禁、启停写审计、恢复原状态）；真机点击开关 + 二次确认通过；
  `security_guard_check.py` 10/10 复跑通过；`tsc` 干净；截图 `docs/_selfcheck/s7_guard_switch.png`。

---

## 2026-11-14 · 新增：安全卫士 v1（攻击型操作累计命中 → 自动拒绝访问）

- **背景**：操作监控解决了「看得见」，但攻击型 / 跨权限 / 数据泄露类操作仍只是留痕，不能主动止损。
  需要一道能**直接拒绝访问**的闸门，并且封得准（IP / 浏览器指纹 / 账号）、能人工解封、有据可查。
- **改法**：
  1. **命中累计** `bi_guard_hit`：只统计攻击型事件（匿名访问、令牌无效、越权 403、限流 429、
     扫描器路径、登录失败），保留 2 天供窗口计数与追溯；
  2. **自动封禁** `bi_security_block`：300s 窗口内同一 IP / 指纹 / 账号命中 10 次 → 三个维度同时封 1800s，
     到期自动失效；`BI_GUARD_*` 可调窗口、阈值、时长、白名单；
  3. **拒绝访问**：`SecurityWatchMiddleware` 最外层先查封禁，命中直接 403「访问已被安全卫士拦截（…），… 后自动解封」，
     不进入业务鉴权；健康检查 / 就绪探针等 skip 路径仍放行；
  4. **告警与审计**：封禁写 `bi_security_event(guard_block)` 与 `bi_audit_logs(security.guard.block)`，
     操作监控可直接筛「安全事件」并看到封禁行（含 IP、指纹、命中次数）；解封写 `security.guard.release_manual`；
  5. **管理端**：`GET /api/admin/monitor/guard`（配置 + 活跃封禁）、
     `DELETE /api/admin/monitor/guard/blocks/{id}`（人工解封，`bi:audit:view`）；
     前端「操作监控」新增「安全卫士」卡片（启用状态 / 窗口 / 阈值 / 封禁时长 / 封禁列表 / 解封按钮），
     KPI 增加「安全事件」，表格增加「指纹」列与详情展示；
  6. **解封语义**：人工解封同时清掉该维度窗口内的命中计数 —— 否则解封后的第一次请求会立刻重新封禁；
  7. 迁移 `052_security_guard.sql`。
- **涉及文件**：`backend/app/security/guard.py`（新增）、`middleware/security_watch.py`、`admin/monitor.py`、
  `app/main.py`、`schema/migrations/052_security_guard.sql`、`frontend/src/features/admin/MonitorPanel.tsx`、
  `scripts/security_guard_check.py`（新增回归）。
- **验证**：`scripts/security_guard_check.py` **10/10 通过**（阈值内普通 403 → 第 11 次被安全卫士拦截 →
  IP/指纹/账号三维封禁 → `guard_block` 进操作监控 → 人工解封恢复普通 403 → 封禁列表清空，自带清场）；
  真实点击前端「解封」可用；`tsc` 干净、`ui_rules.sh` 无新增违规；
  截图 `docs/_selfcheck/s7_guard.png`。
- **注意**：白名单默认 `127.0.0.1,::1` 且**完全豁免**（不计数也不封禁）—— 运维与回归脚本共用同一指纹，
  只跳过 IP 维度会让它们互相把指纹封掉；
  封禁记录不自动删除，便于事故复盘；阈值可被分布式低频攻击绕过，v1 先解决「高频爆刷 / 扫描 / 越权探测」。

---

## 2026-11-14 · 新增：管理员「操作监控」（登录 / 看板 / 数据集 / AI / MCP 全链路留痕）

- **背景**：项目里已有零散审计（管理后台写操作、MCP 调用、AI 生成），但没有统一查看入口；
  登录、看板保存/发布/删除、数据集与数据源变更、AI 整理/推荐都没有留痕，管理员无法追溯风险。
- **改法**：
  1. **统一监控 API** `GET /api/admin/monitor/{summary,activity}`（`bi:audit:view`）：
     合并 `bi_audit_logs` + `bi_mcp_audit` + `bi_ai_audit_log`，支持时间范围 / 来源 / 状态 / 用户 /
     关键词过滤与分页；删除、权限、模型、角色、用户、部门隔离、登录失败、RLS 异常、MCP 高危工具
     统一打「敏感」标；
  2. **补齐留痕**：登录成功/失败、看板新建/保存/发布/删除/团队分享/成员权限、数据集新建/修改/改名/同步/删除、
     部门隔离规则、数据源新建/修改/删除/上传/删表、AI 整理 / AI 推荐；LLM 每次调用（含回退与失败）
     由 `_call_llm` 落 `ai.call`；
  3. **审计归属**：`AuditUserMiddleware` 从 JWT `sub` 写 ContextVar，LLM 等深层调用也能记到人，
     sync 端点的线程池同样生效；
  4. **管理后台第 9 分区「操作监控」**：6 个指标卡（总量/敏感/AI/MCP/失败/活跃用户）、每日趋势、
     筛选与分页、详情弹窗、30s 自动刷新；
  5. 迁移 `050_audit_monitor.sql`：权限码 + `created_at DESC` 索引。
- **迭代（安全指纹：不走账号也要留痕）**：新增 `bi_security_event`（迁移 `051_security_fingerprint.sql`）与
  `SecurityWatchMiddleware`：匿名访问、令牌无效、越权 403、限流 429、扫描器路径（`.env` / `wp-admin` / `../`）
  全部记录，字段含 IP、X-Forwarded-For、User-Agent、浏览器设备号、**指纹**（IP+UA+设备号+语言的 sha256 前 16 位）
  与 request_id；同一指纹+路径+状态 60 秒去重。
  `log_audit` 自动带上 IP / UA / 指纹 —— 用 Postman / curl 调接口也能看出是哪台机器。
  前端 axios 统一发送 `X-Device-Id`（localStorage 随机 id，不含个人信息）。
  外部直连数据库：应用连接打 `application_name=mingcebi-api`，后台每 60s 采样 `pg_stat_activity`，
  非应用会话（psql / 黑客直连）记为 `db_external_session` 安全事件。
  监控页新增「安全事件」KPI 与来源筛选、指纹列、详情里的 UA/指纹。
  **补充直连数据库的权威审计方案并已在本机执行**：`docs/pgaudit配置指南.md`（安装、`postgresql.conf`、
  按角色降噪、验证、日志留存与回滚）。本机 PG 16.14 已安装 pgaudit 16.0、`shared_preload_libraries=pgaudit`、
  应用账号 `pgaudit.log=none`；实测直连角色查表会写 `AUDIT: ...,READ,SELECT,TABLE,...`，应用 API 查询增量 0。
- **涉及文件**：`backend/app/admin/monitor.py`（新增）、`middleware/{audit_user,audit_context,audit,auth,security_watch}.py`、
  `security/security_events.py`（新增）、`admin/permissions.py`、`services/rbac_seed.py`、`services/bi_ai_engine.py`、
  `ai/router.py`、`dashboards/router.py`、`semantic/{router,router_items}.py`、`sources/router.py`、`routers/auth.py`、
  `database.py`、`schema/migrations/{050_audit_monitor,051_security_fingerprint}.sql`、
  `frontend/src/features/admin/MonitorPanel.tsx`（新增）、`frontend/src/api/client.ts`、`frontend/src/pages/AdminPage.tsx`、
  `scripts/activity_monitor_check.py`（新增回归）。
- **验证**：`scripts/activity_monitor_check.py` **32/32 通过**（真实登录失败、看板增删改发、AI 整理/推荐、
  MCP 调用、来源/关键词过滤、敏感标记、无权限 403、匿名/伪造令牌/扫描路径留痕与指纹，自带清场）；
  `pytest` **301 全绿**；权限矩阵 207/207、MCP 网关 15/15；`tsc` 干净；
  截图 `docs/_selfcheck/s7_monitor.png`、`s7_monitor_detail.png`、`s7_security_events.png`。
- **注意**：审计只记录「服务端动作」，不记录前端每一次点击；要看某个用户的操作轨迹，
  按用户筛选即可（登录 → 看板 → 数据集 → AI → MCP 在同一条时间线上）。

---

## 2026-11-14 · 新增：物理表 RLS 兜底（MCP 方案 S6）

- **背景**：S3 的部门隔离只在应用 SQL 里 AND 条件，绕过接口直连数据库（psql / BI 工具 / 只读账号）
  仍然能看到全量数据。S6 给物理表加 PostgreSQL 行级安全策略，作为第二道防线。
- **改法**：
  1. `app/security/rls_backstop.py`：按 `bi_dataset_scope_rule` 给物理表建 `mcbi_dept_scope` 策略
     （`ENABLE + FORCE ROW LEVEL SECURITY`）：`department` 用 `app.dept_ids`、`self` 用 `app.user_id`、
     `data_scope=all` 放行；**表达式缺会话变量 → false**（fail-closed）；
  2. 规则保存 / 删除时同步策略（建不出来 → 规则回滚 + `security.rls.sync_failed` 审计）；
     启动时 `bootstrap.ensure_rls_backstop()` 补齐存量规则，并创建只读角色 `mcbi_rls`（NOLOGIN、仅 SELECT）；
  3. `executor.run`：查询前 `preflight`（策略缺失先自愈，仍失败 403），写入
     `app.user_id / app.dept_id / app.dept_ids / app.data_scope / app.scope_mode / app.rls_enforced`；
     可选 `BI_RLS_APP_ROLE=mcbi_rls`，让应用的数据 SELECT 也以只读角色执行（默认关闭）；
  4. 直连账号用 `mcbi_rls`，与 S3 读同一份规则，避免「应用一套、数据库一套」。
- **涉及文件**：`backend/app/security/rls_backstop.py`（新增）、`dept_scope.py`、`query/executor.py`、
  `app/bootstrap.py`、`app/main.py`、`app/middleware/audit.py`（系统审计 user_id=0 撞外键）、
  `backend/tests/test_rls_backstop.py`、`scripts/rls_backstop_check.py`（新增回归）、`AGENTS.md`。
- **验证**：`scripts/rls_backstop_check.py` **17/17 通过**（带 `BI_RLS_APP_ROLE`；默认关闭 16/16）：
  直连不设变量 → 0 行；部门 A → 本部门；A+下级 → 含下级；`data_scope=all` → 全量；`self` → 按用户 id；
  删策略（RLS 仍开）→ 0 行（数据库默认拒绝）且预检可自愈；应用查询与直连结果一致；
  视图建不了策略 → 规则回滚 + 安全审计告警。
  `pytest` **301 全绿**；MCP 网关 15/15、写工具 34/34、部门隔离 12/12、归属部门 15/15。
- **注意**：应用连接是超级用户时，PostgreSQL 会绕过 RLS（ABAC 仍生效）；要让应用连接本身也受 RLS 约束，
  启动时设 `BI_RLS_APP_ROLE=mcbi_rls`；DBA 直连请使用只读账号，不要用超级用户。

---

## 2026-11-14 · 优化：AI 调用链统一用后台模型，默认失败按顺序回退

- **背景**：编辑器 AI（一句话排版）和引擎 AI 都读同一份模型配置，但只取「默认」一条；
  默认模型连不上时直接降级（一句话排版退回按位置归行），不会尝试其余已启用模型。
  本次先实测「到底调了哪个模型」，再补上回退链。
- **改法**：
  1. `ai_models.candidate_configs()`：**库默认 → 库其它启用（按 id）→ `data/ai_models.json` → 环境变量**，
     按 `chat_url + model + key` 去重；`default_config()` 取第一个；
  2. `bi_ai_engine._call_llm` 逐个真实请求（连接超时 10s / 读 120s）：超时、HTTP 非 2xx、空回复都换下一个；
     回退时打印「默认模型不可用，已回退到：xxx」，全挂时打印最后错误并返回空串（调用方已有降级分支）；
  3. `routers/bi_engine._call_llm`（analyze / nl_to_sql / 自动看板等）改为委托同一实现，删掉第二套 `_load_default_llm`；
  4. 管理后台「当前生效」口径不变（有默认显示默认，没有则第一个启用的）。
- **涉及文件**：`backend/app/services/ai_models.py`、`backend/app/services/bi_ai_engine.py`、
  `backend/app/routers/bi_engine.py`、`backend/tests/test_ai_models.py`、`AGENTS.md`。
- **验证（真实链路，本地 mock OpenAI 兼容服务记录每次 request 的 model）**：
  1. 默认可用 → 编辑器 AI 只请求 `mock-default`，`instruction_applied=true`；
  2. 默认返回 503 → 先请求 `mock-fail` 再回退 `mock-backup`，仍成功；
  3. 默认端口断连 → 直接回退 `mock-backup`；
  4. 全部不可用 → 不发请求，编辑器按位置归行（`instruction_applied=false`、`rows=1`），不报 500；
  5. `/api/bi/engine/ai/analyze` → 同样走 `mock-default`。
  单测 10 项（顺序 / 去重 / 回退 / 全挂）、全量 `pytest` **294 passed**；测试模型已删除，原 `deepseek-flash` 配置已恢复。

---

## 2026-11-14 · 优化：模型「温度 / 最大 Token」跟随供应商官方默认值

- **背景**：新建模型时温度固定 0.3、最大 Token 固定 4096，与各家官方默认不一致；
  用户每次都要自己查文档再改，也容易把推理模型的最大输出设得太小。
- **改法**：
  1. 供应商预设（`GET /api/admin/models` 的 `providers`）补 `temperature / max_tokens / context_window`：
     DeepSeek 1.0 / 8192 / 128K、OpenAI 1.0 / 16384 / 128K、通义千问 0.7 / 32768 / 128K、Moonshot 1.0 / 4096 / 8K；
     「自定义」不带参考值，沿用用户当前填写；
  2. 前端切换供应商时自动带出这组官方默认值（名称 / Base URL / 模型名 / 温度 / 最大 Token 一起同步），
     用户仍可手动修改后再保存；编辑已有模型不覆盖原配置；
  3. 表单下方提示「供应商参考值：温度 · 最大输出 · 上下文（可自行修改）」，自定义供应商提示按文档填写。
- **涉及文件**：`backend/app/admin/router.py`、`frontend/src/features/admin/ModelsPanel.tsx`。
- **验证**：`GET /api/admin/models` 返回四家供应商带参考值、自定义为 null；`tsc --noEmit` 干净；
  实机截图 `docs/_selfcheck/model_params_defaults.png`（DeepSeek 1 / 8192 / 128K）、
  `model_params_provider_switch.png`（切到通义千问自动变 0.7 / 32768）。
- **说明**：参考值只是「新建时的初值」，保存时以表单里用户填的为准；运行期仍走
  `ai_models._config` 的区间校验（温度 0~2、最大 Token 64~32768）。

---

## 2026-11-14 · 修复：后台「测试连接」把推理模型的空正文误判为接入失败

- **背景**：管理后台新建模型（DeepSeek / `deepseek-flash`）点「测试连接」报
  「接口返回 200，但响应里没有 choices[0].message.content」。接口与 Key 其实都是通的：
  测试请求只给 `max_tokens: 8`，推理类模型把这几个 token 全花在思维链上，`content` 就是空的；
  旧逻辑还直接把响应体丢掉，用户看不到真实原因（例如模型名写错时网关返回的错误）。
- **改法**：
  1. 测试请求 `max_tokens` 8 → 64，并明确提示词「ping，请只回复 ok」；
  2. 判定放宽：`content / reasoning_content / choices[0].text` 任一有内容即视为连通；
  3. 失败时把真实响应透出来：200 里包着 `error`、没有 `choices`、不是 JSON、回复为空，
     都会在提示里带 240 字响应体，不再只报「没有 content」；
  4. 运行时 `_call_llm` 同步兜底：`content` 为空时取 `reasoning_content`，不再 `KeyError`。
- **涉及文件**：`backend/app/services/ai_models.py`、`backend/app/services/bi_ai_engine.py`、
  `backend/tests/test_ai_models.py`（新增 6 项单测）。
- **验证**：单测 6/6 通过（正文 / 仅思维链 / 200 带 error / 无 choices / 空回复 / HTTP 401）；
  真实打 `https://api.deepseek.com/v1/chat/completions`（无效 Key）返回 401 且报文完整透出；
  `pytest` 全绿。
- **说明**：若模型名本身不存在，DeepSeek 一般返回 HTTP 400；现在错误提示会直接带出
  `Model Not Exist` 之类的原文，按提示改模型名即可。

---

## 2026-11-14 · 新增：Agent 编排看板（MCP 方案 S5）

- **背景**：S2 的 Agent 只能读；要让 AI 把「新建看板 → 加组件 → 排版 → 自检」跑完，
  必须补一套**写工具**，同时保证草稿不污染团队页、用户手工看板不被 Agent 改、发布必须用户点头。
- **改法**：
  1. **写工具**（默认全关，需 `bi:mcp:write` ∩ 客户端策略 ∩ 用户授权）：
     `bi_create_dashboard`（owner=当前用户、`published=false`、每日额度默认 20 → 超限 429）、
     `bi_add_item`（图表目录 / 组件库二选一，key 后端生成，字段自动落到目标数据集）、
     `bi_set_layout`（`mode=auto` 用 `plan_layout` 归一；`mode=exact` 校验 8 倍数与 16 间距，越界 400）、
     `bi_preview_dashboard`（逐卡 ok/error）、`bi_save_dashboard`（渲染自检 + `updated_at` 乐观锁 → 409）、
     `bi_publish_dashboard`（Agent 单独调用一律 403）、`bi_list_components`（含按字段推荐）；
  2. **归属校验**：写工具只认 `bi_mcp_dashboard(client_id, dashboard_id, user_id)` 登记过、且
     `owner_id = 当前用户` 的草稿；用户手工看板 → 403（标记只存这张表，不写 `doc.meta`，保存不会冲掉）；
  3. **保存前渲染自检**：`render_dashboard` 任一卡片 error 就拒绝保存，避免交付整页红条；
  4. **A4 组件推荐**（S4 移交）：`app/dashboards/items.py` 统一插元素 / 选字段 / 校验字段的共用逻辑，
     `POST /api/bi/ai/recommend` 与 `bi_add_item` 同一套，不再写第二份；
  5. **前端**：项目页给未发布看板打「草稿 / 草稿 · Agent 生成」标；编辑器顶部草稿提示条
     （一键「用 AI 整理版面」+「AI 推荐组件」+ 发布）；「发布我的看板」改为二次确认弹窗。
- **涉及文件**：`backend/app/mcp/{tools,gateway}.py`、`backend/app/dashboards/{items,repository,router}.py`、
  `backend/app/ai/{recommend,router}.py`、`frontend/src/pages/{ProjectsPage,CanvasBoardPage}.tsx`、
  `scripts/mcp_write_check.py`（新增回归）。
- **验证**：
  - `scripts/mcp_write_check.py` **34/34 通过**：草稿只出现在 owner「我的看板」且团队页不可见；
    编造字段 400、越界 400、exact 间距错 400、过期 `updated_at` 409、错误卡片拒绝保存 400、
    Agent 发布 403、改手工看板 403、额度用尽 429；写操作与拒绝都有审计且不含 secret；
  - `pytest` 284 项全绿；网关 15/15、部门隔离 12/12、归属部门 15/15、权限矩阵 207/207；`tsc` 干净；
  - 截图 `docs/_selfcheck/s5_draft_badge.png`、`s5_draft_banner.png`、`s5_ai_recommend.png`、`s5_publish_confirm.png`。
- **注意**：发布入口只有前端（用户点击），`bi_publish_dashboard` 故意不提供 Agent 直发通道；
  需要放开「改用户已有看板」时，必须先补前端二次确认 + 显式 `allow_existing`，不要只改后端判断。

---

## 2026-11-14 · 新增：编辑器 AI 整理版面（MCP 方案 S4）

- **背景**：编辑设计页只能手动拖拽对齐，排版费时且容易对不齐。S4 加「AI 整理」：
  自动归行、等宽、统一间距，筛选栏保持整宽；支持只整理选中元素。
- **改法**：
  1. **确定性算法** `app/ai/layout.py::plan_layout`：按纵向重叠归行 → 行内等宽
     （`floor((1440−(N−1)×16)/N/8)×8`）→ 行内统一高度 → 行间 16px 堆叠；整宽元素（筛选栏）强制 `x=0 / w=1440`；
  2. **接口** `POST /api/bi/ai/layout`（`bi:ai:use`）：`scope=all|selection` + 选区外接矩形 + 可选 `instruction`；
     **LLM 只把一句话翻译成「每行几张」**，坐标仍由算法算，LLM 失败自动退回按位置归行；
  3. **前端** `AiLayoutBar`：工具栏「AI 整理」→ 可选一句话 → 结果确认（应用 / 重试 / 取消）→ 应用后
     Snackbar 可撤销；**一次应用 = 一个撤销步**（先 `pushHistory` 再同步 `prevSnap`，避免重复入栈）；
  4. 少于 2 个元素按钮置灰；接口失败提示「可手动调整」，不卡死。
- **涉及文件**：`backend/app/ai/{__init__,layout,router}.py`、`backend/app/main.py`、
  `backend/tests/test_ai_layout.py`、`frontend/src/features/components/editor/AiLayoutBar.tsx`、
  `frontend/src/pages/CanvasBoardPage.tsx`。
- **验证**：
  - 算法单测 6 项通过：6 张卡 → **224×104、x=0/240/480/720/960/1200**；两行堆叠 y=120；筛选栏整宽；
    选区不越界；强制行数生效；空态与最小尺寸；
  - 接口实测：整页 200 且上述坐标、选区只返回选中元素、匿名 403；
  - UI 实跑 666 看板：整理 → 应用 → **一次 ⌘Z 完整还原**（截图应用前 / 结果 / 应用后 / 撤销后），
    未保存故数据库无改动；console 里 6 个 404 是看板原有商品图缺失，与本次无关；
  - `pytest` 全绿、`tsc` 干净。
- **说明**：A4「按字段推荐组件」移交 S5（和 Agent 插元素共用逻辑，避免两套插入实现）。

---

## 2026-11-14 · 新增：数据源 / 数据集「归属部门」+ 按部门取数准入

- **背景**：新建数据源、数据集时没有部门字段，分不清这份数据属于哪个部门；
  后续数据管理列表与 AI（MCP）取数也无从判断权限。
- **改法**：
  1. 迁移 `049_data_dept_owner.sql`：`bi_dataset.dept_id` / `bi_source.dept_id`（NULL = 不归属部门）；
  2. **新建弹窗加「归属部门（可选）」**：`CreateSourceDialog` 与 `CreateDatasetDialog`（抽取 / 直连 / SQL 三种方式都带）；
     直连数据集未选部门时自动跟随所选数据源的部门；
  3. **可见性**（`semantic/access.py`，与列表口径完全一致）：
     公共数据集（owner 为空）/ 自己的 / 归属本部门（数据范围含下级）→ 可见；
     列表看不到的，按 id 查详情或取数一律 403（堵住「列表隐藏但能按 id 取数」）；
  4. **AI / MCP 自动继承**：`bi_list_datasets` 用同一套部门范围过滤；`bi_query_dataset` 等取数工具走
     `can_access_dataset`，越权返回 403（`McpPermissionError` → JSON-RPC `-32003` + HTTP 403，并记 denied 审计）；
  5. **只能归到自己有权限的部门**：部门管理员选别的部门 → 403；部门不存在 → 400；
  6. 列表回显：数据源、数据集列表都显示部门 Chip（数据源接口额外返回 `dept_name`）。
- **涉及文件**：`backend/schema/migrations/049_data_dept_owner.sql`、`backend/app/semantic/{access,models,repository,router}.py`、
  `backend/app/sources/{repository,router}.py`、`backend/app/mcp/{tools,gateway}.py`、
  `frontend/src/features/bi-dashboard/{DataSources,DatasetPanel}.tsx`、`scripts/data_dept_owner_check.py`（新增回归）。
- **验证**：`scripts/data_dept_owner_check.py` **15/15 通过**（真实部门 + 真实账号，自带清场）：
  本部门可见可取数、别的部门列表看不到且详情 403、公共数据集所有人可见、私有数据集别人 403、
  越权归部门 403、数据源返回 dept_name、MCP 取别的部门数据集 403；
  `pytest` 全绿、矩阵 207/207、`tsc` 干净；
  截图 `docs/_selfcheck/dept_owner_source.png`、`dept_owner_dataset.png`。
- **注意**：「归属部门」只决定**可见性 / 取数准入**；行级过滤仍由数据集「权限」页的**部门隔离规则**负责（S3），两者不互相替代。
  没标部门的存量数据集保持原行为（公共的公开、私有的仅本人与管理员）。

---

## 2026-11-14 · 新增：部门级数据隔离（MCP 方案 S3）

- **背景**：`roles.data_scope` 此前只管管理后台列表，BI 数据（看板 / 数据集查询）没有部门强制过滤，
  MCP 一开查询就能跨部门拿数。S3 把「部门维度」补进数据层，UI 与 MCP 同一口径。
- **改法**：
  1. 配置入口：`PUT/DELETE /api/bi/semantic/datasets/{id}/security/dept-scope`（`bi_dataset_scope_rule`，一个数据集一条），
     数据集「权限」页签顶部新增「部门隔离」控件（部门列 + 模式 + 当前状态 + 取消隔离）；
  2. 注入点：`dataset_rules.row_conditions` 在现有行级规则**之后追加**部门条件，与行级规则同时 AND；
     `query/executor.run` 与 `query/live.run_live` 各自传入方言（标识符引号按 MySQL / ClickHouse / PG 区分）；
  3. 模式：`department`（本部门，`dept_and_children` 含下级）/ `self`（列 = 用户 id）/ `all`（不注入）；
  4. fail-closed：列被删、账号无部门、列名非法 → 403；数据范围 `all`（管理员 / 高层）不注入但列脱敏照旧；
  5. 配置存字段名、注入时解析 `source_column`（如「部门」→ `dept_id`），避免中文别名数据集报「列不存在」。
- **涉及文件**：`backend/app/security/dept_scope.py`（新增）、`backend/app/security/dataset_rules.py`、
  `backend/app/query/{executor,live}.py`、`backend/app/semantic/router_items.py`、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`、`scripts/dept_scope_check.py`（新增回归）。
- **验证**：`scripts/dept_scope_check.py` **12/12 通过**（真实物理表 + 临时部门/账号）：
  员工只看本部门、主管看本部门+下级、跨部门 0 行、无部门账号 403、`self` 用部门列 0 行、
  `all` 不隔离、部门列被删 403、MCP 与 UI 范围一致；`pytest` 全绿、矩阵 207/207、`tsc` 干净；
  截图 `docs/_selfcheck/s3_dept_scope.png`；临时规则 / 表 / 部门 / 账号均已清理。
- **注意**：没有配置规则的数据集行为不变（不隔离）；「测试数据集」等公共数据集如需隔离，同样要在其「权限」页配一次。

---

## 2026-11-14 · 新增：MCP 网关与只读工具（MCP 方案 S2）

- **背景**：S1 建好了客户端与工具目录，这一步把真正的调用链接上：Agent 用「用户授权令牌」代调用，
  每次调用重新鉴权；工具复用现有服务层，保证 **MCP 查到的数 = 页面上看到的数**。
- **改法**：
  1. **JSON-RPC 网关** `POST /api/mcp/rpc`：支持 `initialize / ping / tools/list / tools/call`；
     可见工具 = 已实现 ∩ 客户端工具策略（或目录默认）∩ 角色权限；拒绝一律落审计并返回 403 + JSON-RPC error；
  2. **授权与令牌**：`POST /api/mcp/grants`（用户授权，一次性 `refresh_token`，7 天）、
     `POST /api/mcp/token`（`client_id + secret + refresh_token` → 1 小时 JWT，`aud=mcp` + `jti`）、
     `DELETE /api/mcp/grants/{id}`；迁移 `048_mcp_grant_refresh.sql` 增加 `bi_mcp_grant.refresh_hash`（只存哈希）；
  3. **鉴权链**（`app/mcp/auth.py`）：令牌 → jti 吊销 → 用户状态 / 审批 / `token_version` → 客户端启用 → 授权未撤；
     **每次调用重算**，停用客户端、撤销授权、改密都会让已签发 token 立即失效；
  4. **10 个只读工具**（`app/mcp/tools.py`）：看板列表/详情/渲染、数据集列表/结构/聚合、指标列表/口径/取数、AI 解读；
     全部走服务层并把 `dataset_id` 传进执行器（数据集行列权限生效），结果用 `jsonable_encoder` 编码，与 HTTP 完全一致；
  5. **管理页补齐**：客户端工具开关（高危工具二次确认）、授权记录（可撤销）、调用审计（成功/拒绝/报错）；
     另加「生成我的连接令牌」，用户在页面上完成授权；
  6. `/api/mcp/*` 加入 CSRF 豁免（Bearer 令牌没有浏览器会话）。
- **涉及文件**：`backend/app/mcp/{auth,tools,gateway,router}.py`、`backend/app/main.py`、`backend/app/middleware/csrf.py`、
  `backend/schema/migrations/048_mcp_grant_refresh.sql`、`frontend/src/features/admin/McpPanel.tsx`、
  `scripts/mcp_gateway_check.py`（新增回归脚本）。
- **验证**：
  - `scripts/mcp_gateway_check.py` **15/15 通过**：建客户端→授权→换令牌→initialize/tools-list/tools-call 全通；
    MCP 聚合查询与 UI 查询**逐行一致**；无令牌 / 错误 secret / 高危工具 / 客户端停用 / 工具关闭 / 授权撤销 全部 403；
    审计有记录、含 denied、参数不含 secret；脚本自带清场；
  - 权限矩阵 `207/207`、`pytest` 全绿、`tsc --noEmit` 干净；
  - UI 实跑四个页签（客户端 / 授权记录 / 调用审计 / 工具目录）无 console 报错，
    截图 `docs/_selfcheck/s2_mcp_clients.png`、`s2_mcp_tools.png`、`s2_mcp_grants.png`、`s2_mcp_audit.png`。
- **注意**：写工具（新建/编排看板）在 S5；部门级数据隔离在 S3 —— 在此之前，MCP 的数据范围与 UI 相同（按用户/角色 + 数据集规则）。

---

## 2026-11-14 · 新增：MCP 客户端管理 + 高层角色（MCP 方案 S1）

- **背景**：方案 §9 的 S1 —— 在网关（S2）之前，先把权限码、数据表、工具目录、「高层」角色和后台入口立起来，
  避免 S2 边写网关边改权限模型。
- **改法**：
  1. **权限码**（`admin/permissions.py`）：`bi:mcp:manage` 进 `BI_PERMISSIONS`（第 8 个后台分区）；
     新增 `MCP_PERMISSIONS`（`bi:mcp:use` / `bi:mcp:write`）与 `DATA_PERMISSIONS`
     （`bi:data:export:summary` / `detail`、`bi:resource:delete`），全部并入 `VISIBLE_PERMISSION_CODES`；
  2. **迁移 `047_mcp_permission.sql`**：8 张表（工具目录 / 客户端 / 客户端工具策略 / 用户授权 / 令牌吊销名单 /
     Agent 看板归属 / 调用审计 / 数据集部门规则）+ 6 个权限码 + **23 条工具目录种子**（高危 `default_enabled=false`）；
  3. **MCP 管理页**（真实可用，不是占位）：`app/mcp/router.py` 提供 `GET /api/admin/mcp/clients`、
     `POST /clients`（secret 只返回一次）、`PATCH /clients/{id}`（启停）、`GET /tools`；
     前端 `McpPanel` 在管理后台新增分区「MCP 客户端」，含列表 / 新建（一次性展示 client_id + secret + 复制）/ 启停 / 工具目录；
  4. **高层角色** `executive`（`data_scope=all`、`sort_order=95`）：权限恰为 `bi:ai:use` + `bi:data:export:summary`，
     无 SQL 入口 / 编辑设计 / 明细导出 / 删除；
  5. 角色权限页新增「能力权限」分组（AI / MCP / 数据能力），与「管理后台」「业务入口」并列，避免能力码藏进「其他模块」。
- **涉及文件**：`backend/app/admin/permissions.py`、`backend/app/services/rbac_seed.py`、`backend/app/mcp/{__init__,router}.py`、
  `backend/app/main.py`、`backend/schema/migrations/047_mcp_permission.sql`、
  `frontend/src/features/admin/McpPanel.tsx`、`frontend/src/pages/AdminPage.tsx`、`frontend/src/features/admin/RolesPanel.tsx`、
  `scripts/admin_permission_matrix.py`。
- **验证**：
  - 迁移与表：`schema_migrations` 有 047；`bi_mcp_*` 8 表齐全；工具 23 条；`executive` 角色权限 = 2 项、范围 `all`；
  - HTTP：管理员 `/admin/mcp/clients` 200、`/tools` 23 条、创建返回 secret、停用/启用 200；匿名 403；普通角色与高层 403；
  - 高层：`POST /bi/engine/query` 403、`GET /bi/dashboards` 200、`GET /ai/audit` 200；
  - 矩阵脚本 **207/207 通过**（原 197 + 新 10）；`tsc --noEmit` 干净；
  - UI：Playwright 实跑 `/bi/admin?tab=mcp`（空态 → 新建 → secret 弹窗 → 列表出现），console 无报错，
    截图 `docs/_selfcheck/s1_mcp_admin.png` / `s1_mcp_create.png` / `s1_mcp_secret.png`；验证用客户端已删除。
- **注意**：工具开关（客户端级）、用户授权与调用审计在 S2 接入网关时一起开放；现在列表里的「最近调用」恒为空。

---

## 2026-11-19 · 重构：合入 main 模块结构并保留当前业务行为

- **改了什么**：将 `main` 合入 `feature/analyze`；规范、CI 和部署方案沿用当前分支，前端采用 main 的 shell/auth/viewer/组件页面与数据集子面板结构；后端采用认证、RBAC、AI、权限、血缘、模板与可观测模块拆分，保留 main 新增 MCP、监控及安全能力。
- **保留行为**：多设备登录、UTC+8、移除表名白名单、SQL Lab、公式字段、注释同步、批量导入、自定义汇总和热力矩阵排序。将功能修改迁入实际执行的新模块，旧兼容入口仅转发；main 新增的敏感字段自动脱敏与 JOIN 校验继续保留。画布读取旧面板宽度和折叠设置，Playwright 兼容新旧环境变量名。
- **迁移命名**：65 个历史 SQL 只改文件名，按原顺序分配 `20261119162312` 起的连续时间戳；`legacy_names.json` 保存完整旧名映射，迁移器将旧记录映射到新名，避免重复执行。数据库原记录不重写。同步更新测试引用与后续命名规范。
- **验证**：后端完整测试、前端单测、生产构建、体积预算及 SQL Lab/字段编辑/导入/自定义汇总/帮助页浏览器回归；迁移兼容测试覆盖新库、旧记录、新记录、相同旧编号和重复运行。真实库仅做只读核对：65 条旧记录全部识别，待执行为 0，历史记录不变；未执行数据库迁移或部署。

## 2026-11-19 · 修复：热力矩阵价格带按数字排序

- **改了什么**：横轴识别 `数字-数字` 区间，按起始数值升序，同起点按终点排序；支持负数、小数及区间两侧空格，保留原标签。普通文字沿用字符串排序，空字符串和 `(空)` 放最后。
- **为什么**：避免 `120-130` 排在 `30-40` 前面，价格带公式无需改动。
- **涉及文件**：`backend/app/components/resolver.py` 的矩阵构建；组件库预览与看板共用该逻辑，无需修改模板或业务数据。纵轴排序和指标值保持原有逻辑。
- **验证**：新增排序回归，覆盖数字区间、负数、小数、普通文字、空值、同值横轴去重，以及排序后单元格坐标和值的对应关系。

## 2026-11-19 · 新增：指标自定义 SQL 汇总

- **改了什么**：设计面板主指标的“聚合”新增“自定义 SQL”，输入聚合表达式并引用数据集字段名，例如 `SUM("销售额") * 1.0 / NULLIF(SUM("订单数"), 0)`；配置随看板保存，口径区显示表达式，查询错误显示在输入框下方。组件库数据组件使用同一个设计面板，组件元数据接口同步提供 `CUSTOM`。
- **为什么**：允许按当前筛选、分组和数据权限计算跨字段指标及中位数。`MEDIAN("销售额")` 在 PostgreSQL 转换为 `PERCENTILE_CONT(0.5) WITHIN GROUP`；其他方言暂时明确拒绝中位数，普通聚合表达式按查询方言转换。
- **涉及文件**：组件规格与解析器、语义编译器及新增聚合表达式校验、查询契约与构建器、脱敏规则传播、字段引用检查，以及前端指标面板与口径说明。仅接受单个聚合表达式，拦截子查询、窗口、未知函数、未聚合字段及嵌套聚合；引用脱敏源列（含虚拟数据集别名、公式依赖）时拒绝计算。旧汇总方式保留，未新增依赖或数据库迁移。
- **验证**：后端覆盖字段映射、分组/筛选/RLS、公式字段、脱敏及字段引用；浏览器覆盖编辑、保存刷新恢复、非法字段反馈和切回 SUM。真实 PostgreSQL 只读 VALUES 查询与指标卡完整解析执行验证：含空值的 `[1,3,100]` 中位数为 3，筛选 `<100` 后为 2；没有修改业务表。截图：`docs/_selfcheck/2026-11-19-custom-aggregate.png`。

## 2026-11-19 · 优化：已接入表操作菜单与本地注释同步

- **改了什么**：操作列保留“创建数据集”，三点菜单提供“同步本地表 / 同步本地表元数据 / 移除本地表”；文件表的同步项置灰并说明需重新上传，移除增加确认。
- **为什么**：区分业务数据同步与注释同步。新元数据接口只更新源表与匹配字段的注释，源库空注释会清除对应本地注释；不增删字段、不改字段类型、不读写业务行，不改变数据同步时间及现有数据同步策略。
- **涉及文件**：数据源面板、数据源路由和仓储；复用 SQLAlchemy 注释 DDL 安全处理标识符与引号，全部本地注释写入使用同一事务，源库读取失败不写本地，写入失败回滚。未匹配的新增源字段提示先同步本地表。
- **怎么验证**：后端相关测试 29 项通过、1 项跳过，覆盖注释引号、清空、缺失列、事务失败及接口权限；类型检查与浏览器 2 项测试通过，覆盖菜单、文件禁用、取消移除、同步失败及原导入流程。截图 `docs/_selfcheck/2026-11-19-source-table-menu.png`；真实源库联调尚未完成。
- **迭代**：菜单统一为列表行的 12px 正常字重；三个本地表操作改用 MUI Dialog 确认，取消不发送请求，移除确认使用红色按钮。类型检查与对应浏览器回归通过，截图 `docs/_selfcheck/2026-11-19-source-table-confirm.png`。

## 2026-11-19 · 新增：数据集字段注释与可调整列宽

- **改了什么**：数据集侧边栏的字段表格在字段名右侧显示数据库原始注释，空注释显示灰色斜体 `(空)`；各列支持拖动表头边界或键盘调整宽度，并在刷新后保留。
- **为什么**：便于识别数据库字段含义、阅读较长注释；数据库注释与手工字段描述分开，本地表和直连表分别读取对应数据库元数据，虚拟集和公式字段不推测注释。
- **涉及文件**：语义层列元数据接口与仓储、源库列元数据读取、`DatasetPanel.tsx` 字段表格；不改数据库注释或业务数据。
- **怎么验证**：后端相关测试 71 项通过，类型检查通过；浏览器 5 项通过，覆盖来源列映射、公式字段空态、灰色斜体、列宽拖动与刷新持久化，并回归 SQL Lab。截图 `docs/_selfcheck/2026-11-19-dataset-column-comments.png`；本机 PostgreSQL 9205 拒绝连接，尚未完成真实库注释联调。
- **迭代**：在“同步物理列”左侧增加“同步注释名称”，后端重新读取数据库注释批量修改字段显示名，不改来源列或数据库列名；跳过空注释、公式字段、重名、超长或非法名称、已有图表引用和脱敏配置，并显示结果原因。整批写入失败回滚；抽屉由 940px 加宽 20% 至 1128px，保留 96vw 限制。后端相关测试 64 项、浏览器 5 项及类型检查通过；真实库批量改名尚未联调。

## 2026-11-18 · 新增：SQL Lab 工作台与虚拟数据集

- **改了什么**：SQL 查询更名为 SQL Lab；采用 CodeMirror SQL 编辑器，支持行号、高亮、表字段补全、表字段树插入和有限结果预览。左右分隔线可拖动并记住宽度，上下分隔线可调整编辑器高度；执行成功后可保存虚拟数据集并进入字段、指标配置。
- **为什么**：打通 SQL 探索到看板取数的流程。按用户要求移除全系统固定表名及前缀白名单，业务表自动发现；继续保留系统内部表保护、只读校验、行级权限、脱敏及查询限制。保存原始 SQL，系统预览限制不写入定义。
- **涉及文件**：SQL Lab 面板及按需加载入口、表目录、查询执行器、安全网关、语义层与字段探测、菜单及权限名称迁移 `050_sql_lab_permission_name.sql`；新增 CodeMirror React 和 SQL 扩展。引入编辑器后总 gzip 约 1178KB，预算从 1075KB 调整到 1250KB；编辑器按需加载，单 chunk 预算保持不变。
- **怎么验证**：后端相关回归 185 项通过、4 项跳过；浏览器覆盖执行、补全、空结果、失败、保存权限、配置跳转和拖动宽度持久化。真实 PostgreSQL 临时表验证虚拟集创建、字段类型、再次查询和失败不留脏记录，外层事务已回滚；截图 `docs/_selfcheck/2026-11-18-sql-lab-workbench.png`。

## 2026-11-18 · 优化：选表接入改为后台导入任务

- **改了什么**：选表确认改为创建导入任务；“已接入表”标题右侧增加任务入口，有运行任务时旋转。弹框显示每表的等待、读取、写入、成功、失败状态与实际行数；已接入及等待/执行中的表固定勾选并禁用，失败后可重新提交。
- **为什么**：避免多表同步被前端 15 秒超时打断，明确部分成功与失败结果，阻止同一源表重复导入。
- **涉及文件**：`sources/import_jobs.py`、数据源路由与仓储、`main.py`、迁移 `048_source_import_tasks.sql`、`DataSources.tsx`、后台与浏览器测试、`docs/help/source-import.md`。
- **怎么验证**：前端 65 项单测、类型检查与生产构建；后端 86 项相关回归；独立 PostgreSQL 容器验证迁移幂等、并发提交去重、跨连接任务互斥、真实读写、整表/日期批次回滚及 HTTP 创建/查询和用户隔离；Chrome 3 项交互检查。临时测试容器已回收，未连接业务数据库。
- **边界**：任务列表显示当前用户的活动任务和最近 20 批结果；每张表超过 200,000 行明确失败，不静默截断。等待任务重启后继续，中断任务核对接入登记后恢复成功或标记失败；不提供暂停或取消执行。

## 2026-11-18 · 新增：Markdown 使用文档与公式测试

- **改了什么**：用户帮助文档统一保存在 `docs/help/*.md`，由 React Markdown 渲染为 `/help/:slug`；增加公式字段用法章节、弹窗说明链接和顶栏通知左侧的文档入口，均在新标签页打开。公式弹窗提供真实后端语法测试，普通列名直接插入，特殊列名保留必要引号。
- **为什么**：让公式写法有可维护的说明来源，测试结果与保存校验使用同一套规则，打开文档时保留未保存的编辑内容。
- **涉及文件**：`docs/help/`、`HelpPage.tsx`、`App.tsx`、`TopBar.tsx`、`DatasetPanel.tsx`、语义层路由及测试、前端依赖与锁文件、Vite 配置、Docker 构建文件。文档目录约定记录在 `docs/AGENTS.md`。
- **怎么验证**：Markdown 渲染与链接单测、公式测试 API 正反例、前端类型检查、生产构建与体积预算；Chrome 使用测试接口数据验证公式测试反馈、新标签页跳转和桌面/手机布局。未连接真实数据库，未构建 Docker 镜像。

## 2026-11-17 · 优化：部署配置收敛为单一 compose.yml

- **改了什么**：保留分角色部署配置为根目录 compose.yml，移除 compose.prod.yml 和单独的开发 Compose；同步 README、AGENTS 和部署指南。
- **为什么**：减少环境入口，本机开发统一使用 uv run dev / npm run dev。
- **涉及文件**：compose.yml、README、AGENTS、docs/统一镜像部署.md、docs/GlitchTip部署指南.md。
- **怎么验证**：Compose 配置解析、前后端与 worker 共用镜像/不同角色/持久化卷核对，文档旧路径扫描与 diff 检查；本次未改应用代码和 Dockerfile。

## 2026-11-17 · 优化：uv 项目管理与生产镜像分角色启动

- **改了什么**：后端改用 pyproject.toml / uv.lock，开发入口 uv run dev（热重载），pytest 独立开发依赖；同一镜像支持 frontend（Nginx 静态资源和代理）、backend、worker、app；开发 compose.yml 与独立生产 compose.prod.yml 分开；同步 CI、Helm、脚本和文档；数据政策与第三方声明移入 docs。
- **为什么**：统一依赖环境，同时保留前后端独立部署与扩容能力。
- **涉及文件**：backend 项目配置、开发入口与测试、根 Dockerfile/Compose、deploy、CI、Vite 代理配置、README、AGENTS 与 docs。
- **怎么验证**：Windows uv 安装与 dev 命令通过，270 条测试通过 / 12 条跳过；Linux 271 条通过 / 11 条跳过。生产/开发镜像实构建、类型检查、构建预算、两份 Compose 独立配置、Helm lint 与两种渲染通过。真实 Nginx 页面/API 代理、Vite 代理、双进程后端登录、uv 热重载、worker COUNT=180 均跑通；断后端页面=200/API=502。截图 docs/_selfcheck/2026-11-17-nginx-role-login.png。修复 bcrypt 4.1.0 Windows 打包问题（最小更新 4.1.1，已验证原密码哈希），兼容 Windows 静态路径；POSIX 假浏览器测试仅在 Windows 跳过，worker 用现有 1 秒轮询避免客户端空闲超时。

## 2026-11-17 · 优化：生产前后端统一镜像

- **改了什么**：根目录多阶段 Dockerfile 构建前端与后端；FastAPI 提供页面与静态文件，保留 API/上传文件 404；Compose、Helm、查询 worker 与 CI 统一镜像配置，Compose 新增上传/报表共享持久化卷。移除旧的分离镜像和 Nginx 配置。
- **为什么**：统一生产版本和部署入口，减少独立服务配置；空库实测发现授权迁移先于权限码初始化，已在共享迁移入口先补权限定义，角色种子仍在迁移后执行。
- **涉及文件**：Dockerfile、.dockerignore、backend/app/frontend.py、main.py、bootstrap.py、tests/test_frontend.py、Compose、Helm、CI、README、AGENTS 与 docs/统一镜像部署.md。
- **怎么验证**：统一镜像实构建成功；页面服务与探针 7 条测试通过；UI 规范/类型检查、前端构建与预算通过（JS gzip 970KB）；Compose 默认/生产配置及 Helm lint、两种渲染通过；真实空库 44 条迁移完成、重启保留手工授权调整；断库 readyz=503、livez/登录页=200；登录页截图存 docs/_selfcheck/2026-11-17-unified-image-login.png。CI 已补空库启动门禁。

## 2026-11-17 · 优化：统一文档名称与存放路径

- **改了什么**：更新日志移至根目录 `CHANGELOG.md`；仓库规范更名为 `docs/仓库与发布规范.md`；方案与缺口清单归入 `docs/plans/`；原 `TEST.md` 移为 `docs/测试占位记录.md`，保留占位原文。
- **为什么**：简化 docs 层级，统一文档入口，不按功能拆目录。
- **涉及文件**：README、AGENTS、COPYRIGHT 及迁移文档；同步更新当前路径引用，历史更新记录不改。
- **怎么验证**：核对迁移前后正文、根目录保留文件、README 本地文件链接及旧路径引用；仅文档调整，不涉及应用界面与代码。

## 2026-11-16 · 优化：`npm run dev` 默认按账号选端口

- **改了什么**：`frontend/package.json` 的 `dev` 改为 `bash dev.sh`；无参数时自动按 Unix 账号选端口，带参数时仍可手动覆盖；保留 `dev:me` 别名与 `dev:base` 原始入口。
- **为什么**：AI/开发者习惯直接执行 `npm run dev`，如果仍固定 5300，会绕过账号端口映射。
- **涉及文件**：`frontend/dev.sh`、`frontend/package.json`、`AGENTS.md`。
- **怎么验证**：`npm run dev` 输出 `http://localhost:<账号端口>`；`npm run dev -- --port 5300` 仍可手动覆盖。

## 2026-11-16 · 优化：前端按账号自动选端口并自动转发

- **改了什么**：新增 `frontend/dev.sh` 与 `npm run dev:me`，按 Unix 账号选择 5300-5380 端口；提交 `.vscode/settings.json`，自动转发 5300-5399 并在可用时打开浏览器。
- **为什么**：多人共用一台开发机，手动 `--port` 和手动转发容易用错端口，出现「localhost 打不开」。
- **涉及文件**：`frontend/dev.sh`、`frontend/package.json`、`.vscode/settings.json`、`.gitignore`、`AGENTS.md`。
- **怎么验证**：`npm run dev:me` 输出 `http://localhost:<账号端口>`；VS Code/TRAE 端口面板出现该端口；浏览器能打开。

## 2026-11-16 · 修复：组件库种子启动即失败（词云 spec 取不存在的 chart 键）

- **改了什么**：`seed_base.BASE` 里词云那项 `"chart": {**_spec("词云")["chart"], ...}` 改为 `"chart": {"cloud_palette": "潮彩"}`。
- **为什么**：`_spec()` 返回的 spec 没有 `chart` 键，模块导入时就抛 `KeyError: 'chart'`，被 `bootstrap.ensure_components`
  的 `except` 吞成「组件库种子跳过」—— 结果 `bi_component` 为空，组件库与右侧「图表类型」栏一张卡都没有（静默失效）。
- **涉及文件**：`backend/app/components/seed_base.py`。
- **怎么验证**：`ensure_components()` 返回 `base_components=23`；`select count(*) from bi_component where archived=false` = 23；
  `GET /api/bi/components` 返回 23 条；页面类型栏可拖出组件。

## 2026-11-14 · 新增：AI 接口鉴权（MCP 方案 S0）

- **背景**：`/api/bi/engine/ai/*` 这一整组端点（nl_to_sql / gen_chart / interpret / generate_screen / pipeline…）
  多数连 `get_current_user` 都没有，路由也没有全局鉴权依赖 —— **不登录就能调用**，等于把 AI 与部分数据能力裸露在公网。
  在 MCP 网关和编辑器 AI 上线前必须先把这个洞补掉（`docs/MCP与Agent权限接入方案.md` §14 / S0）。
- **改法**：
  1. 新增 AI 能力权限码 `bi:ai:use / bi:ai:sql / bi:ai:export`（`admin/permissions.py` 的 `AI_PERMISSIONS`，
     与「管理后台分区」分开：有 AI 权限不会因此进入管理后台），同时登记进 `rbac_seed.PERMISSIONS`；
  2. `bi_engine.py` 里 **36 个 AI 端点**统一挂 `dependencies=[Depends(require(...))]`：
     `nl_to_sql / optimize_sql / auto_model` 归 `bi:ai:sql`（高危），其余归 `bi:ai:use`；
     `require()` 现在支持自定义拒绝文案，AI 侧返回「没有 AI 使用权限，请联系管理员开通」；
  3. 迁移 `046_ai_permissions.sql` 一次性回填，保证现有功能不中断：除访客外所有角色补 `bi:ai:use`；
     已有 `bi:nav:sql` 的角色补 `bi:ai:sql`（当前库无此角色，等于默认关闭）；
  4. `scripts/admin_permission_matrix.py` 增加 8 项 AI 用例（匿名 / 无权限 / 有权限 / 缺 SQL 权限 / 回填结果）。
- **涉及文件**：`backend/app/admin/permissions.py`、`backend/app/services/rbac_seed.py`、
  `backend/app/routers/bi_engine.py`、`backend/schema/migrations/046_ai_permissions.sql`、
  `scripts/admin_permission_matrix.py`。
- **验证**：
  - `curl /api/bi/engine/ai/audit`（不带 token）→ 403；`/auth/me` 的 `effective_permissions` 含三个 `bi:ai:*`；
  - 矩阵脚本 `197/197 通过`（原 189 + 新 8）；
  - `backend/.venv/bin/python -m pytest -q` 全绿（278 项）；
  - 管理员 `POST /ai/analyze` 仍 200（前端「AI 分析」按钮不受影响）。
- **注意**：访客角色被排除回填 —— AI 分析对访客不再可用（按方案 §3「访客禁 AI」）；
  如需恢复，在「管理后台 → 角色权限」给对应角色勾上即可。

---

## 2026-11-14 · 新增：管理后台（权限 / 用户 / 模型 / 错误日志 / 运维）

- **背景**：用户从「我的看板」右上角的账号菜单指出入口位置，要求加一个「管理后台」：
  核心是权限分配、用户管理、模型配置、报错日志、运维；布局与配色跟项目主页保持一致（左侧菜单 + 头标卡 + 白卡）。
- **改法**：
  1. **入口**：账号下拉新增「管理后台」（在「退出登录」上方）→ `/bi/admin`；只有管理员或**已被授予任一管理权限**的账号看得到。
     后台页复用 `BiSideNav`（新增 `subtitle` / `footerExtra` 两个可选参数，看板页参数不变）与同一套头标卡 / 白卡，
     六个分区：概览 · 用户管理 · 角色权限 · 模型配置 · 错误日志 · 运维。
  2. **权限模型**（`backend/app/admin/permissions.py`）：新增 6 个权限码
     `bi:overview / bi:user:manage / bi:role:manage / bi:model:manage / bi:error:view / bi:ops:manage`，
     落在既有 `permissions` + `role_permission` 表；管理员直通，其余按「角色 → 权限」**每次请求现算**（不信 JWT 旧快照）。
     每个 `/api/admin/*` 分区各自 `require(code)`，前端侧栏按同一批权限码显隐。
  3. **用户管理**：列表（搜索 / 角色 / 状态筛选）+ 新建 + 编辑资料 + 重置密码 + 停用/启用。
     防呆：不能停用自己、不能取消自己的管理员角色、不能关掉最后一个启用的管理员；
     停用与重置密码都会推进 `token_version`，该账号旧会话立即失效。
  4. **角色权限**：左侧角色列表（含成员数），右侧权限矩阵（管理后台分组置顶，历史模块权限折叠），勾选保存即生效；
     内置管理员角色锁定为全部权限；非系统角色可建可删（还有人在用时拒绝删除）。
     **修复**：`rbac_seed.seed_roles` 原来每次启动都无条件覆盖 `role.permissions`，配好的权限一重启就被冲掉 ——
     改成只在角色首次创建时写默认权限，否则「权限分配」是花架子。
  5. **模型配置**：新表 `bi_ai_model`（迁移 `033_ai_models.sql`），Key 走 `services/crypto` 加密存储、接口只回掩码；
     支持供应商预设、温度 / 最大 Token、启用、设为默认（唯一索引兜底）；「测试连接」是**真实请求** `chat/completions`，
     结果写回上次测试状态。新增 `app/services/ai_models.py` 统一解析默认模型：**库表 > data/ai_models.json > 环境变量**，
     `bi_engine._load_default_llm()` 与 `bi_ai_engine._call_llm()` 都改为从这里取，老部署行为不变（没有库配置就往下回退）。
  6. **错误日志**：复用 `GET /api/bi/errors`（鉴权从「仅管理员」放宽到 `bi:error:view`），表格 + 来源/级别筛选 +
     详情抽屉（完整堆栈 / UA / 附加信息）+ 按保留天数清理。
  7. **运维**：`GET /api/admin/ops` 聚合进程指标（查询成功/失败/超时、渲染缓存命中率、连接池、Redis、后台任务间隔、
     慢查询采样）；维护操作只做安全动作：**清空渲染缓存**、**清理过期错误日志**。
  8. **身份回填**：`/api/auth/me` 增加 `effective_permissions`；前端 `AuthContext.hasPerm` 原来是恒 `true` 的空实现，
     改成按管理员 / 权限码真实判断（否则入口与页面守卫形同虚设）。
- **涉及文件**：
  - 后端：`app/admin/{__init__,permissions,router}.py`（新增）、`app/services/ai_models.py`（新增）、
    `schema/migrations/033_ai_models.sql`（新增）、`app/main.py`、`app/services/rbac_seed.py`、`app/routers/auth.py`、
    `app/schemas/user.py`、`app/errors/router.py`、`app/routers/bi_engine.py`、`app/services/bi_ai_engine.py`。
  - 前端：`pages/AdminPage.tsx`（新增）、`features/admin/{shared,OverviewPanel,UsersPanel,RolesPanel,ModelsPanel,ErrorsPanel,OpsPanel}.tsx`（新增）、
    `features/bi-dashboard/BiSideNav.tsx`、`components/layout/TopBar.tsx`、`contexts/AuthContext.tsx`、`types/index.ts`、`App.tsx`。
- **怎么验证**（本机真机，2026-11-14，截图见 `docs/_selfcheck/管理后台-*.png`）：
  - 正例（真实点击链路）：头像菜单出现「管理后台」→ 点进 `/bi/admin`；新建用户「验收用户」出现在列表 → 停用后状态变「停用」；
    新建角色 `qa_role` → 勾「错误日志」→ 保存 → 刷新后仍勾着；新建模型 → 点「测试连接」返回真实失败
    （`请求失败：HTTPConnectionPool ...`）→ 保存出卡片 → 删除后消失；「清空渲染缓存」有提示；错误行点开有详情抽屉。
  - 反例（权限真实生效）：给临时账号只有 `bi:error:view` 的角色后，
    `/api/admin/overview|users|roles|models|ops` 全部 **403**、`/api/bi/errors` **200**；
    该账号进管理后台只见「错误日志」、无「清理」按钮；无任何权限的账号头像菜单**没有**入口，直接访问 `/bi/admin` 显示「没有管理后台权限」。
  - `npx tsc --noEmit` 通过、`vitest` 52 passed、`bash scripts/ui_rules.sh` 通过；临时用户 / 角色 / 模型验证完已从库里删除。
- **已知边界**：模型配置只影响「AI 生成看板 / 自然语言」这条链路，图表渲染与查询不依赖模型；
  运维页数字是**当前进程**口径（多 worker 时各进程独立），且维护操作不删业务数据。
- **迭代（2026-11-14）· 部门**：用户管理新增「部门管理」（部门清单含成员数，可添加 / 改名 / 删除；
  有人在的部门会拒删并提示先调走成员）；用户列表补「部门」列与部门筛选（含「未分配」）。
  注册页新增**必选**部门下拉，选项来自公开的 `GET /api/auth/departments`（只有 id + 名称），
  `UserCreate` 增加必填 `department_id`，注册服务校验部门存在（无效部门 409、不传 422）。
  迁移 `034_departments.sql` **只在部门表为空时**灌入 11 个默认部门
  （拼多多 / 天猫 / 客服 / 财务 / 人事 / 产品 / 市场 / 供应链 / 品牌 / AI / 股东高层），之后用户的增删改不会被覆盖。
  涉及：`backend/app/schemas/user.py`、`services/auth.py`、`routers/auth.py`、`admin/router.py`、
  `schema/migrations/034_departments.sql`、前端 `pages/LoginPage.tsx`、`api/auth.ts`、`contexts/AuthContext.tsx`、
  `features/admin/UsersPanel.tsx`。
  验证：不选部门注册 → 422；选「AI部门」注册成功且落库 `department_id`（psql 核对）；
  管理后台加部门 / 改名 / 删空部门成功，删有人的部门 → 400「还有 1 个用户在该部门」；
  按「AI部门」筛选只出该部门的人；1440×900 下注册卡片底部 738px < 视口 900px，不溢出、不遮挡。
- **迭代（2026-11-14）· 注册审批**：注册不再直接生效 —— 账号写 `approval_status=pending` + `is_active=false`，
  接口**不签发 token**（前端只拿到「申请已提交」提示并留在登录页），登录被拦：
  待审批 → 「注册申请待审批，审批通过后即可登录」；被驳回 → 带驳回原因。
  新增管理后台「注册审批」分区（权限码 `bi:user:approve`）+ **部门负责人审批**：
  `departments.leader_id` 在「用户管理 · 部门管理」里给每个部门选负责人，负责人只能看到/审批**自己部门**的申请
  （后端按部门过滤，越权返回 403），管理员可审批全部；负责人侧栏只出现「注册审批」这一个分区，
  顶栏账号菜单的「管理后台」入口对负责人也放开（之前只认权限码，纯负责人会被挡在门外）。
  顺带修：已删除用户的缓存 token 不再被伪造成登录态（`_dict_to_user` 查不到人直接 401），
  概览页新增「待审批注册」计数，长报错文案不再把卡片撑出横向滚动。
- **迭代（2026-11-14）· 通知里审批 + 收紧管理后台入口**（用户要求）：
  1. 顶栏铃铛（原「告警通知」）升级为「通知」：审批人的通知里新增「注册审批」分块，
     直接显示申请人 / 部门 / 时间，**在通知里就能通过或驳回**（驳回可填原因），未读数 = 未读告警 + 待审批；
     管理员的「全部」跳转到后台「注册审批」页，部门负责人只在这里处理（没有后台入口）。
  2. **普通用户没有「管理后台」**：入口只给管理员或明确授予 `bi:*` 权限的账号；
     部门负责人不再占后台名额（这正是之前「小宝是普通用户却看到管理后台」的原因），
     其审批能力只体现在通知里；`/bi/admin` 对纯负责人也显示无权限。
  3. 身份信息回到窗口时静默刷新（60s 节流）：管理员改了权限 / 负责人 / 停用账号后，不用退出重登即可生效。
  涉及：`frontend/src/components/layout/TopBar.tsx`、`contexts/AuthContext.tsx`、`pages/AdminPage.tsx`。
  验证：负责人（小宝）通知里看到 2 条待审批 → 点「通过」后列表移除、库里 68 变 `approved`；
  头像菜单**不再出现**「管理后台」、直接访问 `/bi/admin` 显示无权限；管理员从通知里驳回 69 → 状态 `rejected` 且原因落库。
- **迭代（2026-11-14）· 权限真实生效（安全加固 + 可复跑矩阵）**：用户明确要求「权限必须真实生效，权限隔离要反复测」。
  新增 `scripts/admin_permission_matrix.py`：准备 10 类账号（普通 / 仅概览 / 用户管理 / 角色管理 / 错误日志 / 运维 /
  模型 / 审批 / 部门负责人 / 管理员），对**全部管理接口**做 95 项断言，覆盖越权、自我提权、横向越权与会话失效，跑完自动清场。
  1. **越权**：普通用户访问任何 `/api/admin/*` 与 `/api/bi/errors` 全 403；只拿到单一权限的账号只能进对应分区
     （界面侧栏同步只见该分区，深链 `?tab=users` 会回落到允许的分区，后端仍 403）。
  2. **提权（已修）**：非管理员不能修改管理员账号（改密 / 停用 / 降级 / 改资料，防接管）；只有管理员能授予管理员角色；
     非管理员分配角色、授出权限都不能超过自己已拥有的集合；角色管理员不能改自己所属角色、不能删自己的角色、不能改 admin 角色。
  3. **横向**：部门负责人只能审批本部门注册（跨部门 403，「未分配」也拒绝）；审批状态机不接受重复处理。
  4. **会话失效（实测缺口，已修）**：改密 / 停用 / 审批推进 `token_version` 后只写了库、没清 `user:<id>` 鉴权缓存，
     `get_current_user` 命中缓存里的旧版本号 → 旧 token 还能继续用最多 10 分钟（矩阵断言 401 实测 200）。
     现在所有 `token_version` 变更点统一 `cache_delete(user:<id>)`，矩阵复测 401 正确。
  涉及文件：`backend/app/admin/router.py`、`scripts/admin_permission_matrix.py`（新增）。
  验证：矩阵 **95/95** 连续 3 轮全绿（每轮自动建号 / 断言 / 删号）；UI 实测「仅错误日志」账号侧栏只有该分区、
  深链不越权；普通用户头像菜单无「管理后台」、直接访问 `/bi/admin` 显示无权限。
  跑法：`DATABASE_URL=... backend/.venv/bin/python scripts/admin_permission_matrix.py`（需后端在跑，退出码非 0 即失败）。
- **迭代（2026-11-14）· 部门级管理员范围**（用户要求：管理员 + 部门决定后台范围）：
  * **全后台**：`role=admin` 且部门是 **IT运维 / 股东高层**（`departments.is_global_admin=true`），或没有部门的账号 → 全部 7 个分区；
  * **部门管理员**：其它部门的 admin → 只有「概览 / 用户管理 / 注册审批 / 角色权限」，且只能管**本部门**的人、审批与角色配置。
  「部门自建角色」里的账号即使不是 admin，也只在**角色所属部门**内生效（防止部门管理员造一个带用户管理权限的角色把人变成全站管理员）。
  实现：迁移 `036_admin_department_scope.sql` 新增 `departments.is_global_admin` 与 `roles.dept_id`；
  `admin_scope()` 统一判定范围，`require() / has_permission / effective_permissions` 按范围收窄
  （部门管理员的 `/auth/me` 只下发 4 个权限码，界面分区自动只剩四块，后端对模型/错误/运维一律 403）；
  用户列表 / 建号 / 改号强制本部门（筛选别的部门 403，建号自动落到本部门）；注册审批范围 = 本部门；
  角色：部门管理员只能改本部门创建的角色（系统与全局角色只读），最多授出四块分区权限、不能授 admin 角色、
  也不能授模型/错误/运维这类全局权限；部门增删改与「全后台」标记只有全局管理员能做。
  验证：权限矩阵扩到 **144 项**（新增部门管理员 / 全局部门管理员 / 部门操作员三组），连跑 2 轮 144/144；
  UI 实测部门管理员（拼多多）侧栏只有四块、用户列表只有本部门、无「部门管理」按钮、深链 `?tab=models` 回落；
  全局管理员（admin 在 IT运维）仍是 7 个分区，「部门管理」里 IT运维 / 股东高层 带「全后台」标记。
  涉及：`backend/schema/migrations/036_admin_department_scope.sql`、`admin/{permissions,router}.py`、`models/rbac.py`、
  `routers/auth.py`、`schemas/user.py`、前端 `pages/AdminPage.tsx`、`features/admin/{UsersPanel,RolesPanel,OverviewPanel,RegistrationsPanel}.tsx`、
  `types/index.ts`、`scripts/admin_permission_matrix.py`。
- **迭代（2026-11-14）· 业务入口权限（菜单可见性 + 接口拦截）**（用户要求：数据集/数据源/SQL/组件库/编辑设计可以按角色开关）：
  1. 新增 5 个业务入口权限码：`bi:nav:datasets / bi:nav:datasources / bi:nav:sql / bi:nav:components / bi:nav:editor`，
     在「角色权限」里单独成组「业务入口」，勾选即保存。
  2. **默认值**：管理员（含部门管理员）默认全部入口；普通角色默认只有「我的看板 / 模板库 / 我的团队」；
     **IT运维部门默认开 SQL 查询**（`departments.default_permissions`，迁移 037，权限与角色权限取并集）。
  3. 前端：左侧菜单按权限过滤；直接输入 `/bi/components`、`/bi/projects`、`/bi/canvas` 会显示无权访问；
     `?view=datasets|datasource|sql` 这类深链没权限会自动回落到「我的看板」；看板卡片菜单里的「编辑」也会隐藏。
  4. 后端（真实生效，不是只藏菜单）：SQL 执行 `POST /bi/engine/query`、数据源增删改/测试/同步/上传、
     数据集与字段/指标/安全规则/模型导入的写操作、组件库的增删改、看板的建/改/删 —— 没有对应入口权限一律 **403**。
     **共享读接口（数据集列表、字段列表、组件预览/渲染、看板渲染）保持开放**：编辑画布和看板查看都依赖它们，拦了会弄坏主链路。
  涉及：`backend/app/admin/permissions.py`、`services/rbac_seed.py`、`schema/migrations/037_department_nav_defaults.sql`、
  `security/nav_guard.py`（新增）、`sources/router.py`、`semantic/{router,router_items}.py`、`components/router.py`、
  `dashboards/router.py`、`routers/bi_engine.py`；前端 `features/bi-dashboard/BiSideNav.tsx`、`pages/BiDashboardPage.tsx`、`App.tsx`、
  `features/admin/RolesPanel.tsx`。
  验证：权限矩阵扩到 **160 项**（新增 5 类入口账号 + IT运维默认账号），连跑 2 轮 160/160；
  UI 实测：普通成员侧栏只有 3 项、直接开组件库/编辑设计无权、深链 view=datasets 回落；
  IT运维普通账号侧栏有「SQL 查询」；混合角色只显示勾选的两项；管理员 8 项全有。
- **新增（2026-11-14）· MCP × Agent 权限接入方案**：按「BI+AI+MCP+Agent 全权限架构」参考文档，
  对齐本仓库现有 RBAC + 数据范围 + 数据集行列权限 + RLS，整理出《MCP与Agent权限接入方案》
  （`docs/MCP与Agent权限接入方案.md`）：七层鉴权对照、新增权限码、MCP 工具目录（高危默认关闭）、
  用户代持令牌流程、6 张新表、部门数据隔离落点、P0-P4 阶段与安全验收清单。本次只出方案，未改运行代码。
- **优化（2026-11-14）· 头标卡右上角按身份显示「用户 + 权限 + 部门 + 职位」**：
  管理员显示 `admin + 管理员 + IT运维 + 总监`；普通用户显示 `小宝 + AI部门 + 主管`（不再只显示用户名+职位）。
  `/auth/me` 新增 `department_id / department_name`；头标卡按 用户名 → （管理员）→ 部门 → 职位 顺序渲染胶囊标签。
  验证：两种身份实测标签正确；pytest / tsc / vitest 全绿。
- **恢复（2026-11-14）· 用户列表恢复「权限 / 职位 / 部门」三列**（此前尝试把权限并入用户名，用户指出理解有误）：
  表格恢复为 用户 / 邮箱 / 权限 / 职位 / 部门 / 状态 / 创建时间；权限列显示「管理员 / 普通用户」，
  职位列为 总监 / 经理 / 主管 / 员工。新建/编辑弹窗保持「权限 + 职位 + 部门」三个选择。
- **修复 / 优化（2026-11-14）· 后台头标卡显示「职位」**：
  头标卡右上角标签原来显示「部门管理员 / 管理员」这类权限描述，现改为显示**职位**（总监 / 经理 / 主管 / 员工），
  副标题去掉「部门管理员：」前缀。同时修复 `User` ORM 模型漏加 `account_type / position` 字段的问题
  （此前 `/auth/me` 这两个字段一直是默认值，导致头标/列表显示不准）；数据库列早已存在，补模型后生效。
  验证：admin 头标「总监」、小宝头标「主管」；权限矩阵 / pytest / tsc / vitest 全绿。
- **优化（2026-11-14）· 角色列表按职级从高到低排序**：新增 `roles.sort_order`（迁移 045），
  管理员 100 / 总监 90 / 经理 80 / 主管 70 / 员工 60 / 访客 50；`GET /admin/roles` 与角色权限页都按
  `sort_order DESC, id` 返回，不再依赖创建顺序。自定义角色默认 0，排在内置角色之后。
  验证：接口顺序 = admin, director, dept_manager, manager, member, viewer；UI 角色面板按此顺序展示。
- **优化（2026-11-14）· 职位名称精简为「员工 / 主管 / 经理 / 总监」**（用户要求更简洁）：
  用户管理「职位」下拉与列表统一为 员工、主管、经理、总监；对应岗位角色名同步改为 员工/主管/经理/总监
  （`044_simplify_position_names.sql`），权限与数据范围不变。验证：列表显示 admin 总监、小宝 主管、顺顺 员工；
  权限矩阵 189/189 全绿。
- **新增（2026-11-14）· 部门领导可管理本部门（系统级仍归管理员）**（用户明确的基本逻辑）：
  **管理员管系统级（模型配置 / 错误日志 / 运维 / 部门树 / 全部部门），部门领导管本部门（用户 / 角色权限 / 审批 / 概览）。**
  `manager / dept_manager / director` 三个岗位角色补上 `bi:overview / bi:user:manage / bi:user:approve / bi:role:manage`
  （数据范围仍是「本部门及下级」，只能作用于自己部门）：部门领导现在能在管理后台看到「概览 / 用户管理 / 注册审批 / 角色权限」，
  用户列表只出本部门、只能在本部门建号；能建本部门角色并分配给本部门成员，但**不能**改部门树、不能访问模型/错误/运维、
  不能建「全部部门」范围角色、不能跨部门操作（均 403）。
  迁移 `043_dept_leader_permissions.sql`；验证：权限矩阵扩到 **189/189** 全绿；UI 实测部门领导后台只有四块、用户列表只有 AI部门、
  无「部门管理」按钮、角色页系统角色只读但可新建本部门角色。
- **重构（2026-11-14）· 用户管理拆成「权限 / 职位 / 部门」**（用户要求对齐企业规范）：
  用户属性不再用一个「角色」混在一起，改为三个维度：
  * **权限（账号类型）**：管理员 / 普通用户（`users.account_type`）；
  * **职位**：普通成员 / 部门主管 / 部门经理 / 部门总监（`users.position`），并新增「部门经理」「部门总监」两个岗位角色；
  * **部门**：组织归属（不变）。
  用户管理列表显示「权限 | 职位 | 部门」，筛选改为按职位；新建/编辑弹窗改为选「权限 + 职位 + 部门」。
  后端把 权限/职位 映射到权限角色（管理员→admin；普通用户按职位→ member/manager/dept_manager/director），
  权限细节仍可在「角色权限」页调整；`users.role` 继续作为权限载体，历史数据已回填。
  迁移 `042_user_position.sql`（account_type / position + 两个岗位角色 + 回填：admin→管理员/总监、manager→主管）。
  验证：用户列表三条记录显示正确（admin 管理员/部门总监、小宝 普通用户/部门主管、顺顺 普通用户/普通成员）；
  权限矩阵 **179/179** 全绿；pytest / tsc / vitest 全绿。
- **修复（2026-11-14）· 删除「IT运维」角色**（用户指出：IT运维是部门，不是角色）：
  上一轮为标准模型补充的 `it_ops` 角色与「部门默认角色」（`departments.default_role_code`）属于过渡设计，不符合岗位角色口径。
  现删除该角色、移除部门默认角色机制（迁移 `041_remove_it_ops_role.sql`，列一并删除），注册统一为普通成员；
  内置角色只保留 **管理员 / 部门主管 / 普通成员 / 访客** 四个岗位角色，部门只承载组织树、负责人、数据范围与审批归属。
  需要 SQL 入口的人，按角色勾「业务入口 → SQL 查询入口」即可。验证：角色列表只剩 4 个；权限矩阵 **179/179** 全绿。
- **重构（2026-11-14）· 权限模型标准化：RBAC + 数据范围 + 部门树**（用户要求按企业级规范重做）：
  此前是「role=admin + 部门标记 + 主管自动审批 + 显式权限」四套规则叠在一起，边界互相覆盖。现在统一为：
  * **角色 = 功能权限 + 数据范围**：`roles.data_scope` ∈ `all / dept_and_children / dept / self`；
    管理后台分区由权限码决定，数据可见范围由数据范围决定（用户 / 部门 / 注册审批列表全部按范围过滤）。
  * **部门 = 树 + 负责人**：`departments.parent_id`（可空，兼容平级），`dept_and_children` 用递归 CTE 覆盖下级；
    负责人自动获得自己负责部门及下级的审批范围。
  * **审批 = 审批权限 × 数据范围**：`all` 可审全部；`dept / dept_and_children` 只审覆盖范围；`self` 不能审批；跨部门 403。
    股东高层「全审」改为给该部门的人一个数据范围=全部的角色，不再有部门特例字段。
  * **移除部门特例**：`is_global_admin / approves_all_registrations / departments.default_permissions` 停止读取（列保留）；
    新增 `departments.default_role_code`（入职默认角色，如 IT运维 → `it_ops`，权限仍只配在角色上）。
  * **UI**：「角色权限」加「数据范围」下拉与范围标签；「部门管理」每行可设上级部门；用户/审批按范围过滤。
  迁移：`039_rbac_data_scope.sql`（data_scope + parent_id + 内置角色范围 + manager 审批权限）、
  `040_department_default_role.sql`（部门默认角色 + it_ops）；种子角色同步 data_scope。
  验证：权限矩阵重构后 **182/182 全绿**（新增「部门管理员不能建全部范围角色 / 不能改自己角色范围」等）；
  UI 实测角色页数据范围可选、部门页可设上级；pytest / tsc / vitest 全绿。
- **新增（2026-11-14）· 注册审批按部门隔离**（用户定的规则）：
  注册时填的哪个部门，就由**该部门主管级别以上**（`role=manager/admin/super_admin`）或该部门负责人审批；
  跨部门一律 403。特例：**股东高层部门的主管以上**可审批所有部门（部门标记 `approves_all_registrations`，迁移 038，不写死部门名）；
  股东高层的普通成员没有审批权。主管以上即使额外被授予「注册审批」权限，也仍只审本部门（避免跨部门）；
  非主管但被显式授权「注册审批」的账号保持全量（管理员主动委托）。
  配套：`/auth/me` 新增 `approval_scope`（all / department / 空），管理后台侧栏底部显示「审批范围 · 全部部门 / 本部门」；
  主管以上现在也能看到「管理后台 → 注册审批」以及顶栏通知里的审批块（之前只有负责人/管理员）。
  验证：权限矩阵扩到 **180 项**（新增部门主管本/跨部门、股东高层主管全量、股东高层普通成员拒绝、审批范围字段），全绿；
  UI 实测：拼多多主管通知/后台只见拼多多申请；股东高层主管看到天猫+拼多多；股东高层普通成员无审批入口。
- **修复（2026-11-14）· 清理角色权限里的「知识库」等旧模块权限**（用户反馈：BI 项目根本没有知识库功能）：
  角色权限页此前把旧项目脚手架留下的 `kb:* / teamspace:* / user:* / system:*` 权限码全列了出来，
  勾了也不会有任何功能响应 —— 等于假配置。现在：
  * 权限目录只回 **管理后台 7 个分区 + 业务入口 5 个入口**（`VISIBLE_PERMISSION_CODES` 唯一白名单），
    「其他模块权限」整块不再出现；
  * 角色的已存权限也按白名单过滤展示，保存时自动丢掉旧码（不删库，只是不再展示/生效）；
  * 内置角色种子默认权限同步清掉旧模块（manager = 概览 + 错误日志，member / viewer = 空）。
  验证：`GET /admin/permissions` 只回 12 个 `bi:*`；角色权限页「知识库 / 团队空间 / 其他模块权限」均不再出现；
  权限矩阵新增「目录不含旧模块权限」断言，全绿；pytest / tsc / vitest 全绿。
- **迭代（2026-11-14）· 管理后台入口按权限开放**（用户纠正：不是只有管理员才有后台）：
  「管理后台」入口改为 **管理员 / 被授予任一后台分区权限 / 部门负责人** 都能看到，
  进去只展示他被授权的分区（概览、用户管理、注册审批、角色权限、模型配置、错误日志、运维）；
  **业务入口权限（`bi:nav:*`）不算后台权限**，只有 SQL/数据集入口的账号不会看到进不去的后台；
  部门负责人即使没有权限码，也能进后台「注册审批」（后端仍按部门限制范围），侧栏底部显示「负责部门 N」。
  验证：UI 实测「仅错误日志」账号 → 入口有、只有错误日志分区；部门负责人 → 入口有、只有注册审批；
  「仅 SQL」账号 → 无入口、直接访问 /bi/admin 显示无权限；管理员 → 7 个分区全有。
  管理员在后台「新建用户」视为已通过；驳回可填原因，被驳回账号由管理员重新启用时自动转「已通过」。
  登录顺序也调整为先验密码再报账号状态（避免用错误密码探测「账号存在且待审批 / 被禁」）。
  涉及：`backend/schema/migrations/035_registration_approval.sql`、`models/user.py`、`models/rbac.py`、
  `services/auth.py`、`routers/auth.py`、`schemas/user.py`、`admin/{permissions,router}.py`、`services/rbac_seed.py`；
  前端 `api/auth.ts`、`contexts/AuthContext.tsx`、`pages/LoginPage.tsx`、`pages/AdminPage.tsx`、
  `features/admin/{RegistrationsPanel,UsersPanel}.tsx`、`types/index.ts`。
  验证：注册后 `access_token` 为空、登录 401「待审批」；管理员审批后登录 200；
  驳回后登录 401 且带原因「部门信息不符，请补充」；把部门负责人设为 A 后，A 只看到本部门 1 条申请、
  跨部门审批 403「只能审批自己负责部门的申请」、侧栏只有「注册审批」；非审批人（小宝）→ 403。

---

## 2026-11-14 · 新增：每日 9:00 异常日报（自动分析 → Excel 表格 → 归档）

- **背景**：异常面板已经能读，但需要人每天去翻、自己归类、想方案；希望每天 9 点自动出一份「今天有哪些问题、
  怎么解决」的表格发到会话里，并在项目里留档。
- **改法**：
  1. 新增 `scripts/glitchtip_daily_report.py`（用 `backend/.venv/bin/python`）：拉 GlitchTip 最近 N 小时出现过的异常，
     按「接口 / 前端位置 / 异常类型」归并；内置规则库给出 **P0~P3 + 原因判断 + 解决方案 + 验证方式**；
     输出 Excel（概览 / 问题清单 / 异常明细 / 说明）、Markdown 与原始 JSON；
     支持 `--analysis analysis.json` 覆盖规则结论（Agent 研判），也支持空窗口（只输出「今日无新增」）。
  2. 新建资料夹 `docs/异常日报/`（已 gitignore：报告含堆栈与请求信息，不入库）。
  3. DSH 定时任务「生成异常日报」：每天 **09:00（Asia/Shanghai）** 触发 → 跑脚本 → Agent 研判 → 用 `present` 把 Excel 发到会话。
- **涉及文件**：`scripts/glitchtip_daily_report.py`（新增）、`.gitignore`、`AGENTS.md`、`docs/更新日志.md`。
- **怎么验证**（2026-11-14 真实生成）：
  - 今日报表：5 组问题 / 46 条异常 / 92 次事件 / 未解决 0；Excel 4 个 sheet、13KB，含 P0 连接池与接口超时、
    P1 图表竞态、P2 端口占用、P3 测试噪音；
  - `--analysis` 覆盖验证：研判结论与结论字段成功写入 MD/Excel；
  - 定时任务已建（`schedule_list` 可查，next run 2026-11-15 09:00）；
  - 报告仅写 `docs/异常日报/` 与 `/tmp`，不改业务数据；事件文本按不可信数据处理。

---

## 2026-11-14 · 修复：连接池被后台线程泄漏（异常面板 40 条 500 的根因）

- **背景**：GlitchTip 里 46 条未解决异常，其中 40 条都是 `GET /api/bi/alerts/events` 500（30–90s）。
  根因不在告警接口：5 分钟后台线程对**视图**查 `updated_at` 报错，异常被吞且不回滚，连接停在 aborted 事务里不归还，
  连接池被慢慢吃满，所有接口一起等 30s。
- **改法**：
  1. `bi_engine._refresh_once()`（从后台线程拆出的可调用入口）：只对 `information_schema` 里有 `updated_at`
     的表做增量，视图 / `bi_demo_sku` 跳过；每张表独立 commit/rollback，失败不再影响后续表；
     物化视图先查 `pg_matviews` 再刷新（`ACCEL_MAP` 按白名单拼的 `*_agg` 多数并不存在）。
  2. `sync_table`：视图增量提前返回 **400**（明确文案），失败先 `rollback()` 再写失败日志，原始错误不再被覆盖。
  3. `database.py` 慢查询计时：每条语句覆盖起点，请求中途被取消不再产生假的 600s / 784s「慢查询」。
  4. `main.py`：`sqlalchemy.exc.TimeoutError` → **503 + Retry-After: 2**，不写 `bi_error_log`、不刷 Sentry；
     `/api/metrics` 的 `database.pool_timeouts` 计数（60s 首次日志）。连接池耗尽是可恢复容量事件，不应变成 500 风暴。
  5. 前端 `TopBar` 轮询：后台标签页不轮询、focus 与定时器不叠加、失败指数退避（60s→最长 10min）、单次 12s 超时。
  6. 图表 12 处去掉 `lazyUpdate`（与 `notMerge` 组合会在 mouseout 时引用已被替换的 series，
     触发 `getRawIndex` 崩溃）；`echarts-for-react` 的其余参数不动。
  7. GlitchTip 面板：3 条测试 / 环境噪音（PROJECT-1 上报验证、PROJECT-2 端口占用、PROJECT-3 前端验证）
     与其余 43 条已修复异常统一标记 resolved（共 46 条，重复发生会自动重开）。
- **涉及文件**：`backend/app/routers/bi_engine.py`、`backend/app/database.py`、`backend/app/main.py`、
  `backend/app/routers/metrics.py`、`frontend/src/components/layout/TopBar.tsx`、
  `frontend/src/features/components/renderers/*.tsx`（11 个）、`frontend/src/features/bi-dashboard/PddCockpitView.tsx`、
  `AGENTS.md`。
- **怎么验证**（本机真机，2026-11-14）：
  - `_refresh_once()`：同步 16 张表、跳过 3 个无 `updated_at` 的，0.04s，无异常；
  - 视图增量 → `400 表 bi_demand_overview 没有 updated_at...`；普通表增量 / 视图全量 → 200；
    三次请求后 PG `idle in transaction` = **0**；
  - 503 handler 单测：status 503 / `Retry-After: 2` / `pool_timeouts` 计数 +1；
  - 后端 `pytest`：278 passed；前端 `tsc` 通过、`vitest` 52 passed、`build` + `budget` 通过（1061KB gzip，预算内）；
  - 主链路 E2E：7 passed（登录 / 看板渲染 / 筛选 / 组件库地图 / 分享 / 团队协同）；
  - 看板 58 真机渲染截图 `docs/_selfcheck/2026-11-14-charts-fix.png`，hover → mouseout 无 pageerror。
- **说明**：`/api/bi/alerts/events` 健康时 8ms，它只是故障的“显示器”；修复后即使连接池再次吃紧，
  也只会快速返回 503，由前端退避。

---

## 2026-11-14 · 新增：异常通道——agent 可直接读取 GlitchTip 异常

- **背景**：错误已经能上报到自建 GlitchTip（:8070），但只有人能点界面看；agent 要排查异常时必须靠人贴截图，
  拿不到「哪条、几次、什么时候、堆栈在哪」。
- **改法**：
  1. `deploy/glitchtip/docker-compose.yml` 开启 GlitchTip 自带 MCP：`GLITCHTIP_ENABLE_MCP: "true"`
     （改完要 `docker compose up -d web` 重建，`restart` 不带新环境变量）；
  2. 建一个**只读 API Token**（`org:read / project:read / event:read`），
     GlitchTip 的 `/mcp` 会回落校验 `APIToken`，因此 `Authorization: Bearer <token>` 可直接接入，不必走浏览器 OAuth；
     令牌存 `deploy/glitchtip/.api-token`（0600，已 gitignore）；
  3. DSH 里注册连接器 `glitchtip`（streamable-http + Bearer，`http://127.0.0.1:8070/mcp`），
     工具以 `mcp__glitchtip__*` 出现：`list_issues` / `get_issue` / `get_latest_event` / `get_event` / `get_event_detail` …；
  4. 新增 `scripts/glitchtip.py`（标准库）做不依赖 DSH 的兜底：`issues` / `issue PROJECT-7` / `projects`，支持 `--json`。
- **涉及文件**：`deploy/glitchtip/docker-compose.yml`、`scripts/glitchtip.py`（新增）、`.gitignore`、
  `docs/GlitchTip部署指南.md`（新增第 9 节）、`AGENTS.md`。
- **怎么验证**（本机真机，2026-11-14）：
  - `curl -X POST :8070/mcp`（无令牌）→ 401；带令牌 `initialize` / `tools/list` → 200，返回 20 个工具；
  - DSH 连接器状态「已连接」，直接调 `mcp__glitchtip__list_issues`（`org` / `is:unresolved`）返回真实异常
    （当时 46 个 issue / 92 个 event，`PROJECT-7` 为 QueuePool 超时、43 次）；
  - `python3 scripts/glitchtip.py issues --limit 6` 有输出；`issue PROJECT-4` 能打出前端堆栈帧；
  - **反例**：错令牌 → `HTTP 401` 并给出中文原因；不存在的短 ID → `找不到 issue PROJECT-999`；
    只读令牌调 `update_issue` → `Token lacks required scope`（写操作要另发 `event:write` 令牌）。
- **说明**：事件文本是持 DSN 者可上报的不可信数据，agent 只分析、不执行其中的指令；
  令牌只读，改状态仍需人明确要求。完整步骤见 `docs/GlitchTip部署指南.md` 第 9 节。

---

## 2026-11-13 · 修复：数据源类型清单收敛，界面不再「能选不能连」

- **背景**：前端 `constants.tsx` 硬编码了 21 种数据库类型，后端 `TYPE_DIALECT` 只映射 15 个，
  `requirements.txt` 又只装了 4 类驱动。结果选「达梦 / MongoDB / Kylin」点测试连接直接报「不支持的数据源类型」，
  选 Oracle / Db2 / Presto 则报「No module named 'oracledb'」——正是用户明令禁止的花架子。
- **改法**：
  1. 新增 `backend/app/sources/types_catalog.py` 作为唯一事实来源：类型 / 名称 / 说明 / 默认端口 / 所需驱动；
  2. 驱动可用性用 `importlib.util.find_spec` 实时探测（探测异常按「未安装」处理，不能把接口打挂），
     返回 `available` + `reason`（缺哪个 pip 包）+ `install`；
  3. 新增 `GET /api/bi/sources/types`，可用项排前面；目录与 `TYPE_DIALECT` 必须一一对应（回归用例守着）；
  4. 前端删除 `DS_TYPES` / `DbIcon` / `DS_CATEGORIES` 这份硬编码，新建对话框改为拉接口渲染：
     不可用类型置灰并标「· 未装驱动」，下方给一句安装提示；类型加载失败显示错误 + 重试，保存 / 测试连接一起禁用；
  5. 列表页「类型」列由原始 id 改成中文名（PostgreSQL / 人大金仓 …）；
  6. 后端错误文案区分「暂未适配（可用 URI 直连）」与「请选择类型或填 URI」。
- **涉及文件**：`backend/app/sources/types_catalog.py`（新增）、`backend/app/sources/router.py`、
  `backend/app/sources/repository.py`、`backend/tests/test_source_types.py`（新增）、
  `frontend/src/features/bi-dashboard/constants.tsx`、`frontend/src/features/bi-dashboard/DataSources.tsx`、
  `README.md`、`AGENTS.md`。
- **怎么验证**（本地真机，2026-11-13）：
  - `GET /api/bi/sources/types` 返回 15 项：9 项 `available=true`，6 项带 `未安装驱动：cx_Oracle / ibm-db-sa / …`；
  - 反例：直连 `POST /bi/sources/test` 选 dm → 400「暂未适配的数据源类型：dm（可在连接串 URI 里直连）」；
    选 oracle → 400「该类型的驱动未安装：cx_Oracle」；不传类型 → 400「请选择数据源类型，或直接填写连接串 URI」；
  - 新建对话框下拉：PostgreSQL…StarRocks 可选，Oracle / Db2 / Presto / Impala / Hive / RedShift 置灰；
    选「人大金仓」端口自动变 54321；
  - 列表「类型」列显示 `PostgreSQL`（原来是 `postgresql` 原始 id）；
  - 后端 270 条用例通过（新增 14 条：目录一致性 / 驱动探测 / 排序 / 探测异常降级 / 驱动名与运行期一致 / 默认环境 PG 可用）；
  - 前端 `tsc` 通过、52 条单测通过、`vite build` + 预算通过；截图
    `docs/_selfcheck/source-types-dialog.png`、`docs/_selfcheck/source-types-dropdown.png`。
- **迭代（同日）· 六类连接器落地**：Oracle / Db2 / Presto / Hive / Impala / RedShift 不再只是「装驱动就能用」：
  - 驱动进 `requirements.txt`（oracledb / ibm-db-sa / PyHive / thrift / thrift_sasl / pure-sasl / impyla），
    Docker 与本地 `run.sh` 自动安装；RedShift 走 PostgreSQL 协议（psycopg2），不引第三方方言；
  - 修连接串：Oracle 固定 `oracle+oracledb://`（`oracle://` 会找 cx_Oracle）；Redshift 收敛成 `postgresql://`；
    空密码不再拼 `user:@host`（PyHive 会把空串当密码，报「Protocol must be https」这种假错）；
    密码解密失败时给「请重新填写密码」，不再把 `(无法解密)` 塞进 DSN；
  - 修方言：Hive / Impala 标识符改反引号、Impala 去掉 `NULLS LAST`、Presto 补 date_trunc 粒度；
    Hive / Impala / Db2 未适配粒度时明确报错（`_UNSUPPORTED_DIALECTS`），不再静默回退 PG 生成错 SQL；
  - **验证**：`GET /api/bi/sources/types` 15 类全部 `available=true`；
    RedShift 用本地 PG 走完整链路（建源 → 测连通 → 列 73 张表 → 同步 `bi_demo_sku` 180 行 → 删除，无残留）；
    其余五类连关闭端口，返回的是驱动级错误（oracledb DPY-6005 / ibm_db SQL30081N / PyHive 连接拒绝），
    证明「驱动 + 方言 + 连接串」这条链路是通的，不再是 `No module named ...`；
    后端 278 条用例通过（新增 URL / 引号 / 粒度 / 目录一致性用例）。

## 2026-11-13 · 新增：画布多选对齐 / 等间距

- **改了什么**：编辑画布顶部工具栏（「T 标题」左边）新增一组对齐控件，**选中 ≥2 个元素才出现**：
  - 6 向对齐：左 / 水平居中 / 右 / 顶 / 垂直居中 / 底 —— 以选中集合的外接矩形为基准；
  - 2 项等间距：水平 / 垂直 —— **两端固定不动**，只把中间元素按相等间隙重排（≥3 个启用，否则置灰并提示）；
  - 图标沿用 MUI 的 6 个 align 图标；等间距没有现成图标，手写了 `DistributeIcon`（三块等距）与工具栏同节奏（26px 按钮、17px 图标）。
- **为什么**：用户要求「全选这组、两端固定、中间组件间隙平均」，与设计软件（Figma/PS）一致；此前只能靠方向键逐个挪，六张指标卡的间隙是 9/9/9/13/13。
- **实现要点**：
  - 位置用 `Math.round(pos * 10) / 10` 保留 0.1px 精度 —— 画布按 `stageScale` 缩放，取整会让间隙在 11/12 之间跳；
  - 首位固定、末位精确贴住终点、中间按未取整游标落位，避免逐个 round 累积误差；
  - 一次 `setItems` 完成（不是逐个 `patchItem`），撤销栈只记一步；
  - 坐标存 `layout: dict`（后端不校验整型），小数可正常保存。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（导入 6 个 align 图标、`ALIGN_ACTIONS`、`DistributeIcon`、`alignSelection` / `distributeSelection`、工具栏 JSX）。
- **怎么验证**：
  - `npx tsc --noEmit` 通过；
  - Playwright（真浏览器、admin 登录、/bi/canvas）选中同一行 6 张指标卡实测：间距 `9.10/9.10/9.10/13.65/13.65` → 点「水平等距」后 `10.91/10.92/10.92/10.92/10.92`（极差 0.009px），**两端坐标未变**；
  - 「顶对齐」两卡 y 由不同值对齐到同一 y；
  - 点保存 → 刷新页面，间距保持不变（坐标已持久化）；
  - 截图 `/tmp/align-toolbar.png`、`/tmp/tb-zoom.png` 核对图标节奏与按钮可用态。

## 2026-11-13 · 新增：GlitchTip 界面中文化（中英切换）

- **背景**：自建 GlitchTip 只有英文界面；它没有内置中文语言包（`USE_I18N=True` 但 `locale/` 为空），
  直接改镜像里的构建产物又会随升级丢失。
- **改法**：不碰镜像，用「挂载 + 同源注入」做一层界面翻译：
  1. `deploy/glitchtip/i18n/index.html`：从镜像拷出的 SPA 模板（保留 `{{ csp_nonce }}`），
     在 `</body>` 前追加同源 `glitchtip-i18n.css` / `glitchtip-i18n.js`；
  2. `glitchtip-i18n.js`：文本节点词典替换 + `MutationObserver` 跟进 Angular 重新渲染；
     只动可见文本与 `placeholder/title/aria-label`，跳过 `script/style/code/pre`，也不翻译数据字段名；
     相对时间（`11 minutes ago` / `First seen …` / `N events`）走正则；
  3. 右下角 `EN / 中文` 胶囊切换：偏好存 `localStorage`（键 `gt:lang`），英文态完全不执行替换、整页刷新切换；
  4. `docker-compose.yml` 把这三个文件挂进容器（模板挂 `/code/dist/index.html`，脚本样式挂 `/code/static/`），
     重启 web 生效。
- **验证**（真机）：
  - `/login` → 登录 / 邮箱 / 密码 / 还没有 GlitchTip 账号？注册 / 重置密码；
  - `/org/issues` → 问题 / 可用性监控 / 性能 / 日志 / 项目 / 版本 / 组织 / 个人资料 / 支持、
    标记为已解决 / 未解决 / 已忽略、排序、最近出现、趋势、事件、`11 分钟前`；
  - 点右下角 `EN` → 整页变回英文、按钮变「中文」；再点 back to 中文（偏好持久）；
  - 页面注入是**同源**脚本：GlitchTip 的 CSP `script-src 'self'` 直接放行，不需要改 nonce；
  - 截图 `docs/_selfcheck/glitchtip-login-zh.png`、`glitchtip-issues-zh.png`、`glitchtip-issues-en.png`。
- **说明**：翻译的是 SPA 主界面；登录邮件、Django admin 等少数服务端页面仍是英文。
  词典按 GlitchTip 7.0.0 的文案整理，**镜像升级后需要重新 `docker compose cp web:/code/dist/index.html i18n/index.html`
  并补新文案**（已写进 README / AGENTS）。
- **涉及文件**：`deploy/glitchtip/i18n/{index.html,glitchtip-i18n.js,glitchtip-i18n.css}`（新增）、
  `deploy/glitchtip/docker-compose.yml`、`README.md`、`AGENTS.md`。
- **迭代（同日）· 补全词典**：把 17 个页面 / 子菜单的真实文案抓了一遍（209 条），补了 60+ 条：
  个人资料子菜单（账户 / 双因素认证 / 通知 / 访问令牌 / 退出登录）、组织与项目设置
  （常规设置 / 成员 / 邀请成员 / 完全访问 / 所有者 / 创建时间 / 保存名称）、性能与可用性
  （平均耗时 / 最慢 / 最新 / 事务分组 / 暂无性能数据 / 还没有可用性监控）、日志（搜索日志 / 还没有日志）、
  注册与找回密码、404 页；日期改为「2026年11月13日 22:22:04」（含 AM/PM 换算），
  破坏性按钮 `Delete xxx` → `删除 xxx`。截图 `docs/_selfcheck/glitchtip-profile-menu-zh.png`。
  剩余英文只有 Material 图标连字（`folder` / `help` / `menu`）与数据本身（项目名、标签键名），属于不该翻译的部分。
- **迭代（同日）· 修两个漏翻根因**：
  ① 之前只展开了「个人资料」菜单，漏了「支持 / 组织」子菜单 → 补 使用文档 / 反馈问题 / 赞助（Liberapay）/
  获取优先支持 / 订阅 / 团队 / 删除操作；
  ② 脚本里有 **60 字上限**（原本为挡日志正文），整句提示直接跳过 → 放宽到 220，补 评论 / 用户反馈空态、
  「添加评论，与团队分享上下文。」等长句。这次把 16 个页面 + 所有页签 + 三个菜单全展开审计过，
  剩余英文只有图标连字与数据本身（SQL、trace_id、项目名、标签键）。
  截图 `docs/_selfcheck/glitchtip-support-menu-zh.png`、`glitchtip-user-reports-zh.png`。
- **迭代（同日）· 部署指南**：新增 `docs/GlitchTip部署指南.md` —— 源码与镜像地址、依赖底座、
  本仓库 compose 各变量、起服务 / 建项目 / 拿 DSN / 前后端接入、中文化与升级步骤、备份与排错清单、验收 checklist；
  README 文档表已加索引。

---

## 2026-11-13 · 新增：错误上报（Sentry / 自建 GlitchTip，开关式）

- **背景**：站内 `bi_error_log` 只够日常排查；要看堆栈、做聚合与报警，需要 Sentry 协议的上报端。
  用自建 GlitchTip（Django + PG + Redis，协议与 sentry.io 一致），不依赖外部 SaaS。
- **改法**：
  1. 后端 `app/observability.init_sentry()`：`SENTRY_DSN` 为空 → 不导入 SDK、不发请求；DSN 写错 →
     打一行原因并返回 off，**应用照常启动**；配对 → 初始化（FastAPI / SQLAlchemy 集成，默认只收错误，
     `SENTRY_TRACES_SAMPLE_RATE` 控制性能采样）。`/api/readyz` 返回 `sentry: on/off`。
  2. 前端 `src/observability/sentry.ts`：`VITE_SENTRY_DSN` 为空时整段动态 import 被 Vite 摇掉（不进包、不发请求）；
     站内 `/api/report` 保持不变（站内给业务看，Sentry 给开发看堆栈）。
  3. 部署清单 `deploy/glitchtip/docker-compose.yml`：自带 PG / Redis（与业务库隔离）、单进程 web（新版自带任务队列），
     端口 8070，`GLITCHTIP_SECRET_KEY` / `GLITCHTIP_DOMAIN` 可覆盖；镜像默认走 **GitLab Registry**
     （`registry.gitlab.com/glitchtip/glitchtip`，Docker Hub 拉不动时的可用源，可用 `GLITCHTIP_IMAGE` 覆盖）。
- **验证**：
  - 不配 DSN：`/api/readyz` → `sentry:"off"`，启动日志一行「未配置 SENTRY_DSN」；
  - DSN 写错（`not-a-dsn`）：`init_sentry()` 返回 False、`sentry_sdk` 无 client、应用正常启动（单测 3 条）；
  - **真实链路（自建 GlitchTip 7.0.0 跑在本机 :8070）**：`bootstrap_dev` 建出项目并拿到 DSN →
    后端带 `SENTRY_DSN` 重启 → `/api/readyz` 显示 `sentry:"on"` → 用应用自己的 `init_sentry()` 发一条异常 →
    GlitchTip「Issues」里出现 `ValueError: 明策BI · GlitchTip 真实上报验证…`（1 event）；截图 `docs/_selfcheck/glitchtip-issue.png`；
  - 前端：带 `VITE_SENTRY_DSN` 构建多出 `sentry-*.js` 懒加载 chunk，gzip **942 → 1059KB**（预算 1075KB，仍在门禁内）；
    不带 DSN 构建产物里没有该 chunk；
  - 后端 pytest **288 passed**、`tsc` 通过、E2E **7 passed**、`npm run budget` 通过；看板 58 渲染 16 卡 0 error。
- **说明**：Docker Hub 拉 `glitchtip/glitchtip` 在本机反复停滞、13 个国内镜像全部 403 / 连不上；
  改用 GitLab Registry 两分钟拉完（955MB）。源码直跑不可行（最新版依赖 `glitchtip-rust` 未上 PyPI、
  `django-vcache` 需 Rust 编译）。本机 GlitchTip 用的是开发密钥（`GLITCHTIP_SECRET_KEY` 默认值），正式部署要换。
- **涉及文件**：`backend/app/observability.py`（新增）、`backend/app/main.py`、`backend/requirements.txt`、
  `backend/tests/test_observability.py`（新增）、`backend/.env.example`、`frontend/src/observability/sentry.ts`（新增）、
  `frontend/src/main.tsx`、`frontend/package.json`、`deploy/glitchtip/docker-compose.yml`（新增）、`README.md`、`AGENTS.md`。
- **迭代（同日）· 后端上报持久化**：`Settings` 增加 `sentry_dsn / sentry_environment / sentry_traces_sample_rate`
  （读 `backend/.env`，环境变量优先），`init_sentry(dsn, environment, rate)` 改成参数优先、回退读环境变量；
  `backend/.env` 写好本机 `SENTRY_DSN` 后，**普通启动命令就生效**，不用每次内联环境变量；
  compose 后端服务补 `SENTRY_DSN / SENTRY_ENVIRONMENT` 透传。
  验证：仅靠 `.env`（不传任何环境变量）启动 → `/api/readyz` 显示 `sentry:"on"`、`database:"up"`；
  单测 4 条（新增「显式传空不让同名环境变量顶掉」）。
- **迭代（同日）· 前端上报打通**：开发环境用 `frontend/.env.local`（`VITE_SENTRY_DSN`，已加进 `.gitignore`，
  改完重启 `npm run dev` 生效）；生产用 `frontend/Dockerfile` 的 `ARG VITE_SENTRY_DSN` + compose `build.args` 注入。
  真机验证：浏览器里 `setTimeout(() => { throw ... })` → GlitchTip Issues 出现
  `Error: 前端上报验证 · 浏览器 JS 异常（MingceBI）`；同一时间后端一次启动失败
  （`[Errno 48] address already in use`）也被自动捕获，说明 FastAPI/SDK 集成同时生效；
  GlitchTip 默认 `CORS_ORIGIN_ALLOW_ALL=True`，跨端口上报不需要额外放行。
  截图 `docs/_selfcheck/glitchtip-issues-frontend.png`。

---

## 2026-11-13 · 优化：多账号 × 多看板混合压测（P1 收口）

- **背景**：此前的压测是「同一个 token 反复开同一张看板」，缓存全命中，数字偏乐观；
  真实情况是多个用户各看各的看板，而整页渲染缓存按用户隔离，命中率完全不同。
- **改法**：`backend/tests/load/k6_dashboard.js` 支持多账号与多看板 ——
  `ACCOUNTS="u1:p1,u2:p2"`（各自登录拿 token，按 VU 轮转）、`DASHBOARD_IDS="57,58,107"`（按 VU+迭代轮转，
  不填就按卡片数自动挑 3 张）；单 `TOKEN` + `DASHBOARD_ID` 的老用法保持兼容。
- **验证**（本机真实压测，不是估算）：
  - 环境：独立后端进程（:8301，`RATE_LIMIT_DEFAULT=1000000`、`BI_RENDER_CACHE_TTL=15`，关闭告警 / 报表 / 同步调度）；
    3 个临时成员账号 × 3 张看板（4 / 16 / 9 卡，共 29 卡）；ramping 1→50→100→200 VU、思考 1s、持续 4m46s；
  - 结果：**27,275 次渲染、95.3 req/s**；p50 **79ms**、p95 **258ms**、max **1.2s**；
    `http_req_failed 0%`、`dashboard_render_fail 0%`、81,825 条断言（状态 200 / 有卡片 / 卡片无 error）**全部通过**；
  - 与单账号同看板（缓存全命中，p95 168ms / 98.1 req/s）对比：多账号下吞吐只掉 3%、p95 增加 90ms —— 
    缓存按用户隔离的额外回源开销可控，服务端没有排队；
  - 清理：临时账号 3 个、授权行 9 条已全部删除（复查 `users` / `bi_resource_permissions` 均为 0），压测进程已停。
- **涉及文件**：`backend/tests/load/k6_dashboard.js`、`AGENTS.md`、`docs/底座优化方案.md`。

---

## 2026-11-13 · 新增：K8s 部署（存活/就绪分离 + Helm chart + HPA）

- **背景**：部署一直只有 docker compose；上 K8s 缺三样东西 —— 探针语义、清单、弹性伸缩。
  尤其是探针：原来只有一个 `/api/health`（顺带查库），拿它做 liveness 会导致数据库抖一下就把 API 容器全部重启。
- **改法**：
  1. 后端探针拆开（`backend/app/main.py`）：
     · `GET /api/livez` —— 只证明进程能响应，**不碰数据库**；
     · `GET /api/readyz` —— 数据库可用才 200，否则 **503**（被摘出 Service）；Redis 连不上只报 `redis: down`，
       不影响就绪（缓存是可选依赖）；`/api/health` 语义保持不变（compose / 前端在用）。
  2. `deploy/helm/mingcebi`：API（2 副本，探针已按上面口径）、前端、可选独立 worker（`worker.enabled`）、
     可选 Ingress（`/api` → backend、`/` → frontend）、可选 HPA v2（2→6 副本 / CPU 70%）；
     密钥走 `existingSecret`（不落 values），未提供时用 values 渲染 Secret 并对必填项 `required` 报错；
     开 worker 时 API 侧自动 `BI_JOB_EXECUTOR=worker`，避免「开了 worker 但请求还在 API 进程里跑」。
  3. README 增加「方式三：Kubernetes（Helm）」，写明 Secret 键名与常用 `--set`。
- **验证**（真实接口 + 清单渲染，不是只看代码）：
  - `/api/livez` → 200 `{"status":"alive"}`；`/api/readyz` → 200 `{"database":"up","redis":"disabled"}`；
  - 真实反例：以 `REDIS_URL=redis://127.0.0.1:6399/0`（不可达）启动 → `/api/readyz` 仍 **200** 且 `redis:"down"`
    （证明 Redis 是可选依赖，不会把 API 摘出负载均衡）；
  - 数据库不可用 → 503：单测用假引擎覆盖（`backend/tests/test_readiness.py` 5 条，含「livez 不碰库」）；
  - `helm lint` 通过；`helm template` 两个变体校验：默认（Secret + 2 Deployment + 2 Service，`BI_JOB_EXECUTOR=inline`）、
    全开（无 Secret、worker 起 `python -m app.query.async_jobs.worker`、HPA 2→6/70%、Ingress 两条路径正确、
    HPA 开启后 Deployment 不再写死 replicas）；
  - 后端 pytest **252 passed**、E2E **7 passed**。
- **说明**：本机没有 K8s 集群，只做了 `helm lint` + `helm template` 的离线校验，**未做真实集群 apply**；
  集群上 `kubectl get pods` / `curl /api/readyz` 即可复验。
- **涉及文件**：`backend/app/main.py`、`backend/tests/test_readiness.py`（新增）、
  `deploy/helm/mingcebi/**`（新增：Chart / values / 6 个模板 / NOTES）、`README.md`、`AGENTS.md`、`docs/底座优化方案.md`。

---

## 2026-11-13 · 新增：dbt / LookML 语义模型导入（指标口径 + 字段说明）

- **背景**：P4 语义治理最后一块 —— 客户的口径通常已经在 dbt 或 Looker 里定义过，重建一遍既慢又容易走偏。
- **改法**：
  1. `backend/app/semantic/importer.py`（纯解析 + 计划 + 执行）：
     · dbt `manifest.json`：`simple`（`semantic_models.measures` 的 `agg + expr`）、`ratio`（分子/分母都是 simple 时转成
       `A / NULLIF(B, 0)`）、dbt ≤1.5 的 `calculation_method + expression`；`derived` / 带 measure filter / 不支持的聚合 → 跳过并给原因；
       模型列描述按列名匹配到数据集字段。
     · LookML `view`：`measure` 的 `type`（sum / count / average / min / max / count_distinct）转聚合，`${TABLE}.col` 与 `${dimension}`
       解析成列名，`filters: [col: "v"]` 翻成 `CASE WHEN`（多值 OR 会改变口径 → 跳过）；`dimension` 的 `description` 补到字段。
     · 先 `plan()` 出预览（新建 / 更新 / 无变化 / 跳过 + 原因），确认后 `apply()` 才写库；导入的指标走现有版本治理
       （口径变了 `version + 1`、自动取消认证、写「口径变更」快照）。
  2. 接口：`POST /bi/semantic/datasets/{id}/model-preview`（只读）、`POST /bi/semantic/datasets/{id}/model-import`。
  3. 前端：数据集抽屉「指标」页签 →「导入模型」→ 选 dbt / Looker → 选文件或粘贴 → 预览表 → 「导入 N 项」。
- **验证**（真机全链路，不是只看代码）：
  - 临时数据集（`bi_demo_sku`，26 字段）导入真实 dbt manifest：预览 `新建 4 / 字段说明 2 / 跳过 1`，
    跳过原因 `列不在数据集里：ghost_col`；表达式 `SUM(heat_score)`、`COUNT(DISTINCT product_id)`、
    `SUM(price_avg) / NULLIF(COUNT(DISTINCT product_id), 0)` 均正确；
  - 导入后再预览 → **全部 unchanged**（幂等）；先认证 `heat_total` 再改口径导入 → 版本 **1 → 2**、`certified=false`，
    版本历史两条（`新建指标` / `口径变更`）；
  - 真实 LookML 文件：`新建 3 / 更新 1`（同名 `sku_count` 口径不同 → update），`filters` 翻成
    `SUM(CASE WHEN "heat" = '1' THEN 1 END)`；
  - 反例：空内容 → `导入内容为空`；`format=superset` → `不支持的模型格式`；`ghost_col` → 跳过而不是带病入库；
  - 后端 pytest **247 passed**、`tsc` 通过、E2E **7 passed**；验证用的临时数据集已删除（dataset / metric / field 三表 count=0）。
  - 截图 `docs/_selfcheck/model-import-empty.png`、`model-import-preview.png`。
- **涉及文件**：`backend/app/semantic/importer.py`（新增）、`backend/app/semantic/router_items.py`、
  `backend/tests/test_model_import.py`（新增 7 条）、`frontend/src/features/bi-dashboard/ModelImportDialog.tsx`（新增）、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`、`AGENTS.md`、`docs/底座优化方案.md`。

---

## 2026-11-13 · 新增：SQL Server 连接器（pyodbc + ODBC 驱动自动探测）

- **背景**：类型栏一直有 SQL Server（默认 1433），但 `pyodbc` 没装、系统也没有 ODBC 驱动，建了源只会报「驱动未安装」。
- **改法**：
  1. `requirements.txt` 加 `pyodbc==5.2.0`；`Dockerfile` 装 `unixodbc` 并在 MS 源可达时安装 `msodbcsql18`
     （源不可达只 warn、不中断构建，其它数据源不受影响）。
  2. `app/sources/repository.py`：`sqlserver / mssql / tsql` 统一拼 `mssql+pyodbc://` 并自动补 `driver=` ——
     顺序 `BI_MSSQL_DRIVER` → 本机注册的 `ODBC Driver 18/17 for SQL Server` → `FreeTDS`；
     MS 驱动附带 `TrustServerCertificate=yes`（18 默认强制加密，自签证书会握手失败），FreeTDS 不加。
     手填 `mssql://` / `sqlserver://` 会被改写成 `mssql+pyodbc://` 并补 driver；已自带 driver 的原样保留。
  3. 登录超时 8s（pyodbc 用 `timeout` 参数，与其它驱动的 `connect_timeout` 不同），同步链路与直连查询都加。
  4. 本地开发环境：`brew install unixodbc freetds` + `~/.odbcinst.ini` 注册 `FreeTDS`
     （`Driver=/opt/homebrew/lib/libtdsodbc.so`），否则 `pyodbc.drivers()` 为空、连接报 IM002。
- **验证**：
  - 单测 4 条（`tests/test_source_urls.py`）：MS 驱动串（带 `TrustServerCertificate`）/ FreeTDS 串（不带）/
    `mssql://` 归一 / 手填 driver 不重复追加；
  - 真机 API `POST /api/bi/sources/test`（127.0.0.1:1433，无服务端）→ 400
    `[FreeTDS][SQL Server]Unable to connect: TDS server is unavailable or does not exist (20009)` ——
    证明 pyodbc → ODBC 驱动 → TCP → TDS 握手整条链路真的在跑，不是「驱动未安装」；
  - 反例：`BI_MSSQL_DRIVER="ODBC Driver 18 for SQL Server"`（本机未装该驱动）→
    `[unixODBC][Driver Manager]Can't open lib ... file not found`，提示指向具体缺失的驱动；
  - 后端 pytest **240 passed**、`tsc` 通过；看板 57 / 58 / 107 共 29 张卡渲染 **0 error**（本地 PG 链路未受影响）。
- **说明**：本机没有 SQL Server 实例，`mcr.microsoft.com` 镜像拉取停滞（磁盘 20 秒零增长），
  **真实建连取数、以及 Dockerfile 的镜像构建未验证**。复验：起 `mcr.microsoft.com/mssql/server:2022-latest`（1433）后，
  在「数据源」页建 SQL Server 源 →「测试连接」→ 同步一张表即可；MS 驱动装好后会被自动优先选中。
- **涉及文件**：`backend/requirements.txt`、`backend/Dockerfile`、`backend/app/sources/repository.py`、
  `backend/app/query/live.py`、`backend/tests/test_source_urls.py`、`AGENTS.md`、`docs/底座优化方案.md`。

---

## 2026-11-13 · 新增：「测试数据集」页可以新建数据集（上传 CSV / 选已有表）

- **背景**：用户要求「测试数据集」页也能「＋ 新建数据集」。原来这页只能看内置演示数据和模板副本，
  新的测试数据（比如她刚整理的 CSV）只能先走「数据源」再绕到「数据集」页，路径太长。
- **改法**：
  1. 后端：`bi_dataset` 加 `is_sandbox`（迁移 `031_dataset_sandbox.sql`）；`POST /bi/semantic/datasets` 接受
     `sandbox: true` —— 建出来是**公共数据集**（`owner_id` 为空、跟着项目走），**只有管理员能建**（成员 403）；
     新增 `GET /bi/semantic/datasets/sandbox` 给这页列出来。删除不用新逻辑：owner 为空本来就只有管理员能删。
  2. 前端「测试数据集」页：右上角加「＋ 新建数据集」（仅管理员可见），弹窗两个来源 —— **上传文件**
     （CSV / TSV / Excel / JSON，走 `/bi/sources/upload` 落成 `bi_imp_*` 表）和 **已有物理表**；
     名称留空就用文件名 / 表名；建完自动 `sync` 把物理列导成字段，然后直接打开这个数据集的明细。
  3. 列表：新增「自建 · 测试」绿色来源标（内置演示数据仍是「组件预览」、模板副本仍是「模板 · xxx」），
     自建那几行带删除按钮（二次确认，删数据集不删数据源里的表）。
  4. 这些数据集**不进「数据集」管理页**（`DatasetPanel` 过滤 `is_sandbox`），但看板 / 组件库的数据集选择器里能选到 ——
     这样「用测试数据搭看板」不用再建一份。
- **验证**（真机全链路，不是只看代码）：
  - 上传「测试数据2026.11.13-补全版.csv」→ 建出数据集（180 行 / 25 字段），明细页页脚 `共 180 行 · 25 列`；
  - 「已有物理表」选 `bi_imp_*` → 建出数据集（25 字段）、选 `bi_demo_sku` → 26 字段；
  - 列表出现 3 条「自建 · 测试」，`查看 / 删除` 正常；普通成员（小宝）调建库接口 → **403**；
  - 删除后 `GET /datasets/sandbox` 为空、数据源里的测试表一并清掉；「数据集」页始终不出现这些行；
  - 后端 pytest **236 passed**、`tsc` 通过。
  - 截图 `docs/_selfcheck/test-dataset-list.png`、`test-dataset-create-dialog.png`、`test-dataset-sandbox-created.png`。
- **涉及文件**：`backend/schema/migrations/031_dataset_sandbox.sql`（新增）、`backend/app/semantic/models.py`、
  `backend/app/semantic/repository.py`、`backend/app/semantic/router.py`、
  `frontend/src/features/bi-dashboard/TestDataPanel.tsx`、`frontend/src/features/bi-dashboard/DatasetPanel.tsx`、`AGENTS.md`。
- **迭代（同日）**：页头按钮改成「返回数据集 → 刷新 → ＋ 新建数据集」，主操作压到最右、与表格右缘对齐（用户要求）。

---

## 2026-11-13 · 修复：词云报「标识字段不能聚合：产品id」

- **现象**（用户实测）：词云卡上出现红字 `标识字段不能聚合：产品id`，口径卡显示 `维度 痛点 · 0 行 / 指标 —`。
- **根因**：词云「只绑了词、没绑权重」时，后端会自动挑一列去 `COUNT` 当词频；原来那句兜底
  `next(f for f in fields if f.name != dim_name)` **连标识列都会挑**，于是生成 `SUM(产品id)` 这类聚合，
  被 `semantic/compiler.py` 的「标识字段不能聚合」拦下 → 整张卡变成错误态 + 0 行。
- **改法**：
  1. `components/resolver.py`：计数列改成**优先指标列 → 再维度/时间列 → 非标识列**，绝不再拿标识列当权重；
  2. `semantic/compiler.py`：标识字段**允许 COUNT / COUNT_DISTINCT**（数行数、算词频本来就该允许），
     SUM / AVG 仍然拒绝，报错文案补「（只能计数）」；
  3. `editor/QueryPanel.tsx`：词云老卡如果权重是标识字段，**打开面板时自动清掉**（自愈，卡片立刻恢复）。
- **验证**：
  - 直接跑 resolver（维度=痛点、无指标）：SQL `SELECT "pain_point", COUNT("price_avg") … GROUP BY "pain_point"`，
    **40 行**，词 颗粒碎末多 35 / 详情描述简略 18 / 看不懂规格 18 …
  - 真机临时看板：拖入词云 → 卡片正常出词、无红字，口径 `40 行`；
  - 后端 pytest **255 passed**、`tsc` 通过；临时看板已删（DELETE 200）。
- **涉及文件**：`backend/app/components/resolver.py`、`backend/app/semantic/compiler.py`、
  `frontend/src/features/components/editor/QueryPanel.tsx`。

---

## 2026-11-13 · 新增：词云「拆词」分隔符（面板可见 · 之前只能靠模板默认值）

- **问题暴露**：用户那张词云里，词是「颗粒碎末多/不爱吃」「详情描述简略/看不懂规格」——
  整格带着 `/`。原因是这张卡的 `binding.split` 是空的（拆词关着），而**面板上没有这个开关**，
  只有模板默认值，用户根本不知道可以拆。
- **改法**（`QueryPanel.tsx`）：词云面板在「颜色（分类）」下新增「拆词」输入框（分隔符，如 `/`；留空 = 不拆）。
  编辑态用本地草稿，失焦 / 回车才提交，避免每敲一个字就重算。
- **验证**（真机，临时看板）：
  - 拆词 = `/` → 13 个词，全是单词（颗粒碎末多 / 看不懂规格 / 详情描述简略 …）；
  - 清空拆词 → 27 个词，全带 `/`（详情描述简略/看不懂规格、包装破损/物流慢 …）——正是用户那张卡的样子；
  - 后端 pytest **255 passed**、`tsc` 通过；临时看板已删（DELETE 200）。
  截图 `docs/_selfcheck/wordcloud-split-control.png`。
- **涉及文件**：`frontend/src/features/components/editor/QueryPanel.tsx`、`frontend/src/features/components/types.ts`。

---

## 2026-11-13 · 优化：词云「颜色（分类）」允许选跟「词」同一列（对齐帆软）

- **用户疑问**：帆软里「文本 = 城市、颜色 = 城市」可以同一列，我们的颜色下拉把同一列排掉了，合理吗？
- **结论**：合理且应该允许 —— 帆软这种用法的语义是「每个词一个颜色」（纯区分/装饰），不是业务分组。
  我们原来排除同列，是怕「选了看不出效果」，实际上按名次轮转就已经是「每词一色」。
- **改法**：
  1. 面板：「颜色（分类）」下拉不再排除当前词列；
  2. 后端：`b.series == b.dimension` 时**不再重复加分组维度**（否则 SQL 会 `GROUP BY` 同一列两次），
     `_normalize` 也不走分组分支，`payload.series_label` 带出颜色字段名供前端判断；
  3. 前端：`series_label == dimension_label` 时**按词名散列取色**（每个词固定一色，换权重指标不变色）；
     颜色选其它列时仍按分类同色（业务分组），不选时按名次轮转。
- **验证**（真机，临时看板）：
  - 颜色=痛点（同词）→ 10 个词出现青/藕紫/玫红/蓝/琥珀等 6 种色相，**每词一色**；
  - 颜色=种类 → 同分类同色（青 `rgb(14,165,165)` 等）；
  - 直接跑 resolver 三种情况：`series=None` 无分组、`series=种类` 带 group、`series=痛点` 无 group 且 `series_label='痛点'`；
    三种 SQL 都不会重复分组；
  - 后端 pytest **255 passed**、`tsc` 通过；临时看板已删（DELETE 200）。
  截图 `docs/_selfcheck/wordcloud-color-equals-word.png`。
- **涉及文件**：`backend/app/components/resolver.py`、`frontend/src/features/components/editor/QueryPanel.tsx`、
  `frontend/src/features/components/renderers/WordCloudCard.tsx`。

---

## 2026-11-13 · 新增：词云「颜色（分类）」档（对齐帆软词云的 颜色 / 大小 / 文本）

- **参照**：用户贴了帆软 BI 的词云属性面板 —— 「颜色 = 城市 / 大小 = 客户数量（求和）/ 文本 = 城市 / 提示 / 细粒度」。
  对照下来我们少了「颜色（分类）」这一档（原来颜色只按名次渐变）。
- **实现**：
  1. `binding.series` 复用为词云的「颜色（分类）」（后端 `_request_for` 本来就会把它加成第二个维度）；
  2. `resolver._normalize`：词云 + 分类时行是 `[词, 分类, 权重, (出现次数)]`，拆成 `name / group / value`；
  3. `compute.explode_tokens`：一个词跨多个分类时，取**权重最大的那个分类**决定颜色；
  4. `WordCloudCard`：有分类就按分类上色 —— **同分类同色、每个分类用足饱和度**（分类色是类别色，
     不跟「按名次混白」混用）；没配分类时仍按名次轮转主题色；
  5. 面板：词云新增「颜色（分类）」下拉（维度字段 + 不用）。
- **验证**（真机 + 直接跑 resolver）：
  - SQL 变成 `SELECT 痛点, 种类, SUM(热销指数), COUNT(均价) … GROUP BY 痛点, 种类`；
  - 词云 30 个词里三个分类分别是 `rgb(14,165,165)` 青 / `rgb(124,108,224)` 藕紫 / `rgb(62,123,250)` 蓝，
    同分类的词颜色一致；口径卡 `词 痛点 · 76 行 / 权重 SUM(热销指数) · 合计 2,271,682`；
  - 截图 `docs/_selfcheck/wordcloud-color-by-category.png`、`wordcloud-panel-color-slot.png`；
    后端 pytest **255 passed**、`tsc` 通过；临时看板已删（DELETE 200）。
- **对照帆软其它档位**：`文本` = 我们的「词（维度）」、`大小` = 「权重（指标）+ 聚合」、`颜色` = 新增「颜色（分类）」、
  `提示` = 悬停自动显示「词 · 权重值」、`细粒度` = 我们按维度聚合（粒度体现在 SQL 的 GROUP BY，不需要再单独选）；
  右键菜单里的汇总方式 / 快速计算 / 过滤 / 数值格式 / 显示名 = 面板的「聚合 / 计算 / 过滤 / 数字格式 / 卡片标题」。
- **涉及文件**：`backend/app/components/resolver.py`、`backend/app/components/compute.py`、
  `frontend/src/features/components/editor/QueryPanel.tsx`、
  `frontend/src/features/components/renderers/WordCloudCard.tsx`。

---

## 2026-11-13 · 修复：词云换权重会「换掉一批词」→ 选词按出现次数、字号按权重

- **用户疑问**：权重指标一换（热销指数 → 日销量），词云里的词也跟着换了一批，「这科学吗」。
- **对照业界**：字号 = 权重是统一口径；但「换权重导致词变了」在 Tableau / Superset 里不该发生
  —— 它们一个词就是一行，行限制只影响「取多少行」，词池不变，只有大小变。
  我们这里因为 `痛点` 是「一格多词」（按 `/` 拆），拆完再按权重排前 N，边界上的词就会随权重抖动。
- **改法**：
  1. `resolver.py`：词云 + 拆词 + 有指标时，SQL 里**多带一列 `COUNT` 当「出现次数」**（别名 `出现次数`）；
  2. `compute.explode_tokens`：每个词同时累计 `value`（权重）与 `freq`（出现次数）；
  3. `compute` 词云分支：**选词看出现次数**（`freq` 降序，同频按名字排，保证确定性）、**字号看权重**；
  4. 只绑词不绑权重时仍按 `COUNT` 计数（不变）。
- **验证**（同一份 测试-01，维度=痛点，前 30 词）：
  - 热销指数 / 日销量 / 均价 三个权重下 **词集完全一致（True，30 个词）**，只有字号变：
    首词「颗粒碎末多」235,831 → 29,096 → 2,304，排序随之调整；
  - 真机临时看板：卡片 13 个词，来回切换状态稳定；后端 pytest **255 passed**；临时看板已删（DELETE 200）。
- **涉及文件**：`backend/app/components/resolver.py`、`backend/app/components/compute.py`。

---

## 2026-11-13 · 优化：词云面板去掉「维度」（只留指标）

- **用户要求**：词云配置里「维度」这一块不要，只保留指标。
- **改法**（`frontend/src/features/components/editor/QueryPanel.tsx`）：
  1. 非维度类组件（指标卡 / 结论卡 / 分节标题 / 仪表盘 / **词云**）里那段「已绑维度 + ✕」的槽，
     **词云不再渲染**；`binding.dimension` 原样保留（词云靠它决定「词来自哪一列」，删了字就变了）；
  2. 顺带修了同一行的排版：指标 + 聚合 + ✕ 原来会因为宽度不够换行、✕ 掉到单独一行 →
     改成不换行（指标可收缩、聚合 96、✕ 固定），窄栏也不掉行。
- **词的来源不丢**：把左侧的「列」拖到指标框 = 当词（按出现次数），拖「指标」= 当权重；
  模板默认仍是 痛点 + 热销指数。
- **验证**（真机，临时看板）：面板只剩「口径卡 → 指标（+ 聚合 + ✕）→ 计算 / 过滤 / 行限制 / 排序 / 外观」，
  没有「维度」槽；口径卡仍显示 `维度 痛点 40 行 · 指标 SUM(热销指数) 合计 2,349,244`，卡片照常出词。
  截图 `docs/_selfcheck/wordcloud-panel-without-dimension.png`；`tsc` 通过；临时看板已删除（DELETE 200）。
- **涉及文件**：`frontend/src/features/components/editor/QueryPanel.tsx`。
- **· 迭代（同日晚）**：对过市面做法后把「维度」配回来了 ——
  **词云 = 词（维度，文本列）+ 权重（指标，决定字号）** 是业界统一口径：
  Superset `WordCloudViz` 就是一个 Series + 一个 Metric；Tableau 词云是标记卡「文本 = 维度、大小 = 度量」；
  Power BI 词云视觉对象同样是 Category + Value；FineBI / Quick BI 也是「词 + 权重」两槽。
  本仓库：`axisLabels` 给词云加了「词（维度）/ 权重（指标）」叫法，词云重新走完整维度槽
  （下拉可换词列、✕ 可清空），权重槽照旧「指标 + 聚合」；只绑词不绑权重时后端自动 `COUNT`，两种用法都能出图。
  截图 `docs/_selfcheck/wordcloud-panel-dimension-restored.png`；`tsc` 通过。

---

## 2026-11-13 · 新增：词云「主题色」（6 套配色，面板可选）

- **需求**：参考多套配色图，在词云配置面板里加「主题色」，从中挑 **6 套**（不要全搬）。
- **实现**：
  1. `skin/tokens.ts` 新增 `CLOUD_PALETTES`（6 套 × 8 色）：**潮彩**（默认，青/蓝/藕紫/琥珀/绿/玫红/天蓝/淡紫）、
     **甜韵**（薄荷/粉/鹅黄）、**希翼**（冷蓝青 + 暖点缀）、**谷韵**（深绿 → 雾青）、**复古**（棕驼/灰绿）、**炽情**（大红橙黄紫）；
     `cloudColor(rank, total, colors?)` 支持传色板，尾部仍自动混白两档；
  2. 存 `spec.chart.cloud_palette`（后端 `ChartSpec.cloud_palette`，默认「潮彩」，长度截断到 12）；
     `resolver` 里 `chart.model_dump()` 直接带进 payload，前端 `WordCloudCard` 按名字取色板；
  3. 面板：`StylePanel` 在「外观」下、**仅词云**出现「主题色」3×2 胶囊（每个显示 6 色条 + 名称，选中描边 `#4F46E5`）。
- **验证**（真机画布，逐套点过并读 DOM 计算色）：
  - 潮彩 `rgb(14,165,165)/(62,123,250)/(124,108,224)`；
  - 甜韵 → `rgb(53,201,165)/(79,195,232)/(169,139,232)`；
  - 谷韵 → `rgb(15,81,50)/(17,107,90)/(31,138,112)`；
  - 炽情 → `rgb(225,29,72)/(249,115,22)/(234,179,8)`；
  - 截图 `docs/_selfcheck/wordcloud-palette-panel.png`（面板）、`wordcloud-palette-gu.png`、`wordcloud-palette-chi.png`；
  - 后端 pytest **255 passed**、`tsc` 通过、后端已重启；自检临时看板（234/235）均已删除。
- **涉及文件**：`backend/app/components/spec.py`、`backend/app/components/seed_base.py`、
  `frontend/src/features/components/skin/tokens.ts`、`frontend/src/features/components/editor/StylePanel.tsx`、
  `frontend/src/features/components/renderers/WordCloudCard.tsx`、`frontend/src/features/components/types.ts`。

---

## 2026-11-13 · 修复：词云被裁字 + 改成「中间最大、向外渐小」

- **用户实测两个问题**：① 首行和末行的字被卡片切掉；② 最大的词跑到左上角，看着不像词云。
  根因：原来是 `flex-wrap` 换行排版 —— 只能一行一行排，行高累加就溢出；顺序按大小降序，头名必然在左上。
- **改法**（`frontend/src/features/components/renderers/WordCloudCard.tsx` 整体重写，**不引第三方库**）：
  1. **从中心向外的螺旋摆放**：最大词钉在正中间，其余按大小依次找不重叠的位置（离屏 canvas 量字宽，误差最小）；
  2. **放不下的词不再拖累全局**：整片云不会因为塞不下就整体缩小（那会把大小对比摊平），
     而是给剩下的词逐级缩小（1 → 0.82 → 0.66 → 0.52 → 0.4）再塞进空隙；
  3. **字号跟容器算**：取 `容器高×0.34`、`容器宽×0.52÷头名词长`、上限 46 三者最小值 ——
     头名最宽不超过容器一半，保证旁边还有词；
  4. **任何词都不越过卡片边界**（放不进就不画），彻底消除裁字；
  5. 关键坑：组件库缩略图外层有 `transform: scale(0.82)`，`getBoundingClientRect` 拿到的是缩放后尺寸，
     用它算字号会让字号偏大 1.2 倍、只能塞 5 个词 → 改用 `clientWidth/clientHeight`（未缩放的布局尺寸）。
- **验证**（真机，两处渲染路径）：
  - 组件库缩略图（232×129 内容区）：**19 个词**全部落在卡片内（越界 0），「颗粒碎末多」居中且最大；
  - 画布上的标准卡（420×300）：13 个词，头名 39px 居中，二档 30px，小词 21px 向外，越界 0；
  - 截图 `docs/_selfcheck/wordcloud-wall-thumb.png`、`wordcloud-center-layout.png`；`tsc` 通过。
  - 自检用的临时看板「临时-词云自检」已删除（DELETE 200）。
- **涉及文件**：`frontend/src/features/components/renderers/WordCloudCard.tsx`。
- **· 迭代（同日晚）**：词色从「红 → 灰」单一梯度换成**多彩色板**（青 / 蓝 / 藕紫 / 琥珀 / 绿 / 玫红 / 天蓝 / 淡紫，
  `skin/tokens.ts::CLOUD_COLORS` + `cloudColor`）：按名次轮转色相，尾部两档自动混白（0.2 / 0.4），
  保证头名最饱和、小词不抢眼。截图 `docs/_selfcheck/wordcloud-center-layout.png`（画布卡）、
  `wordcloud-wall-thumb.png`（缩略图，19 个词、越界 0）。

---

## 2026-11-13 · 优化：词云改用「痛点」字段（模拟数据更饱满）

- **背景**：组件库的「词云」模板只有 3 个词（平台A / 平台B / 平台C）—— 因为它没绑维度，
  后端兜底「自动挑一列」挑到了平台。用户要求换成「测试-01」的 `痛点` 字段，让样例看起来饱满。
- **改法**：`base.wordcloud` 模板改成
  `dimension = 痛点`、`metric = 热销指数（SUM）`、`split = "/"`（痛点值本来就是「颗粒碎末多 / 分量不足」这种，按 / 拆词）、
  `top_n = 30`；同步 `seed_base.BASE` 与库里那一行。
  顺带把卡片脚注从写死的「字号 = 提及次数」改成按指标名显示（现在是「字号 = 热销指数 · 共 2,349,244」），
  换权重指标时不会再张冠李戴。
- **验证**：`preview-batch` 词云卡返回 **30 个词**：颗粒碎末多 235,831 / 看不懂规格 124,918 / 详情描述简略 /
  物流慢 / 分量不足 / 包装破损 / 家人不喜欢 / 味道重 … 总量 2,349,244；SQL 为
  `SELECT "pain_point", SUM("heat_score") FROM "bi_demo_sku" GROUP BY "pain_point"`；
  卡片墙缩略图从 3 个字变成一整片痛点云。截图 `docs/_selfcheck/wordcloud-pain-points.png`；`tsc` 通过、后端已重启。
- **涉及文件**：`backend/app/components/seed_base.py`、`frontend/src/features/components/renderers/WordcloudCard.tsx`。

---

## 2026-11-13 · 修复：组件库模板不再写死字段（筛选栏按数据集现建 + 拖入自检）

- **用户质疑**：「组件库的组件是不是没用『测试-01』的数据？字段不能写死」。逐条核过：
  - **数据类 19 个模板**（指标卡/表格/柱/条/折线/面积/饼/环/散点/矩阵/词云/组合/排行/漏斗/仪表/雷达/瀑布/地图）全部
    `binding.dataset_id = 20`，算出来的 SQL 一律 `FROM "bi_demo_sku"`，值也对得上（指标卡 151,880、
    平台A/B/C、品牌A~N、种类 6 档、上架时间 2026-05-04~11-03、省份 31 个）——**确实用的是测试-01**；
  - **真写死的是「筛选栏」模板**：`dataset_id` 为空、6 个字段**一个都没绑列**，选项还是老的
    天猫 / 拼多多 / 乌鸫食品…（那是另一套数据的值）。拖到画布上当然对不上，也就是前后两次问题的根源。
- **改法**：
  1. `seed_base.build_filter_spec(db, dataset)`：筛选栏模板**按演示数据集现建** ——
     有哪几列就出哪几栏、`column` 自动绑好、**选项 = 该列真实取值**（按出现次数排序，价格带按档位顺序）；
     现在生成的是 平台 / 种类 / 价格带 / 上架时间 / 搜索，选项 平台A·B·C / 猫咪零食… / <20 元…；
  2. `_prune_missing`：**组件库出厂自检** —— 任何模板里引用了「数据集里不存在的字段」一律清掉（维度 / 指标 / 图表轴 / 表格列），
     宁可空着也不带死字段上架；
  3. `CanvasBoardPage`：组件从类型栏拖进画布时，**按目标数据集再自检一次**（`pruneSpecFields`，
     字段没加载完就不动手，`useDatasetFields` 顺带暴露 `datasetId` 防串用）——
     拖到没有「价格带」的数据集上，分组字段直接空出来，不会出现「字段不存在 / 0 行」还带着旧字段的错觉。
- **验证**：
  - 23 张卡 `preview-batch` **0 报错**；19 张数据卡 SQL 全部 `FROM "bi_demo_sku"`；
  - 卡片墙筛选栏卡现在显示 平台A / 猫咪零食 / <20元 / 全部日期 / 搜索（改前是 天猫 / 乌鸫食品）；
  - 拖入自检正例：工作数据集=榜单端-天猫（有价格带）→ 拖柱状图，分组字段仍是「价格带」、正常出数；
  - 拖入自检反例：工作数据集=需求端·天猫·汇总（没有价格带）→ 拖柱状图，分组字段为「—」、不报错；
  - 截图 `docs/_selfcheck/library-data-audit.png`；`tsc` 通过、后端重启。
- **涉及文件**：`backend/app/components/seed_base.py`、`frontend/src/pages/CanvasBoardPage.tsx`、
  `frontend/src/features/components/board/useDatasetFields.ts`、`AGENTS.md`。

---

## 2026-11-13 · 修复：筛选栏拖字段进来「取候选值失败 / 解析不到」

- **问题**（用户实测）：在「测试-01」上把左栏字段拖进筛选栏某张字段卡的绑定框，面板只给一句「选项 0 · 取候选值失败」，
  看着像「字段解析不了」。真因有两类，全被原来那句含糊文案盖住了：
  ① 拖来的列**不在当前数据集里**（左栏数据集刚修好之前会钉在「榜单端-天猫」，字段列表是那张表的，
     绑到了筛选栏正在用的「测试-01」上 → `POST /datasets/{id}/query {dimensions:[列]}` 直接报列不存在）；
  ② 请求本身失败（CSRF 还没就绪 / 网络抖动）→ 原来只留一个**死状态**，不会自愈也不会说原因。
- **改法**（`frontend/src/features/components/editor/FilterFieldsEditor.tsx`、`CanvasBoardPage.tsx`）：
  1. 绑列前先校验：列不在当前数据集 → 文案直接写 **「当前数据集没有「X」列」**，不再发必然失败的请求；
  2. 真失败时显示 **「取候选值失败 · 点这里重试」**（可点，重跑取候选值），不再是死状态；
  3. **换数据集就清空** 上一轮的「已取到 N 个 / 失败」状态，免得串到新数据集上误导；
  4. 失败 / 缺列时**清空旧选项**（旧选项属于上一列，留着会张冠李戴——实测拖完仍显示 14 个旧值）；
  5. 可绑字段从「只有维度」扩到 **维度 + 指标 + 标识**（`columns` 用当前数据集全部字段）。
- **验证**（真机画布 126，选中筛选栏）：
  - 拖「品牌」→ 「已绑定：品牌」+ **已取到 14 个值**（测试-01 里确实 14 个品牌）；
  - 拖「链接id」（只存在于榜单端-天猫）→ 选项归 0 + **「当前数据集没有「链接id」列」**（改前是一句「取候选值失败」）；
  - 左栏切到「榜单端-天猫」→ 旧的失败/计数状态立刻清空。
  - 截图 `docs/_selfcheck/filter-field-drop-feedback.png`；`tsc` 通过。
- **说明**：她那页的「上架时间」字段目前是 `名称=上架时间 / 列=平台 / 控件=下拉`（拖串了），
  名称和绑的列对不上，这也让「解析」看起来更糊涂 —— 建议改回：上架时间 绑「上架时间」列 + 日期控件，平台单独一栏。

---

## 2026-11-13 · 修复：左栏「数据集」被钉死、点其他数据集没反应

- **问题**（用户实测）：画布编辑器左栏「数据集」一直显示「榜单端-天猫」，点下拉里其它数据集毫无反应，
  像被固定住了。原因：`fieldDatasetId` 用了 `selectedItem.spec.binding.dataset_id`，**不分元素类型**；
  当时选中的是**筛选栏**（`type=filter`，残留 `binding.dataset_id = 21` 榜单端-天猫），
  于是左栏被这个残留值钉死；而下拉 `onChange` 只对 `type === "chart"` 的元素回写，
  筛选栏/标题/文字/画板一律不回写 —— 点下去既不改数据也不改显示，看起来就是「没反应」。
- **改法**（`frontend/src/pages/CanvasBoardPage.tsx`）：只有**数据类元素**（`type === "chart"`）才用它绑定的数据集决定左栏
  （`selectedChartDatasetId`）；筛选栏 / 标题 / 文字 / 形状 / 画板退回「当前工作数据集」`activeDatasetId`。
  平台分套的跟随逻辑（`followedDatasetId`）也改成只基于这个值，依赖项一并改掉。
- **验证**（真机画布 126）：
  - 打开：左栏 = **测试-01**（页面上的卡确实绑 20），改前是「榜单端-天猫」；
  - 选中筛选栏后再看：仍 **测试-01**（改前会被 21 钉住）；
  - 点下拉「榜单端-天猫」→ 左栏切过去，字段列表同时换成该数据集的字段（链接id / 均价 / 榜单排名 / 产品标题）；
  - 切到「页面2」（那页的卡都绑 21）→ 左栏自动跟到「榜单端-天猫」；选中卡片仍跟随 ✓。
  - 截图 `docs/_selfcheck/canvas-left-dataset-pinned.png`（改前）/ `canvas-left-dataset-switchable.png`（改后）。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`、`AGENTS.md`（坑清单补一条）。

---

## 2026-11-13 · 修复：「平台」分套字段选了平台，明细表不过滤

- **问题**（用户实测）：画布上「平台」这栏是**分套依据 + 数据集切换器**（`split: true` + `dataset_map`），
  它原来只干两件事：切「平台A / 平台B 各自的卡片套」+ 切数据集；字段本身**没有绑定数据列**（`column: ""`），
  所以 `_page_filters` 不会生成 `WHERE 平台 = ...` —— 明细表当然还是 180 行混着。
  同类字段（种类 / 品牌 / 上架时间）因为绑了列，所以都能过滤，唯独平台不行，看起来就像「漏了」。
- **改法**：
  1. 编辑器 `FilterFieldsEditor`：配了数据集映射的平台字段，面板里**也显示「绑定列」拖入框**
     （原来 `!switchMode` 把它整块藏了，用户根本没有入口）；绑定后「切平台」= 切卡片套 + 按该列过滤行。
  2. 用户那页（画布 126）的「平台」字段已绑到「平台」列（改前备份 `/tmp/doc126-backup-platform-2.json`）。
- **验证**：
  - 改前：`/render` 平台A / 平台B 都返回 180 行，`平台` 列三个值混在一起，SQL 无 WHERE；
  - 改后：平台A → **60 行全是平台A**（`WHERE "platform" = :f0`）、平台B → **60 行全是平台B**；
  - 真机预览页：地址栏 `p_platform=平台B` → 明细表「共 60 条」全 平台B，`p_platform=平台A` → 60 条全 平台A；
  - 普通筛选字段（种类 / 品牌）行为不变，业务看板不受影响。
  - 截图 `docs/_selfcheck/platform-filter-bound-A.png` / `platform-filter-bound-B.png`。
- **说明**：`平台C` 没配在数据集映射里，所以第三套页面切不到（要的话在面板「切换数据集」里补一行）。
  另外用户那页的「上架时间」字段当前被拖成了 label / column = 品牌 + 日期控件，选日期不会生效，已单独提醒。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`、`AGENTS.md`。

---

## 2026-11-13 · 修复：测试数据集明细页只显示 100 行（把上限当成了总数）

- **问题**：用户问「为什么显示只有 100 行」。原因两处叠在一起：`TestDataPanel` 取数写死 `limit: 100`，
  页脚又把「返回的行数」当成总数渲染成 `共 100 行` + `前 100 行` —— 表里 180 行看起来像只有 100 行。
- **改法**（`frontend/src/features/bi-dashboard/TestDataPanel.tsx`）：
  1. 预览上限提成常量 `ROW_LIMIT = 1000`（演示表 180 行能整页看完；宽表也不会把页面拖死）；
  2. 页脚按真实情况说话：没触到上限显示 `共 N 行 · M 列`，触到上限显示 `已显示前 1000 行`，不再拿返回行数冒充总数。
- **验证**：真机打开「测试数据集 → 查看」：页脚 `共 180 行 · 26 列`、DOM 里 `tbody tr` = 180、
  最后一行是 180 号（产品id 700000000344），滚动到底正常；`tsc` 通过。
  截图 `docs/_selfcheck/demo-dataset-all-rows.png`。
- **涉及文件**：`frontend/src/features/bi-dashboard/TestDataPanel.tsx`。

## 2026-11-13 · 数据：「测试数据集」换成真表（180 行 / 26 字段，对齐榜单端口径）

- **背景**：用户把自己整理的「测试数据2026.11.13.csv」补全成 180 行 / 25 列（3 个月量、ID 列配齐、31 个省），
  要求用它**替换「测试数据集」里的数据**，并让组件库那些卡的数据跟着同步。
- **改法**：
  1. 把 CSV 抄进仓库 `backend/app/components/data/demo_sku.csv`，`seed_demo.py` 重写成「读 CSV → 建表 → 灌数 → 同步字段」，
     不再随机造数；字段名取 CSV 表头，物理列名沿用榜单端那套（`platform / brand / category / board / price_avg /
     sales_lower / sales_tier / heat_score / bad_review_cnt / main_selling_point …`），换绑真实数据集时不用改绑定；
  2. 「日销量」CSV 里是 `999+` 档位文本：拆成 **日销量（整数，可求和）/ 日销量档位（文本）** 两个字段，和真实数据集同口径；
  3. 幂等三层：表结构对不上 → 重建表；行数或产品 id 指纹对不上 → 整表重刷；字段集合对不上 → 按 CSV 顺序重建字段
     （日常启动不动用户改过的字段名 / 角色）；
  4. 字段改名同步：`商品标题 → 产品标题`、`品类 → 种类`（删除 搜索文本 / 销量增速 / 链接ID，新增 11 个字段），
     `seed_base.BASE` 4 个模板 + 组件库 4 行 spec + 33 个画板绑定一起改，只改 `binding.dataset_id == 20` 的元素；
     业务数据集（2 / 16 / 21 / 27 / 28 / 37…）里的同名字段一个都没碰 —— 脚本 `scripts/rebind_demo_fields.py`，
     改前把 doc 备份到 `/tmp/doc{id}-backup-rebind-20261113.json`；
  5. 演示看板 57（散点相关性）的副标题原来是「预期：负相关 / 强正相关 / 无相关」，数据换掉后这些结论不再成立，
     改成中性描述（只留「气泡 = 差评数」）。
- **验证**（重启后端后真机跑）：
  - 表：`bi_demo_sku` 180 行 / 180 个产品 id、平台 60/60/60、26 个字段且顺序 = CSV 表头；
  - 测试数据集页：26 列（产品id / 产品标题 / 平台 / 品牌 / 种类 / 榜单 / 上架时间 / 价格带 / 均价 / 日销量 / 日销量档位 /
    榜单排名 / 热销指数 / 霸榜天数 / 上架天数 / 差评数 / 链接 / 主卖点 / 副卖点 / 痛点 / 5 个 ID 列 / 省份），数据为新表；
  - 组件库：`preview-batch` **23/23 张卡全部出数、0 报错**；卡片墙 指标卡 151,880、品牌A/C/B/N 排行、平台A/B/C 漏斗、
    明细表 180 条都跟着新数据走；
  - 演示看板 57 四张散点正常渲染（240 → 180 点，`产品标题` 维度）；业务看板 58（未涉及）照常渲染 26 个 SKU、筛选「品类 → 仓鼠食品」不变；
  - 截图 `docs/_selfcheck/demo-dataset-v2.png` / `demo-cardwall-v2.png` / `demo-board57-v2.png`。
- **涉及文件**：`backend/app/components/seed_demo.py`、`backend/app/components/data/demo_sku.csv`（新增）、
  `backend/app/components/seed_base.py`、`scripts/rebind_demo_fields.py`（新增）、`AGENTS.md`（规则 1 节补「演示数据集」）。
- **说明**：折线 / 面积图模板按「指标值 TOP10」取点，所以趋势卡看起来是乱的 —— 这是模板既有口径，和这次换数据无关，
  要改成按时间升序全量的话说一声。
- **迭代（同日，用户要求）**：这行数据集从「测试数据集」改名为 **「测试-01」**（页面标题仍是「测试数据集」）。
  关键点：以后认它**只按物理表 `bi_demo_sku`**，不再按名字 —— 落库 `seed_demo.DATASET_NAME`、改名保护 / 删除保护
  （`semantic/router.py`）、组件库缩略图兜底（`components/router.py::_demo_dataset_id`）都改成按表认；
  老环境启动时 `ensure_demo_dataset` 会把还叫「测试数据集」的那行就地改名（`rename_dataset` 只写 name 一列）。
  验证：接口 `POST /datasets/test` 返回 `测试-01`、列表不再重复建行、改接口名仍 403、组件库 23/23 张卡出数（指标卡 151,880）。
- **迭代（同日，用户要求「上架时间改成半年跨度，时间更密集」）**：`bi_demo_sku` 的 180 行重排到
  **2026-05-04 ~ 2026-11-03（183 天，每天最多一条 SKU）**，`上架天数` 跟着重算（0~183）、
  47 行原本「霸榜天数 > 上架天数」的压到上限；其余列一个没动。仓库 CSV 与桌面那份「-补全版」一起改。
  - 顺带治了两个真问题：① 演示数据的幂等判定从「行数 + 产品 id」换成 **CSV 内容指纹**（新表 `bi_demo_meta`，迁移 032），
    只改某一列（比如这次只改日期）也能触发重刷；② 折线图 / 面积图原来按「指标值」排序，画出来是「值最大的 10 天」、
    时间轴乱跳 —— 给模板加 `order_by_dimension`（按时间升序 + top_n 400），并修 `resolver` 里那句无条件的按值重排
    （带这个标记的卡保留 SQL 的时间顺序）。现在趋势卡是 2026-05-04 → 2026-11-03 的 **180 个日节点**。
  - 验证：`select min/max(listed_at)` = 2026-05-04 / 2026-11-03、`count(distinct listed_at)` = 180、
    霸榜天数 > 上架天数 = 0 行、把 meta 指纹改坏再 ensure 会整表重刷（负例）；页面明细表日期 2026-05-04 起、
    组件库趋势卡 180 点升序、业务看板 58 渲染不变；截图 `docs/_selfcheck/test-dataset-half-year.png`、
    `test-dataset-trend-dense.png`。
  - 说明：后端 pytest 现为 **243 passed / 3 failed**，3 条失败都在**未入库**的 dbt·LookML 导入模块
    （`app/semantic/importer.py` + `tests/test_model_import.py` 都是未跟踪的新文件，WIP 自己的期望没对齐），与本次无关。

## 2026-11-13 · 数据：「测试数据集」脱敏（平台 → 平台A/B/C，品牌 → 品牌A~H）

- **背景**：演示数据集里是真实平台名（拼多多 / 天猫）和真实品牌（麦富迪 / 网易严选 …），
  组件库缩略图、看板截图、对外演示都会带出去；用户要求平台改成 平台A / 平台B / 平台C，品牌一并脱敏。
- **改法**（`backend/app/components/seed_demo.py`）：
  1. `PLATFORMS` = 平台A / 平台B / 平台C（240 行按 80 / 80 / 80 均匀铺，不再两平台交替）；
  2. `BRANDS` = 品牌A ~ 品牌H（8 个，各 30 行）；
  3. 商品标题里夹着的真实品牌名一并去掉（「2罐麦富迪每日洁齿…」「网易严选宠物零食大礼包…」），
     `搜索文本` = 标题 + 品牌 + 榜单，跟着一起变成 品牌A/B/C…；
  4. 幂等判定加一条：**表里现有平台 / 品牌的取值集合对不上生成器 → 整表重刷**，
     老环境（旧数据是拼多多/天猫）启动或打开「测试数据集」时自动脱敏，不用手工跑脚本；演示表只读、不承载业务，重刷无风险。
- **验证**：
  - `SELECT platform/brand ... group by` → 平台A/B/C 各 80、品牌A~H 各 30，共 240 行；
  - 老数据自愈：手工把一行改回「拼多多」→ 调 `ensure_demo_dataset` 无 force 也整表重刷回 平台A/B/C，再调一次不重刷（幂等）；
  - 真实页面（重启后端后）：测试数据集明细表 平台 / 品牌 / 搜索文本 全部新值，无旧值残留；
    组件库 23 张卡缩略图（环形图 / 热力矩阵 / 转化漏斗按平台、排行按品牌）显示 平台A/B/C、品牌A~H；
    演示看板 57「散点相关性」240 点照常。
  - 截图 `docs/_selfcheck/demo-data-desensitized.png`、`docs/_selfcheck/demo-cardwall-desensitized.png`。
- **没动的两处**（有代价，等用户拍板）：组件库里「筛选栏」模板的平台默认选项、「头标卡」模板的副标题仍是
  拼多多 / 天猫 —— 那是拖到**真实看板**时的默认值，改成 平台A/B/C 会让真实看板的平台分套默认对不上数据。
- **涉及文件**：`backend/app/components/seed_demo.py`。

## 2026-11-13 · 新增：ClickHouse 连接器（驱动接入 + 方言修正）

- **背景**：类型栏一直有 ClickHouse，但驱动没装（SQLAlchemy plugin 缺失），建了源也取不出数；
  另外 ClickHouse 会拿 SELECT 别名替换同名源列 —— 时间粒度 `toStartOfMonth(dt) AS dt` 的 GROUP BY / ORDER BY
  会直接报 `NOT_AN_AGGREGATE`。
- **改法**：
  1. `requirements.txt` 增加 `clickhouse-sqlalchemy==0.3.2` + `clickhouse-driver==0.2.11`；
     连接串按端口选驱动：8123 → `clickhouse+http`，其余 → `clickhouse+native`（9000），
     手填 `clickhouse://` 自动改写为 native；前端 ClickHouse 默认端口改 9000；
  2. 原生驱动连接加 `settings={"prefer_column_name_to_alias": 1}`（列名优先于别名，解决上面的别名替换问题）；
     数据源引擎与直连查询两条链路都加了；
  3. `builder`：ORDER BY 时间粒度维度时**按粒度表达式排序**（不再用别名），
     顺带把 MySQL 的 `ONLY_FULL_GROUP_BY` 同类问题一起收掉（MySQL 用 `(expr IS NULL)` 前置键）。
- **验证**：
  - `POST /api/bi/sources/test`（clickhouse → 127.0.0.1:9000）→ 400 `连接失败：Connection refused`：
    驱动真的发起连接，不再报「驱动未安装」；
  - 嵌入式 ClickHouse 26.9（`chdb`，验完已卸载）真实执行我们生成的 SQL：分组 + `ILIKE` + `NULLS LAST`
    返回 A店 300.5 / B店 120 / C店 10；`toStartOfMonth` 月度返回 3 个月；`IN` + `LIMIT/OFFSET` 生效；
  - 单测：`tests/test_source_urls.py` 6 条（scheme 选择 / URI 归一）、方言单测 7 条（MySQL 粒度改按表达式排序）；
  - 回归：直连 PG 查询正常、看板 57/58/107 渲染 0 error、E2E 7 passed、后端 **236 passed**。
- **说明**：本机没有 ClickHouse 实例，Docker Hub 拉镜像超时，**TCP 驱动的真实往返未验证**；
  SQL 语义已在嵌入式 ClickHouse 上跑通。要复验：`pip install chdb` 后按「建表 → `build()` → 执行」即可，
  或在有 CH 实例的环境用 `test_source` / 直连数据集走一遍。
- **涉及文件**：`backend/requirements.txt`、`backend/app/sources/repository.py`、`backend/app/query/{live,builder}.py`、
  `backend/tests/{test_source_urls.py,test_query_dialects.py}`、`frontend/src/features/bi-dashboard/constants.tsx`。

## 2026-11-13 · 新增：字段级血缘（P4 语义治理收尾）

- **背景**：改字段（改来源列 / 角色 / 删字段）前，没人知道这个字段被哪些看板的卡片当维度、指标或筛选用到；
  指标侧已有影响分析，字段侧还缺一层。
- **改法**：
  1. `app/dashboards/sources.py`：`field_hits_in_doc`（纯函数）在一份看板文档里找使用点 ——
     绑定了该数据集的元素中，字段出现在 `binding.dimension / dimensions / split / metric`，
     以及筛选栏 `filter.fields[].column`（筛选栏靠 `dataset_map` 或元素绑定挂到数据集）；
     `usages_of_field` 遍历在用看板（软删不算）并去重；
  2. 接口 `GET /api/bi/semantic/datasets/{id}/fields/usages`：一次返回每个字段的使用数与明细
     （看板名 / 页面 key / 元素 key / 角色：维度 / 指标 / 筛选 · 标签）；
  3. 前端数据集抽屉「字段」页签新增「使用」列：有引用显示可点的「使用 N」胶囊，点开列看板 + 元素，
     点条目直接打开对应看板；没有引用显示「—」。
- **验证**（真实看板数据）：
  - 数据集「榜单端-天猫」：11 个字段有引用（日销量 7 处、种类 6 处、平台 2 处…），
    弹窗显示「2 个看板 · 7 处」，条目带角色（指标 / 维度 / 筛选）；
  - 数据集「测试数据集」：商品标题 4 处（散点图三个维度使用），日销量 4 处；
  - 单测 `tests/test_field_lineage.py` 3 条：指标 / 维度命中、筛选字段经 `dataset_map` 命中、别的数据集不串；
  - 截图 `docs/_selfcheck/field-lineage-list.png` / `field-lineage-dialog.png`；
  - 门禁：后端 **230 passed**、`tsc` 通过、E2E 7 passed；后端已重启。
- **说明**：血缘按文档实时解析（看板数量级很小），不依赖账本；手工 SQL 改过 `doc` 的看板也能算准。
  数据源 / SQL 面板这类不经过数据集的取数不在统计范围内。
- **涉及文件**：`backend/app/dashboards/sources.py`、`backend/app/semantic/router_items.py`、
  `backend/tests/test_field_lineage.py`（新增）、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`。

## 2026-11-13 · 新增：数据集行列权限 + 模板复制保留脱敏（P4 收口）

- **背景**：既有行级 / 脱敏规则都按「物理表名」配，模板复制会把数据搬到 `bi_tpl_*` 新表，
  规则跟着表名一起失效；数据集侧也没有一处能集中看 / 配自己的行列权限。
- **改法**：
  1. 迁移 `030_dataset_security.sql`：新增 `bi_dataset_row_rule`（user_id / role_name / filter_rule，都空 = 所有人）
     与 `bi_dataset_column_mask`（column_name + 脱敏类型 + 自定义模板），都按 dataset_id 绑定、随数据集删除级联；
  2. `app/security/dataset_rules.py`：规则读写 + 编译校验（非法条件直接 400，坏规则 fail-closed）；
     行级条件与表级 RLS **同时 AND** 进 WHERE；列级先套表级脱敏、再套数据集脱敏（同列以数据集为准）；
  3. 生效链路：`query.executor.run` 与 `query.live.run_live` 都接受 `dataset_id`，
     语义查询接口 / 看板卡片解析（`components/resolver`）都传了；直连结果缓存键带上 dataset_id，避免不同数据集串味；
  4. 接口：`GET /bi/semantic/datasets/{id}/security`、`POST/DELETE .../security/row-rules`、
     `POST .../security/masks`、`DELETE .../security/masks/{column}`（改权限限 owner / 管理员）；
  5. 模板复制：`template_market._copy_dataset` 把行级规则与脱敏整组复制到新数据集（不再依赖物理表名）；
  6. 前端数据集抽屉新增「权限」页签：行级规则（范围 / 条件 / 备注）与列级脱敏（字段 / 方式 / 模板）都可增删。
- **验证**（真实接口 + 真实看板链路）：
  - 临时数据集（`bi_demand_overview`，4 行）：加规则 `source_name = '搜索词（人气）'` + `source_name` 脱敏后，
    查询 SQL 注入 `WHERE (source_name = …)`、只返回 1 行且值为 `***`；
  - 反证：删掉两条规则再查 → 4 行、明文原值，确认变化就是规则造成的；
  - 模板复制：调用 `_copy_dataset` 生成 `bi_tpl_999001_45` → 新数据集上 1 条行级规则 + 1 条脱敏（与原数据集一致）；
  - 反例：条件写 `source_name = ; DROP TABLE x` → 400「行级条件不合法：规则中不允许出现分号」；
  - 清理：临时数据集、模板副本（表 + 数据集行）与规则全部复核为 0；
  - 截图 `docs/_selfcheck/dataset-security-tab.png`；
  - 门禁：后端 **227 passed**、`tsc` 通过、E2E 7 passed；后端已重启（迁移 030 已应用）。
- **说明**：规则里的行级条件按列名写（迁移到模板副本后表名会变，条件里不要写表名）；
  数据源 / SQL 面板这类不走数据集的入口仍只受表级规则约束。
- **涉及文件**：`backend/schema/migrations/030_dataset_security.sql`（新增）、
  `backend/app/security/dataset_rules.py`（新增）、
  `backend/app/query/{executor,live}.py`、`backend/app/components/resolver.py`、
  `backend/app/semantic/{router,router_items}.py`、`backend/app/template_market.py`、
  `backend/tests/test_dataset_rules.py`（新增）、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`。

## 2026-11-13 · 新增：指标认证 / 版本历史 / 影响分析（P4 语义治理）

- **背景**：指标口径被改过之后，看板上的数字会静默变化，但没人知道改了什么、谁改的、影响哪些卡片；
  也没有「这个指标是确认过的口径」这类标记。
- **改法**：
  1. 迁移 `029_metric_governance.sql`：`bi_dataset_metric` 增加 `certified / certified_by / certified_at / version`，
     新建 `bi_metric_version`（每次口径变更留一版快照，含改动人 / 时间 / 备注）；
  2. 口径变更判定只看「聚合表达式 + 格式」：变了才 version+1、**自动掉认证**、写一条 `口径变更` 快照；
     只改中文名 / 描述不算口径变更（不升版本）；
  3. 接口：`GET .../metrics/{id}/versions`、`POST .../metrics/{id}/certify`、`GET .../metrics/{id}/usages`
     （影响分析读 `bi_dash_item_source` 账本，按「数据集 + 指标名」找在看板 / 页面 / 元素）；
  4. 前端数据集抽屉「指标」页签：新增「状态」列（已认证 / 未认证 + vN，点胶囊可直接切换认证），
     行尾加「认证 / 版本历史 / 影响分析」三个入口；版本历史弹窗按版本倒序列出表达式与改动人，
     影响分析弹窗列看板 + 元素，点条目直接打开对应看板。
- **验证**（真实接口 + 临时数据，验完已删）：
  - 临时数据集 → 新建指标（v1，认证）→ 改表达式（v2、认证自动变 false）→ 只改描述（仍 v2）→
    版本历史 2 条（`新建指标` / `口径变更`，改动人 admin）；建真看板引用该指标后影响分析返回 1 看板 / 1 元素；
  - 反例：不存在的指标查影响分析 → `指标不存在：999999`（404）；
  - 清理：临时看板（软删后又按 id+name 硬删）、临时数据集、指标与版本记录均复核为 0 条；
  - 截图 `docs/_selfcheck/metric-governance-tab.png` / `metric-governance-versions.png` /
    `metric-governance-usages.png`；
  - 门禁：后端 **222 passed**、`tsc` 通过、E2E 7 passed；后端已重启（迁移 029 已应用）。
- **说明**：影响分析依赖保存看板时重建的账本；手工 SQL 改过 `doc` 的看板要重新保存一次才会进账本。
- **涉及文件**：`backend/schema/migrations/029_metric_governance.sql`（新增）、
  `backend/app/semantic/{models,repository,router_items}.py`、
  `backend/tests/test_metric_governance.py`（新增）、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`。

## 2026-11-13 · 新增：已接入表自动同步 + 同步失败提示（P4 第三批）

- **背景**：上一批做了「新鲜度」提示，但过期了还得手动点「重新同步」；数据要每天自动更新才有意义。
- **改法**：
  1. 迁移 `028_source_sync.sql`：`bi_source_table` 增加 `sync_interval_minutes`（0 = 关闭）/ `last_sync_status` /
     `last_sync_error`，并给到期扫描建部分索引；
  2. `app/sources/sync_scheduler.py`：后台线程默认每 60s 扫一次到期表（`synced_at + 间隔 <= now`），
     每轮最多 `BI_SYNC_MAX_PER_RUN`（默认 3）张，单表独立 Session、失败不影响其它表；
     多 worker 用 PG advisory lock 去重；`BI_SYNC_INTERVAL_SECONDS=0` 可整体关闭（表上的配置保留）；
  3. 接口：`PATCH /bi/sources/files/{id}/schedule` 设间隔（0 或 15 分钟 ~ 7 天），
     `POST /bi/sources/sync/due` 立即跑一轮（手动验证 / 补跑用）；
     列表返回 `sync_interval_minutes` / `next_sync_at` / `last_sync_status` / `last_sync_error`；
  4. 手动「重新同步」也会写 `last_sync_status`，失败原因同口径落库；
  5. 前端「数据源」页新增「自动同步」列（关闭 / 每小时 / 每 6 小时 / 每天），
     最近一次同步失败的表的表名旁显示红点 +「同步失败」，tooltip 给失败原因。
- **验证**（真实源库 + 反例）：
  - 表 1（本地 PG 源，4 行）设 15 分钟并把 `synced_at` 回拨 20 分钟 → 跑一轮：`due=2 / synced=1 / failed=1`，
    `bi_demand_overview` 真实重拉 4 行、`last_sync_status=ok`、同步时间刷新；
  - 失败路径：插入一张指向 `dm.definitely_missing` 的临时登记行（同样到期）→ 结果 `ok=false`，
    `last_sync_error=源表不存在或无权访问`，进程不崩、不影响同轮其它表；临时行验完已删除；
  - 反例：间隔填 3 分钟 → `同步间隔需在 15 分钟到 7 天之间（0 = 关闭）`（400）；
  - 前端自检截图 `docs/_selfcheck/datasource-auto-sync.png`（8 列不折行、长表名省略号 + 原生 title）；
  - 门禁：后端 **219 passed**、`tsc` 通过、E2E 7 passed；后端已重启（调度线程随应用启动）。
- **说明**：定时同步只重拉数据，不会自动改结构；源表结构变了仍走上一批的「结构检查 + 重新同步」确认。
- **涉及文件**：`backend/schema/migrations/028_source_sync.sql`（新增）、
  `backend/app/sources/sync_scheduler.py`（新增）、`backend/app/sources/repository.py`、
  `backend/app/sources/router.py`、`backend/app/main.py`、
  `backend/tests/test_source_sync_schedule.py`（新增）、
  `frontend/src/features/bi-dashboard/DataSources.tsx`。

## 2026-11-13 · 新增：数据源结构快照 / 漂移检查 / 数据新鲜度（P4 第二批）

- **背景**：源表加列 / 删列 / 改类型时，本地物理表不会自动变，图表会静默出错（查不到列、类型不匹配）；
  「已接入表」也只有一行同步时间，看不出数据是不是早就过期了。
- **改法**：
  1. 迁移 `027_source_schema.sql`：`bi_source_table` 增加 `columns_snapshot`（字段快照）/ `schema_hash`（指纹）/
     `checked_at`（上次检查）/ `drift`（最近一次检查的增删改明细）；
  2. 接入 / 重新同步成功时落基线快照（类型取源库 inspector，不是 pandas 推断），并清空旧漂移；
  3. `POST /api/bi/sources/{id}/schema-check`：只读源库结构逐表对比，有变更写 `drift`、无变更清空；
     迁移前接入、没有基线的表只补基线不报「全部新增」（避免误报一屏）；
  4. `POST /api/bi/sources/files/{id}/resync`：单表重新同步（重拉数据 + 刷新快照 + 清空漂移；文件表明确拒绝）；
  5. `GET /api/bi/sources/files` 增加 `freshness`（新鲜 <24h / 待更新 <7d / 过期）/ `age_hours` / `column_count` /
     `schema_hash` / `checked_at` / `drift`；
  6. 前端「数据源」页：数据源行加「检查结构变更」，已接入表新增「新鲜度」列（胶囊 + 距今时长）、
     结构变化时表名旁打「结构已变 · N」并 tooltip 列出增删改明细、每张表可「重新同步」。
- **验证**（真实源库，反例齐全）：
  - 远端 PG 源（榜单端-拼多多）3 张表：首次检查补基线（24 / 30 / 30 列），复检 `changed=0`；
    源 1、源 4 各补 1 张基线，5 张表全部有快照；
  - 漂移：把 `dm.v_bangdan` 快照人为改成 1 列后检查 → `changed=1`、新增 29、类型变更 1；
  - 恢复：对该表执行「重新同步」→ 真实重拉 62 行、快照回到 30 列、`drift` 清空，同步时间刷新为当下；
  - 反例：不存在的表 id → `已接入表不存在`（400）；不存在的数据源 → `数据源不存在`（404）；
  - 前端 Playwright 自检：新鲜度列 / 胶囊渲染正常、点「检查结构变更」出「检查 N 张表」提示，
    截图 `docs/_selfcheck/datasource-freshness.png`、`datasource-schema-check.png`；
  - 门禁：后端 **213 passed**、`tsc` 通过、E2E 主链路 7 passed。
- **说明**：结构检查是显式动作（按钮触发），没有做后台定时轮询；定时同步 / 调度仍留到下一批（P4 余项）。
- **涉及文件**：`backend/schema/migrations/027_source_schema.sql`（新增）、`backend/app/sources/repository.py`、
  `backend/app/sources/router.py`、`backend/tests/test_source_schema.py`（新增）、
  `frontend/src/features/bi-dashboard/DataSources.tsx`。

## 2026-11-13 · 修复：跨方言 SQL 编译（P4 连接器第一批）

- **背景**：直连模式（`app/query/live.py`）会把 `QueryObject.dialect` 覆盖成源库类型，但 `builder.build` 一直按 PG 生成
  双引号 + `ILIKE` + `NULLS LAST`；接 MySQL / SQL Server 会直接语法错，等于「能建数据源、取不出数」。
- **改法**：
  1. `quote(ident, dialect)` 按方言加引号：MySQL 反引号、SQL Server 方括号、其余双引号；先 `normalize_dialect`
     收敛别名（postgresql→postgres、sqlserver/mssql→tsql、mariadb/doris/tidb/starrocks→mysql），schema 表名逐段加引号；
  2. 关键词搜索：MySQL / SQL Server / Oracle / DB2 / Presto / Hive / Impala 降级 `LIKE`（这些库没有 `ILIKE`）；
  3. 排序：MySQL / SQL Server 不支持 `NULLS LAST` → 用 `(col IS NULL)` 当前置排序键，空值仍排最后（与 PG 口径一致）；
     时间粒度别名不补这个键（MySQL 会把别名解析成源列，`ONLY_FULL_GROUP_BY` 直接报错）；
  4. MySQL 家族连接串固定 `mysql+pymysql://`（手填 `mysql://` / `mariadb://` 也改写）；
     `requirements.txt` 的 `PyMySQL==2.2.8` 改成发行版真实版本 `1.2.4`（2.2.8 是包内 `__version__` 的遗留值，PyPI 没有该版本，`pip install -r` 必失败）；
  5. 数据源引擎按「id + 连接串指纹」缓存（1 小时，改地址/密码自动释放旧池），测连通 / 同步不再每次新建连接池；
     直连查询那条链路仍保留 30s 语句超时，两者刻意分开（同步几十万行不能被 30s 打断）。
- **验证**：
  - `tests/test_query_dialects.py` 新增 7 条（引号矩阵 / MySQL 反引号 + `LIKE` + 无 `NULLS LAST` / MySQL `DATE_FORMAT` 粒度 /
    SQL Server 方括号 / PG 保留 `ILIKE` + `NULLS LAST` / ClickHouse 双引号 / RLS + `IN` 绑定）；后端全量 **207 passed**；
  - 真机 MySQL：起临时 MySQL 8（Docker，3307，验完即删），`build` 出的 SQL 直接执行——分组 + `LIKE` + `ORDER BY`
    返回真实行（A店 300.50 / B店 120.00 / C店 10.00），按月粒度返回 `2026-01-01 / 2026-02-01`；
    `run_live` 全链路（方言覆盖 / 表存在校验 / 结果缓存）返回 3 行；
  - 反例：MySQL 查不存在的表 → `源库里没有这张表`；账号错 → `连接失败：Access denied`（不再是「驱动未安装」）；
  - 回归：远端 PG 直连（源 3 `dm.v_bangdan`）真实返回 2 天行数（36 / 26）；看板 58（16 卡）/ 107（9 卡）渲染 0 error。
- **说明**：ClickHouse / SQL Server 驱动仍未安装（`clickhouse-sqlalchemy` / `pyodbc`），现在会给「驱动未安装」的明确提示；
  装驱动 + 改连接串即可接，SQL 侧已按方言生成。
- **涉及文件**：`backend/app/query/builder.py`、`backend/app/sources/repository.py`、`backend/requirements.txt`、
  `backend/tests/test_query_dialects.py`（新增）。

## 2026-11-13 · 新增：Storybook 渲染器用例（P3）

- **背景**：新增 / 调图表只能进画布、靠真实看板数据看效果，既慢又容易被数据状态干扰；需要一个隔离环境先把样式与空态调好。
- **改法**：
  1. 接入 Storybook 8（`storybook` + `@storybook/react-vite`，Vite 5 / React 18），配置 `.storybook/main.ts` 与
     `preview.tsx`（套应用浅色主题 + 看板底色，统一 712 宽画框）；
  2. 新增 `src/features/components/renderers/Renderers.stories.tsx`（8 条）：指标卡 / 柱状图 / 饼图 / 漏斗 / 仪表盘 /
     瀑布 / 排行列表 / 明细表，全部用 mock payload，不连后端；
  3. 脚本：`npm run storybook`（:6006）、`npm run build-storybook`；CI 前端 job 增加 `npm run build-storybook` 作编译门禁；
     `frontend/storybook-static/` 进 `.gitignore`。
- **验证**：
  - `npm run build-storybook` → 构建成功（产物 1.4MB 主 chunk，仅静态预览，不进应用 bundle）；
  - 静态站点真实打开：柱状图 story canvas 渲染、排行 story 3 条数据完整，截图
    `docs/_selfcheck/storybook-bar.png`、`storybook-rank.png`；
  - `tsc --noEmit` 通过（stories 纳入类型检查）、`npm test` 52 passed。
- **说明**：地图 story 暂未纳入（`MapCard` 需要 `/api/bi/maps/china` 的 GeoJSON，隔离环境没有后端），地图仍在组件库预览验证。
- **涉及文件**：`frontend/.storybook/{main.ts,preview.tsx}`（新增）、
  `frontend/src/features/components/renderers/Renderers.stories.tsx`（新增）、`frontend/package.json`、
  `.github/workflows/ci.yml`、`.gitignore`。

## 2026-11-13 · 新增：错误日志（前端上报落库 + 后端异常捕获 + 管理页）

- **背景**：之前前端报错只写进后端日志文件，服务重启就丢，也看不到是谁、在哪个页面出的错；
  生产排障缺一条「页面报错 → 可查」的闭环（Sentry 暂不接外部服务）。
- **改法**：
  1. 迁移 `026_error_log.sql`：`bi_error_log`（source / level / message / stack / url / user_id / username /
     user_agent / extra jsonb / created_at，按时间与来源建索引）；保留 `BI_ERROR_RETAIN_DAYS`（默认 30 天），每小时最多清理一次；
  2. `POST /api/report` 改为真实落库（保持原路径，CSRF 已豁免）：可选登录（带 token 记用户），
     message / stack / url 全部截断；前端 `reportError` 增加 **10s 同页同错去重**，避免错误风暴刷表；
  3. 后端 `global_exception_handler` 捕获未处理异常时同步落一条 `source=backend`（方法 + 路径 + traceback），落库失败不影响 500 返回；
  4. `GET /api/bi/errors`（仅管理员，成员 403）：最近错误 + 24h / 总量 / 按来源计数，支持 source / level / limit 筛选；
  5. 「操作审计」页新增「错误日志」表：时间 / 来源（前端·后端）/ 用户 / 信息（hover 看堆栈）/ 页面。
- **验证（真实链路 + 反例）**：
  - curl 匿名上报 → 200 `{id}`；带 token 上报 → 记录 `user_id=1 / username=admin`；空 message → 跳过不写；
  - 直接调用全局异常处理器（`POST /api/bi/dashboards/999/render`）→ 返回 500，落库 `source=backend` + traceback；
  - Playwright 在页面真实抛错 → 全局监听上报 → 审计页出现该条（来源前端 / admin / 页面 `/bi`）；
  - 成员（小宝）请求错误列表 → 403「只有管理员可以查看错误日志」；
  - 截图 `docs/_selfcheck/error-log.png`；验证用的 4 条记录已删除（DB 复核 0）；
  - 回归：后端 **200 passed**（新增 2 个纯函数用例）、前端 52 passed、`ui_rules`（tsc 通过）、`visual` 4 passed、E2E 7 passed、构建与预算通过。
- **说明**：错误日志只存排障字段（不含 SQL / 业务数据）；外部 Sentry 仍是可选增强，当前不依赖任何 SaaS。
- **涉及文件**：`backend/schema/migrations/026_error_log.sql`（新增）、`backend/app/errors/`（新增 repository + router）、
  `backend/app/main.py`、`backend/tests/test_errors.py`（新增）、`frontend/src/components/common/ErrorBoundary.tsx`、
  `frontend/src/pages/AuditLogPage.tsx`。

## 2026-11-13 · 新增：数据集名称随时可改（只改名字，绝不碰数据库连接）

- **诉求**（原话）：「数据集这里的名称，改成：可以再次编辑修改（但不能影响数据库连接问题）」。
  原来只有抽屉里的「基本信息」页签能改名，且列表 / 抽屉标题上的名字看着像只读；用户想直接改，同时担心改坏直连。
- **改法**：
  1. 新接口 `PATCH /api/bi/semantic/datasets/{id}/name`：UPDATE 的 SET 只有 `name` / `updated_at`，
     物理表、取数方式、`source_id`、`sql_text` 在语句层面不可能被这条路径改动；校验去空白 / 非空 / ≤120 字 / 全局重名，
     并发撞名由唯一索引兜底（`IntegrityError` → 400 而不是 500）；权限沿用删除的口径（公共 / 本人 / 管理员），
     「测试数据集」是组件库公共资产，明确不允许改名。
  2. 就地改名 `InlineRename`（列表行 + 抽屉标题）：hover 名称浮出铅笔（120–160ms 过渡），点铅笔或双击标题变输入框，
     回车 / 失焦保存、Esc 取消、空名或未改不请求；失败（重名等）回退原名并弹红色提示，成功后只替换这一行的名称与更新时间，
     不整表重载（列表不闪、搜索条件下标立刻跟着变）。
  3. 名称**只有一个输入入口**（§3.1）：抽屉「基本信息」里重复的「数据集名称」输入框删掉（名称就是上面那个标题，点铅笔改），
     那里只剩物理表 / 取数方式 / 描述 —— 避免表单草稿与就地改名两条路径写出不一致的名字。
  4. 数据集列表排除「测试数据集」改成按物理表 `bi_demo_sku` 判定，改名也不会把它漏进列表。
- **为什么**：名字是展示信息，绑定与取数全按 dataset_id（`bi_dash_item_source` 读时 join 数据集名），改名天然不影响看板与连接。
- **涉及文件**：`backend/app/semantic/repository.py`（`normalize_dataset_name` / `rename_dataset`）、
  `backend/app/semantic/router.py`、`backend/tests/test_semantic.py`、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`。
- **验证（正反两面）**：
  - 真实接口：`榜单端-抖音`（直连 · 源库 6）改名 → 200，`physical_table=dm.dm_dy_product / conn_mode=live / source_id=6 / 28 字段` 全部不变，
    连通性圆点仍「连接正常」；再改名回原名；
  - 改名期间 `POST /datasets/21/query` 仍 200 且 SQL 打到原物理表；`GET /datasets/21/usages` 改名前后都是 **50** 条（看板引用不断）；
  - 反例：重名 → 400「数据集名称已存在：直连-榜单端-天猫」；空名 → 400；130 字 → 400；`测试数据集` → 403；不存在 id → 404；
    普通成员改别人的数据集 → 403「只能修改自己创建的数据集的名称」；
  - 真机（CDP）：hover 铅笔 opacity 1 → 点开输入框（值 = 原名、已聚焦）→ 回车后列表就地变名与更新时间；
    抽屉标题铅笔 / 双击都能改，重名时红色 toast + 标题回退；「基本信息」页签已无重复名称输入框；控制台无报错；
  - 回归：后端 **198 passed**、`ui_rules.sh` 通过（`tsc` 0 错、无「数据集名称」重名 label）；
  - 截图 `docs/_selfcheck/dataset-rename-1-list.png` … `-11-duplicate-toast.png`。
- **说明**：改名会刷新 `updated_at`（列表「更新时间」随之变化，属预期）；物理表 / 源库表名不提供改名 —— 那才是会动连接的东西。

## 2026-11-13 · 新增：Playwright E2E 主链路（P3）

- **背景**：视觉回归只守 4 个静态页面的版式，登录跳转 / 看板渲染 / 导出菜单 / 组件库预览这些「点进去还能不能用」没有自动化守着。
- **改法**：
  1. 新增 `frontend/e2e/main-flow.spec.ts`（4 条用例，`npm run e2e`）：
     未登录访问 `/bi` → 跳登录页；我的看板列表能打开；成品看板图表能渲染 + 导出菜单含 Excel / PDF / PNG / HTML；
     组件库 23 类含「中国地图」，点开放大能渲染；
  2. token 仍走 `scripts/visual_tokens.py` 注入 localStorage（不调用登录接口，不会踢掉正在用的浏览器会话）；
  3. 看板 id 默认 57，可用 `MCBI_DASHBOARD_ID` 覆盖；只断言「能渲染」，不依赖具体业务数值。
- **验证（正反两面）**：
  - `npm run e2e` → **4 passed（7.7s）**；
  - 反例：`MCBI_DASHBOARD_ID=999999 npm run e2e` → 成品看板用例在 canvas 断言处失败（说明断言真的在守）；
  - 与 `npm run visual` 互不影响（visual 仍 4 passed）。
- **说明**：E2E 需要本地前后端都在跑（:5300 / :8300）与 token 文件，暂不进 CI（CI 无浏览器 + 无服务）；
  `frontend/test-results` 为运行产物，验完已删。
- **涉及文件**：`frontend/e2e/main-flow.spec.ts`（新增）、`frontend/package.json`（`e2e` 脚本）。
- **迭代（同日）**：补齐剩余 3 条主链路，共 **7 条** ——
  ① 看板筛选：切「平台 → 拼多多」→ 筛选值更新且地址栏带 `p_platform`；
  ② 模板分享：弹窗字段（模板名称 / 说明 / 分类 / 可见范围）齐全，名称清空时「分享」置灰；
  ③ 团队协同：分享 → 「我的团队」出现该看板 → 取消协同恢复原状（本来就已分享时只断言不取消）。
  验证：`npm run e2e` → **7 passed（15.7s）**；反例：`MCBI_FILTER_DASHBOARD_ID=57` → 筛选用例在
  `[data-filter-select="platform"]` 断言处失败；协同用例执行后 DB 复核 `team_shared=f`、权限记录 0（已恢复）。

## 2026-11-13 · 新增：中国地图组件（P2 收尾）

- **背景**：老板要看各省份的销量分布；地图需要「省份」维度和省级边界数据，这两样之前都没有。
- **改法**：
  1. 新组件 `map`（后端 `spec.py / compute.py / seed_base.py` + 前端 `types / registry / ChartThumb / sizes / QueryPanel / MapCard`），
     组件库 22 → **23 类**；维度绑省份、指标决定颜色深浅（连续渐变），0 / 负值不上色，最多 34 个省级区域；
  2. 地图数据不进前端 bundle：`GET /api/bi/maps/china` 返回省级 GeoJSON（419KB，gzip 117KB，ETag + 缓存一天），
     `MapCard` 按需拉取并 `registerMap`，失败显示「地图数据加载失败」；省份名兼容「广东省」与「广东」；
  3. 演示数据集 `bi_demo_sku` 增加「省份」维度（存量行按 `link_id` 顺序回填，广东 / 浙江 / 江苏权重更高），
     `seed_demo` 重建时同样带省份；
  4. 默认不显示省份名标签（京津 / 江浙沪会互相压住），副标题「颜色越深，指标越高」说明含义；面板可再打开标签；
  5. 点省份 → 走既有 `onSliceClick` 图表联动。
- **验证（真实链路 + 反例）**：
  - 演示数据省份分布：广东 48 / 浙江 36 / 江苏 36 / 北京 24 / 上海 24…，地图预览聚合
    广东 49,026、浙江 34,866、江苏 33,730…（与 SQL 口径一致）；
  - `GET /api/bi/maps/china` → 200 `application/json` 418,671B，`ETag` 命中下一次 **304**，未登录 403；
  - 临时看板（真实 `render_dashboard` 链路）渲染地图卡正常，验完已删除（DB 复核 0）；
  - 反例：未知格式 / 不绑定维度 / 不绑定指标 → 400；省份值与地图不匹配 → 卡片提示「省份值与地图名称不匹配」；
  - 截图 `docs/_selfcheck/map-dashboard.png`、`map-preview.png`、`map-component.png`；
  - 回归：后端 **197 passed**、前端 52 passed、`ui_rules.sh`、`visual` 4 passed（组件库基线已确认并更新）、构建与预算通过。
- **说明**：真实业务表要用地图像素级效果，需要数据里有一列省份名（或城市名映射到省）；没有地理字段的数据集绑地图只会提示不匹配。
- **涉及文件**：`backend/app/components/{spec,compute,seed_base,seed_demo}.py`、`backend/app/maps/`（新增 router + china.json）、
  `backend/app/main.py`、`backend/tests/test_components.py`、`frontend/src/features/components/renderers/MapCard.tsx`（新增）、
  `frontend/src/features/components/{types.ts,registry.tsx,ChartThumb.tsx,sizes.ts,editor/QueryPanel.tsx}`。

## 2026-11-13 · 新增：服务端 PDF / PNG 导出（报表与整页）

- **背景**：之前「PDF」要靠浏览器打印，自动化 / 定时报表 / 邮件里拿不到真正的 PDF 文件；
  老板转发和存档要的是能直接打开的 PDF，以及一张能发群里的长图。
- **改法**：
  1. 新增 `app/reports/browser.py`：调用本机 Chrome / Chromium 无头渲染自包含 HTML 报表 ——
     PDF 走 `--print-to-pdf`（A4 自动分页），PNG 走 CDP `Page.captureScreenshot(captureBeyondViewport)`
     截**整页**（`--screenshot` 只截视口，长报表会被裁掉）；找不到浏览器 / 渲染失败只返回原因，HTML / Excel 照常生成；
  2. 迁移 `024_report_pdf.sql`：`bi_report_run.pdf_path`；定时报表生成时同步产出 PDF，
     站内记录与邮件（钉钉 / 企微 / 邮件）都多一个「下载 PDF」链接（签名 7 天有效）；
  3. 整页导出 `POST /api/bi/reports/export/{id}` 支持 `format=pdf|png`（权限 / 筛选口径与原来一致）；
     报表下载 `/runs/{id}/download?kind=pdf`、签名链接 `/download/{id}/pdf` 同步支持；
  4. 前端预览页「导出」菜单加 PDF / PNG 长图；定时报表「最近生成」每条记录按实际产物显示 HTML / Excel / PDF 按钮；
  5. 顺手修掉报表里导航菜单卡渲染成「— — —」的问题：`kind=nav` 现在列成「市场总览 · 榜单端 · …」一行文字。
- **配置**：`BI_PDF_CHROME`（浏览器路径，默认自动探测 Chrome / Chromium / Edge）、
  `BI_PDF_TIMEOUT`（默认 30s）、`BI_PDF_PNG_WIDTH`（默认 1240）、`BI_PDF_PNG_SCALE`（默认 2 倍图）。
- **验证（真实 Chrome + 反例）**：
  - 看板 58 整页导出 PDF → **4 页 419KB**（中文正常、KPI / 表格 / 条形完整），PNG → **2480×5790**；
  - 前端点「PDF / PNG 长图」真实下载 `666-20261113-1738.pdf` / `.png`；截图 `docs/_selfcheck/pdf-export-menu.png`；
  - 定时报表立即生成 → `has_pdf=true`，`var/reports/58/*.pdf` 头部 `%PDF-`、420KB；
    签名链接 `/download/{id}/pdf` → 200 `application/pdf`，邮件正文含「下载 PDF：…」；
  - 反例：`format=docx` → 400；`BI_PDF_CHROME` 指向不存在路径 → failed（HTML / Excel 不受影响）；临时订阅 / 记录 / 文件已清理；
  - 回归：后端 **195 passed**（新增 4 个渲染 / 签名用例）、前端 52 passed、`ui_rules.sh`、`visual` 4 passed、构建与预算通过。
- **说明**：服务端渲染依赖 Chrome / Chromium —— `backend/Dockerfile` 已内置 `chromium` + `fonts-noto-cjk`
  （镜像约增大 300MB，中文不会出现方块），本机默认自动探测；找不到浏览器时只跳过 PDF，HTML / Excel 照常。
- **涉及文件**：`backend/app/reports/browser.py`（新增）、`backend/schema/migrations/024_report_pdf.sql`（新增）、
  `backend/app/reports/{generate,scheduler,repository,router,tokens}.py`、`backend/tests/test_reports.py`、
  `backend/Dockerfile`、`backend/requirements.txt`（显式声明 `websockets`，PNG 走 CDP）、
  `frontend/src/pages/DashboardPage.tsx`、`frontend/src/features/bi-dashboard/ReportSubscriptionsDialog.tsx`。

## 2026-11-13 · 新增：邮件（SMTP）通知渠道（通知渠道 · 迭代）

- **背景**：钉钉 / 企微之外，老板还要把告警和定时报表发到邮箱（给不同角色各发一份）；
  报表邮件必须带可点的签名下载链接，不能只有一句「已生成」。
- **改法**：
  1. `app/notifications.py` 增加 `valid_emails()`（逗号 / 分号 / 空格分隔、去重、最多 10 个）、
     `build_email()`、`send_email()`；`send(channel="email", …)` 的「地址」就是收件人列表；
     SMTP 配置走环境变量：`SMTP_HOST` / `SMTP_PORT`（默认 25）/ `SMTP_USER` / `SMTP_PASSWORD` /
     `SMTP_FROM`（默认取 user）/ `SMTP_STARTTLS` / `SMTP_SSL`；未配 host 直接返回 failed，不影响站内事件；
  2. 迁移 `023_email_notify.sql`：`bi_alert_rule.email_to` / `bi_report_subscription.email_to`（varchar 500，默认空）；
     仓储读写、告警评估、报表调度全部带上该字段；邮件里附「查看报表 / 下载 Excel」签名链接；
  3. 两个路由校验：`channel=email` 时收件人必填且逐个格式校验（归一化后再存），
     其他渠道清空 `email_to`；切换开关（只传 `enabled`）不会把收件人冲掉；
  4. 前端「指标告警 / 定时报表」弹窗增加「站内 + 邮件」选项与收件人输入框，收件人为空时保存按钮置灰。
- **验证（真实 SMTP + 反例）**：
  - 本地起原始 socket SMTP sink（127.0.0.1:2525），后端进程配 `SMTP_HOST/SMTP_PORT` 真发：
    告警规则命中 → 事件 `notified=email`，sink 收到 `Subject: 指标告警 · …`、`To` 为两个收件人、正文含当前值；
    定时报表立即生成 → `delivered=email`，邮件正文含「查看报表 / 下载 Excel」两个签名链接；
  - 接口：非法邮箱 → 400「请填写收件人邮箱」；`a@x.com, b@y.cn; a@x.com` → 归一化为 `a@x.com, b@y.cn`；
    关闭开关后 `email_to` 保留；未配置 SMTP 时「立即测试」→ `notified=failed`、`notify_error=未配置 SMTP_HOST`；
  - 截图 `docs/_selfcheck/email-notify-alert.png` / `email-notify-report.png`；
  - 回归：后端 **191 passed**（新增 5 个邮件用例）、前端 52 passed、`ui_rules.sh`、`visual` 4 passed、构建与预算通过。
- **说明**：验证用的 SMTP sink、临时规则 / 订阅与事件均已删除（DB 复核为 0）；
  真实环境需自行配 SMTP 账号（企业邮箱 / 邮件服务商），否则渠道会以 `failed` 记录原因。
- **涉及文件**：`backend/schema/migrations/023_email_notify.sql`（新增）、`backend/app/notifications.py`、
  `backend/app/alerts/{repository,evaluate,router}.py`、`backend/app/reports/{repository,scheduler,router}.py`、
  `backend/tests/test_notifications.py`、`frontend/src/features/bi-dashboard/{AlertRulesDialog,ReportSubscriptionsDialog}.tsx`。

## 2026-11-13 · 新增：钉钉 / 企业微信机器人通知渠道

- **背景**：告警和定时报表之前只能推「自定义 Webhook」，老板日常用的是钉钉 / 企业微信群，需要原生机器人格式。
- **改法**：
  1. 新增 `app/notifications.py`：统一 `send(channel, url, title, text, data, links)`，支持
     `webhook`（原业务 JSON）/ `dingtalk`（`msgtype=markdown`，title + text）/ `wecom`（`msgtype=markdown`，content）；
     机器人消息里带「查看报表 / 下载 Excel」链接；超时 `BI_NOTIFY_TIMEOUT`（默认 5s），失败只返回 failed；
  2. 告警与定时报表都改走这个模块：渠道选项扩展为 站内 / 自定义 Webhook / 钉钉机器人 / 企业微信机器人，
     非站内渠道都必须填机器人 Webhook 地址；
  3. 前端两个弹窗（指标告警 / 定时报表）增加渠道选项与对应地址输入提示（钉钉 `oapi.dingtalk.com/robot/send`、企微 `qyapi.weixin.qq.com/cgi-bin/webhook/send`）。
- **验证（真实外发 + 反例）**：
  - 钉钉告警：规则 `channel=dingtalk` 触发 → 事件 `notified=dingtalk`，本地接收器收到
    `{"msgtype":"markdown","markdown":{"title":"指标告警 · …","text":"### …"}}`；
  - 企微报表：订阅 `channel=wecom` 立即生成 → `delivered=wecom`，收到 markdown 内容并带
    「查看报表 / 下载 Excel」两个签名链接；
  - 反例：未知渠道 → 400；地址为空 / 连不上 / 非 2xx → `failed`，站内事件与报表本身不受影响；
  - 截图 `docs/_selfcheck/notify-channels.png`；
  - 回归：后端 **186 passed**（新增 4 个渠道请求体用例）、前端 52 passed、`ui_rules.sh`、`visual` 4 passed、构建与预算通过。
- **说明**：真实钉钉 / 企微群需要用户自己的机器人 Webhook（含 access_token / key）；
  本地验证覆盖到「请求体格式 + 送达状态 + 失败降级」，没有伪造真实群消息。
- **涉及文件**：`backend/app/notifications.py`（新增）、`backend/app/alerts/{evaluate,router}.py`、
  `backend/app/reports/{scheduler,router}.py`、`backend/tests/test_notifications.py`（新增）、
  `frontend/src/features/bi-dashboard/{AlertRulesDialog,ReportSubscriptionsDialog}.tsx`。

## 2026-11-13 · 新增：图表联动（点类目交叉筛选）

- **背景**：P2 交互分析的第二块。看到「品牌 TOP」想直接看这个品牌的其他指标，之前只能手动加筛选，链路太长。
- **改法**：
  1. 后端 `render_dashboard` 支持 `cross_filters`（最多 10 条，`{column/name, value}`）；
     与页面筛选同一条注入逻辑：**页面筛选优先**，只对数据集中确实有这一列的卡片生效；
  2. 渲染缓存 key 带上 `cross_filters`，避免联动结果和全量结果互相污染；
     `/render`、`/rows`（查看更多）、整页导出都透传联动条件，口径一致；
  3. 前端：柱状图 / 饼图 / 环形图 / 漏斗 / 瀑布 / 排行条形 / 排行列表支持点击类目，
     点击后用卡片的 `dimension_label`（语义字段名）+ 类目值发起联动；再点同一项取消；
  4. 页面左下角出现「联动：品牌 = 萌维兔 ×」胶囊，点 × 清除；应用收藏时自动清空联动。
- **验证（真实数据 + 反例）**：
  - 看板 58（拼多多）点品牌「萌维兔」：热销指数 **220,645 → 35,971**、日销量 **999+ → 700+**、
    品牌条形只剩「萌维兔 · 共 1 项」，品类饼图随之按该品牌重算；点 × 后恢复原值；
  - API 同口径：`POST /render` 带 `cross_filters` 后所有 KPI 变化，去掉后恢复；
  - 反例：`value` 为空 / 不是对象 → 条件被丢弃；同一列已有页面筛选时不叠加；
    非法/超长条件最多保留 10 条；缓存 key 对联动前后不同（单测覆盖）；
  - 截图 `docs/_selfcheck/cross-filter.png`；
  - 回归：后端 **178 passed**（新增 4 个联动/缓存用例）、前端 52 passed、`ui_rules.sh`、
    `npm run visual` 4 passed、构建与体积预算通过。
- **涉及文件**：`backend/app/dashboards/{render,router,render_cache}.py`、`backend/app/reports/{generate,router}.py`、
  `backend/tests/test_cross_filters.py`（新增）、`frontend/src/features/components/registry.tsx`、
  `frontend/src/features/components/renderers/{BarCard,PieCard,HbarCard,FunnelCard,WaterfallCard,RankListCard}.tsx`、
  `frontend/src/pages/DashboardPage.tsx`。
- **迭代（同日）**：联动胶囊增加「**查看明细**」下钻：
  - 后端 `POST /bi/dashboards/{id}/drill`：按维度值取这张卡数据集的原始行（最多 200 行、最多 12 列），
    复用语义层与行级权限，字段不存在 → 400、元素不存在 → 404；
  - 前端弹窗表格展示（表头吸顶、长文本截断 + title 完整值、行数提示）；
  - 验证：看板 58 品牌「萌维兔」→ 6 行明细、全部为该品牌；截图 `docs/_selfcheck/drill.png`；
  - 回归：后端 **182 passed**（新增 4 个下钻构造用例）、前端 52 passed、`ui_rules.sh`、`visual` 4 passed、构建与预算通过。

## 2026-11-13 · 新增：收藏视图（交互分析第一批）

- **背景**：P2 交互分析的第一块。用户经常固定看某个筛选组合（例如「拼多多 + 某价格带」），
  每次都重新点一遍筛选太麻烦，需要把「当前视图 + 筛选」存下来一键恢复。
- **改法**：
  1. 数据：迁移 `022_board_favorites.sql` 新增 `bi_board_favorite`（看板 + 视图 + 参数 JSON + 创建人，
     `UNIQUE(dashboard_id, created_by, name)` 同名覆盖）；
  2. 后端 `app/dashboards/favorites.py`：`GET / POST / DELETE /bi/dashboards/{id}/favorites`，
     权限复用看板 `_require_read`（能看就能收藏自己的）；每人每板最多 30 个，参数过大（>4KB）拒绝；
  3. 前端预览页右上角新增「收藏视图」：菜单列出收藏（点名称应用、垃圾桶删除），
     底部「保存当前视图与筛选…」弹窗起名；应用后视图与筛选一起恢复，地址栏 `p_*` 同步更新。
- **验证（真实链路 + 反例）**：
  - 正例：看板 58 以 `p_platform=拼多多` 打开 → 保存「拼多多视图」（5 个筛选）→ 切到天猫 →
    点收藏恢复 → 地址栏回到 `?view=main&p_platform=拼多多`，看板数据随之恢复；删除后列表为空；
  - 反例：空名称 → 400；参数不是对象 / 超过 4KB → 400；非 owner 成员访问该看板收藏 → 403；
  - 截图 `docs/_selfcheck/favorites-menu.png`；
  - 回归：后端 **174 passed**（新增 5 个参数校验用例）、前端 52 passed、`ui_rules.sh`、
    `npm run visual` 4 passed、构建与体积预算通过。
- **涉及文件**：`backend/schema/migrations/022_board_favorites.sql`、`backend/app/dashboards/favorites.py`（新增）、
  `backend/app/main.py`、`backend/tests/test_favorites.py`（新增）、`frontend/src/pages/DashboardPage.tsx`。

## 2026-11-13 · 新增：整页导出（Excel + HTML 打印 PDF，保持当前筛选口径）

- **背景**：看板只能在线看，老板要把「此刻这一屏」发给别人 / 存档，需要整页导出，而且必须和页面上的筛选一致。
- **改法**：
  1. 后端 `reports/generate.py`：`build_report` 支持传入 `params`；新增 `export_dashboard()`，用当前视图 + 当前筛选参数走
     `render_dashboard`，按与定时报表同一套逻辑生成 HTML + Excel，写到 `backend/var/exports`（不落订阅记录、不改数据库）；
  2. 接口：`POST /api/bi/reports/export/{dashboard_id}`，body `{format: xlsx|html, view, params}`，权限复用看板 `_require_read`；
  3. 前端：预览页右上角新增「导出」浮层按钮（与「编辑」同一套样式），菜单选 Excel 或 HTML；
     HTML 先同步开窗再塞 blob（避免浏览器拦截），失败自动退回下载；成功用 Snackbar 提示；
  4. 修复：中文看板名放进 `Content-Disposition` 会 500 → 改为 RFC 5987 `filename*=UTF-8''…`（导出与报表签名下载共用）。
- **验证（真实数据 + 反例）**：
  - 看板 57 导出 Excel：浏览器真实下载 `演示 · 散点相关性-2026-11-13.xlsx`（36KB），可正常打开；
  - 看板 57 导出 HTML：新窗口打开（标题 `演示 · 散点相关性 …`），可在浏览器打印为 PDF；
  - 筛选口径：看板 58 传 `platform=拼多多` → HTML 顶部显示「筛选：platform = 拼多多…」，卡片标题/数值与在线一致；
    传 `platform=天猫` 时与在线一致地落「取数失败」（该表指向一个不可达的直连库，不是导出问题）；
  - 反例：`format=pdf` → 400；成员（非 owner、未共享）导出 → 403；中文文件名不再 500；
  - 回归：后端 **168 passed**、前端 52 passed、`ui_rules.sh`、`npm run visual` 4 passed、构建与体积预算通过。
- **涉及文件**：`backend/app/reports/{generate,router}.py`、`frontend/src/pages/DashboardPage.tsx`。
- **说明（能力边界）**：Excel 与 HTML 由服务端直接产出；PDF / PNG 走「打开 HTML → 浏览器打印 / 另存」，不在后端装无头浏览器。

## 2026-11-13 · 新增：图表补齐（漏斗图 + 仪表盘）

- **背景**：P2 的分析层要补齐可视化形态。之前只有柱/线/饼/散点等基础图，缺「逐层收窄」和「单值目标」两种最常用的业务图。
- **改法**（按「新增一种组件要同时动 5 处」的规范）：
  1. 后端 `spec.py`：`KINDS / ROLES / 中文名` 增加 `funnel`、`gauge`；校验「漏斗必须绑维度、仪表必须绑指标」；
  2. `resolver.py`：仪表盘按单值取数（不按维度分组，和指标卡一致）；
  3. `compute.py`：漏斗只画正数层级、按值降序、按 top_n 截断；仪表盘返回 `gauge_value` + 自动整刻度 `max`（`chart.y_max` 可覆盖）；
  4. 组件库：`seed_base` 新增 `base.funnel` / `base.gauge`（默认绑演示数据集），重启自动入库 → 组件库从 18 类变 **20 类**；
  5. 前端：`types.ts` / `registry.tsx` / `ChartThumb` / `QueryPanel`（仪表盘不出「维度」槽）+ 新渲染器
     `FunnelCard.tsx`（逐层收窄、图例、标签）与 `GaugeCard.tsx`（进度弧 + 指针 + 数值），tooltip 统一 `confine`。
- **验证（真实数据）**：
  - 组件库预览：漏斗「天猫 113,779 / 拼多多 107,348」，仪表盘「221,127 / 刻度 250,000」（演示数据集真实聚合）；
  - 临时看板（验完已删）两卡并排渲染正常，截图 `docs/_selfcheck/new-charts-board.png`；
    组件库 20 张卡 + 新分类「转化 / 进度」截图 `docs/_selfcheck/new-charts-library.png`；
  - 单测：漏斗过滤 0/负数并降序、仪表自动刻度 126033 → 150000、`y_max` 覆盖生效；
  - 回归：后端 **168 passed**（新增 5 个）、前端 52 passed、`ui_rules.sh` 通过、`npm run visual` 4 passed、构建与体积预算通过。
- **涉及文件**：`backend/app/components/{spec,compute,resolver,seed_base}.py`、`backend/tests/test_components.py`、
  `frontend/src/features/components/{types.ts,registry.tsx,ChartThumb.tsx}`、
  `frontend/src/features/components/editor/QueryPanel.tsx`、
  `frontend/src/features/components/renderers/{FunnelCard,GaugeCard}.tsx`（新增）。
- **迭代（同日）**：图表补齐第二批 —— **雷达图 + 瀑布图**，组件库 20 → **22 类**（新增「贡献」分类，雷达归入「关系」）：
  - 雷达图：每个轴一个维度值，单指标画成轮廓；不足 3 个维度时提示「至少需要 3 个维度」；默认绑「价格带」5 档；
  - 瀑布图：逐项累计贡献，正值用主题色、负值红色，tooltip 显示「贡献 + 累计」；
  - 同步：`seed_base` 增加 `base.radar` / `base.waterfall`，并同步了库里已有 `base.radar` 行的默认维度；
  - 验证：演示数据预览 雷达 5 档（<20元 66,476 …）、瀑布逐项累计；临时看板两卡并排渲染截图
    `docs/_selfcheck/new-charts2-board.png`（验完已删）；组件库新增/重排后的视觉基线已确认并更新；
  - 回归：后端 **169 passed**（新增雷达/瀑布校验用例）、前端 52 passed、`ui_rules.sh`、`npm run visual` 4 passed、构建与预算通过。

## 2026-11-13 · 新增：订阅与定时报表（HTML + Excel → 站内 / Webhook）

- **背景**：P2 告警之后的第二块。老板要的是「到点自动收到日报」，而不是每天自己打开看板截图。
- **改法**：
  1. 数据：迁移 `021_report_subscriptions.sql` 新增 `bi_report_subscription`（看板 + 视图 + 每天/每周 + 时间 +
     渠道 + 启停 + 上次结果 + 下次时间）与 `bi_report_run`（每次生成的文件与结果）；`bi_alert_event` 补 `link` 字段；
  2. 生成：`backend/app/reports/generate.py` —— 与看板同一条渲染链路（`render_dashboard`，含筛选/平台默认值/创建者 RLS），
     产出**自包含 HTML**（内联样式，浏览器打开可直接打印为 PDF）和 **Excel**（概览 + 每张卡一个 sheet，指标/榜单/明细/图表序列都转表格）；
     文件写在 `backend/var/reports`，不挂静态目录，只能通过接口下载；
  3. 调度：`backend/app/reports/scheduler.py` —— 后台线程默认每 60s 检查一次到期订阅，多 worker 用 PG advisory lock 去重；
     生成失败落 failed 记录并把下次时间往后推，不会每分钟重试刷屏；
  4. 交付：站内通知复用告警事件表（`rule_id` 为空 = 报表事件），顶栏铃铛可点开报表（HMAC 签名链接，7 天有效）；
     Webhook 推送 JSON（含 html_url / xlsx_url / 摘要），失败只记 `delivered=failed`，不影响报表本身；
  5. 前端：看板卡片 ⋯ 新增「定时报表」，弹窗里可新建 / 编辑 / 启停 / 删除订阅、**立即生成**、查看最近生成并下载 HTML / Excel。
- **说明（能力边界）**：服务端直接产出 HTML 与 Excel；PDF / PNG 走「打开 HTML → 浏览器打印 / 另存」，
  不在后端装无头浏览器（部署成本高、与现有镜像冲突）。
- **验证（真实链路 + 反例）**：
  - 正例：看板 58 建「日销量日报」（每天 09:00）→ 立即生成 15 张卡片（真实平台默认值「天猫」）→
    HTML 19.6KB / Excel 17KB，Excel 打开有「概览 + 15 张卡」sheet；浏览器真实下载文件名 `666-20261113-1546.html`；
  - 站内：铃铛出现「日销量日报 · 666：报表已生成（15 张卡片）」，点击新窗口打开报表（标题 `666 · 日销量日报`），未读 1 → 已读 0；
  - Webhook：本地服务收到 `type=report` 报文（html_url / xlsx_url / summary）；指向死端口 → 报表仍成功、`delivered=failed`；
  - 到点调度：把 `next_run_at` 调到过去 → `run_due` 自动生成一条 `triggered_by=schedule`，并把下次时间推到明天 09:00；
  - 反例：`25:00` / `hourly` / 不存在的视图 / `ftp://` Webhook → 400；签名链接被篡改 → 403；非 owner 成员读订阅 / 下载 / 立即生成 → 403；
  - 前端 Playwright 真机走完「⋯ → 定时报表 → 新建 → 立即生成 → 下载 HTML → 顶栏打开 → 删除」，
    截图 `docs/_selfcheck/reports-dialog.png`、`reports-bell.png`；
  - 回归：后端 **163 passed**（新增 8 个排期 / 签名用例）、前端 52 passed、`ui_rules.sh`、`npm run visual` 4 passed、构建与体积预算通过。
- **涉及文件**：`backend/schema/migrations/021_report_subscriptions.sql`、`backend/app/reports/{__init__,repository,generate,tokens,scheduler,router}.py`（新增）、
  `backend/app/alerts/{repository,router}.py`（报表事件 + link）、`backend/app/main.py`、`backend/tests/test_reports.py`（新增）、
  `frontend/src/features/bi-dashboard/ReportSubscriptionsDialog.tsx`（新增）、`frontend/src/components/layout/TopBar.tsx`、
  `frontend/src/pages/BiDashboardPage.tsx`、`.gitignore`、`AGENTS.md`、`docs/底座优化方案.md`。
- **开关**：`BI_REPORT_INTERVAL_SECONDS`（默认 60，0 = 关闭调度）、`BI_REPORT_WEBHOOK_TIMEOUT`（默认 5s）、
  `BI_REPORT_DIR`（默认 `backend/var/reports`）、`BI_PUBLIC_BASE_URL`（Webhook 里的绝对链接，默认 `http://127.0.0.1:8300`）。

## 2026-11-13 · 新增：指标告警（阈值 / 波动 → 站内事件 + Webhook）

- **背景**：P2 分析层的第一块。老板不会一直盯着看板，指标跌了/涨了要能主动通知；
  之前只有被动查看，没有任何告警能力。
- **改法**：
  1. 数据：迁移 `020_alerts.sql` 新增 `bi_alert_rule`（看板 + 指标卡 + 比较符/阈值 + 可选波动 % +
     冷却 + 渠道 + Webhook 地址 + 启停 + 上次值/检查/触发时间）与 `bi_alert_event`（触发记录 / 未读状态 / 通知结果）；
  2. 后端 `app/alerts/`：
     - `evaluate.py` 与看板走**同一条渲染链路**（`render_dashboard`，含筛选默认值 / 平台默认值 / 创建者的 RLS）取指标卡真实值；
       `raw_value` 由 `compute.build_payload` 的 kpi 分支补出（前端展示仍用格式化后的 `value`）；
     - 阈值与波动任一满足即触发；冷却期内不重复写事件；Webhook 超时 **5s**，失败只记
       `notified=failed`，不影响站内事件；
     - 后台线程随应用启动，默认 **每 60s** 评估一次；多 worker 用 PG advisory lock（`pg_try_advisory_lock`）
       保证同一时刻只有一个实例在跑；
  3. API：`/api/bi/alerts/{cards,rules,preview,events}` —— 规则 CRUD、立即测试、新建前试算、
     事件列表 / 单条已读 / 全部已读；权限复用看板的 `_can_read/_can_edit`
     （看规则/事件 = 能看这块看板，改规则 = 能编辑这块看板）；
  4. 前端：顶栏新增告警铃铛（未读徽标 + 事件弹层 + 标记已读，60s 轮询 / 窗口聚焦刷新）；
     看板卡片 ⋯ 菜单新增「指标告警」，弹窗里可新建 / 编辑 / 启停 / 删除规则，
     并支持「试算当前值 / 立即测试」（真实取数，不是假状态）。
- **验证（真实链路 + 反例）**：
  - 正例：看板 58「日销量」卡真实值 26，建 `> 10` 规则 → 后台线程自动触发，事件「日销量告警 · 666：当前值 26 > 阈值 10」
    出现在顶栏，未读徽标 1；点开后未读变 0；
  - Webhook：本地 HTTP 服务真实收到 JSON（`type=alert`、value、message、sent_at），事件 `notified=webhook`；
  - 反例：阈值 `> 1e12` 不触发；冷却期内第二次评估 `triggered=0`（`skipped=cooldown`）；
    坏比较符 / 非法 Webhook 地址 / 不存在的卡片 → 400；成员（非 owner、看板未协同）读规则/建规则 → 403，事件列表为空；
  - 前端：Playwright 真机走完「⋯ → 指标告警 → 新建 → 试算 → 创建 → 顶栏未读 → 点开已读 → 删除」，
    截图存 `docs/_selfcheck/alerts-rules-dialog.png`、`alerts-bell.png`；
  - 回归：后端 `pytest` 全绿（新增 `tests/test_alerts.py` 12 个纯函数用例）、前端 `npm test` 52 passed、
    `bash scripts/ui_rules.sh` 通过、`npm run visual` 4 passed。
- **涉及文件**：`backend/schema/migrations/020_alerts.sql`、`backend/app/alerts/{__init__,repository,evaluate,router}.py`（新增）、
  `backend/app/components/compute.py`、`backend/app/main.py`、`backend/tests/test_alerts.py`（新增）、
  `frontend/src/features/bi-dashboard/AlertRulesDialog.tsx`（新增）、`frontend/src/components/layout/TopBar.tsx`、
  `frontend/src/pages/BiDashboardPage.tsx`、`AGENTS.md`、`docs/底座优化方案.md`。
- **开关**：`BI_ALERT_INTERVAL_SECONDS`（默认 60，0 = 关闭评估线程）、`BI_ALERT_WEBHOOK_TIMEOUT`（默认 5s）。

## 2026-11-13 · 新增：性能预算门禁（bundle 体积 + 首屏 LCP / 图表出现时间）

- **背景**：P3 要防「越改越慢、越改越大」。之前只有 `vite build` 的 900KB 警告，不会失败；
  首屏到底多快也没有基线。
- **改法**：
  1. `frontend/scripts/perf-budget.mjs` + `npm run budget`：构建后统计全部 JS 的未压缩 / gzip 体积，
     总 gzip > 1075KB 或单 chunk raw > 1250KB 直接失败，并列出最大 5 个文件；
     阈值可用 `MAX_TOTAL_GZIP_KB` / `MAX_CHUNK_RAW_KB` 覆盖；
  2. `frontend/e2e/perf.spec.ts` + `npm run perf`：先在**生产构建**上起 `vite preview`，
     用 PerformanceObserver 量 FCP / LCP，并量「第一块 canvas 出现」的时间（图表真正可见）；
     登录页 LCP < 3000ms、看板 LCP < 4500ms、图表出现 < 8000ms；
     预算可用 `MCBI_LOGIN_LCP_MAX_MS` / `MCBI_DASHBOARD_LCP_MAX_MS` / `MCBI_CHART_MAX_MS` 覆盖；
     `perf.mjs` 负责「构建 → 起 preview → 跑用例 → 关 preview」，跑完端口自动释放；
  3. CI 前端 job 增加 `npm run budget`（不需要后端与浏览器）；LCP 门禁留在本地（需要整套服务）。
- **验证（真实构建 + 真实浏览器）**：
  - `npm run budget`：19 个 JS，2870KB raw / **918KB gzip**，最大 `echarts` 1119KB raw → 在预算内；
    反例 `MAX_TOTAL_GZIP_KB=500` → 退出码 **1** 并明确报超预算条目；
  - `npm run perf`：登录页 FCP/LCP **76ms**；成品看板 LCP **320ms**、图表出现 **828ms** → 2 passed；
    反例 `MCBI_CHART_MAX_MS=100` → 看板用例失败（1 failed），证明门禁真的会卡住；预览端口已释放。
- **说明**：LCP 数字受机器负载影响，预算留了余量；它防的是「数量级回退」，不替代 Lighthouse。
- **涉及文件**：`frontend/scripts/perf-budget.mjs`（新增）、`frontend/scripts/perf.mjs`（新增）、
  `frontend/e2e/perf.spec.ts`（新增）、`frontend/package.json`、`.github/workflows/ci.yml`、`AGENTS.md`。

## 2026-11-13 · 新增：视觉回归基线（Playwright）

- **背景**：P3 要有「防 UI 回退」的网。纯函数有 Vitest，但版式/图表/空态被改坏了只能靠人眼发现。
- **改法**：
  1. `frontend/playwright.config.ts` + `frontend/e2e/visual.spec.ts`：
     固定 1440×900、zh-CN、浅色，对 4 个关键页面截图比对
     （登录页 / 我的看板 / 成品看板 / 组件库），差异阈值 1% 像素；
  2. **默认用本机 Chrome**（`channel: chrome`），不依赖 `playwright install` 下载 Chromium
     （本次下载 CDN 无响应，改用系统 Chrome 才跑通）；
  3. token 不走登录接口：`scripts/visual_tokens.py` 直接签发写入 `/tmp/mcbi_tokens.json`，
     Playwright 注入 localStorage —— 避免把正在用的浏览器会话踢下线；
  4. 命令：`npm run visual`（比对）/ `npm run visual:update`（确认改动后更新基线）；
     `MCBI_VIEWPORT=1280x900` 可换视口手工验证；
  5. Vitest 用独立 `vitest.config.ts` 排除 `e2e/**`，两套测试互不干扰。
- **验证**：
  - `npm run visual:update` 生成 4 张 1440×900 基线（`frontend/e2e/visual.spec.ts-snapshots/*-darwin.png`），
    成品看板基线里 4 张散点图正常渲染；
  - 复跑 `npm run visual`：4 passed，零差异；
  - **反例**：`MCBI_VIEWPORT=1280x900 npm run visual` → 4 failed，并生成 actual/diff 截图（差异检测真实生效），
    产物已清理。
- **说明**：视觉回归目前作为本地交付门禁（CI 需要整套后端+库+浏览器，成本高，暂不接入）；
  基线按平台存放（`*-darwin.png`），换机器首次需 `visual:update` 重建。
- **涉及文件**：`frontend/playwright.config.ts`（新增）、`frontend/e2e/visual.spec.ts`（新增）、
  `frontend/vitest.config.ts`（新增）、`frontend/package.json`、`frontend/package-lock.json`、
  `scripts/visual_tokens.py`（新增）、`.gitignore`、`AGENTS.md`。

## 2026-11-13 · 新增：/api/metrics 指标端点 + 前端单元测试（P3 第一批）

- **背景**：P1 加了不少性能/治理能力（缓存、配额、队列、慢查询），但只能靠日志猜；前端也只有 tsc/build，
  纯函数改错了没有回归网。
- **改法**：
  1. **`GET /api/metrics`**（`backend/app/routers/metrics.py`）：进程内聚合，不返回 SQL / 业务数据；
     包含 `query`（总量/成功/失败/超时/取消/配额拒绝/并发中 + 直连源库 live 计数）、
     `render_cache`（lookups / hits / hit_rate / stores / invalidations）、
     `jobs`（执行方式 / 队列长度 / worker 进程数 / 状态分布）、`database`（连接池）、
     `slow_queries`（阈值 / 采样数 / 最近 1h、24h）、`app.uptime_seconds`；
  2. 计数器 `backend/app/query/metrics.py`：内存 + 锁，`incr/decr/snapshot`，开销可忽略；
     埋点位置：`executor.run`（成功/失败/超时/取消/配额/并发）、`live.run_live`、`render_cache`、`slowlog`；
  3. **前端单测**：接入 Vitest 2.1.9（与 Vite 5 匹配），`npm test` 跑 `src/**` 与
     `packages/mylayout/**` 全部用例；新增 `format.test.ts`（数值/金额/万/k/百分比/轴标签）与
     `split.test.ts`（分套判定、取值、删依据清 `fields_map`）；
  4. CI 前端 job 增加 `npm test`。
- **验证（真实接口 + 真实跑测试）**：
  - 连续渲染看板 107 三次：`render_cache.lookups=4 / hits=2 / hit_rate=0.5 / stores=1`，
    `query.live_total=8 / live_ok=8`（该看板走直连源库），`jobs.executor=inline`，
    `slow_queries.threshold_ms=1000`、`redis.enabled=false`、连接池利用率正常；
  - 前端 `npm test`：8 个测试文件、**52 个用例全部通过**（含 `packages/mylayout` 原有 38 个）；
    `tsc --noEmit` 通过、`vite build` 通过；
  - 后端 **143 个测试通过**（新增 3 条指标用例）。
- **说明**：多 worker 下指标是「当前进程」的数字；Sentry / Prometheus 采集留给 P3 后续。
- **涉及文件**：`backend/app/query/metrics.py`（新增）、`backend/app/routers/metrics.py`（新增）、
  `backend/app/main.py`、`backend/app/query/executor.py`、`backend/app/query/live.py`、
  `backend/app/query/slowlog.py`、`backend/app/dashboards/render_cache.py`、
  `backend/tests/test_metrics.py`（新增）、`frontend/package.json`、`frontend/package-lock.json`、
  `frontend/src/features/components/__tests__/format.test.ts`（新增）、`.../split.test.ts`（新增）、
  `.github/workflows/ci.yml`、`AGENTS.md`。

## 2026-11-13 · 新增：独立 worker 队列（异步查询执行搬出 API 进程）

- **背景**：异步查询还在 API 进程里跑 —— API 被大查询拖慢或被重启时，异步任务跟着受影响，也没法单独扩容。
  任务表已经落 Redis，这一步把「执行」也搬出去。
- **改法**：
  1. 队列 `app/query/async_jobs/queue.py`：`bi:jobq` 列表（LPUSH / BRPOP），payload 含 job_id、QueryObject、
     user_id / role、attempts；取消标记 `bi:jobcancel:<id>`、worker 心跳 `bi:jobworker:<id>`；
  2. 开关 `BI_JOB_EXECUTOR=inline|worker`（**默认 inline，行为与今天完全一致**）；
     worker 模式下提交只入队；队列不可用（Redis 断）自动退回 inline，不会出现「永远排队」；
  3. worker 进程 `python -m app.query.async_jobs.worker`：
     每 10 秒心跳；排队期间被取消的任务直接判失败、不执行；
     执行复用 `execute_job`（语句超时 / 配额 / `bi:qrun` 登记 / 取消照旧）；
     连接类错误按 `BI_ASYNC_MAX_ATTEMPTS`（默认 2）重投，业务错误不重试；
  4. 取消排队中的任务：`POST /api/bi/query/jobs/{id}/cancel` 打标记并置失败，worker 取到后跳过；
     任务记录新增 `user_id`，非本人（非管理员）取消 → 403；
  5. `GET /api/bi/query/jobs` 增加 `executor / queue_len / worker_processes`；
  6. `docker-compose.prod.yml` 新增 `worker` 容器并把 API 设为 `BI_JOB_EXECUTOR=worker`，默认 compose 不变。
- **验证（真实进程 + 真实接口）**：
  - 只入队：worker 未启动时提交 → `state=queued`，统计 `queue_len=1 / worker_processes=0`；
  - 排队取消：取消该任务 → 200 `state=cancelled`，任务变 `failed（任务已被用户取消）`；
  - 消费：启动 worker 后另一个任务 60s 内变 `done`（count=1），`queue_len=0 / worker_processes=1`；
    被取消的那个任务始终是 failed，没有被补跑；
  - 回退：worker 模式 + `REDIS_URL` 指向未监听端口 → 提交直接本进程执行，最终 `done`；
  - 默认配置（inline）回归：看板 107 仍 200 / 9 卡 / 0 error；异步提交照常 `running → done`；
  - 后端 140 个测试通过（新增 10 条：入队/取队、取消标记、心跳、无 Redis 回退、worker 跳过已取消/已完成/已过期任务）；
    验证产生的 Redis key 已清理。
- **回滚**：`BI_JOB_EXECUTOR=inline`（默认值）并停掉 worker 容器即可，数据与接口不变。
- **涉及文件**：`backend/app/query/async_jobs/queue.py`（新增）、`.../worker.py`（新增）、
  `.../runner.py`、`.../store.py`、`.../__init__.py`、`backend/app/routers/bi_query.py`、
  `backend/tests/test_async_queue.py`（新增）、`docker-compose.yml`、`docker-compose.prod.yml`、`AGENTS.md`。

## 2026-11-13 · 优化：查询治理第二批（全局配额 / 慢查询落库 / 取消查询）

- **背景**：第一批只有「本进程」的并发配额、语句超时和日志里的慢查询；多 worker 时配额各管一份，
  慢查询查不到、杀不掉。这一批把三件事补齐。
- **改法**：
  1. **每用户配额进 Redis**（`app/query/executor.py` + `app/query/redis_bus.py`）：
     每人一个 ZSET（`bi:qcon:<用户>`），member 是带 180s 租约的 token，进程崩溃不会把名额占死；
     有 Redis → 多 worker 一起算，连不上 → 自动回退本进程信号量；`BI_QUERY_QUOTA` 可强制 auto/local/redis；
  2. **慢查询落库**（`app/query/slowlog.py` + 迁移 `019_query_slow.sql`）：
     超过 `BI_SLOW_SAMPLE_MS`（默认 1000ms）的查询进内存环形缓冲，后台每 5 秒批量写
     `bi_query_slow`（独立 Session，绝不递归进查询路径）；保留 `BI_SLOW_RETAIN_DAYS`（默认 7 天）；
     表缺失/写入失败自动停用，不影响查询；新增 `GET /api/bi/query/slow`（仅管理员）；
  3. **取消查询**（`app/query/running.py`）：
     每次执行登记 `query_id → PG 后端 pid`（Redis `bi:qrun:<id>`，TTL 5 分钟，多 worker 可见）；
     `POST /api/bi/query/cancel/{query_id}` 用 `pg_cancel_backend` 在数据库端打断；
     只能取消自己的（管理员不限）；`POST /api/bi/query/jobs/{job_id}/cancel` 取消异步任务（任务 id 即查询 id）；
     同步查询响应新增 `query_id` 字段；直连源库的查询不支持手动取消（靠语句超时兜底）。
- **为什么**：配额、慢查询、取消是查询底座的闭环 —— 出了问题能看见、能定位、能止血，而不只是「有超时」。
- **验证（真实接口 + 真实数据库）**：
  - 慢查询：`BI_SLOW_SAMPLE_MS=5` 下渲染看板 107，`bi_query_slow` 落库 8 条真实样本
    （`dm.v_pdd_bangdan` 51~64ms，source=live）；普通成员访问 `/slow` → 403；验证样本已清空；
  - 取消：`pg_sleep(30)` 会话登记后调取消接口 → 200 `cancelled:true`，该会话报
    `canceling statement due to user request`，Redis 登记随即清除；成员取消管理员查询 → 403；
    取消不存在的查询 → 404；
  - 配额：Redis 分支与取消登记共用同一连接（取消链路已证明 Redis 生效）；单测覆盖限流、释放、
    过期租约清理（本机 Redis 真实跑，没 Redis 自动跳过）；
  - 默认配置回归：看板 107 仍 200 / 9 卡 / 0 error；`/slow` 阈值 1000ms、结果为空；
  - 后端 130 个测试通过（新增 9 条）；Redis 验证 key 与 `bi_query_slow` 测试样本均已清理。
- **涉及文件**：`backend/app/query/executor.py`、`backend/app/query/redis_bus.py`（新增）、
  `backend/app/query/running.py`（新增）、`backend/app/query/slowlog.py`（新增）、
  `backend/app/query/live.py`、`backend/app/query/async_jobs/runner.py`、
  `backend/app/routers/bi_query.py`、`backend/schema/migrations/019_query_slow.sql`（新增）、
  `backend/tests/test_query_governance2.py`（新增）、`AGENTS.md`。

## 2026-11-13 · 新增：异步任务表支持 Redis（多 worker 共享、重启不丢）

- **背景**：P1 持久化队列的第一步。原来异步查询的任务表是进程内 dict —— 开了两个 worker 后，
  A 进程提交、B 进程轮询就是 404；服务重启后任务记录也全部消失。
- **改法**（`backend/app/query/async_jobs/store.py`）：
  1. 新增 `RedisJobStore`，与进程内 `JobStore` 完全同一套接口（create / get / mark_* / stats），
     路由与调用方一行没改；任务记录 `bi:job:<id>`，TTL 30 分钟；
  2. `BI_JOB_STORE=auto|memory|redis`（默认 **auto**）：配了能连上的 `REDIS_URL` 就用 Redis，
     没配 / 连不上自动退回进程内 —— 不让「缓存/队列」成为启动的硬依赖；
  3. `running` 超过 10 分钟没有结果 → 判定「任务已中断（服务重启或执行超时）」，前端不会一直转圈；
  4. 任务执行仍在提交它的进程线程池里跑（`BI_ASYNC_WORKERS`，默认 2，可调）；
     docker-compose 注入 `BI_JOB_STORE` / `BI_ASYNC_WORKERS`。
- **为什么**：这一步先把「提交 → 轮询 → 取结果」在多 worker 与重启场景下做成正确的；
  真正把执行搬到独立 worker（RQ / Arq）留到下一批，避免一次动太多。
- **验证（真实接口）**：
  - 单进程内存模式：提交 → 轮询 `running → done`，耗时 11.3ms，结果 `count=240`；
  - 双 worker + Redis：提交成功，连续轮询取到 `done`（跨进程可见），Redis 里 `bi:job:<id>`
    内容与接口返回一致；任务统计 `total=1 / done=1`；测试 key 已清理；
  - 回退：未配 `REDIS_URL` 时 `build_store()` 返回内存实现（单测覆盖）；
  - 后端 121 个测试通过（新增 5 条：Job 序列化往返、memory 模式、无 Redis 回退、
    Redis 状态机、running 超时判定中断）。
- **涉及文件**：`backend/app/query/async_jobs/store.py`、`backend/app/query/async_jobs/runner.py`、
  `backend/tests/test_async_jobs.py`、`docker-compose.yml`、`AGENTS.md`。
- **下一步（P1 最后一块）**：把执行搬到独立 worker（RQ / Arq），支持横向扩 worker 与任务重试。

## 2026-11-13 · 优化：整页渲染缓存 + Redis/连接池参数化 + 压测脚本（底座 P1 第一批）

- **背景**：P1 要补的是「高并发 / 查询」两个短板。一个 9 卡看板冷启动要 ~1 秒，同一批人反复刷新、多块大屏轮播时几乎全是重复计算。
- **改法**：
  1. **整页渲染结果短时缓存**（`backend/app/dashboards/render_cache.py`）：
     key = 看板 id + 文档 `updated_at` + 用户（id/role/username）+ 视图 + 请求参数 + 现场版面的指纹；
     命中直接返回上一次的整页 payload（逐字段一致，不新增任何返回字段）；
     `BI_RENDER_CACHE_TTL`（默认 15 秒，0 = 关闭）；有报错卡的结果不缓存；
     **保存 / 删除看板时按 `render:<id>` 前缀立即失效**；Redis 掉线自动回退进程内内存并仍按 TTL 失效。
  2. **Redis 作为可选共享缓存**：`docker-compose.yml` 新增 `redis:7-alpine`（256MB / LRU / 不落盘，只做缓存），
     后端注入 `REDIS_URL`；连不上就是「不缓存」，不影响启动与渲染。进程内内存缓存加了 4000 条上限与过期清理。
  3. **连接池参数化**：`DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_TIMEOUT`（默认仍是 20 / 10 / 30，行为不变）。
  4. **可选多 worker**：Dockerfile 支持 `WEB_CONCURRENCY`（默认 1，与原来完全一致）；
     新增 `docker-compose.prod.yml`：2 worker + 收窄连接池（2×18=36，远低于 PG 默认 100）+ `BI_RENDER_MAX_THREADS=10`。
  5. **限流可调**：`RATE_LIMIT_DEFAULT`（默认 300/分钟/IP，不变），压测与大屏场景可调高。
  6. **压测脚本** `backend/tests/load/k6_dashboard.js`：50→100→200 并发打开同一张看板，阈值 p95<1.5s、错误率<0.1%。
- **为什么**：这是对「并发打开看板」收益最高、风险最低的一刀 —— 不改任何业务口径、不动前端、失败可自动降级。
- **验证（真实接口，非模拟）**：
  - 看板 107（9 卡）：冷启动 1061ms → 缓存命中后中位 6ms；看板 57（4 卡）18ms → 12ms；
  - 临时看板实测：第二次请求 payload 与第一次**完全一致**，Redis 里出现 `render:<id>:*`；
    改写视图标题并保存后立刻返回新标题（证明失效生效）；带不同 `params` 生成第 2 个 key（不串结果）；
    TTL 过期后仍正常返回；临时看板已删除（再读 404）；
  - 反例：`REDIS_URL` 指向未监听端口（6399）时后端正常启动、看板 107 仍 200 / 9 卡，内存缓存 1219ms → 14ms；
  - 双 worker（`--workers 2`，共享 Redis）启动无重复种子报错，6 次渲染稳定 9~29ms；
  - 后端 112 个测试通过（新增 `tests/test_render_cache.py` 6 条：key 隔离 / 失效 / 报错不缓存 / TTL=0）；
    `scripts/ui_rules.sh` 通过（`tsc` 绿）。
- **涉及文件**：`backend/app/dashboards/render_cache.py`（新增）、`backend/app/dashboards/router.py`、
  `backend/app/cache.py`、`backend/app/database.py`、`backend/app/middleware/rate_limit.py`、
  `backend/tests/test_render_cache.py`（新增）、`backend/tests/load/k6_dashboard.js`（新增）、
  `backend/Dockerfile`、`docker-compose.yml`、`docker-compose.prod.yml`（新增）、`AGENTS.md`。
- **迭代（压测 + 查询治理）**：
  - 缓存加「单飞」：同一个 key 过期时只让一个请求回源，其余请求等它写进缓存后直接读
    （`render_cache.lock_for`）；权限查完立即 `db.commit()` 把连接还池，排队请求不再各占一条连接。
    200 并发下失败率 0.04% → **0%**，最大耗时 30s → 945ms；
  - 查询治理（`app/query/executor.py`）：`BI_QUERY_TIMEOUT_MS`（默认 15s，由 PG 端 `statement_timeout`
    真实取消，实测 300ms 超时在 0.39s 被打断）、`BI_USER_MAX_CONCURRENT`（同一账号默认 16 个并发查询，
    超了排队）、慢查询阈值 `DB_SLOW_QUERY_MS`（默认 500ms）；直连源库原本已有 30s 语句超时，未改；
  - k6 脚本改用 `TOKEN`（本项目的登录会递增 token_version，用账号密码压测会顶掉浏览器会话），
    并新增「整页没有报错卡」检查，避免 200 却被错误卡糊过去。
- **压测报告**（看板 107，9 卡，50→100→200 并发，每轮思考 1s）：

  | 指标 | 缓存开（15s） | 缓存关 |
  |---|---:|---:|
  | 吞吐 | 98.1 req/s | 16.6 req/s |
  | p95 | 168ms | 60s（请求超时） |
  | 失败率 | 0.00% | 7.56% |
  | 最大耗时 | 945ms | 60s |

  两轮门槛（p95 < 1.5s、错误率 < 0.1%）只有缓存开启时通过；关掉缓存的失败全部是排队/超时，
  不是数据错误 —— 说明缓存 + 单飞 + 每用户配额这条链路能在高并发下把数据库压力挡住。
- **下一步（P1 剩余）**：持久化任务队列（替换进程内 `JobStore`）；按线上真实并发再调
  `BI_RENDER_WORKERS` / 连接池。

## 2026-11-13 · 新增：底座分阶段优化方案文档

- 把「对齐/反超 Superset」的优化路线整理成项目文档：`docs/底座优化方案.md`。
- 内容：评分基线（明策BI 67 / Superset 86）、P0–P4 阶段目标、关键动作、验收标准、风险与回滚、防崩门禁、相关代码索引、当前进度。
- P0（并行渲染、读路径索引、CI）已标记完成，后续按 P1 高并发 → P3 工程化 → P2 分析层 → P4 连接器/语义治理推进。

## 2026-11-13 · 优化：看板卡片并行渲染 + 读路径索引 + CI（底座第一批）

- **背景**：底座评估里「高并发 / 查询 / 工程化」分数低于 Superset，主要卡点是看板卡片串行查库、没有索引治理、没有 CI。
- **改法**：
  1. `render_dashboard` 的卡片渲染改为并行：每张卡独立 `SessionLocal`，`ThreadPoolExecutor` + 全局信号量限流；
     `BI_RENDER_WORKERS`（默认 4）/ `BI_RENDER_MAX_THREADS`（默认 16）可调；单卡失败仍然只返回 error 卡，不影响整页；
  2. 新增 `018_read_path_indexes.sql`：我的看板、字段/指标、元素数据源账本、协同权限、模板可见性等读路径索引；
  3. 新增 `.github/workflows/ci.yml`：后端 `pytest` + 前端 `typecheck` + `vite build`。
- **为什么**：先把最影响并发和稳定性的串行渲染、缺索引、缺 CI 补掉；不改业务口径、不改前端结构，降低改崩风险。
- **验证**：后端 106 个测试通过；同一看板串行 vs 并行 payload 逐字段比对一致（仅 `elapsed_ms` 不同）；
  真实接口：看板 57（4 卡）200 / 37ms / 0 error，看板 126（2 卡）200 / 12ms / 0 error；
  迁移 018 已应用，索引已建；前端 `tsc` 通过。
- **涉及文件**：`backend/app/dashboards/render.py`、`backend/schema/migrations/018_read_path_indexes.sql`、
  `.github/workflows/ci.yml`、`AGENTS.md`。

## 2026-11-13 · 修复：「我的看板」串入了其他成员克隆的模板看板

- **现象**（用户原话）：「原来是我分享到模板库的看板，其他成员使用了，怎么『我的看板』页面也会出现一份，这是不对的」。
- **原因**：`GET /bi/dashboards` 在管理员账号下传了 `owner_id=None`，等于**不按归属过滤**，于是所有成员的看板（包括成员从模板库克隆的
  「666（副本）」）都混进了管理员的「我的看板」；普通成员本来就是按 owner 过滤的，所以只有管理员会看到。
- **改法**：列表始终按 `current_user.id` 过滤（`owner_id` 为空的公共种子看板仍可见）；管理员也不再在「我的看板」看到别人的看板。
- **权限隔离核对**：
  - 「我的看板」：只列自己的 + 公共种子；
  - 「我的团队」：只列 `team_shared=true` 的协同看板（按 view/edit 权限操作）；
  - 详情 / 渲染 / 查看更多行 / 浮层：`_can_read`；保存：`_can_edit`；改名 / 删除 / 权限：owner 或管理员；
  - 管理员仍可直接按 ID 打开任意看板做运维，但不会出现在他的「我的看板」列表里。
- **验证**：管理员列表从 `[58 666] + [221 666（副本，成员小宝）]` 变为只剩 `[58 666]`；
  另建临时成员账号创建看板，管理员列表不可见，成员自己可见；测试看板与账号已删除。
  截图 `_selfcheck/myboards-isolation-20261113.png`。
- **涉及文件**：`backend/app/dashboards/router.py`（`list_dashboards`）。

## 2026-11-13 · 优化：登录页改成「左侧品牌区 + 右侧登录卡片」布局（主题色 #4F46E5）

- **诉求**（原话）：「登录页面，设计成这样的布局（颜色使用我的项目的主题色）」。
- **改法**：
  1. 左侧 34% 品牌区：主题色渐变底、品牌标识、主标题「让经营分析 / 像有一位 AI 搭档」+ 定位说明；
  2. 右侧浅色区居中登录卡片：标题 / 副标题 /「账号登录」标签、浅灰底输入框、主题色登录按钮；
  3. 输入框改为占位式（账号 / 密码），密码可切换明文；错误提示保留在按钮上方；
  4. 窄屏（<900px）自动隐藏左侧品牌区，登录卡片居中，不出现横向溢出；
  5. 登录逻辑、账号密码校验、redirect 跳转全部沿用原来的，没有改认证链路。
- **为什么**：原来的单卡片居中太像通用后台，新布局更符合品牌门户感，同时保证手机 / 窄窗口可用。
- **涉及文件**：`frontend/src/pages/LoginPage.tsx`。
- **验证**：1440×900 与 800×900 两种宽度逐屏检查（无折行 / 无溢出 / 窄屏品牌区正确隐藏）；
  真实输入 admin 账号密码 → 点登录 → 跳转 `/bi` 并正常显示「我的看板」。
  截图 `_selfcheck/login-redesign-20261113.png`、`_selfcheck/login-narrow-20261113.png`、
  `_selfcheck/login-success-20261113.png`；`tsc` 通过。
- **· 迭代（同日，用户「注册功能没有」）**：补上真实 **注册** 标签与注册表单：
  用户名 / **邮箱或手机号（一个输入框）** / 密码 / 确认密码；
  输入里带 `@` 按邮箱校验，纯数字按手机号校验（11-20 位），注册时自动拆成后端需要的 email / phone；
  密码要求 ≥6 位且含大小写字母和数字，两次密码一致；
  调用现有 `POST /api/auth/register`，注册成功后自动登录并跳转，不需要再登一次。
  验证：留空会提示「请填写邮箱或手机号」；只填邮箱注册成功；只填手机号注册成功；
  两次密码不一致会提示；测试账号已删除。
  截图 `_selfcheck/login-register-single-20261113.png`；`AuthContext` 增加 `register` 方法，`tsc` 通过。

## 2026-11-13 · 新增：分享到「我的团队」（协同看板，看板与数据集都不复制）

- **诉求**（原话）：「分享到模板库和分享到『我的团队』这个是有区别的：分享到模板库就是复制看板和数据集；
  但是分享到我的团队，我的看板就变成了协同看板项目（数据集调用不变），看板出现在我的团队，
  同时我的看板上面也会打一个标（看板的权限也是可以设置，有查看、编辑的功能）」。
- **改法**：
  1. 看板卡片 ⋯ 菜单在「分享到模板库」下面新增 **分享到我的团队**；
  2. 分享的是看板本体：`bi_canvas.team_shared=true`，数据集仍绑原来的（不复制）；
  3. 「我的团队」页改为真实协同看板：分「我分享的 / 共享给我的」，成员卡片显示「可查看 / 可编辑」；
  4. 权限落 `bi_resource_permissions`（`resource_type='canvas'`）：全团队可见，默认 `view`，
     可把指定成员设为 `edit`；只有 owner / 管理员能改权限、取消协同、删除；
  5. 「我的看板」卡片左上角打绿色「协同」标；旧的文件式团队面板（TeamPanel）下线。
- **为什么**：协同场景要的是同一块看板一起改，复制一份会导致两边数据/版面分叉；模板库才需要独立副本。
- **涉及文件**：`backend/schema/migrations/017_canvas_team_share.sql`、`backend/app/dashboards/repository.py`、
  `backend/app/dashboards/router.py`（`/dashboards/team`、`/team-share`、`/team-permissions`、`_can_read/_can_edit`）、
  `frontend/src/features/bi-dashboard/TeamBoardsPanel.tsx`（新增）、`TeamShareDialog.tsx`（新增）、
  `frontend/src/pages/BiDashboardPage.tsx`（菜单 / 协同标 / 团队页）、删除 `TeamPanel.tsx`。
- **验证**：用真实账号跑通：管理员把「666」分享到团队 → 我的看板出现「协同」标、团队页「我分享的」1 条；
  成员 `qa_team` 默认 view：能打开看板（200）、保存被拒（403）；管理员改为 edit 后保存成功（200）；
  取消协同后成员再打开 403。验证用户 / 权限行 / 协同标记已全部清理。
  截图 `_selfcheck/team-myboards-badge-20261113.png`、`team-page-admin-20261113.png`、`team-share-dialog-20261113.png`、
  `team-page-member-20261113.png`；`tsc` 通过。

## 2026-11-13 · 新增：看板分享到模板库（数据一起复制，模板和「测试数据集」页关联）

- **诉求**（原话）：「『测试数据集』页面存放的数据集，不只是放『组件预览』的，还放『模版库』的数据集
  （看板分享到模版库后，除了看板复制过去，还有数据集也复制过来测试数据集这里，并且模版库的数据跟『测试数据集这里』关联）」。
- **改法**：
  1. 看板卡片 ⋯ 菜单新增 **分享到模板库**（自己的看板；管理员可分享任意看板）：
     填模板名称 / 说明 / 分类，可见范围默认「所有人可见」，也可切「指定成员」精确勾人；
  2. 后端把看板文档深拷贝成模板（`bi_template_market.kind='page'` + `doc`），
     并把它用到的数据集**复制成物理副本**：抽取表 `CREATE TABLE AS SELECT`、直连表先取快照再落本地，
     表名 `bi_tpl_<模板id>_<原数据集id>`，字段 / 指标一并复制，数据集归属公共（owner 为空）；
  3. 模板里的卡片绑定被重写到副本数据集，所以克隆出来的看板开箱即用、所有人看同一份模板数据；
  4. 「测试数据集」页列表 = 测试数据集 + 模板数据副本（带「模板 · xxx」来源标记，只读）；
     模板副本不再出现在「数据集」页；
  5. 模板可见性按账号过滤：公开 / 作者本人 / `shared_user_ids` 里的成员，管理员看全部。
- **为什么**：模板要能独立复用，不能跟着业务库变化或被原表删除拖垮；数据必须能在「测试数据集」页看到并和模板对应。
- **涉及文件**：`backend/app/template_market.py`（新增）、`backend/app/routers/bi_engine.py`（/market 系列 + /market/share）、
  `backend/app/semantic/router.py`（模板数据集清单 / 数据集页标记 / 删除保护）、`backend/app/query/whitelist.py`（`bi_tpl_` 前缀）、
  `backend/schema/migrations/016_template_market_boards.sql`、`frontend/src/pages/BiDashboardPage.tsx`（分享弹窗 / 模板卡片 / 克隆跳转）、
  `frontend/src/features/bi-dashboard/TestDataPanel.tsx`（来源列 + 模板副本只读）、`frontend/src/features/bi-dashboard/DatasetPanel.tsx`（隐藏模板副本）。
- **验证**：看板「测试666」（引用 3 个数据集，含 2 个直连）分享后 → 模板库出现「看板模板 · 3 个数据集」；
  「测试数据集」页出现 3 条「模板 · …」数据（`bi_tpl_1_21/27/28`，行数 26/26/36 与原表一致）；
  克隆生成看板 219，渲染接口 200、卡片口径与原看板一致；异常路径：分享不存在看板 404、克隆不存在模板 404。
  验证用的模板 / 副本数据集 / 克隆看板已删除，`bi_tpl_%` 表已清理。
  截图 `_selfcheck/tpl-market-20261113.png`、`_selfcheck/tpl-testdata-20261113.png`、`_selfcheck/tpl-share-dialog-20261113.png`；`tsc` 通过。

## 2026-11-13 · 新增：数据集页每个数据集都能「预览数据」（只读网格，字段就是原库的列）

- **诉求**（原话）：「『数据集』这些数据集可以设计成这样的预览吗，这也是原数据库的字段预览（不用修改的功能）」。
- **改法**：
  1. 数据集列表「操作」列最前面加 **预览**（眼睛图标）：点开 `/bi?view=dataset-preview&id=<id>&ro=1`；
  2. 复用测试数据集那套网格：列头 = 字段名 + 类型小字、行号、底部「共 N 行 · M 列 · 耗时」；
  3. **只读**：进来就打开该数据集，列头不可双击（提示「只读预览：字段就是原数据库的列，这里不做修改」），
     不改字段、不改数据；直连库连不上时字段照常列出、数据区给出错误原因。
- **涉及文件**：`frontend/src/features/bi-dashboard/TestDataPanel.tsx`（支持 `id` / `ro` 参数）、
  `frontend/src/pages/BiDashboardPage.tsx`（`dataset-preview` 视图）、`frontend/src/features/bi-dashboard/DatasetPanel.tsx`（预览按钮）。
- **验证**：打开「榜单端-天猫」预览 → 标题为该数据集名、表头 `链接id·integer / 产品标题·text / 平台·text …`、
  26 行 24 列、耗时 0 ms；双击列头**不会**出现编辑条（只读生效）；截图 `_selfcheck/dataset-preview-readonly.png`。
  `tsc` 通过。
- **· 迭代（同日，用户「入口没看到」）**：预览入口从「只有一个眼睛图标」改成**带文字的「👁 预览」按钮**
  （13 行都有、一眼能看见），截图 `_selfcheck/dataset-preview-entry.png`。
- **· 迭代（同日，用户「测试的数据集不放到这里，只放『测试数据集』页面」）**：数据集列表里**不再出现「测试数据集」**
  （列表 13 → 12 条），它只存在于「测试数据集」页面；页头的「测试数据集」按钮仍可进那个页面。
  截图 `_selfcheck/dataset-list-no-test.png`。

## 2026-11-13 · 新增：点「测试数据集」进入独立页面（专门看组件预览用的模拟数据）

- **诉求**（原话）：「我想『点击这里』进入新的页面，是专门组件模拟的数据那些的」。
- **改法**：
  1. 数据集页的「测试数据集」按钮改成**跳转**（不再原地创建），进入新页面 `/bi/test-data`；
  2. 新页面：顶部说明（组件库 / 卡片缩略图用的模拟数据 · 公共、跟随项目、仅管理员可删）、
     物理表 / 字段数 / 本次加载行数 / 耗时、15 个字段的类型胶囊、以及**真实数据表格**（默认 100 行，横向可滚动，数值右对齐）；
  3. 右上角「重建模拟数据」：调 `POST /bi/semantic/datasets/test` 幂等重建后再读一遍（缺了/被删都能一键回来）；
  4. 页面进入时也会先确保数据集存在，所以从任何入口进来都不会看到空页。
- **涉及文件**：`frontend/src/pages/TestDataPage.tsx`（新增）、`frontend/src/App.tsx`（路由）、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`（按钮改为跳转）。
- **验证**：数据集页点「测试数据集」→ URL 变为 `/bi/test-data`、表格渲染 **100 行**、列头为
  `# / 商品标题 / 平台 / 品牌 / 品类 / 榜单 / 价格带 / 上架时间 / 搜索文本 / 日销量 / 热销指数 / 均价 / 差评数 / 霸榜天数 / 销量增速 / 链接ID`；
  截图 `_selfcheck/test-data-page.png`；`tsc` 通过。
- **· 迭代（同日，用户「点击进来显示一条一条的，点击查看，再是明细，并且可以在明细修改字段的信息」）**：
  页面改成 **列表 → 明细** 两级：
  1. 列表：15 个字段一条一行（图标 + 字段名 + 类型 + 角色 + 说明），右侧「查看」；
  2. 明细：顶部字段信息表单（**名称 / 类型 / 角色 / 说明，可改、保存即生效**，走 `PATCH /datasets/{id}/fields/{fid}`），
     下面是全量数据表，当前字段那一列高亮；顶部可返回列表；
  3. 保存后重新拉字段与数据，提示「已保存」；只影响测试数据集，不动业务数据。
  实测：把「商品标题」的说明改成「验证：改字段说明」→ 保存 → `bi_dataset_field.description` 真的变了（验完已清空还原）；
  截图 `_selfcheck/test-data-list.png`（列表）、`test-data-detail.png` / `test-data-detail-saved.png`（明细 + 已保存）。
- **· 迭代（同日，用户「不是拆解表头，是跟一条数据集显示一样，点击才是查看明细」）**：
  列表不再拆成字段行，而是**和「数据集」页一样一条一条的数据集**（图标 + 名称 + 直连标记 + 字段数 + 物理表 + 「查看」），
  数据源就是 `GET /api/bi/semantic/datasets`（全部可见数据集，测试数据集排在最前）；
  点任意一条 → 明细：**字段下拉切换 + 名称/类型/角色/说明可改并保存**（`PATCH /datasets/{id}/fields/{fid}`），
  下方是该数据集的数据表（100 行，当前字段列高亮）；直连库连不上时字段照常展示、数据区给出错误原因。
  实测：13 条数据集全部列出，点第一行「测试数据集」→ 表头 `# / 商品标题 / 平台 / 品牌…`，字段默认选中「商品标题」；
  截图 `_selfcheck/test-data-list.png`、`test-data-detail.png`。
- **· 迭代（同日，用户「组件测试的数据集没有这么多的吧」）**：列表收成**只有「测试数据集」这一条**
  （原来是全部可见数据集），点它才进明细；页面标题也从「数据集 · 查看数据」改回「测试数据集」。
- **· 迭代（同日，用户「测试数据集的页面也是有这大页面的布局，这样风格统一」）**：
  页面从独立路由 `/bi/test-data` 改成**数据集页下面的一个视图**（`/bi?view=test-data`），
  放进同一个大页面外壳（左侧导航 + 同样的页头/表格风格）；旧的 `/bi/test-data` 自动跳到新地址；
  列表用「数据集」页同款表格（数据集 / 物理表 / 字段 / 指标 / 更新时间 / 操作·查看），明细不变。
  截图 `_selfcheck/test-data-shell.png`。
- **· 迭代（同日，用户「点击查看之后页面设计成这样，鼠标双击可编辑字段，不能破坏数据」）**：
  明细改成**数据网格**（列头 = 字段名 + 类型小字、行号、密排、底部「共 N 行 · M 列 · 耗时」）；
  **双击任意列头**弹出字段编辑条（名称 / 类型 / 角色 / 说明 + 取消 / 保存），平时不占版面；
  **只改字段定义**（`PATCH /datasets/{id}/fields/{fid}`），不动表里任何一行数据，字段名留空会被拦下。
  实测：双击「平台」列头 → 编辑条出现且字段=平台 → 取消后收回；截图 `_selfcheck/test-data-grid-edit.png`。

## 2026-11-13 · 新增：数据集页「测试数据集」入口（组件预览用的模拟数据，公共、仅管理员可删）

- **诉求**（原话）：「以后防止『数据没了』，在数据集新建一个『测试数据集』的入口，这里是存放组件对应模拟效果的数据，
  请你创建并更新组件库的组件匹配的数据（它是跟随项目的，只有管理员才能删除的）」。
- **改法**：
  1. 原来的「演示数据 · SKU 榜单」正式改名为 **测试数据集**（同一张内置表 `bi_demo_sku`，15 个字段覆盖
     平台/品类/榜单/价格带/品牌/商品标题/上架时间/日销量/热销指数…），公共数据（`owner_id = null`），跟着项目走；
  2. 数据集页右上角加 **「测试数据集」按钮**：缺了/被误删就按内置数据重建（表 + 数据集 + 字段），
     点完提示「测试数据集已就绪 · N 个字段」；
  3. 后端 `POST /api/bi/semantic/datasets/test` 幂等重建；**删除接口加保护**：这个数据集只有 `admin / super_admin` 能删，
     其他人 403（公共数据集原来谁都能删，这块一并收紧）；
  4. **组件库 13 个数据类组件全部绑定到测试数据集**（散点/柱/饼/环/指标/排行条/排行列表/折线/面积/明细/热力/组合/词云），
     卡片墙永远有图；拖到画布时前端仍会用当前看板的数据集覆盖它，不会带错业务数据。
- **涉及文件**：`backend/app/components/seed_demo.py`（改名 + 描述）、`backend/app/semantic/router.py`
  （`/datasets/test` 入口 + 删除保护）、`frontend/src/features/bi-dashboard/DatasetPanel.tsx`（按钮 + 成功提示）、
  `bi_component` 库数据（13 条 `binding.dataset_id`）、`AGENTS.md §5`（同步规则：写测试数据集，不要置空）。
- **验证**：
  - 接口：`POST /api/bi/semantic/datasets/test` → `{id:20, name:"测试数据集", fields:15}`；
  - 权限：用临时 viewer 账号（验完已删）DELETE → **403「只有管理员可以删除」**，数据集仍在；
  - 预览：18 个组件 `preview-batch` → `ok 18 / errors {}`；
  - 页面：点按钮弹出「测试数据集已就绪 · 15 个字段」，列表里出现该行 —— `_selfcheck/dataset-test-entry.png`。

## 2026-11-13 · 修复：组件库卡片墙大部分不显示缩略图（只剩一条灰条）

- **现象**：组件库 18 张卡里 13 张没有画面，缩略图位置只有一根浅灰占位条（散点 / 柱 / 饼 / 环 / 指标 / 排行 / 折线 / 面积 / 明细 / 热力 / 组合 / 词云 等数据类组件）。
- **原因**：卡片墙走 `POST /bi/components/preview-batch`，而这些模板的 `binding` 里按规矩**不写死数据集**，
  渲染时直接报「组件未绑定数据集 → 该卡无 payload」，前端就只能画占位条。**不是图表坏了，也不是数据没了**。
- **改法**：批次预览时给「没绑定数据集的数据类模板」**临时**挂上演示数据集（`演示数据 · SKU 榜单`）再算，
  只作用于本次预览、不写回库 —— 模板依旧不写死数据集，拖到画布还是用当前看板的数据集。
- **涉及文件**：`backend/app/components/router.py`（`_demo_dataset_id` + `preview-batch` 兜底）。
- **验证**：同一批 18 个组件调接口 → 修复前 `ok 5 / errors 13（组件未绑定数据集）`，修复后 **`ok 18 / errors {}`**；
  页面截图 `_selfcheck/library-thumbs-after.png`（每张卡都有真实图，筛选栏卡也带上了新的「日期」控件）。
- **· 迭代（同日）**：规则同步更新 —— 组件库模板的 `binding.dataset_id` 以后**统一写「测试数据集」**（不再置空），
  它由「数据集」页的「测试数据集」入口一键重建、仅管理员可删；`preview-batch` 的演示数据集兜底保留作第二道保险。
  见 `AGENTS.md §5`。

## 2026-11-13 · 规则：「真实生效」成为功能交付的硬门槛

- **用户要求**（原话）：「以后我叫你新增功能这些，一定要做到真实生效的，不要搞花架子」。
- **落成**：写进 `AGENTS.md` 新增的 **0.1 只交付「真实生效」的功能**：新功能必须真实跑通整条链路
  （真实接口 / 真实数据 / 真实失败路径），禁止写死状态、假数据、只改前端不动后端；
  交付时必须附**正反两面**的可复现证据（正例跑通 + 反例该红就红 / 该空就空 / 该报错就报错）；
  做不到或要付代价的当场说明，不许用「已完成」糊过去。
- **影响**：以后每个功能都按「能证明它真的在工作」来交付，而不是「界面看起来有了」。

## 2026-11-13 · 新增：数据集列表给「直连」数据集加连通性小圆点（绿=连得上 / 红=连不上）

- **诉求**：直连数据库的数据集看不出源库通不通，想知道「现在还能不能取到数」。
- **改法**：
  1. 后端新增 `GET /api/bi/semantic/datasets/status`：只探 `conn_mode=live` 的数据集，
     **真连一次源库**（`test_source` → 建立连接 + `SELECT 1`，连接超时 8s）判活，多数据集并行探；
     结果缓存 30s，`?refresh=1` 立即重探；本地抽取数据集不探、不返回；
  2. 数据集名后面的「直连」标记右边加一个 **8px 小圆点**：灰=检测中、绿=连接正常、红=连接失败；
     鼠标悬停看原因（错误原文 + 检测时间），**点一下重新检测**（圆点不挡行点击）；
     **进页面这一次强制重探**（不受 30s 缓存影响），之后的刷新才复用缓存 —— 圆点永远是「此刻」的真实状态；
  3. 探测失败不影响列表本身（接口异常时只是圆点不亮）。
- **涉及文件**：`backend/app/semantic/router.py`（`/datasets/status`）、
  `frontend/src/features/bi-dashboard/DatasetPanel.tsx`。
- **验证（红绿都实测过，不是写死的）**：
  - 建了一个临时数据源指向 `127.0.0.1:5999`（没有服务）→ 挂在上面的直连数据集 **红点**，
    错误原文「Connection refused」；把端口改成 `5432`（真库）→ 同一个数据集变 **绿点**；改回 5999 → 又变红；
  - 同一个页面里同时存在能连（本地PG）和不能连（5999）的两个直连数据集，一个绿一个红：
    `_selfcheck/dataset-status-proof.png`；
  - 真实环境也验证过一次：`192.168.31.10` 主机不通时三个直连数据集全红，恢复后自动变绿；
  - 临时数据源 / 临时数据集验完已删；`tsc` 通过。
- **注意**：红点只代表「此刻连不上」，源库恢复后点一下圆点即可变绿；缓存 30 秒内不会重复连库。

## 2026-11-13 · 优化：组件库「筛选栏」模板同步日期控件（新拖出来的筛选栏自带「日期」）

- **诉求**：日期区间控件做完后，组件库里的筛选栏模板还是老的「下拉 / 分段 / 多选 / 搜索」，拖出来看不到新能力。
- **改法**：
  1. `seed_base.BASE` 的 `base.filter`：加一个 **日期** 字段（`type=date`、宽度 160、不写死数据集列），描述改成「下拉 / 日期 / 分段 / 多选 / 搜索」；
  2. 库里现有那一行 `base.filter`（id 107）整份同步：字段追加「日期」并排在「搜索」之前，`binding.dataset_id` 保持为空；
  3. 组件库编辑页里这张卡：控件 = 日期、不再显示「选项」、默认值占位是 `YYYY-MM-DD 或 起~止（空 = 全部）`。
- **涉及文件**：`backend/app/components/seed_base.py`、`bi_component.base.filter`（库数据）。
- **验证**：`GET /api/bi/components` 返回的 `base.filter` 有 6 个字段（平台/品类/榜单/价格带/日期/搜索）、`render` 无校验错误；
  组件库编辑页截图 `_selfcheck/library-filter-date.png`（日期卡：控件=日期、无选项、宽度 160）。
- **注意**：类型栏的组件库是进页面 / 窗口重新获得焦点时拉的，**刷新一下**才能看到新模板；已经拖在画布上的卡片不受影响（副本）。

## 2026-11-13 · 新增：筛选栏「日期」控件（区间日历 + 快捷档位，按绑定的时间字段精确过滤）

- **诉求**：筛选栏里「上架时间」原来只是个下拉，选项是库里那几天；用户要**日历选时间**，
  挂到数据源的时间字段上，选哪天（或哪一段）就只看那一段。
- **改法**：
  1. 字段「控件」下拉新增 **日期**（`type = "date"`），选它之后字段卡不再显示「选项」，也不再去库里拉候选值；
  2. 筛选栏渲染成日期区间触发器（显示 `2024-05-01 ~ 2024-05-07`，空时显示「全部日期」）；
  3. 点开是**区间日历**：顶部快捷档位 **今日 / 昨日 / 近7日 / 近15天 / 近30日 / 近60天 / 近90天**，
     下面左右两月并排，点第一下 = 开始、第二下 = 结束（反着点自动对调），选中段浅靛底、两端实心；
     底部显示「已选 · 清除 · 确认」，确认才写回参数；
  4. 值 = `[开始, 结束]`（单日则是一个日期字符串），后端翻成 **开始日 00:00 ~ 结束日 23:59:59 的 BETWEEN**，
     date 列、时间戳列（含时分秒）、文本日期列都能命中；
  5. 和别的字段一样走页面参数链路：绑了列 → `_page_filters` → 所有含该列的卡片、明细表「查看更多」一起生效。
- **涉及文件**：`frontend/src/features/components/renderers/FilterBar.tsx`（`FilterDate` / `MonthGrid`）、
  `features/components/types.ts`、`features/components/editor/FilterFieldsEditor.tsx`（控件选项 / 不取候选值 / 默认值占位）、
  `backend/app/components/spec.py`（type 枚举）、`backend/app/dashboards/render.py`（`_date_bounds` → 日期区间）。
- **验证**：临时看板（已删）把「上架时间」切成日期控件 → 日历选 `2024-05-01 ~ 2024-05-07` →
  触发器显示该区间，「明细表」共 1 条（未选时 10 条）；接口另测 `单日 / [起,止] / "起~止"` 三种取值都对；
  `tsc` 通过；截图 `_selfcheck/filter-date-range-open.png`（快捷档位 + 双月历）、
  `filter-date-range-picked.png`（选中区间）、`filter-date-range-applied.png`（筛选结果）。

## 2026-11-13 · 修复：明细表行详情面板右侧压着「溢出区」灰层（组件看着超出面板）

- **现象**：看板「测试666」点明细表任意一行，右侧详情面板最右一截是灰的，热销指数那张卡的
  右端（口径小字、数值）像被切掉、跑到面板外面去了。
- **真正原因**：不是面板宽度不够、也不是缩放没生效 —— 是**画布自己的图层盖在面板上**。
  编辑器给版面两侧的「溢出区」画了一层浅灰遮罩（`data-bleed-mask`，`zIndex: 50`），
  面板同一层叠上下文里只有 `zIndex: 30`，于是面板压在溢出区的那 40~70px 被灰层染灰、
  遮罩边界（`rgba(148,163,184,0.55)` 那条细线）正好从卡片中间切过去。
- **改法**：行详情面板 `zIndex` 30 → **60**（高于遮罩 50 / 参考线 56 / 落点提示 58），
  并写清「面板必须压在画布图层之上」的注释，避免以后有人按「面板是浮层」再往回调低。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（内联行详情面板）。
- **验证**：`doc=126` 点第 2 行 → 面板 504px、`z-index: 60`、内容区 `scrollWidth == clientWidth`；
  截图上原先右侧那条灰带消失、卡片的「热销指数」口径与数值完整可见
  （`_selfcheck/detail126-before.png` 灰带 vs `detail126-after.png` 全白）；`tsc` 通过。

## 2026-11-13 · 修复：明细表行详情弹窗比画板矮（画板下半截的组件落在弹窗外面）

- **现象**：画板是 480×1432，但点明细表某行弹出来的画布里，下半部分组件（日销量那两张）跑到画面外/看不到，
  看着像「弹窗里多出/缺了超出的区域」。
- **真正原因**：画板元素在文档里存了**两份高度** —— `layout.h = 1432`（画布渲染用的就是它）、顶层 `h = 900`（历史遗留旧值）。
  `canvasDetail` 解析画板范围时优先读了**顶层 h** → 弹窗画布只有 900 高；而画板里 y=832~1456 的组件自然落在画面外。
- **改法**：
  1. `asCanvasItem` / `geomOf` 一律以 `layout` 为准（与画布渲染同源），不再被残留的顶层几何带偏；
  2. 弹窗按画板真实尺寸 `frameW/frameH` **1:1 渲染**（不缩放、不裁切）；
  3. 顺手：行标识列被清空时按当前行的 ID 列（链接id）兜底，避免「点哪行都显示全量」。
- **验证**：用库里真实 doc 跑 —— 画板框解析成 **480×1432、8 个组件、没有任何组件超出画板**（改前会按 900 截断）。
  另外 `toDocItem` 保存时会同时写顶层 h 与 `layout.h`，两份不会再分叉。
- **涉及文件**：`features/components/board/canvasDetail.ts`、`features/components/board/BoardViewer.tsx`、
  `features/components/renderers/TableCard.tsx`、`pages/CanvasBoardPage.tsx`。
- **· 迭代（同日）**：再兜一层 —— 画板框取 `max(画板尺寸, 组件外接框)`（历史数据里画板比组件小时也不切）；
  弹窗/面板「放得下就 1:1、容器真的更窄才等比缩一点」，并且面板宽度 = 画板宽 + 48（只在画布本身太窄时收）。
  这样任何数据下都不会再出现「组件被切在弹窗外」。
- **· 迭代（同日，用户「现在是宽度没有适配」）**：面板宽度原来只按 `画板.w` 算，画板里组件实际比画板宽时
  （拖进去不卡边界）就会伸到面板外。改成按**组件真实外接宽**算：内容宽 = `max(画板宽, Σ(x+w))`，
  面板/抽屉宽 = 内容宽 + 24 → 内容区正好等于内容宽，1:1 不缩放、不伸出去。
- **· 迭代（同日，用户点出关键：「面板是比例缩小的，但组件没有按比例缩小」）**：根因是**缩放压根没生效** ——
  测量容器宽度的 `useEffect` 只在首帧跑，那时 `loading` 还是 true（渲染的是转圈，容器节点还没挂），
  `boxRef.current` 为 null 直接 return；加载完成后依赖没变，effect 不重跑 → `containerW` 永远是 0 →
  `scale` 恒为 1，组件按设计尺寸画在缩小后的面板里，于是「伸出去」。
  修法：把 `loading` 加进 effect 依赖（加载完重测量并挂 `ResizeObserver`），缩放才真正按容器宽度生效。

## 2026-11-13 · 修复：编辑画布里的「行详情」内容横向超出面板（成品页正常、编辑器不正常）

- **现象**：编辑画布里点明细表某一行，右侧详情面板的画板内容横向超出、被裁掉一截；成品页的抽屉却是对的。
- **原因**：面板宽度写死 `min(460, max(320, 画布宽 × 0.5))`，而画板内容按画板宽度（480+）排 —— 装不下就溢出去；
  `BoardViewer` 又只是把宽度当容器宽，不做缩放。
- **改法**：
  1. 面板宽度先跟着画板走（`画板宽 + 24`，上限 560 / 画布宽 62%），和成品页抽屉同宽；
  2. `BoardViewer` 加**等比缩放**：可用宽度放不下内容时按 `可用宽 / 内容宽` 缩放（`transform: scale`，左上为原点），
     不再横向裁切；成品页抽屉、居中弹窗、编辑面板三处同一套逻辑；
  3. 三处都传「真实可用宽度」（扣掉内边距与滚动条），跨场景表现一致。
- **涉及文件**：`frontend/src/features/components/board/BoardViewer.tsx`、
  `frontend/src/pages/CanvasBoardPage.tsx`（内嵌详情面板）、`frontend/src/features/components/renderers/TableCard.tsx`（弹窗/抽屉）。
- **验证**：编辑画布点首行 → 面板 499px，画板画布 `scrollWidth == clientWidth`（无横向溢出），纵向可滚动；
  `_selfcheck/inline-detail-fit.png`；`tsc` 通过。
- **· 迭代（同日，用户「这里还是有超出」）**：上一版是调用方估宽度（面板宽 − 固定值），滚动条一出现就多溢几像素。
  改成 `BoardViewer` 自己用 `ResizeObserver` 量父容器**内容宽**（`fitWidth="container"`），
  按 `可用宽 / 内容宽` 精确缩放；面板/弹窗的内容区加 `scrollbar-gutter: stable`（滚动条占位固定，不来回抖），
  缩放后布局溢出用 `overflow: hidden` 收掉，父容器不再出现横向滚动条。
- **· 迭代（同日，用户「弹窗画布不是跟画布的布局一样」）**：等比缩放虽然不裁切，但会让组件变窄、触发断点降级
  （指标卡标题被压成「日…」），和画布上看到的不一样。改成**按画板真实尺寸 1:1 还原**（`frameW/frameH`），
  组件宽度、断点、位置和画布完全一致；面板/抽屉宽 = 画板宽 + 24，正常正好放下，放不下就滚动。
  弹窗/面板内容区的原生滚动条也改成浮层（`scrollbarWidth: none`），不再留一条空白。
- **· 迭代（同日，用户「还是没生效」）**：1:1 还原后发现编辑面板仍偶发少 20~40px（面板宽度上限用了画布宽 62%，
  画布一窄就比画板窄）。改成：面板宽 = `画板宽 + 40`，只受 `画布宽 - 140` 约束；`BoardViewer` 在画板模式下
  **放得下就 1:1、真放不下（窄屏）才等比缩**，两种情况下都不再出现横向滚动条/被裁。

## 2026-11-13 · 修复：画板比屏幕高时，行详情弹窗会撑出屏幕（改成滚动）

- **现象**：画板高度 1432 远超屏幕；行详情弹窗尺寸原来写死 `min(画板高+24, 880)`，
  屏幕矮的时候弹窗比屏幕还高 —— 上下被裁、也没有滚动条，等于看不全。
- **改法**：
  1. 弹窗尺寸按**当前视口**收：宽 `min(画板宽+24, 1280, vw-32)`、高 `min(画板高+24, 880, vh-32)`，
     再加 `maxWidth/maxHeight: calc(100vw/100vh - 32px)` 兜底；
  2. 左/右抽屉也跟着收宽（`maxWidth: 100vw`），内容区本来就是 `overflow: auto`，画板再高也是滚动看；
  3. 编辑面板的「半屏 / 满屏」不再写死 450 / 900，按当前屏幕真实可视高度算（满屏 = 视口高 − 96，半屏 = 一半），
     点出来的尺寸不会超过屏幕。
- **涉及文件**：`frontend/src/features/components/renderers/TableCard.tsx`（`BoardPopup`）、
  `frontend/src/pages/CanvasBoardPage.tsx`（画板预设尺寸）。
- **验证**：760 高视口 + 1432 高画板 + 居中弹窗 → 弹窗 504×728（top 16 / bottom 744，完整在屏内），
  内容区 `scrollHeight 1462 / clientHeight 673` 可滚动（`_selfcheck/board-dialog-clamped.png`）；`tsc` 通过。

## 2026-11-13 · 规则：「交互丝滑度」纳入每次改动的固定维度

- **用户要求**（原话）：「把这个丝滑性能记下来，接下来对于项目的调整、修改，我都需求包含这个维度来开展」。
- **落成**：写进 `AGENTS.md` 新增的 **3.2 交互丝滑度**，作为交付自检的固定一项：跟手（必要时自定义拖影）、
  落点按上下半区精确判定 + 提示线 + 边缘自动滚动、120–160ms 过渡不闪不跳、高频事件先比较再 setState、
  配置改完画布立即联动、交付前真机拖一遍（长列表 / 空态 / 折叠态）。
- **影响**：以后每次改动是「功能 + 丝滑度」一起交付，不再只交功能。

## 2026-11-13 · 新增：拖动头标可以调换筛选字段的顺序

- **诉求**：用户说「拖动，可以改变筛选栏的位置关系」——想让配置里的字段顺序 = 筛选栏上的左右顺序，并且能直接拖。
- **改法**：
  1. 字段卡的**头标可拖动**（`cursor: grab`），拖到另一张卡上松手就插到它前面，面板顺序即时变；
  2. 顺序写回 `filter.fields`（平台专套里则写回该平台那套），筛选栏按它渲染 —— 画布上立刻跟着重排；
  3. 拖动中：被拖的卡半透明、落点卡顶部一条靛蓝提示线；分套依据那张通用卡不参与排序（拖不动）。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`（`moveField` + 头标 `draggable` + 卡片 `dragover/drop`）。
- **验证**：把「品类」拖到「平台」前 → 面板顺序变 品类 / 平台 / …，画布筛选栏同步成「品类 → 平台 → 榜单 → 价格带 → 搜索」
  （`data-filter-select` 顺序与 `_selfcheck/filter-reorder-bar.png` 一致）；`tsc` 通过。
- **· 迭代（同日，用户「拖动还不够丝滑精准」）**：
  1. 落点按鼠标在卡片的**上下半区**判定 —— 上半区插到它前面、下半区插到它后面（原来只能插到前面，排到最后放不进去）；
  2. 落点画一条 2px 靛蓝提示线（带淡光晕），被拖的卡压到 0.4 透明；
  3. 拖到面板上下边缘时自动滚动，长列表能一路拖到底；
  4. 原地放回不再触发一次无意义的重排（`from === slot - 1` 直接返回）。
  实测：把「品类」拖到「平台」上半区 → 顺序变 品类 / 平台 / 榜单 / 价格带 / 搜索，画布 `data-filter-select` 同步为 category 在前。

## 2026-11-13 · 优化：筛选字段卡片加头标（组与组更好认）

- **诉求**：用户说「在名称组上方再加一个头标，这样更加辨别」。
- **改法**：每张字段卡顶部加一行头标 —— 字段名（12.5/600，随「名称」输入框实时更新，空名显示「未命名字段」），
  下面一条 `#F4F7FC` 细分隔线，再进「名称 / 控件」那排；平台作用域里那张通用卡的「通用」标记也从「名称」旁挪到了头标右侧。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **验证**：`_selfcheck/filter-card-headers.png`（头标依次是 平台 / 品类 / 榜单 / 价格带 / 搜索）；`tsc` 通过。
- **· 迭代（同日，用户「再添加头标色块」）**：头标左侧加一条 3×14 的圆角色块，按字段顺序轮流取
  （靛 / 蓝 / 青 / 紫 / 玫），组与组一眼分得开；`_selfcheck/filter-card-accent.png`。
- **· 迭代（同日，用户「这里再添加一个折叠的功能」）**：**点头标可折叠整张卡片**（只留 色块 + 字段名 + 折角箭头），
  展开/收起状态按卡片各自记；折叠时面板滚动高度从 1684 降到 1149（同屏多看三组）；`_selfcheck/filter-cards-folded.png`。

## 2026-11-13 · 优化：筛选字段卡片加一层投影（每组看得开）

- **诉求**：用户说「每个名称的卡片组，底部做一个阴影嘛，不然每组名称感觉都是连在一起的」。
- **改法**：字段卡从「只有一条 1px 细边框」改成白底 + 浅边框 + 轻投影（同一套卡片阴影令牌），
  相邻两张卡之间有明确的层次，不再糊成一片。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **验证**：`_selfcheck/filter-field-cards.png`；DOM 里 5 张卡都带上了
  `0 1px 2px rgba(15,23,42,.04), 0 6px 16px -12px rgba(15,23,42,.18)`；`tsc` 通过。

## 2026-11-13 · 优化：筛选栏面板去掉「绑定字段 / 快捷填入 / 拖入绑定」

- **诉求**：用户圈住「绑定字段（数据表列名）+ 提示文字 + 快捷填入」说这些不需要，配置要更简洁（其他的先不动）。
- **改法**：去掉「绑定字段（数据表列名）」输入框、下面那行提示、以及「快捷填入」一排字段胶囊。
  字段卡现在只剩：名称 / 控件 → 分套依据 → 选项 → 默认值 / 宽度 / 删除（平台那张多一块「切换数据集」）。
- **· 迭代（同日，用户当场纠正「这个框不能删除，这里是拖字段进来的」）**：
  「把左侧字段拖到这里」的**拖入框保留**，并且成了绑定列的唯一入口 ——
  拖一个左栏字段进来 = 绑到那一列并自动取该列候选值；拖过之后框里直接显示「已绑定：品类」；
  点一下弹出左栏字段清单可挑一列，已绑定时还多一条「清除绑定」（触屏 / 手滑也能用）。
- **影响**：`field.column` 与「含该列的图表自动跟随此筛选」照旧生效，入口从输入框换成了拖入框。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`
  （清掉了只为输入框服务的 `columnInputs` / 防抖 `scheduleBind`）。
- **验证**：`_selfcheck/filter-panel-slim.png`（精简后的字段卡）、`filter-drop-zone.png`（点拖入框弹出左栏字段清单）、
  `filter-drop-bound.png`（绑「产品标题」后显示「已绑定：产品标题」+ 已取到 26 个值）；`tsc` 通过。

## 2026-11-13 · 修复：新拖出的筛选栏「面板只有「平台」一个，栏上却有五个」

- **现象**：在按平台分套的页面上从类型栏拖一个筛选栏下来，筛选栏显示 平台/品类/榜单/价格带/搜索 五个，
  配置面板却只有一个「平台」+「这个平台还没有字段」。
- **原因**：面板在画布上会自动切到「当前平台」那套，而新卡片还没有这套 → 空；筛选栏渲染时却回落到通用那份 → 两边说的不是同一件事。
  （更早的版本会「打开面板就把通用复制成平台专套」，但这一步会被切平台时的 items 重装覆盖掉，所以时灵时不灵。）
- **改法**：
  1. 面板默认编辑**通用**那份 —— 筛选栏渲染的就是它，平台没单独配过时不再显示空列表；
  2. 不再「一打开就偷偷复制」：要单独一套必须显式点右上角胶囊「通用 ▾」→「拼多多（单独一套）」；
  3. 画布切平台时，只有这个平台**确实有**自己那套才跟过去，否则停在通用；
  4. 数据集映射（切换数据集 / 添加平台）只在分套依据 / 已配过映射的字段上出现，别的字段不再挂一块没用的入口。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **验证**：`filter-scope-synced.png`（面板 5 个字段 = 筛选栏 5 个）、`filter-scope-menu.png`（作用域菜单）、
  `filter-scope-forked.png`（点「单独一套」后变「拼多多专用」、平台卡标「通用」）；`tsc` 通过。

## 2026-11-13 · 优化：筛选栏字段删完 → 组件自动移除（不再留个空框）

- **诉求**：用户说「当删除完所有的名称字段，这个组件就默认被删除了，而不是停留一个空框」。
- **改法**：
  1. 通用那份字段删到一个不剩 → 画布把这个筛选栏元素一起删掉，底部提示「筛选栏的字段都删完了，组件一起移除了」；
  2. 只删某个平台的专套（通用还有字段）不动组件 —— 组件还在，别的平台照常用；
  3. 读文档时顺手清掉历史遗留的空筛选栏（通用 0 字段 = 死框：没有平台入口，专套里剩的也永远渲染不出来）；
  4. 组件库编辑页不触发（那是模板，允许空着）。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`（`onEmpty`）、
  `pages/CanvasBoardPage.tsx`（包装透传、移除 + 提示、读文档清理空筛选栏）。
- **验证**：临时看板走完整流程——删「平台」（确认弹窗）→ 面板切回通用 → 依次删完剩下 4 个字段 →
  画布只剩明细表、提示弹出、保存后 `doc.views[0].items` 只有明细表、`items_map` 消失；`tsc` 通过。

## 2026-11-13 · 优化：筛选栏面板里「平台」这张卡看得见、也能删

- **诉求**：用户说「配置参数这里没有平台的字段，平台这里也是可以删除的」——
  她把这页平台专套的字段都删了，筛选栏上的「平台」还在，但面板里根本没有这张卡
  （分套依据只存在于通用那份，平台作用域下原本被藏起来了）。
- **改法**：
  1. 平台作用域下把**分套依据那张卡**放到面板最上面，带「通用」标记：改它 = 改通用那份（不是改这个平台的专套）；
  2. 卡上照常可改名称 / 控件 / 选项 / 默认值 / 宽度、可开关「分套依据」，也能删；
  3. 删它先确认：删掉后这一页不再分套、筛选栏改用「通用」那套字段（各平台专套会收起来）。
     确认删除时顺带清空 `fields_map`，不留以后再加分套字段时旧专套复活的隐患。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`、
  `frontend/src/features/components/split.ts`（`filterWithFields`）、`pages/CanvasBoardPage.tsx`、`pages/ComponentEditorPage.tsx`。
- **验证**：面板 `_selfcheck/filter-platform-card.png`（平台卡 + 通用标记 + 拼多多专用）、确认弹窗 `filter-split-delete-confirm.png`；
  SSR 校验：删掉分套依据后 `fields` 只剩品类、`fields_map` 清空、筛选栏不再渲染「平台」。`tsc` 通过。

## 2026-11-13 · 修复：筛选栏按平台的字段「删了还在」（专套里没有的字段从通用那份回落出来）

- **现象**：在筛选栏面板里删掉几个字段（此时人在「拼多多」那套里），画布上的筛选栏一点没变，看着像没生效。
- **原因**：前后端两处解析都写成「通用那份按 id 找平台版本，找不到就用通用版本」——
  专套里删掉的字段又被通用那份补回来了。面板显示已删、筛选栏还在，两边不一致。
- **改法**：只要这个平台**配过**专套（`fields_map[平台]` 存在，哪怕是空数组）就以它为准：
  平台入口仍取通用那份，其余字段只出专套里的；**没配过**才整体回落通用。
  - 前端 `FilterBar` 的 `visible`、后端 `resolved_fields`（卡片参数定义走同一条），口径一致；
  - 面板右上角补作用域标记：`拼多多专用` / `通用`（没有 `dataset_map` 的看板原来完全看不出在改哪一套）。
- **涉及文件**：`frontend/src/features/components/renderers/FilterBar.tsx`、`backend/app/dashboards/render.py`、
  `frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **验证**：用真实组件 SSR 渲染——拼多多专套删掉「品类 / 价格带」后渲染结果不再含这两个，天猫没配专套仍回落通用；
  后端用真实文档数据跑 `resolved_fields` 结论一致；`tsc` 通过。**改的是后端，已重启 8300，页面刷新后生效。**

## 2026-11-13 · 新增：筛选栏「选项」可以逐条删除 / 改名

- **诉求**：用户指着筛选栏配置面板的「选项」说「是可删除分类的名称的（现在还不行）」——
  原来选项是一整块 `值|显示名|区间` 文本，想删掉一个分类名只能手动在文本里挑行删，看不出哪儿能删。
- **改法**：
  1. 「选项」改成**逐条列表**（定高滚动，6 行一个视窗）：每行就是选项名，点进去就能改名；
     行尾 ✕ 删除这一条 —— 平时淡（0.45）、悬停变深、悬停 ✕ 变红，破坏性操作不抢视线但看得见；
  2. 改名规则：值=显示名的（乌龟食品）一起改，改完才搜得到；值是自定义的（`all` → 全部品类）只改显示名，
     右边把真实值标出来，不偷偷改掉过滤用的值；
  3. 删除连带清理：`ranges` 里该档位一起删；`default` 正指向它时清空默认值（不然筛选栏停在一条不存在的选项上）；
  4. 右上「添加」：追加一条并滚到底、直接聚焦改名；「批量编辑」保留原来的原文编辑（`值|显示名|区间`），
     批量粘贴、维护区间档位仍走它 —— 与列表是同一份 `options`，不是第二套配置。
  5. 顺带修掉平台分套作用域里的老 bug：「+ 添加」「删除字段」写的一直是通用那份（应写当前平台那份）。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`。
- **组件库**：只改面板交互，模板 spec 没动，`bi_component.base.filter` 仍 5 个字段、无需重灌种子。
- **怎么验证**：`bash scripts/ui_rules.sh`（tsc 通过）；真机截图 `docs/_selfcheck/filter-option-list.png`、`filter-option-list-panel.png`；
  临时看板里删「仓鼠食品」→ 列表与保存后的 `doc` 都没有该选项；删默认项（全部品类 / all）→ `default` 落库为空；
  单条改名 → 值=显示名的两条一起改；新增 → 滚到底并聚焦。
  · **迭代（同日晚，用户要求「选项不能添加、编辑，这些字段都是数据库固定的」）**：「选项」改成**只读展示**——
  列表照旧列出（值 + 显示名），行尾 ✕ 保留（不想显示的字段删掉即可）；「+ 添加」「批量编辑」及其原文输入框一并撤掉，
  改名的就地编辑也撤销。`ranges`（档位区间）随之不再有 UI 入口，老文档里的区间数据照旧生效。
  想把删掉的选项找回来：把左侧字段拖进拖入框重新取（或把列绑回去）。
  · **迭代（同日晚）**：选项列表**默认折叠** —— 标题行「选项 · 个数 · ›」一行带过，点它展开/收起（一列十几个值不再把面板撑长）；
  展开后照旧只读 + 行尾 ✕ 删除。

## 2026-11-13 · 数据：组件库同步（词云模板 + 模板不再写死数据集）

- **为什么**：词云面板去掉了「维度」槽、默认只绑指标，组件库模板要跟上（AGENTS.md §5：「改组件配置能力必须同步组件库」）。
  顺带按同一条铁律**清掉所有模板里写死的 `dataset_id`**（拖出组件时用当前数据集覆盖，模板不该绑死某一个）。
- **改了什么**：
  1. `seed_base.BASE` 的 `base.wordcloud`：`dimension: null`、`metric: 热销指数`（默认只绑指标，拖「列」进指标槽就当词）；
  2. `bi_component` 的 `base.wordcloud` 同步（`dimension=null`、`dataset_id=null`）；
  3. 其余 12 个组件模板的 `dataset_id` 一并清空（原本都写死 20）。
- **自查**（`select code, kind, spec->'binding*' from bi_component where archived=false`）：
  - 模板写死 dataset_id 的行数：**0**；
  - 13 个组件的 dimension / metric 在演示数据集（20）里都存在（全部 `ok`）；
  - 从类型栏点出词云：`dimension=null, metric=热销指数, dataset_id=当前数据集`（`cloud-template-drag.png`）。

## 2026-11-13 · 优化：词云只需一个字段就能出图

- **诉求**：词云组件「不需要维度，只需要单一的指标」就能挂载（现在空着维度会直接报错）。
- **改法**：
  1. 校验放宽：词云只要有 `dimension` 或 `metric` 之一即可（其他图表仍要求维度）；
  2. 只绑了指标、没绑维度时，后端**自动挑一个适合当词的列**（跳过标题 / 链接 / 图片 / SKU / ID 这类长文本），
     用它当词、指标当权重；想精确控制就把那一列拖到「维度」槽；
  3. 自动选维度时同步补上排序（按指标降序），词云不会乱序。
- **涉及文件**：`backend/app/components/spec.py`（校验）、`app/components/resolver.py`（自动维度）。
- **怎么验证**：临时项目放一个只绑「日销量」的词云 → 预览直接出词云（自动按「平台」分词：天猫 / 拼多多），不再报「需要先绑定维度」；
  只绑「品牌」不绑指标时按词出现次数出词云（招牌：顽皮 / 迪格宠物 / 麦斯蒂…）。
  · 修复（同日，用户说「怎么还在」）：槽位是否显示原来由 `needsDimension = !["kpi","insight","section"]` 决定，
    `NEEDS_DIMENSION` 只影响「拖指标时自动补维度」——第一次没改到点子上。现在把 `wordcloud` 从 `needsDimension` 里排除，
    词云面板才真正只剩「指标」槽。
  · 优化（同日，用户要求）：**词云面板删掉「维度」槽**，只留一个「指标」槽 —— 拖「列」进去当词（按出现次数出图），
    拖「指标」进去当权重（没配词时后端自动挑一列）。词云面板不再出现「维度」。
  · 修复（同日）：只绑维度、不绑指标时后端会报 `unsupported operand type(s) for +: 'int' and 'str'` / `ORDER BY 有歧义` ——
    现在无指标时自动按「词出现次数」COUNT，指标别名用「词频」（避免与维度列同名），词云正常出图
    （`wordcloud-metric-only.png`）；验完已删除；后端已重启。

## 2026-11-12 · 新增：组件可拖到更小 + 内容等比缩放

- **诉求**：组件库的卡片要能拖得更小，缩小后里面的文字 / 数据也跟着变小，但**布局不能乱**。
- **改法**：
  1. 卡片最小尺寸从 180×110 降到 **100×68**（480 宽的画板能并排排下 4 张指标卡；页面元素仍按自己的最小高度）；
  2. `BoardCard` 的内容容器按「实际尺寸 / 默认尺寸」等比缩放（`scale = min(1, w/默认w, h/默认h)`，页面元素不缩）：
     字号、间距、图表一起缩，**布局比例不变**，不会出现数字压标题、文字溢出；
  3. 卡片只缩小不放大：比默认尺寸大时内容保持原尺寸（避免字被拉大）；
  4. 缩放下限 **0.78**（用户反馈拖到最小时数字太小）：再小的卡片里文字/数字也不低于默认尺寸的 78%，
     超出卡片的部分由卡片裁掉（左侧标题与数字优先保留）。
- **涉及文件**：`board/snapping.ts`（MIN 常量）、`board/BoardCard.tsx`（内容缩放容器）。
- **怎么验证**：临时项目放三张指标卡（336×156 / 150×92 / 120×80）→ 内容分别按 1 / 0.67 / 0.54 缩放，
  三张卡的标题与数字排版一致、无溢出（`card-scale.png`）；验完已删除；`tsc --noEmit` 通过。

## 2026-11-12 · 新增：画板（弹窗区域）+ 明细表「跳转弹窗」

- **诉求**：功能栏加「画板」→ 在画布上框一块区域；区域里摆组件；明细表配置里选这个画板并设置弹出方式（右侧 / 中间 / 左侧）。
- **实现**：
  1. 工具栏「画板」：点一下或拖到画布上创建画板元素（`type=board`），显示虚线框 + 左上角标签，可拖动 / 拉大小；画板铺在最底层，不抢内部组件的点击；
  2. **画板内组件**：照常从类型栏拖组件进来（中心点落在画板矩形内即属于这个画板），画板只是区域标记，没有单独的编辑模式；
  3. 明细表配置「弹窗」：开关 + 「弹窗画板」下拉 + 「弹出位置」（左 / 中 / 右）+ 「行标识列」；
  4. 成品页：画板本身和区域内的组件不直接铺在页面上；点行 → 按配置从左侧 / 中间 / 右侧弹出，**弹窗尺寸 = 画板尺寸**（左右两侧抽屉宽 = 画板宽 + 24，中间对话框 = 画板宽高 + 24），内容按行标识列过滤取数；
  5. 编辑器里点行仍在画布右侧面板里预览（和成品页同一份内容）。
- **涉及文件**：`backend/app/dashboards/models.py`（ItemDef 允许 board）、`app/dashboards/render.py`（board 跳过渲染）、`app/components/spec.py`（`TableDetailSpec` 加 `board_key / popup`）、`frontend/.../editor/TableDetailSettings.tsx`（重写为弹窗设置）、`board/canvasDetail.ts`（`boardOf / boardViewItems / injectRowFilter`）、`renderers/TableCard.tsx`（`BoardPopup`：抽屉 / 对话框）、`board/BoardViewer.tsx` 与 `pages/DashboardPage.tsx`（隐藏画板内容、提供页面元素上下文）、`pages/CanvasBoardPage.tsx`（画板按钮 / 元素 / 右侧面板）。
  · 迭代（同日）：① 新建画板自动编号（画板、画板2、画板3…，换页接着编）；② **拖动画板时区域内的组件一起移动**
    （`onLayoutChange` 判到画板且尺寸未变，按位移同步移动中心点落在画板内的元素）；③ 后端保存时给画板补/去重 id
    （重复 key 改成 `bd_00x`，`_heal_board_ids`）；④ 选中画板时中栏出「名称 / 宽度 / 高度」配置，不再显示文字元素的配置。
  · 迭代（同日，用户说「跟随有延迟不丝滑」）：跟随从「松手才跳」改成**拖动过程实时同步** —— `BoardCard` 拖画板时，
    把同一个 `translate3d` 也写到区域内的组件 DOM 上（`followers` + `getCardNode`），松手清空内联位移再提交一次；
    实测拖动中组件与画板 transform 完全一致。
  · 修复（同日，用户说「带有弹出画板的组件还没识别到画板」）：明细表「弹窗画板」下拉原来只扫当前页，画板建在别的页面就显示
    「还没有画板」。现在下拉**扫描所有页面（含分套）**；运行时 `CanvasDetailContext.findBoard` 跨页面找画板；
    `boardOf` 兼容文档里 `layout` 形式的坐标（否则跨页拿到的是 ItemDef、坐标读不到）。实测画板放「页面2」、明细表在主视图 → 下拉能选、点行弹出 544px 并显示该行数据。
  · 新增（同日）：**画板可绑定数据集** —— 选中画板，中栏出现「数据集」下拉；**拖进画板的组件默认继承该数据集**
    （`addChart` 按落点判断落在哪个画板里，用画板的 `spec.binding.dataset_id` 覆盖，组件仍可单独改）。
    配合明细表「行标识列 = 链接ID」，弹窗里所有组件都会按当前行过滤。画板坐标兼容 `layout` 与顶层两种写法。
  · 新增（同日）：组件拖进画板时**自适应画板宽度** —— 宽取「画板宽 − 32 内边距」、位置夹在画板矩形内；
    明细表 / 头标卡这类默认 1440 的整版块组件不再撑出画板（例如 480 宽画板里明细表自动变 448 宽）。
    附：整版块拖动时落位会强制贴左（x=0），所以「落进哪个画板」改用**光标位置**判定，否则会被误判成没进画板。
    同样规则也应用到了页面元素（**标题 / 文字 / 分割线**）：拖进画板时宽度收成「画板宽 − 32」并夹在画板内
    （此前标题仍是 980 宽、会撑出画板）。
  · 修复（同日，用户说「数据集挂不上，刷新就没了」）：`toDocItem` 以前对页面元素**不写 spec**，
    画板绑定的 `spec.binding.dataset_id` 在保存时被丢掉。现在画板（连同分割线的形状 spec）一起保存，
    实测保存后 `dataset_id=20` 仍在、重新打开下拉显示对应数据集。
  · 修复（同日，用户说「网页预览跟编辑画板的组件内容不一致」）：预览页给弹窗用的元素数据是 `DocItem`，**不带 `kind`**，
    弹窗里 `RENDERERS[kind]` 找不到就回退成指标卡 → 词云/条形图全被画成数字。现在按 `component` 推导 kind
    （`base.wordcloud` → `wordcloud`），弹窗里的组件类型与画板一致（实测词云、条形图都正常渲染）。
    补：**跨页面**找画板时（画板在页面2、明细表在主视图）走的是文档原始元素，同样没有 kind —— 统一用
    `asCanvasItem` 转换（补 kind + 摊平 layout 坐标），实测用户看板 126 的跨页弹窗里词云、条形图都正常。
  · 新增（同日）：画板配置加「半屏 / 满屏」快捷高度（450 / 900，按 1080 屏浏览器可视高给参考），
    设计时直接按满屏画就能估算弹窗里放得下多少内容；成品页弹窗本来就按视口收缩（`min(board.h + 24, 880)`），超出只会滚动。
- **验证**（同上临时项目）：画板绑数据集 20 → 拖入指标卡 → 保存后新卡 `binding.dataset_id = 20`（继承生效）。
  · 优化（同日）：行过滤列名做**大小写归一化** —— 明细表配「链接ID」、弹窗组件用的数据集里叫「链接id」时，解析阶段按数据集真实列名自动纠正
    （`resolver._fix_filter_columns`，只做大小写匹配，不做模糊猜列），避免两套数据集的列名写法不一致导致过滤不生效。
- **怎么验证**（临时令牌）：临时项目放一个画板（520×680）+ 里面两张指标卡 + 明细表（弹窗指向该画板）→ 成品页只剩明细表（画板内容隐藏）、点行右侧弹出 544px 宽、内容是两张卡且按行过滤；改中间弹出为 544×704 对话框、改左侧为 x=0 宽 524；编辑器里选明细表出现「弹窗 / 弹窗画板 / 弹出位置 / 行标识列」，点行画布右侧面板同样显示。截图：`board-element.png`、`board-popup-right.png`、`board-popup-center.png`、`board-popup-left.png`、`board-editor-panel.png`；验完已删除；`tsc --noEmit` 通过。

## 2026-11-12 · 新增：明细表「行详情」——点一行右侧滑出可配置面板

- **诉求**：点明细表的一行，右侧滑出详情面板；面板内容和看板一样用组件搭；明细表配置里有开启按钮。
- **改了什么**：
  1. 后端 `TableViewSpec.detail = { enabled, key_field, items[] }`（`items` = 组件卡片：`{key, component, kind, h, spec}`），`compute` 输出到 `payload.detail`；
  2. 编辑器：选中明细表 → 配置面板底部「行详情」→「点击行弹出右侧详情」开关；开启后出现「行标识列」下拉（用表格里哪一列识别这一行）、「添加卡片」（从组件库选）与卡片列表；**点卡片在中栏编辑其配置**（顶部有「← 返回明细表」）；
  3. 运行时：点行 → 右侧 480px 抽屉（`BoardViewer` 紧凑模式，无点阵背景/无横向滚动），顶部显示行标题；每个卡片自动注入 `key_field = 当前行值` 的过滤条件，取数只取这一行；
  4. `BoardViewer` 增加 `plain / fitWidth` 两个参数（不加时行为不变）。
- **涉及文件**：`backend/app/components/spec.py`、`compute.py`、`frontend/src/features/components/types.ts`、`renderers/TableCard.tsx`、`board/BoardViewer.tsx`、新增 `editor/TableDetailSettings.tsx`、`editor/QueryPanel.tsx`、`pages/CanvasBoardPage.tsx`。
- **组件库自查**：`detail` 默认 `enabled=false`、缺省即关闭，`base.table` 模板无需改库；`table_view` 其余字段未变。
- **怎么验证**（临时令牌）：临时项目表格（数据集 27，列 产品标题 + 链接）+ 行详情放一张指标卡（按「产品标题」过滤）→ 点第一行抽屉宽 480、顶部是产品标题、卡内显示「日销量 300」；编辑器选中表格出现「行详情 / 点击行弹出右侧详情」开关（`table-detail-editor.png`、`table-row-detail.png`）；验完已删除；`tsc --noEmit` 通过。
  · 迭代（同日）：编辑器里原来用的是全屏右侧 Drawer，会盖住左栏/类型栏（用户实测）。现在**编辑器内改为画布区域内的右侧面板**（`CanvasDetailContext` 下发，`TableCard` 检测到在画布里就走面板），成品页仍是全屏抽屉；
    面板宽度随画布自适应（≤460，窄时按画布 50%），详情卡片按面板宽度排版（`RowDetailContent` 增加 `width`）；
    面板顶部再让出 `RULER_SIZE`（20px），只占版面区域、不压顶部标尺。
  · 迭代（同日，用户要求）：行详情改成**可进「详情画布」编辑** —— 配置面板点「在画布中编辑」，画布切换成该明细表的详情组件，
    和编辑页面一样拖动 / 缩放 / 选中配置；顶部条「正在编辑：行详情面板」+「完成 / 取消」；保存/发布时自动先提交详情再落盘
    （`stashView` 增加 `list` 参数与「详情编辑中不落页面」保护）。
  · 迭代（同日，用户点名「弹窗本身要是画布」）：右侧行详情面板改为**可编辑小画布** —— 点阵背景；从类型栏把组件**直接拖到面板上**
    （按落点定位）、卡片可拖动 / 右下角拉伸、点卡片在中栏配置；卡片坐标 `x/y/w/h` 随 spec 落盘（`TableDetailSpec` 增加这三个字段）。
    实测：拖一张指标卡进面板 → 位置 (200,152) 宽 378 高 120 → 保存后库里的 `detail.items` 与之一致。
  · 性能收口：详情面板取数改为 `preview-batch` 一次批量（10 张详情卡 = 1 个请求，原来 10 个）；
    实测 10 张详情卡让看板 doc 增大约 6KB（压缩后 2KB），主画布 items 结构不变、渲染路径不变。
  · **回退（2026-11-12 晚，用户要求）**：「弹窗本身是画布」被认为有局限，已撤销 —— 行详情面板恢复为**只读渲染**
    （`RowDetailContent`），移除面板内拖入 / 拖动 / 缩放与 `DetailCanvasPanel`；组件仍通过配置面板的「添加卡片」
    或「在画布中编辑」（详情画布模式）管理。面板位置/宽度自适应、按行过滤取数都保留。验证：编辑器点行后 `[data-inline-detail]` 面板 403px、位于画布右缘、顶部从标尺下方开始，顶部显示行品牌、卡内「日销量 300（麦富迪）」按行过滤生效（`table-detail-inline.png`）。

## 2026-11-12 · 新增：明细表「链接」列改为「打开」按钮，点击弹二维码

- **诉求**（用户截图）：明细表里链接 / 网址列铺一整串 URL 太长；希望点成「打开」按钮，弹出二维码方便手机扫。
- **改了什么**：
  1. 单元格值匹配 `^https?://…` 时，渲染成「打开」按钮（带二维码图标），不再显示长网址；
  2. 点击弹出二维码弹窗：白底圆角卡 + 232px 二维码 + 「用手机扫一扫，打开链接」+ 完整网址（可换行）；
  3. 二维码**本地生成**（`qrcode.react`），不走外网接口；
  4. 卡片内、查看更多弹窗、预览页三处共用同一单元格渲染，行为一致。
- **涉及文件**：`frontend/src/features/components/renderers/TableCard.tsx`、新增 `frontend/src/features/components/board/QrCodeDialog.tsx`、`frontend/package.json`（+`qrcode.react@4.2.0`）。
- **怎么验证**（临时令牌，不经过登录）：临时项目用数据集 27、列「产品标题 + 链接」→ 链接列 10 个「打开」按钮，点第一个弹出二维码（SVG 232px，地址 `https://detail.tmall.com/item.htm?id=810000000001`），截图 `docs/_selfcheck/table-qr-dialog.png`；验完已删除（DELETE 200）；`tsc --noEmit` 通过。
  · 迭代（同日）：关闭二维码时会出现一个**空白框**（用户实测截图）。原因：`open` 变 false 的瞬间内容被条件卸载，
    关闭动画里只剩一张透明的 Dialog Paper。现在把最后一次的地址保留到 `TransitionProps.onExited` 才清空，
    关闭动画期间仍显示二维码淡出；顺带把「点缩略图看大图」弹窗做了同样处理。
    验证：关闭后 120ms 仍 `role=dialog` 且内含 SVG（内容在淡出），600ms 后 dialog 数 0（`qr-close-mid.png`）。

## 2026-11-12 · 重构：分套改为「分套依据」显式开关（不再绑死「平台」）

- **诉求**：原来筛选字段配了「切换数据集」（`dataset_map`）就自动按平台分套，太固定；分类名不一定是「平台」（也可能是品类 / 榜单），要一个灵活的开关。
- **改了什么**：
  1. 筛选字段卡片「名称」下方新增「分套依据」开关（`FilterFieldSpec.split`）；勾上即成为分套依据，取值 = `dataset_map` 的键，或该字段的选项值；
  2. 同一筛选栏只允许一个分套依据，勾选新的会自动清掉其它字段的分套标记与 `dataset_map`；
  3. 判定统一收到 `split.ts`：`isSplitField / splitKeysOf / findSplitField`（`split === true || dataset_map 非空`，历史看板行为不变）；
     画布（`activePlatform` / `hasPlatformSwitcher` / `boundPlatforms`）与筛选栏渲染（`isDatasetSwitch` / `optionsOf`）都改用它；
  4. 后端 `render.py` 新增 `_is_split`，切换器取值 / 字段解析 / 当前套判定全部兼容 `split`；`spec.py` 增加 `split: bool`。
- **涉及文件**：`frontend/src/features/components/split.ts`（新增）、`types.ts`、`editor/FilterFieldsEditor.tsx`、`renderers/FilterBar.tsx`、`pages/CanvasBoardPage.tsx`、`backend/app/components/spec.py`、`backend/app/dashboards/render.py`、`AGENTS.md §5.1`、`docs/平台分套_需求与技术方案.md`。
  · 迭代（同日）：筛选栏字段顺序改为**严格按「筛选字段」配置的先后** —— 原来 `[...switchers, ...perPlatform]` 会把分套字段提到最前（用户实测：品类被挪到平台前面）。
    现在 `FilterBar` 与后端 `resolved_fields` 都按通用字段顺序渲染，分套字段留在原位；平台那套独有的字段追加在末尾。
  · 组件库同步（AGENTS.md §5 铁律）：① 库中 `base.filter` 的「平台」字段补 `split: true`（备份 `/tmp/component-filter-backup.json`）；
    ② `seed_base.BASE` 与 `catalog.py` 的筛选栏模板同步加「平台」字段（`split: true`，选项 天猫 / 拼多多）；
    ③ 自查 `base.filter` 五个字段顺序/选项正常，组件库放大预览渲染正常（`library-filter-split.png`）；
    ④ 文件同步：`AGENTS.md §5.1`、`docs/平台分套_需求与技术方案.md` 第 7 节、本日志均已更新。
- **怎么验证**：
  1. 后端单测式验证：`split=True → 是分套`、旧 `dataset_map → 仍是分套`、普通字段 → 否；`_switcher_value` / `_platform_value` 能取到分套值；
  2. 编辑器实测（看板 666）：选中筛选栏后每个字段出现「分套依据」开关（截图 `docs/_selfcheck/split-switch.png`）；
  3. 端到端：临时项目里筛选字段「品类」只勾 `split`、选项甲类/乙类、`items_map` 各放一张标题卡 → 预览默认显示「甲类专属内容」（`split-e2e.png`），验完已删除；
  4. 顺序实测（看板 666）：配置顺序 平台→品类→榜单→价格带→搜索，画布筛选栏顺序完全一致（`filter-order.png`）；
  5. `tsc --noEmit` 通过，后端已重启。

## 2026-11-12 · 修复：编辑器中栏出现两条滚动条；滚动条改细改浅

- **现象**（用户截图）：中栏配置面板右侧出现两条竖滚动条。
- **原因**：中栏容器本身 `overflowY: auto`，里面的 `QueryPanel` 又自带一层 `overflow: auto`，两层都滚。
- **改了什么**：
  1. `QueryPanel` 去掉内层滚动（改由中栏统一滚动），中栏只留一条；
  2. 全局滚动条：宽/高 8px → **6px**，轨道改透明，滑块改 `rgba(148,163,184,0.32)`（hover 才加深到 0.5），圆角 999，整体更细更浅。
- **涉及文件**：`frontend/src/features/components/editor/QueryPanel.tsx`、`frontend/src/index.css`、新增 `frontend/src/features/components/editor/OverlayScrollbar.tsx`、`frontend/src/pages/CanvasBoardPage.tsx`。
  · 迭代（同日）：原生滚动条仍会「滑块拉得很长、一直占着一条」。改为**自定义覆盖层滚动条**：
    原生滚动条在三栏里隐藏，改由 `OverlayScrollbar` 画一条 4px 细条 —— **鼠标移进面板才出现**，
    滑块长度上限为容器高度的 38%（不再按内容比例拉满），支持拖动；离开面板即淡出。
    `FieldPanel` / `ChartTypeRail` 的内部滚动也统一收到外层栏，保证每栏只有一条。
- **怎么验证**：
  1. 全页统计可滚动容器 —— 左 232 / 中 336 / 右 168 各一条（此前中栏是两条）；
  2. `editor-overlay-scroll.png`：未 hover 时三条覆盖层 opacity 全 0；hover 中栏后中栏 opacity 1、滑块高 335px（容器 882 的 38% 上限）；
  3. `scrollbarWidth: none` + `::-webkit-scrollbar { display: none }` 已生效；
  4. `tsc --noEmit` 通过。

## 2026-11-12 · 新增：编辑器三栏支持拖拽调宽（PS 式）

- **诉求**：编辑页左（数据集字段）/ 中（元素配置）/ 右（图表类型）三栏都改成可以拖拉窗口大小，像 Photoshop 的分栏。
- **改了什么**：
  1. 三栏之间加 5px 拖拽手柄（画 1px 细线，hover / 拖动时变紫加粗，光标 `col-resize`）；
  2. 限宽：左栏 180–420、中栏 280–560、右栏 140–340（右栏反向拖）；
  3. 宽度写 `localStorage`（`mcbi.editor.leftW/midW/rightW`），刷新、重开都保留；
  4. 拖动时锁 `body` 光标与文本选中，松手才落盘；拖动过程里画布按剩余空间自适应。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（新增 `useResizableWidth` hook 与 `Splitter` 手柄）、`frontend/src/features/components/editor/QueryPanel.tsx`。
  · 迭代（同日）：① 拖动改为「拖拽中只改 CSS 变量 + rAF 合帧」，不再每帧 setState，实测拖动期间 p95 16.8ms（60fps，无 >32ms 长帧）；
    ② 画布缩放拖动中实时跟随（rAF 合并测量），不再等松手才跳变；
    ③ 面板内元素自适应：控件宽度随面板伸缩，指标行在窄宽时自动换行（原来指标下拉被压成「日…」）；
    ④ 三栏拖到极窄 / 极宽均无横向溢出（scrollWidth == clientWidth）；
    ⑤ 新增 PS 式折叠：左（数据集）/ 中（配置）/ 右（图表类型）各一个收起按钮，收起后变 24px 窄条（竖排标题），
       点窄条展开；状态存 `mcbi.editor.collapsed`，刷新保留。三栏全收起时画布宽度 849 → 1528；
    ⑥ 折叠/展开动画：240ms 宽度过渡（cubic-bezier(.4,0,.2,1)）+ 内容淡出 + 窄条淡入；动画期间冻结画布重算、
       结束补一次 —— 实测动画期间 p95 16.8ms、0 帧 >32ms（不做冻结时 45 帧里有 15 帧掉到 33ms）。
- **怎么验证**（临时令牌，不经过登录；截图在 `docs/_selfcheck/`）：
  1. `editor-splitters.png`：拖后 左 372 / 中 280 / 右 268，画布 665；
  2. 实测拖拽：左栏 302→372、中栏 336→400、右栏 218→268，都按预期变化并写入 localStorage；
  3. `editor-splitters-default.png`：清掉 localStorage 后恢复默认 232 / 336 / 168；
  4. hover 手柄：分隔线 `rgb(238,243,251)` → `rgb(79,70,229)`（紫），光标 `col-resize`；
  5. `editor-pane-narrow.png`（180/280/140）与 `editor-pane-wide.png`（420/560/340）：内容自适应、无溢出、指标行换行正常；
  6. 拖动帧耗时：avg 17ms / p50 16.7 / p95 16.8 / max 33.3，仅 2 帧 >32ms；
  7. 折叠实测：三个收起按钮均存在；全收起后三条窄条（数据集/配置/图表类型）出现、画布 849→1528；点窄条可逐条展开；状态写入 localStorage；`docs/_selfcheck/editor-collapsed.png`；
  8. 动画实测：折叠后宽度 0、展开 120ms 时 176（过渡中）、完成 232；动画期间帧耗时 p50 16.7 / p95 16.8 / max 16.8、0 帧超 32ms；
  9. `tsc --noEmit` 通过。

## 2026-11-12 · 新增：环形图文字位置三档（图形上 / 图形旁 / 图形外）

- **诉求**：环形图的标签文字会压在扇形上（用户截图），不改图形本身，希望在参数配置里能选文字显示位置。
- **改了什么**：
  1. 编辑器中栏「环形」组底部新增「文字位置」三档分段按钮（仅 `pie` / `donut` 显示，全站唯一入口）；
  2. `chart.label_layout` 从 `inside | outside` 扩展为 `inside | beside | outside`：
     - **图形上**（inside）：标签在扇区内部（原默认，会压在图形上）；
     - **图形旁**（beside）：标签紧贴扇区外缘（`distance 0`），不画引导线；
     - **图形外**（outside）：离边缘更远（`distance 30`）+ 引导线（`length 34 / length2 22`）；
  · 迭代（同日四次）：① 首版两档只差 10px 看不出区别；② 拉开 `distance/labelLine` 后「图形旁」仍偏远；
    ③ 改用 `labelLayout` 硬定位能把标签拉近，但会破坏 ECharts 的防重叠（标签互相压）。
    最终方案：**回到 ECharts 原生布局**，「图形旁」= `distance 10` + 一条 18/6 的**透明引导线**（借它把标签推到贴边、
    又不画出来），既贴近约 10px、又不压图形、还不互相重叠；「图形外」= `distance 30` + 可见引导线 `34/22`。
  3. 后端 `ChartSpec.label_layout` 枚举同步放开 `beside`，前端类型同步。
- **涉及文件**：`frontend/src/features/components/types.ts`、`skin/pieOption.ts`、`editor/ChartOptionsPanel.tsx`、`backend/app/components/spec.py`。
- **组件库同步**（按 AGENTS.md 铁律自查）：`bi_component` 中只有 `base.donut`（inside）与 `base.pie`（outside）两个饼环模板，字段都已存在、语义正确，无需改库；`seed_base` 的默认值来自后端 ChartSpec，重灌也不会漂移。
- **怎么验证**（用本机签发令牌，不经过登录；截图在 `docs/_selfcheck/`）：
  1. 建临时项目放 3 张环形图（三档各一），`docs/_selfcheck/donut-label-layout.png`：图形上=文字压图形、图形旁=外缘无引导线、图形外=带引导线，三档视觉明确区分；
  2. 编辑器选中环形图，配置面板出现「文字位置」+ 图形上/图形旁/图形外按钮（`donut-label-panel.png`）；
  3. 后端 PUT 校验通过（三档均能保存），临时项目 108/109/110 已删除（软删）；
  4. `tsc --noEmit` 通过。

## 2026-11-12 · 数据：组件库移除「榜首数字」「最佳名次」两条 kpi 定制模板

- **诉求**：用户指出这两条与「指标卡」是同类，保留标准「指标卡」即可。
- **核实**：三条都是 `kind=kpi` ——
  - 93 `base.kpi`「指标卡」：内置（`is_builtin=true`，接口本来也不允许删）；
  - 111「榜首数字」：dataset 28 · 日销量 SUM（前 10 合计口径）；
  - 112「最佳名次」：dataset 21 · 榜单排名 MIN（前 10 计数口径）。
- **做法**：软删除（`archived=true`），行还在、随时可恢复；删除前备份 `/tmp/component-backup-111-112.json`；
  先查过 `bi_canvas.doc` 无任何看板引用这两条（0 行），删模板不影响已有看板（看板存的是 spec 副本）。
- **怎么验证**（截图 `docs/_selfcheck/component-library-18.png`）：
  1. 组件库从 20 个变 18 个，顶部「18 个卡片」，两条均不再出现；
  2. 只有这两条属于「指标」分类，分类栏随之消失；「指标卡」分类与卡片保留；
  3. 类型栏与组件库同源（`/bi/components`），画布右侧也不再出现这两项；
  4. 看板渲染不受影响（无引用）。

## 2026-11-12 · 优化：组件库卡片点开 = 放大查看（不再跳画布）

- **诉求**：组件库的卡片点击后应该放大展开看组件，而不是跳去画布。
- **改了什么**：
  1. 卡片点击从 `nav("/bi/canvas")` 改为打开 `ComponentPreviewDialog`：1120px 宽弹窗、标题 + 类型/分类/描述，Esc / 右上 ✕ / 点遮罩关闭；
  2. `PreviewThumb` 增加 `scale` / `full` / `fit` 三个参数：词云与表格不再裁条数；卡片墙仍是 0.82 缩略；
  3. 卡片手势 `cursor: zoom-in`。
  · 迭代（同日）：首版放大是「宽高拉满容器」，组件被拉伸失真（用户实测指出）。现改为按**真实落版尺寸**等比缩放：
    新增 `features/components/sizes.ts`（banner 1440×200、nav 1440×64、filter 1440×56、table 1440×560、section 1200×56、insight 420×220、kpi 224×104、其余 420×300），
    画布 `KIND_SIZE` 与放大预览共用这一份；弹窗内按 `min(1072/原宽, 520/原高)` 整体 scale，字号与间距跟着等比放大，看到的就是画布上的真实效果。
- **涉及文件**：`frontend/src/pages/ComponentLibraryPage.tsx`、`frontend/src/pages/CanvasBoardPage.tsx`、`frontend/src/features/components/board/PreviewThumb.tsx`、新增 `frontend/src/features/components/board/ComponentPreviewDialog.tsx`、新增 `frontend/src/features/components/sizes.ts`。
- **怎么验证**（不经过登录接口：用本机密钥按当前会话版本临时签发令牌，避免单设备登录把用户顶下线；截图在 `docs/_selfcheck/`）：
  1. `component-library-grid.png`：卡片墙 20 张；
  2. `preview-ratio-banner.png`：头标卡按 1440×200 比例显示成宽条（7.2:1），不再拉伸；
  3. `preview-ratio-scatter.png`：散点图按 420×300（1.4:1）等比放大，居中留白；
  4. `preview-ratio-kpi.png` / `preview-ratio-table.png`：指标卡 224×104 → 1072×498（2.15:1）、明细表 1440×560 → 1072×417（2.57:1），比例与原始一致；
  5. Esc 关闭成功；`tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：组件库「新建图表」改为「新建项目」，去掉建图弹窗

- **诉求**：组件库（卡片墙）右上角不要再弹「创建新图表」弹窗；按钮改成「新建项目」，点了直接进全新的「编辑设计」（画布编辑器）。
- **改了什么**：
  1. 按钮文案「新建图表」→「新建项目」；点击 = `POST /bi/dashboards` 建一块空项目 → 跳 `/bi/canvas?doc=<新id>`（与项目页「新建项目」同一套逻辑），创建中显示「创建中…」并禁用防连点；
  2. 删掉 `NewChartDialog` 弹窗与空态里的「新建第一个图表」入口（组件文件保留但已无引用）；
  3. 创建失败时提示用 error 样式（toast 增加 severity）。
- **涉及文件**：`frontend/src/pages/ComponentLibraryPage.tsx`。
- **怎么验证**：
  1. `tsc --noEmit` 通过；
  2. 无头浏览器实测点击 → 后端确实创建了项目（id 106「未命名项目06」，19:16:57 创建），证明按钮链路通；
  3. 该临时项目已不存在（19:17:11 被删除），当前库内无测试残留；
  4. 注意：本系统登录是**单设备**（每次登录 `token_version+1`，旧会话立刻失效），验证脚本登录 admin 会把正在使用的浏览器顶下线 —— 本次实测就发生了互相顶号，后续验证不再用真实账号登录，改为让用户手点确认。

## 2026-11-12 · 优化：「我的看板」只收已发布看板（点过「发布我的看板」才出现）

- **规则（用户明确）**：「我的看板」是作品集，项目在编辑器里点「发布我的看板」后才进来；草稿只在「编辑设计 → 项目」里维护。
- **改了什么**：
  1. 后端 `GET /bi/dashboards` 增加 `published_only` 参数，SQL 过滤 `COALESCE(doc->>'published','true') <> 'false'`
     —— 只有显式 `published=false` 才算草稿；没有该字段的老看板 / 种子看板视为已发布（否则演示看板会凭空消失）；
  2. 列表返回的 `published` 与过滤同口径 `(doc.published is not False)`，避免「标着 false 却出现在列表」的自相矛盾；
  3. 前端「我的看板」请求带 `?published_only=1`（重命名 / 删除后的刷新也带）；「项目」页仍取全量。
- **涉及文件**：`backend/app/dashboards/repository.py`、`backend/app/dashboards/router.py`、`frontend/src/pages/BiDashboardPage.tsx`。
- **怎么验证**（admin 实测，截图在 `docs/_selfcheck/`）：
  1. 接口对比：全量 4 条（666 / 未命名项目03 / 未命名项目02 / 演示），`published_only=1` 只剩 2 条（666、演示）—— 97/98 是 `published=false` 被过滤；
  2. `board-list-published-only.png`：我的看板 2 张，侧栏计数同步为 2；
  3. `projects-all-drafts.png`：项目页仍是 4 张，草稿没丢、编辑入口不受影响；
  4. 后端已重启（DEBUG 热重载不生效），`/api/health` 正常。

---

## 2026-11-12 · 优化：「我的看板」看板区改成「项目」页同款布局

- **诉求**：项目页（白底、大标题、缩略图网格）视觉更好，BI 主页的看板区要照同一套来。
- **改了什么**：
  1. 头标卡（紫色渐变「明策BI / 自研先进BI引擎 / 浏览模板」）保留，移到内容区最上方、白卡之外；· 迭代（同日）：首版曾整块删掉，用户要求保留，已按「头标在上、白卡在下」恢复；
  2. 看板区改成项目页结构：白色大圆角容器 + 27px 标题「我的看板」+ 右上搜索图标（点开才出输入框）；
  3. 卡片网格与项目页同一套参数：`repeat(auto-fill, 208px)`、列间距 40 / 行间距 32、16:10 缩略图、名称居中在卡片下方；
  4. 原来的「打开 / 编辑 / 重命名 / 共享 / 删除」按钮排收进卡片右上角 hover 出现的 ⋯ 菜单（预览 / 编辑 / 重命名 / 删除；engine 类型另有共享）；
  5. `BoardThumb`（doc → 微缩版面）从项目页抽到 `features/bi-dashboard/BoardThumb.tsx` 共用，两页缩略图不会再各写一份。
- **涉及文件**：`frontend/src/pages/BiDashboardPage.tsx`、`frontend/src/pages/ProjectsPage.tsx`、新增 `frontend/src/features/bi-dashboard/BoardThumb.tsx`。
- **怎么验证**（无头 Chrome 登录实测，截图在 `docs/_selfcheck/`）：
  1. `board-list-banner.png`：头标卡在最上方（紫渐变、20px 圆角、与白卡间距 16px），下面是白底看板区，4 张卡 208×130；
  2. `board-list-new.png`：仅白底看板区（无头标）的对照图，标题「我的看板」；
  2. `board-list-menu.png`：hover 出现 ⋯，菜单为 预览 / 编辑 / 重命名 / 删除；`board-list-hover.png` 显示按钮 opacity 1；
  3. 点卡片跳 `/bi/dashboards/58?view=main`，点「编辑」进画布（原逻辑不变）；
  4. `board-list-search.png`：搜索「散点」只剩 1 张；`board-list-empty.png`：搜不存在的词显示「没有匹配的看板」；
  5. `board-list-1024.png`：1024 宽自动两列不溢出；`projects-regression.png`：项目页抽组件后仍正常（新建项目 + 4 张卡）；
  6. `tsc --noEmit` 通过、`bash scripts/ui_rules.sh` 通过。

## 2026-11-12 · 优化：前端开发服支持局域网访问（手机 / 其他电脑直接打开）

- **诉求**：项目要能在局域网里打开，方便用手机 / 另一台电脑看看板。
- **改了什么**：
  1. `frontend/vite.config.ts` 的 `server.host` / `preview.host` 从 `127.0.0.1` 改为 `0.0.0.0`（监听全部网卡）；
  2. 后端保持只绑 `127.0.0.1:8300`（不额外暴露），前端 `/api`、`/uploads` 仍走 Vite 代理，局域网设备只需访问 5300；
  3. `scripts/dev.sh` 前端启动固定用 `/usr/local/bin/node`（已加入 macOS 防火墙白名单，避免外部连接被 ALF 静默拦截），`status` 额外打印局域网地址；
  4. README「端口约定」补局域网访问与防火墙说明。
- **涉及文件**：`frontend/vite.config.ts`、`scripts/dev.sh`、`README.md`。
- **怎么验证**（本机 + 无头 Chrome 实测，截图 `docs/_selfcheck/lan-192.168.31.41.png`）：
  1. `lsof -iTCP:5300` 显示 `*:5300 (LISTEN)`；`http://10.0.20.34:5300` 与 `http://192.168.31.41:5300` 首页均 200；
  2. 局域网 origin 下 `fetch("/api/health")` 返回 `database: up`，CSRF cookie 正常写入（64 字符），登录接口可达；
  3. 无头 Chrome 打开 `http://192.168.31.41:5300` 正常渲染登录页。

---

## 2026-11-12 · 修复：头标卡预览里大标题变成「头标卡」（编辑器与预览不一致）

- **现象**（用户实测，看板「666」）：编辑器里头标卡大标题是「四平台榜单」，预览页显示成「头标卡」。
- **根因**：渲染服务在给每张卡拼 payload 时，**无条件用卡片名 `spec.title` 覆盖了 `payload.title`**
  （`_resolve_spec` 里 `payload.update({"kind":…, "title": spec.title})`，以及 `render_dashboard` 里
  `if item.title: payload["title"] = item.title`）。头标卡的 `payload.title` 装的是**大标题内容**
  （`banner.title`），被卡片名「头标卡」顶掉，于是预览、缩略图、发布页全显示错。
- **改了什么**：两处覆盖都跳过 `kind == "banner"`；卡片名仍然通过 `payload.component.name` 提供，
  其它组件（指标卡 / 图表 / 明细表 / 分节标题 / 结论卡）行为不变。
- **涉及文件**：`backend/app/dashboards/render.py`（`_resolve_spec`、`render_dashboard`）。
- **怎么验证**（QA 账号只读打开看板 58，未改数据）：
  1. `POST /bi/dashboards/58/render` 该卡 payload：`title` 由「头标卡」→ **「四平台榜单」**，
     `component.name` 仍是「头标卡」；
  2. 预览页大标题显示「四平台榜单 市场分析看板」，其它卡标题（日销量 / 榜单排名 / 链接ID）不受影响；
  3. 截图 `docs/_selfcheck/banner-preview-fixed.png`；后端重启后 `health 200`。

---

## 2026-11-12 · 修复：明细表「图片字段」下拉读不出字段（直连数据集为空）

- **现象**（用户实测，看板「666」的明细表）：打开缩略图后「图片字段」下拉一个选项都没有。
- **根因**：候选字段只取 `role === "id"` 的字段（`identifierOptions`）。而直连数据集同步出来的字段角色是按
  数据库类型猜的（text → dimension、数字 → measure），**根本不会有 `id` 角色**（实测数据集 27 的
  链接ID 是 measure/numeric、主图ID/详情图ID 是 dimension），所以列表恒为空。
- **改了什么**：
  1. 候选改为**所有文字类列**（标识 + 维度，排除 measure / time），去重；
  2. 排序把名字像图片的（主图 / 详情图 / image / url / 链接…）提到最前，挑起来不用翻；
  3. 打开缩略图时的默认字段沿用「名字最像图片的那一列」逻辑（不变）。
- **涉及文件**：`frontend/src/features/components/editor/QueryPanel.tsx`（`TableThumbSettings` 的候选与排序）。
- **怎么验证**（QA 账号只读打开看板 58 的明细表，未保存、未改数据）：
  1. 图片字段下拉从「0 个选项」变为 19 个，前三个正好是 `主图ID / 详情图ID / 链接`；
  2. 截图 `docs/_selfcheck/thumb-field-options.png`；控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 新增：编辑器顶栏点项目名直接改名

- **诉求**：编辑器左上那个项目名 chip 点不了，想在里面直接改名字。
- **改了什么**：
  1. 点**当前项目**那个 chip → 原地变成输入框（同样的高度与胶囊圆角，文字预选中）；
  2. 回车 / 失焦提交（`PATCH /bi/dashboards/{id}`，只改名不动内容），提示「已重命名」；`Esc` 放弃；
  3. 名字为空或没改动 → 直接退出、不发请求；成功后就地更新顶栏 chip 文字；
  4. 其它项目的 chip 行为不变：点一下切过去（悬停提示最近编辑时间）。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（`renaming` / `renameDraft` / `commitRename`）。
- **怎么验证**（QA 账号 + 临时看板 103，验完已删）：
  1. 点当前 chip「未命名项目04」→ 出现输入框（`placeholder="项目名称"`）；
  2. 输入「天猫渠道月报」+ 回车 → 顶栏 chip 立刻变成新名字，`GET /bi/dashboards/103` 返回 `name=天猫渠道月报`；
  3. 截图 `docs/_selfcheck/rename-inline.png`；控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：没起名的项目自动编号「未命名项目01 / 02 / 03…」

- **诉求**：项目列表里一堆同名「未命名项目」分不清（截图 3 个一模一样），没命名的要按 01、02、03 排下去。
- **改了什么**：
  1. 后端新增 `repo.next_untitled_name()`：扫现有 `未命名项目\d+`，取**最大号 +1**，两位补零（01、02…10、11）；
  2. `POST /bi/dashboards`：名字为空、或只给了默认名「未命名项目」时，自动用这个编号；
     用户自己起的名字原样保留；
  3. 前端「新建项目」不再写死名字，交给后端编号；
  4. 启动自愈 `bootstrap.ensure_project_names()`：历史上就叫「未命名项目」的看板按**创建时间**顺序补成 01/02/03…（幂等，只动名字）。
- **涉及文件**：`backend/app/dashboards/repository.py`、`backend/app/dashboards/router.py`、
  `backend/app/bootstrap.py`、`backend/app/main.py`、`frontend/src/pages/ProjectsPage.tsx`。
- **怎么验证**（QA 账号，验完测试看板与账号已删）：
  1. 重启后端 → 现有 3 块裸名看板按创建时间变为 **未命名项目01（doc 58）/ 02（doc 97）/ 03（doc 98）**；
  2. 连续新建：不传名 → `未命名项目04`；传默认名「未命名项目」→ `未命名项目05`；传自定义名 → 原样保留；
  3. 项目页按更新时间倒序显示 05/04/03/02/01（截图 `docs/_selfcheck/untitled-numbered.png`）；
  4. `tsc --noEmit` 通过，后端 `health 200`。

---

## 2026-11-12 · 优化：顶栏只显示「最近编辑」的 3 个看板

- **诉求**：编辑器左上那排看板 chip 太多了，希望只显示**最近更改过的 3 个**。
- **改了什么**：
  1. 列表接口本来就按 `updated_at DESC` 返回，前端取前 3 个；**当前正在编辑的这个永远在内**
     （若它比较旧，就它 + 最近 2 个，总数仍 ≤3）；
  2. chip 的 `title` 悬停显示「最近编辑 MM-DD HH:mm」，两个同名「未命名项目」也能分辨；
  3. 保存成功后重新拉一次看板列表，刚存完的这个自动排到第一个。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（`recentDocs` memo、`persist` 成功后刷新列表）。
- **怎么验证**（QA 账号 + 临时看板 99，验完已删；用户自己的 5 个看板未改动）：
  1. 当前=新建的临时看板 → chips 正好 3 个：`临时验证 · 最近编辑`、`未命名项目`、`未命名项目`（接口顺序第 1/2/3 名）；
  2. 打开第 5 名的老看板 57 → chips：`演示 · 散点相关性`（当前，第一）、`临时验证…`、`未命名项目` —— 当前项不会被挤掉，总数仍 3；
  3. 截图 `docs/_selfcheck/recent-3.png`；控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 规则：把「平台分套」的需求与技术方案落成文档

- **诉求**：「你把这个修改的方式、需求、技术方案都记录下来，万一出现，还可以知道原需求」。
- **新增文档** `docs/平台分套_需求与技术方案.md`，含：
  1. 原始需求（用户原话逐条：切平台只属于自己的内容、标题/形状也要分、以指标卡为参照、预览必须一致）；
  2. **四条不变量**（只有筛选栏共用 / 其余元素全归平台 / 平台之间互不影响 / 三处渲染同一口径）；
  3. 数据模型（`items` vs `items_map[平台]`、`view_items_for` 唯一读入口、同 ID 可跨套出现）；
  4. 四层技术方案（编辑器 `isViewLevelItem`/`stashView`/`migratePlatformSplit`、后端 `heal_view_filters`/
     `_with_live_items`/`all_items`、预览页合并口径与 `p_*` 参数、与「首视页 / 跳转页全展示 / 数据源账本」的交叉规则）；
  5. 踩坑时间线（形状不显示 → 矫枉过正改成整页共用 → 删标题连带 → 预览参数假生效）；
  6. 8 条回归验收清单 + 文件清单。
- **同时**：`AGENTS.md §5.1` 末尾加一行指向该文档（改这段逻辑前先读）。
- **涉及文件**：`docs/平台分套_需求与技术方案.md`（新）、`AGENTS.md`。
- **怎么验证**：通读文档里的 8 条回归清单，与当前实现逐条对照（12 元素全类型验证已通过，见同日前一条的「· 迭代」）。

---

## 2026-11-12 · 修复：切平台后标题/形状仍是「全院共用」，删一边另一边跟着没

- **现象**（用户实测，未命名项目 doc 58）：拼多多页里删掉「天猫 •榜单概况」标题，天猫页也没了 —— 标题根本没分平台；
  指标卡却是分平台的。用户要求「切到哪个平台，就只属于自己的那一页内容」。
- **根因**：上一轮为了修「形状保存后不显示」，把标题 / 文字 / 形状一并算成了**整页共用**（存 `items`），
  于是任何平台上的删除都会删掉共用那份。
- **改了什么（口径统一为：只有筛选栏共用）**：
  1. 前端 `isViewLevelItem()` 只认筛选栏；标题 / 文字 / 形状 / 卡片一律归当前平台那套 `items_map[平台]`；
  2. 后端 `_is_page_element` 去掉、`_shared_filter_items` 只返回筛选栏、`view_items_for` 的共用部分 = 筛选栏
     （旧结构里还挂在 `items` 的内容先照常渲染，避免「还没保存就先少一截」）；
  3. `heal_view_filters` 改成 `heal_view_platforms` 的语义：保存时把页面级残留的标题/形状**复制进每个还没有它们的平台那套**
     （同 key），然后页面级只留筛选栏；某平台自己已有标题的就不再掺，避免两份标题；
  4. 编辑器载入时先跑一次同样的迁移（`migratePlatformSplit`），切平台立刻就是各自一份，不用等保存；
  5. 预览页 `items` 合并口径同步改成「共用 = 筛选栏」。
- **顺带修掉两个真 bug（都是预览侧的）**：
  ① 预览页从来不读地址栏的 `p_*` 参数（`readParamQuery` 写了却没人调用），所以「预览带上筛选值 / 平台」
     一直没生效；② 换看板时 `setParams({})` 会把刚读进来的 `p_*` 抹掉，再被默认值顶替。
  现在预览会按链接里的 `p_platform=拼多多` 真的渲染拼多多那套。
- **涉及文件**：`backend/app/dashboards/models.py`、`frontend/src/pages/CanvasBoardPage.tsx`、
  `frontend/src/pages/DashboardPage.tsx`、`AGENTS.md`（§5.1 口径改成「只有筛选栏共用」）。
- **怎么验证**（QA 账号 + 临时看板 94/95，验完已删）：
  1. 复刻 doc 58 的旧结构（筛选栏 + 标题 + 形状共 3 个挂在页面级，两个平台各 1 张卡）→ 载入后三样都在，
     且已各自分进两个平台那套；
  2. 在**拼多多**选中「拼多多 •榜单概况」删除 → 保存后库内：`items=[filter]`、
     `天猫=[heading:h_tm, chart]`（**保留**）、`拼多多=[chart]`（只删掉自己那份）；
  3. 编辑器里切平台（筛选栏「平台」下拉）→ 卡片各自不同（截图 `docs/_selfcheck/platform-pdd-view.png`）；
  4. 预览 `?view=main&p_platform=拼多多` → 平台选中拼多多且出现该平台标题；`p_platform=天猫` → 没有该标题
     （截图 `docs/_selfcheck/platform-preview-pdd.png`）；
  5. `tsc --noEmit` 通过；后端重启后 `health 200`。
- **· 迭代（全类型复核）**：按「筛选栏 + 8 种组件 + 标题 + 文字 + 形状」共 12 个元素做全类型验证 ——
  载入后 12 个全在；切到拼多多后 12 个也全在（各一份）；在拼多多删掉柱状图后保存：
  天猫 11 个（原样保留）、拼多多 10 个（只少了它自己那张）、`items` 只剩筛选栏 ✓
  （截图 `docs/_selfcheck/all-kinds-platform.png`）。

---

## 2026-11-12 · 数据：把本轮组件改动同步进组件库（nav / filter）

- **背景**：本轮动了三个组件的配置能力（头标卡底色、筛选栏底部背景、导航菜单卡首视页），
  按 §5 的规矩逐个核对是否要回写 `bi_component`。结论：
  | 组件 | 改动 | 要不要入库 | 处理 |
  | --- | --- | --- | --- |
  | 头标卡 `base.banner` | 底色 4 套 → 7 套、面板改色点 | 模板只需 `tone=sky`（仍是合法值），选项不写进 spec | 核对通过，未改 |
  | 筛选栏 `base.filter` | 新增「底部背景」开关；画布默认高度 76 → 56 | **要**（新增字段 + 默认高度） | 模板补 `filter.inline=true`、`filter.background=false`，`ui.min_height` 76 → 56 |
  | 导航菜单卡 `base.nav` | `active` 语义从「当前页」改为「首视页」（互斥） | **要**（模板里原来预置了 `榜单端 active=true`，会变成「自带一个首视页」） | items 全部 `active=false` 并补 `page: ""`；描述文案改为「圆点/高亮/首视页」 |
  | 形状（矩形/线） | 线粗支持小数、形状参数面板 | 不要（形状是页面元素，不在组件库） | — |
  | 编辑器交互（丝滑拖拽 / 复制粘贴 / 参考线 / 标题去横线） | 不是组件配置能力 | 不要 | — |
- **改了什么**：`backend/app/components/seed_base.py` 的 `BASE`（下次重灌种子即新值）+
  直接 `UPDATE bi_component` 那两行（只动目标 JSON 路径，未整份重写）。
- **怎么验证**：
  1. 库表回读：`base.nav` 四个菜单项 `active = [false,false,false,false]`、`page` 均为空；
     `base.filter` `filter.background=false` / `filter.inline=true` / `ui.min_height=56`；`base.banner` `tone=sky`；
  2. 接口回读 `GET /bi/components`（类型栏用的同一份数据）三条一致；
  3. 全库自查 18 个内置组件：数据类全部指向演示数据集 20，维度/指标列都存在于该数据集
     （热力图的 `series` 是字符串维度 `价格带`，符合 `BindingSpec.series: str`）。
- **注意**：画布上已有的卡片是副本，不受影响；**只有之后从类型栏新拖出来的**才用新模板。

---

## 2026-11-12 · 修复：首视页在「预览」里不生效（预览按钮把 view 写死了）

- **现象**（用户实测，未命名项目 doc 58）：「需求端」勾了首视页，点预览仍停在主视图。
- **根因**：编辑器右上「预览」按钮会拼 `?view=<当前编辑页>`，预览页优先认 URL 里的 view，
  于是首视页永远被盖掉（改首视页 → 以为没生效）。
- **改了什么**：预览不再塞 `view`（= 打开发布后的样子，按首视页落地），只保留 `p_*` 筛选参数。
  要看特定页：在预览里点导航菜单，或地址后加 `?view=页面ID`。
- **常见误解（数据层面，不需要改代码）**：分平台的看板，导航卡在 `items_map[平台]` 里各存一份；
  doc 58 的「拼多多」那份菜单项「跳转页面」都是空的（早前拆分时留下的副本），
  所以切到拼多多平台时导航不会高亮——回到「天猫」平台编辑/预览即可。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`。
- **怎么验证**（QA 账号只读打开 doc 58，未改用户数据）：
  1. 直接打开发布链接 `/bi/dashboards/58` → URL 变 `?view=page_mwd28hgl`，落地**页面2**，
     导航高亮「需求端」（琥珀底 `rgba(217,119,6,0.14)`）；
  2. 在编辑器里点「预览」→ 同样落到页面2（URL 不再带 `view=main`）；
  3. 截图 `docs/_selfcheck/home58-preview.png`；控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：导航菜单卡「当前页」改为「首视页」+ 高亮色跟随菜单项圆点

- **诉求**：① 菜单项上的「当前页」开关改成「首视页」（= 网页打开先展示哪一页）；
  ② 导航卡里选中的那个菜单项的**颜色要跟随该项自己的「圆点」配色**，不要固定蓝。
- **改了什么**：
  1. 面板开关更名为 **首视页**，语义变成「打开看板优先落到这一页」，且**互斥**（勾一个自动取消其余）；
  2. 落地页生效点：编辑器打开看板、预览/成品页首次打开（URL 带 `?view=` 时以 URL 为准，用户切过页则保持）；
     新增 `features/components/navHome.ts` 的 `navHomePage(doc)`，`items` 与 `items_map[平台]` 都扫；
  3. 导航卡高亮改由「你在哪一页」推导（编辑器把当前编辑的页面传进 `NavCard`，预览页传当前 view），
     `active` 不再参与高亮 —— 它现在只表示「首视页」；
  4. 高亮胶囊按该项 `tone` 取色：背景用该色 12% 透明、文字用该色深一档（灰/靛蓝/天蓝/青绿/琥珀/玫红/紫各自一套）。
- **组件库**：`nav.items[].active` 字段含义变了但结构没变，`base.nav` 模板无需改动。
- **涉及文件**：`frontend/src/features/components/navHome.ts`（新）、
  `frontend/src/features/components/renderers/NavCard.tsx`、`frontend/src/features/components/editor/QueryPanel.tsx`、
  `frontend/src/features/components/board/BoardCard.tsx`、`frontend/src/features/components/board/BoardSurface.tsx`、
  `frontend/src/pages/CanvasBoardPage.tsx`、`frontend/src/pages/DashboardPage.tsx`。
- **怎么验证**（QA 账号 + 临时看板 93：三页，导航卡挂在主视图，「页面2」设为首视页，圆点分别灰/玫红/青绿）：
  1. 打开编辑器 → 直接落在**页面2**（页签高亮），主视图里的导航卡把 页面2 项点亮；
  2. 预览页不带参数打开 → URL 变 `?view=pg2`，导航胶囊是**玫红底**（`rgba(244,63,94,0.12)`）、文字玫红；
     `?view=main` → 主视图点亮且是**石墨底**，`?view=pg3` → 页面3 青绿底；
  3. 面板里点第三个菜单项的「首视页」→ 页面2 的自动关掉（互斥），保存后刷新编辑器 → 落在**页面3**；
  4. 截图 `docs/_selfcheck/nav-home-panel.png`、`docs/_selfcheck/nav-home-preview.png`；
  5. 控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：筛选栏默认高度 76 → 56（开「底部背景」时白卡贴住控件）

- **诉求**：筛选栏开了「底部背景」后，白卡默认上下空太多，希望默认就更紧凑。
- **改了什么**：筛选栏的**新建默认高度** `76 → 56`（56 = 控件自身 32px + 上下各 12px 内边距），
  三处默认值一起改：工具栏「筛选栏」按钮（`addFilter`）、从类型栏拖进来（`KIND_SIZE.filter`）、
  拖入落位框的预览尺寸（`ELEMENT_SIZE.filter`）。白卡仍按元素高度铺满，所以 56 时正好贴住一排控件。
- **已存在的筛选栏**不动（属于用户数据）：它们保留原来的高度，选中后往下拖底边即可压到 36–56；
  上一轮已把筛选栏的最小高度从 110 放到 36，所以现在能拖得动。
- **组件库**：`base.filter` 模板的 spec 没变（画布高度是前端默认值，不写在模板里），无需同步。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`。
- **怎么验证**（QA 账号 + 临时看板 92，验完已删）：
  1. 带「底部背景」的筛选栏按 56 布局 → 白卡实测高度 56 设计像素（屏幕 33px）、左右内边距 16px；
  2. 从工具栏再点一次「筛选栏」新增 → 两张卡高度都是 56；
  3. 截图 `docs/_selfcheck/filter-default-56.png`；控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 修复：筛选栏拉矮反而变大 / 拉不到贴着控件

- **现象**（用户实测）：拖筛选栏的框想拉矮，高度反而变大；想贴住文字根本拉不下去。
- **根因**：`MIN_SIZE` 只分了两档 —— 「页面元素」（标题/文字/形状，最小 120×36）
  与「图表卡」（最小 180×110）。筛选栏 `type=filter` 被算进了图表卡那一档，
  于是「最小高度 110」直接顶住它：默认 76 的筛选栏一拖就先被撑到 110（= 变大），再往下拖也停在 110。
- **改了什么**：`BoardCard` 的最小尺寸增加「控件条」一档 —— `type=filter` 时最小 `240×36`
  （36 = 控件自身 32px + 边框余量），想贴多紧就多紧；图表卡仍是 180×110，页面元素不变。
- **涉及文件**：`frontend/src/features/components/board/BoardCard.tsx`。
- **怎么验证**（QA 账号 + 临时看板 91，验完已删）：
  1. 拖底边往上 48px：76 → 36 设计像素（屏幕 45px → 21px），不再弹到 110；
  2. 继续往上拖停在 36（最小），白底卡片仍完整包住一排下拉控件；
  3. 截图 `docs/_selfcheck/filter-height-min.png`；控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 新增：筛选栏「底部背景」开关（白底圆角卡片）

- **诉求**：筛选栏现在直接铺在画布上（没有底），希望在配置面板里能一键开「底部背景」，变成一张白底卡片（参考图）。
- **改了什么**：
  1. `spec.filter.background`（默认 `false`，老数据行为不变）；
  2. 配置面板（`FilterFieldsEditor`）顶部新增一行开关「底部背景」，样式与导航卡的「跳转页全展示」一致；
     只有画布编辑器传了回调才显示，组件库编辑页不出现；
  3. `FilterBar` 新增 `surface` 属性：开启后自身铺满高度并加一层表面 —— 白底、`12px` 圆角、
     `1px #EEF3FB` 细边、`0 1px 2px` + 柔和投影，左右 `16px` 内边距；关闭时保持原样（纯控件铺在画布上）；
  4. 编辑器（`BoardCard`）与预览页（`DashboardPage`）都按这个开关渲染，所见即所得。
- **组件库**：`FilterSpec` 只是多了一个默认 `false` 的字段，`base.filter` 模板无需改动（已核对库里那行 spec 仍合法）。
- **涉及文件**：`backend/app/components/spec.py`、`frontend/src/features/components/types.ts`、
  `frontend/src/features/components/renderers/FilterBar.tsx`、
  `frontend/src/features/components/editor/FilterFieldsEditor.tsx`、
  `frontend/src/features/components/board/BoardCard.tsx`、`frontend/src/pages/CanvasBoardPage.tsx`、
  `frontend/src/pages/DashboardPage.tsx`。
- **怎么验证**（QA 账号 + 临时看板 90，验完已删）：
  1. 选中筛选栏 → 面板出现「底部背景」开关（默认关）；开启后卡片计算样式 `borderRadius 12px / border #EEF3FB / bg #fff`；
  2. 保存后回读 `spec.filter.background = true`；预览页同一位置是 1 张白底圆角卡片；
  3. 截图 `docs/_selfcheck/filter-bg-on.png`（编辑器）、`docs/_selfcheck/filter-bg-preview.png`（预览页）；
  4. 控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：矩形「线」的粗细可以输任意小数（最小 0.1）

- **诉求**：线的粗细要能输任意数值（比如 0.1），最小值按 0.1 理解。
- **原来的两个卡点**：
  1. 渲染端 `Math.max(1, Math.round(stroke_w))` —— 把 0.5 四舍五入成 1、0.1 也变 1；
  2. 面板是「边打字边写回 + 每键夹区间」的受控数字框 —— 输 `0` 立刻被夹成 1，根本输不进 `0.1`。
- **改了什么**：
  1. `ShapeView` 的直线分支不再取整：`thickness = max(0.1, stroke_w)`，按小数渲染；
  2. 形状参数改用新的 `ShapeNumberField`：编辑时保留**本地草稿**（可以正常打出 `0.1`），
     失焦 / 回车才提交并夹到 `[0.1, 40]`（保留两位小数），`Esc` 放弃；
  3. 顺带：矩形的「描边宽度」同样支持 0.1 步长（圆角仍是整数步长 1）。
- **涉及文件**：`frontend/src/features/components/shapes.tsx`（线粗取整 → 保留小数）、
  `frontend/src/pages/CanvasBoardPage.tsx`（`ShapeNumberField` + 形状面板三个数值框）。
- **怎么验证**（QA 账号 + 临时看板 89，验完已删）：
  1. 线粗输入框 `min=0.1 / step=0.1`；三击全选后输入 `0.1`，输入过程中显示就是 `0.1`（不再被夹）；
  2. 回车提交后线元素 `getComputedStyle.height = 0.09375px`（≈0.1px 细线，DPR2 下是一条发丝线）；
  3. 保存后回读 `items[0].spec.shape.stroke_w = 0.1`（后端不改写数值）；截图 `docs/_selfcheck/line-thickness.png`；
  4. `tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：标题元素去掉下方那条横线

- **诉求**：标题组件下面那条线不要了（截图：「1 新标题」底下有一道 1px 线）。
- **改了什么**：`type=heading` 的渲染盒去掉 `borderBottom: 1px solid #EEF3FB` 及其 `padding-bottom`；
  编辑器（BoardCard 的 `ElementBody`）和预览页（DashboardPage 的 `HeadingElement`）两处同时改，保证所见即所得。
- **涉及文件**：`frontend/src/features/components/board/BoardCard.tsx`、`frontend/src/pages/DashboardPage.tsx`。
- **怎么验证**（QA 账号 + 临时看板 88，验完已删）：编辑器里标题元素盒 `border-bottom = 0px none / padding-bottom = 0`；
  预览页同一元素父盒 `border-bottom: 0px none`；截图 `docs/_selfcheck/heading-no-line.png`；`tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：头标卡「底色」扩到 7 套，并改成色点选择

- **诉求**：头标卡的「底色」只有 4 个选项（天蓝/靛蓝/青绿/暖橙），要像「指标卡 → 外观」那样多几种颜色。
- **改了什么**：
  1. 新增 3 套底色主题 **玫红 rose / 紫罗兰 violet / 石墨 slate**，连同原有 4 套共 7 套；
     每套都配好渐变底、同色系描边、波浪、标题/副标题文字色（不是只换一个背景色）；
  2. 面板里「底色」从下拉框改成**一排色点**：20px 圆点、选中描 2px 同色环 + 2px 偏移、悬停放大 ——
     与「指标卡 → 外观」那排色点同一套交互和尺寸；
  3. 后端 `BannerSpec.tone` 白名单同步放行新值（否则保存时会被归一化成 sky，颜色丢失）。
- **组件库**：模板 `base.banner` 的默认底色仍是 `sky`、spec 结构没变，所以**不需要**改种子/回写库里那一行
  （已核对 `select code, spec->'banner'->>'tone' from bi_component where code='base.banner'` → `sky`）。
- **涉及文件**：`frontend/src/features/components/renderers/BannerCard.tsx`（3 套新主题 + 导出 `BANNER_TONES`）、
  `frontend/src/features/components/editor/QueryPanel.tsx`（下拉 → 色点）、`backend/app/components/spec.py`（tone 白名单）。
- **怎么验证**（QA 账号 + 临时看板 87，验完已删）：
  1. 面板出现 7 个色点；点「玫红」→ 头标卡底色变成 `linear-gradient(102deg, rgb(255,249,251), rgb(254,242,245), rgb(253,233,239))`；
  2. 保存后回读 `spec.banner.tone = "rose"`（后端没把它改回 sky），刷新后颜色仍在；
  3. 截图 `docs/_selfcheck/banner-tone-rose.png`；控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 修复：导航菜单卡「跳转页全展示」不生效

- **现象**（用户实测）：导航菜单卡勾上「跳转页全展示」，换到别的页面看不到那张导航。
- **根因**：两处查找都只认「老位置 + 老字段」：
  1. 只翻 `view.items` —— 带平台切换器的看板里，卡片会被挪进 `items_map[平台]`，于是永远找不到；
  2. 只认 `component === "base.nav"` —— 卡片被「换成导航形态」后 component 不会跟着改，也对不上。
  3. 预览页（DashboardPage）有同一份重复逻辑，所以预览里同样不生效。
- **改了什么**：
  1. 编辑器只读影格（`ghostNav`）与预览页「叠全局导航」（`globalNavItem` / `renderItems`）统一成：
     只认 `spec.nav.global_nav` 这一个开关（不再看 kind / component），并且同时扫 `items` 和
     `items_map` 里所有平台那几套；
  2. 「本页已经有全展示导航 → 不再叠影格 / 不再重复注入」的判定同样按这个口径。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（`ghostNav`）、`frontend/src/pages/DashboardPage.tsx`（`globalNavItem` / `renderItems`）。
- **怎么验证**（QA 账号 + 临时看板 83/86，验完已删）：
  1. 无平台切换器的看板：页面2 出现「全展示」只读影格；导航卡自己的那页没有影格；
  2. **带平台切换器**的看板（复现前是坏的）：页面2 影格正常出现（修前 `ghostBadge: 0`，修后 `1`）；
  3. 预览页 `?view=pg2` 顶部正常叠出导航条（截图 `docs/_selfcheck/nav-preview-pg2.png`），
     导航卡所在的主视图不会叠第二次；
  4. 控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 新增：元素复制粘贴（⌘C / ⌘V）+ ⌥拖动即复制

- **诉求**：画布页面之间要能「复制粘贴组件 / 元素」；再要一个「按住 Alt + 左键拖动 = 在此页复制该元素」的 PS 手感。
- **改了什么**：
  1. `⌘C`：把选中的元素转成文档元素放进剪贴板（提示「已复制 N 个元素」）。同时写一份到**系统剪贴板**
     （JSON 带 `mingcebi:1` 标记），所以换页面、换看板、甚至刷新后都能粘；
  2. `⌘V`：粘到**当前页面**（换页不受影响），每个元素生成新 ID、深拷贝 spec（改副本不会串改原件），
     反复粘贴按 24px 阶梯错开，粘完自动选中新元素；
  3. `⌥ + 左键拖动`：越过 4px 阈值时先在原位复制一份，原元素继续被拖走 —— 视觉上就是 PS 的「Alt 拖动复制」；
     多选时整组一起复制；复制出来的那份留在原位、被拖走的仍保持选中；
  4. 修饰键冲突处理：**按下时就按住 ⌥ = 复制**；拖动过程中才按 ⌥ 仍然等于旧行为「关掉磁吸、自由摆放」；
  5. 在输入框里打字时 `⌘C / ⌘V` 不拦截（交给浏览器），不影响面板里复制文字。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（剪贴板 / `cloneDocItem` / `duplicateForDrag` / 快捷键）、
  `frontend/src/features/components/board/BoardCard.tsx`（`altStart` + 阈值触发复制）、
  `frontend/src/features/components/board/BoardSurface.tsx`（`onDuplicate` 透传）。
- **怎么验证**（QA 账号 + 临时看板 82，验完已删）：
  1. 主视图选中矩形 `r1` → ⌘C 提示「已复制 1 个元素」→ 切「页面2」→ ⌘V → 页面2 出现 `s_mwd5ab0829`；
  2. 在该形状上 `⌥ + 拖 96px`：元素数 1 → 2，原元素左上角 708,211 → 803,284，复制出来的仍在 708,211；
  3. 粘贴提示「已粘贴 1 个元素」（截图 `docs/_selfcheck/copy-paste.png`）；
  4. 控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 新增：后端记录「组件 → 数据源」账本

- **诉求**：「组件使用哪些数据集的数据，在后端都需要记录」——绑定关系原来只埋在 `bi_canvas.doc` 的 JSON 里，
  想回答「这个数据集被哪几个看板 / 哪一页 / 哪个元素在用」，得把整份文档捞出来解析，无法索引、无法关联。
- **新增表** `bi_dash_item_source`（`schema/migrations/015_dash_item_source.sql`）：
  `dashboard_id + view_key(页面 ID) + item_key(元素 ID) + dataset_id` 是主键，另带 `item_kind / item_type /
  role(primary | platform:平台) / metric / dimension / updated_at`。一个元素绑多个数据集（筛选栏的平台映射）
  就多行，`role` 说明是哪一条绑定；不取数的页面元素（标题 / 文字 / 形状）不记。
- **什么时候写**：`PUT /bi/dashboards/{id}`（保存 / 发布）后按这次保存的文档**整体重建**；
  看板软删时清掉它的行；启动时 `bootstrap.ensure_item_sources()` 按现存文档全量回填一遍（幂等，34 个看板 23 行）。
- **怎么查**：
  * `GET /bi/dashboards/{id}/sources` —— 这个看板每个元素用了哪个数据集（带数据集名 / 指标 / 维度）；
  * `GET /bi/semantic/datasets/{id}/usages` —— 这个数据集被哪些看板 / 页面 / 元素在用（删数据源前的安全查询）。
- **界面上**：左侧「数据集」下拉下面多一行 `本看板 N 个元素在用`（来自后端账本，保存后自动刷新），
  配合上一轮的中栏 `页面 ID / 元素 ID`，定位就是「看板 58 › 页面 pg2 › 元素 b1 › 数据集 3」。
- **涉及文件**：`backend/schema/migrations/015_dash_item_source.sql`、`backend/app/dashboards/sources.py`（新）、
  `backend/app/dashboards/router.py`、`backend/app/semantic/router.py`、`backend/app/bootstrap.py`、
  `backend/app/main.py`、`frontend/src/pages/CanvasBoardPage.tsx`。
- **怎么验证**（QA 账号 + 临时看板 81，验完已删）：
  1. 建一份「主视图 a1/a2 用数据集 2、页面2 b1 用数据集 3」的看板 → 账本 3 行：
     `main|a1|2`、`main|a2|2`、`pg2|b1|3`（带数据集名与指标）；
  2. `datasets/3/usages` → `count=1`，命中 `81 / pg2 / b1`；
  3. 编辑器里数据集选「榜单端·SKU」→ 下拉下显示「本看板 2 个元素在用」；
  4. 现有看板启动回填：`bi_dash_item_source` 23 行 / 2 个看板 / 4 个数据集；
  5. `tsc --noEmit` 通过，后端重启后 `health 200`。

---

## 2026-11-12 · 新增：工具栏「矩形」——6 种形状 + 参数面板（替代原来的「分割线」）

- **诉求**：编辑页功能区的「分割线」改成 PS 那样的「矩形」，点开能选多种形状；
  形状要有参数区（颜色 / 圆角 / 描边 / 翻转），画布上还能拖动拉大小。
- **数据怎么放**：元素类型仍复用 `divider`（后端 `ItemDef.type` 不用改，老文档照样读），
  外观参数放 `spec.shape`（`ItemDef.spec` 是自由字典）。老分割线没有 `shape` → 兜底成「直线」，
  渲染与原来那根 1px 浅灰线完全一致。
- **改了什么**：
  1. 工具栏「分割线」→「矩形 ⌄」，点开是形状菜单：矩形 / 椭圆 / 三角形 / 多边形 / 直线 / 星形；
  2. 新形状元素默认尺寸按形状给（矩形 320×200、椭圆/多边形/星形 240×240、直线 480×12），
     落到视口中央，选中即可拖动 / 拉四边缩放；
  3. 右侧参数区：形状（6 格图标切换）、填充（9 色板 + 系统取色器 + 无）、
     描边（同色板 + 宽度，无描边时不显示宽度）、圆角（仅矩形）、翻转（水平 / 垂直）；
  4. 渲染：矩形 / 椭圆走 CSS（圆角、描边是像素级），三角形 / 多边形 / 星形走 SVG
     （`vector-effect: non-scaling-stroke`，拉成扁宽时描边不变粗），直线 = 居中的一条线；
  5. 保存链路：`toDocItem` 原来只给 chart/filter 写 spec，现在形状元素也写，
     所以颜色/圆角刷新后还在；预览页（`/bi/dashboards/:id`）与发布查看器（`BoardViewer`）
     统一用同一个 `ElementBody` 渲染，形状不再退化成一根线（顺带修好了标题/文字在查看器里被当成空卡片的老问题）。
- **涉及文件**：新增 `frontend/src/features/components/shapes.tsx`（形状定义 / 默认值 / 渲染 / 图标）；
  `frontend/src/features/components/types.ts`（`ShapeKind` / `ShapeSpec`）；
  `frontend/src/features/components/board/BoardCard.tsx`（`ElementBody` 改用形状渲染并导出）；
  `frontend/src/features/components/board/BoardViewer.tsx`（页面元素本地渲染）；
  `frontend/src/pages/CanvasBoardPage.tsx`（工具栏菜单 / `addShape` / 参数面板 / 保存）；
  `frontend/src/pages/DashboardPage.tsx`（预览页形状渲染）。
- **怎么验证**（QA 账号 + 临时看板 74/75，验完已删）：
  1. 菜单 6 项齐全；点「椭圆」→ 新卡带 50% 圆角；填充点琥珀 → `rgb(245,158,11)` 立即生效；
  2. 切回矩形 → 默认圆角 12；圆角改 40 → `border-radius:40px`；翻转水平 → `matrix(-1,0,0,1,0,0)`；
  3. 六种形状同屏渲染（`docs/_selfcheck/shape-gallery.png`），宽扁三角形描边不变形；
  4. 右下角缩放：星形 142×142 → 203×194；
  5. 保存后回读 doc：`spec.shape` 完整（fill/kind/radius/stroke/flip），刷新后形状与参数都在；
  6. 老分割线（无 shape）仍渲染 1px 浅灰线（`height:1px`）；
  7. 预览页 `/bi/dashboards/75` 六种形状正常（`docs/_selfcheck/shape-preview-page.png`）；
  8. 控制台无异常；`tsc --noEmit` / `ui_rules.sh` 通过。

### · 迭代（同日，修复：形状保存后画布不显示）

- **现象**（用户实测）：「矩形这些保存后，画布并没有显示」。
- **根因**：不是渲染，是**分平台存储的归类错了**。`splitItems()` 只把「筛选栏」当整页共用元素，
  标题 / 文字 / **形状**被当成「平台卡片」塞进了 `items_map[平台]`。于是：
  切页（或切平台）时这页的 `items` 先被清空成只剩筛选栏，形状跟着进了平台套；
  再保存就把 `items` 写成空、形状留在 `items_map` 里 —— 画布上自然什么都看不到。
  实测链路（临时看板复现）：切「页面2」时 `[DBG platform] 天猫 items 2` → `map[天猫]` 只落 1 条 →
  `items` 变 1 条，形状消失。
- **改前端**：新增 `isViewLevelItem()`（筛选栏 + `heading/text/divider` 都算整页共用），
  `splitItems()` 与「没选平台先显示第一套」的兜底统一按这个口径；无平台切换器的页面在
  `stashView()` 里顺手清掉残留的 `items_map`，避免同一张卡在 `items` / `items_map` 各存一份。
- **改后端（兜底旧脏数据）**：`heal_view_filters()` 现在把「被误存进平台套的标题/文字/形状」也挪回 `items`，
  并从平台套里剔除（只挪「确实还存在」的，不会凭空补删掉的）；`_shared_filter_items()` 与
  `view_items_for()` 同步把页面元素算作整页共用，且平台套里与页面级同 key 的元素会被去重。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`、`backend/app/dashboards/models.py`。
- **怎么验证**（QA 账号 + 临时看板 76/77/78，验完已删）：
  1. 用户看板 `doc=58`：切「页面2」→ 3 个形状全部渲染，来回切两次都在；
  2. 端到端：带平台筛选的看板新建「页面2」放形状 + 图表 → 保存 → 库内
     `p2.items = [形状, 图表]`、`p2.items_map = {}`（旧版会写成 items 空 + 形状进 map）→ 刷新后仍在；
  3. 自愈：故意 PUT 一份「形状塞在 `items_map.天猫`」的脏文档 → 回读为
     `items = [形状1, 形状2]`、`items_map.天猫 = [图表]`；
  4. `tsc --noEmit` 通过；后端重启后接口 200。

### · 迭代（同日，页面归属确认 + 页面/元素 ID 可见可复制）

- **诉求**：「在哪个页面编辑就属于哪个页面的」；新增页面要有**页面 ID**，加的组件同样有**组件 ID**，
  这样才能精确定位到「哪个看板 / 哪一页 / 哪个元素」。
- **现状与改动**：
  1. 页面归属：上一轮的 `isViewLevelItem()` 修复后实测已经成立 ——
     在「页面2」加形状，切回主视图看不到它，切回来在；保存后库内
     `main.items=[图表]`、`pg2.items=[形状]`，刷新后依然如此（不再串页）；
  2. 页面 ID：建页时生成（`page_xxx` / `pg2` 这类 key 存在 `views[].key`），本来就稳定；
     现在**在 UI 里露出来**：页面标签悬停显示「页面 ID」，右键菜单新增「复制页面 ID」；
  3. 元素 ID：每个元素创建时生成（`c_xxx` / `s_xxx`，全局唯一、随 doc 持久化），
     中栏顶部新增 ID 条：`页面 <id>` + `元素 <id>`，点一下复制并提示「已复制元素 ID / 页面 ID」；
  4. 复制走 `navigator.clipboard`，失败时退回 `execCommand`（非安全上下文也能用）。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（`IdChip` / `copyText` / ID 条 / 页面菜单）。
- **怎么验证**（QA 账号 + 临时看板 80，验完已删）：
  1. 页面2 加形状 → `页面2: [s_mwd4z5z787]`；切主视图 → `[c1]`（形状不串页）；切回 → 形状仍在；
  2. ID 条显示 `页面 pg2` / `元素 s_mwd4z5z787`，点元素 ID → 提示「已复制元素 ID」；
  3. 保存 → 库内 `main.items=[c1:chart]`、`pg2.items=[s_mwd4z5z787:divider]`；刷新后页面2 形状仍在；
  4. 截图 `docs/_selfcheck/page-id-chip.png`；控制台无异常，`tsc --noEmit` 通过。

### · 迭代（同日，修「预览看不到形状」）

- **现象**（用户实测）：「这些矩形，点击预览就是网页的内容」—— 在「页面2」点预览，看到的却是主视图。
- **两个原因**：
  1. 预览按钮只跳 `/bi/dashboards/{id}`，没带当前页 → 预览永远落在 `views[0]`（主视图），
     页面2 的形状自然看不到；
  2. 预览页（DashboardPage）取元素时同样把「整页共用」写死成只看 `type === "filter"`，
     页面2 有 `items_map` 时 `shared` 为空 → 整页空白（截图实测就是一张白板）。
- **改了什么**：
  1. 预览按钮带上「当前页 + 当前筛选值」：`?view=<当前页>&p_<参数>=…`（和预览页自己的 URL 格式一致）；
  2. 预览页的共用元素口径改成「筛选栏 + 标题 / 文字 / 形状」，与画布编辑器一致。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`（预览按钮）、`frontend/src/pages/DashboardPage.tsx`（items 取数）。
- **怎么验证**（用户看板 `doc=58`，只读，未保存）：
  1. 页面2 → 点预览 → URL 变成 `…?view=page_mwd28hgl`，三个形状（矩形 / 椭圆 / 三角形）正常显示
     （`docs/_selfcheck/preview-check.png`）；
  2. 主视图预览仍正常（筛选栏 + 头标卡 + 图表）；
  3. 控制台无异常，`tsc --noEmit` 通过。

---

## 2026-11-12 · 优化：画布拖拽改为「过程不渲染，松手才提交」

- **诉求**：拖参考线（以及拖卡片）不够丝滑，不像 PS。根因不是鼠标，是**底座**：
  过去每一次 `pointermove` 都走 `setGuides / setItems / setSnapGuides / setDirty`，
  整页 React 重渲染 → 9 张卡片的 ECharts 全部 `setOption` 一遍 → 掉帧。
- **改了什么**（核心一句：**拖拽期间零 React 渲染**）：
  1. 卡片移动改用 `transform: translate3d` 直接写 DOM（不再改 left/top），缩放直接写内联宽高；
     吸附数学仍在 `snapping.ts` 里逐帧算，但结果只进 ref，**松手才 `onLayoutChange` 提交一次**；
  2. 参考线拖动同样只写这一根线的内联位置；坐标提示（X/Y 像素）与拉线预览线由
     `BoardSurfaceHandle.previewGuide / showTip` 直接写 DOM，页面不再为此 setState
     （`pendingGuide` / `guideTip` 两个 state 已删除）；
  3. 吸附线改成复用 DOM 节点池（`paintSnap`），不再 `setSnapGuides` 触发整页重渲染；
  4. 所有实时写入走 `requestAnimationFrame` 合帧（鼠标回报率高于刷新率时不重复劳动）；
  5. 多选拖动：其余选中的卡同帧 transform 跟随，提交仍走页面原来的「delta 应用到整个选区」；
  6. 顺手补上 PS 手感：拖动中 `Esc` 取消（原位作废，不落历史）、`pointercancel` 回原位、
     被拖卡片临时 `zIndex:30` 置顶、`will-change` 提升合成层。
- **涉及文件**：`frontend/src/features/components/board/BoardSurface.tsx`、
  `frontend/src/features/components/board/BoardCard.tsx`、`frontend/src/pages/CanvasBoardPage.tsx`
- **怎么验证**（无头 Chrome + 独立 QA 账号，不动你自己的登录态；临时看板 63 / 测试账号验完已删）：
  1. 8 张 ECharts 卡片，拖卡片 60 帧：`p50 16.7ms / p95 16.8ms / max 33.4ms`，整段 0 个 longtask，
     `LayoutCount` 只涨 19（原来是每帧一次全页重渲染）；
  2. 拖参考线 40 帧：`p50 16.7ms / p95 16.7ms / max 16.8ms`，拖动中 `inlineTop` 实时变化、
     提示浮层跟随，松手才把 `y:673` 写回 doc；
  3. 多选（⇧ 点第二张）拖动：两张同帧跟手，松手后两张位置都更新；
  4. 吸附线在拖动中出现（`#FB7185` / 中线虚线）、松手即消失；
  5. `Esc` 取消卡片拖动 → 回原位且不产生历史步；`Esc` 取消参考线拖动 → 位置不变；
  6. 撤销 ⌘Z 可把一次拖动整体还原（一次按下-松手 = 一步）；
  7. 控制台无异常；截图 `docs/_selfcheck/drag-qa-mid-drag.png`（拖动中）、
     `drag-qa-resize-live.png`（缩放中）、`drag-qa-guide-live.png`（参考线拖动中）。

### · 迭代（同日下午，第二轮）：从类型栏 / 工具栏「拖组件进来」也换成指针拖

- **诉求**：编辑页「组件」的拖拉也要丝滑。原来走浏览器原生 HTML5 拖放：只有一张半透明鬼影，
  落点看不见，`dragover` 也不给反馈，感觉「拖不动」。
- **改了什么**：
  1. 类型栏每一项、工具栏「标题 / 文字 / 分割线 / 筛选栏」按钮，去掉 `draggable` + `dataTransfer`，
     改为 `pointerdown` 起拖（位移超过 4px 才算拖，没动就还是「点击」）；
  2. 画布上实时画**落位框**（虚线 + 淡紫底 + 组件名药丸），尺寸就是该组件的默认落版尺寸
     （指标卡 224×104、图表 420×300、整版块 1440×…、元素按工具栏默认），跟着指针走；
  3. 落位框走同一套磁吸：其它卡边线 / 画布中线 / 手工参考线都能吸，吸附线复用卡片拖动那套节点池；
  4. 松手才 new 一张；**松手位置在画布外 = 放弃**（按松手点判，不看最后一次移动点）；
     拖完紧跟的那次 click 会被吞掉，不会「拖完又点一下」多建一张；
  5. 拖动中 `Esc` 取消；整段零 React 渲染，帧率与卡片拖动一致；
  6. 细节：拖组件时整块画布（含参考线的 ↔ 光标）统一切成「抓取中」；窗口失焦
     （切到别的 App / 在窗口外松手）一律按取消收尾，落位框和光标不会卡住。
- **涉及文件**：新增/改动集中在 `BoardSurface.tsx`（`previewInsert` / `showSnap` + 落位框节点）、
  `ChartTypeRail.tsx`（`onDragInsert`）、`CanvasBoardPage.tsx`（`beginInsertDrag`）。
- **怎么验证**（QA 账号 + 临时看板，验完已删）：
  1. 从「饼图」拖进画布：中途落位框 `display:block`、尺寸 247.9×177.1（= 420×300 × 0.59 缩放）、
     药丸显示「饼图」；松手卡片 2→3，落位框隐藏；
  2. 拖出画布再松手 → 卡片数不变（修掉了「按最后一次移动点误建卡」的坑）；
  3. 不拖只点（先 Esc 取消选中）→ 仍在视口中央新增一张，点击语义不变；
  4. 工具栏「文字」拖进画布：药丸显示「文字」，松手 4→5；
  5. `Esc` 中途取消 → 不建卡；拖动 40 帧 `p50 16.7ms / p95 16.8ms`、0 个 longtask；
  6. 截图 `docs/_selfcheck/insert-drag-live.png`（落位框）、`insert-drag-after.png`（落版后）。

### · 迭代（同日下午，第三轮）：整张卡都能拖（不再只认顶部那个小把手）

- **诉求**：「组件的拖拽按钮只有这里才能拖动，有点局限，我想像那些设计软件一样，
  组件里面的区域都能拖动」。
- **改了什么**：
  1. 卡片任意位置按下去都能拖：位移超过 4px 才真正开拖（单击选中、双击、内部控件都不受影响），
     起点用「按下点」，阈值触发时不会跳一下；
  2. 卡片内的**可交互元素**排除在拖动之外：`button/a/input/textarea/select/label/[role=button]/
     [role=combobox]/[contenteditable]/.MuiInputBase-root`，外加「任何 `cursor: pointer` 的元素」
     —— 自定义下拉、「查看更多」这类 div 靠光标自动认出来（以后新加的控件只要按规范给 pointer 就不用改这里）；
  3. 悬停整卡显示 `grab`、拖起来 `grabbing`；内部可点元素自带 `pointer`，会盖住它；
  4. 编辑器里卡片内容设为不可划选（设计软件语义；拖拽起手就整块移动），预览页 / 发布页不受影响；
  5. 拖完紧跟的那次 click 吞掉 —— 否则「按着可点区域拖卡片」松手会把列表排序 / 触发行点击；
- **· 迭代（同日下午，第四轮）**：顶部那个小把手按用户要求**删掉**（「不需要显示了，多余了」），
  整卡拖动已经够用。删把手时顺带修掉一个只有真机才能发现的坑：
  ECharts 悬停到数据点时会把自己的画布设成 `cursor: pointer`，被「pointer = 可交互」的判定
  误伤 —— 压在某根柱子上就拖不动卡片。现在判定里对 ECharts 内部（`.echarts-for-react` 子树）
  与 `canvas` 跳过光标判断，图表悬停照常有反馈，压着数据点也能拖。
- **涉及文件**：`frontend/src/features/components/board/BoardCard.tsx`（`pressBody` / `isInteractive` / `beginDrag`）。
- **怎么验证**（QA 账号 + 临时看板 67/68/69/70–72，验完已删）：
  1. 从柱状图**图表区域**拖 → 卡片 635,138 → 706,176，跟手；
  2. 只点不拖 → 位置完全不变；
  3. 在筛选栏的「天猫」下拉上按住拖 40px → 卡片**不动**；单独点一下 → 菜单正常展开（`[role=menu]` 1 个）；
     从筛选栏右侧空白处拖 → 卡片 138 → 176；
  4. 环形图中心拖、右下角缩放手柄、⌘Z 撤销一次拖动，全部正常；
  5. 去掉把手后：`[data-handle="move"]` 数量 0、删除按钮仍在、5 个缩放手柄仍在，
     先悬停到柱子上再拖卡片 → 635,138 → 687,176 正常跟手；
  6. 控制台无异常；`tsc --noEmit` / `ui_rules.sh` 通过。

---

## 2026-11-12 · 优化：参考线可以跨过溢出区

- **诉求**：标尺拉出的参考线只画在 1440 版面里，碰到左右溢出区（浅灰带）就断掉 ——
  用户要求「参考线改为可以跨过溢出区的」。
- **改了什么**：
  1. 参考线（手工线 / 吸附线 / 拖动中的预览线）从缩放层内部抽成**独立图层**，
     压在外溢区遮罩（zIndex 50）之上（zIndex 56）：横线一律横贯整条画布（含左右溢出区），
     竖线贯通整个可视高度，不再在版面边界处截断；
  2. 拖参考线的坐标换算改走画布滚动容器（`clientX − canvas.left + scrollLeft − 版面居中位移`），
     落点范围放宽到溢出区（负坐标 / 超出 1440 都允许）；**拖出画布松手仍然删除**；
  3. 拖拽热区由 1.4px 放宽为 7px 透明带（视觉线仍 1.4px），细线不再点不中。
- **· 迭代（同日下午）**：7px 抓取带带了一条 `:hover` 描边，鼠标靠近时参考线上/下会多出两条浅蓝细线
  （用户：「怎么参考线上下多出两条浅线，不需要可以吗」）—— 直接删掉悬停描边，抓取带改成完全透明，
  只保留鼠标移上去变 ↔ 光标；参考线永远只有一根 1.4px 细线。
- **涉及文件**：`frontend/src/features/components/board/BoardSurface.tsx`、
  `frontend/src/pages/CanvasBoardPage.tsx`（标尺拉线的落点范围同步放宽）
- **怎么验证**（无头浏览器，临时看板 62，验完已删）：
  1. 横线 y=350 的渲染盒 588→1532px，与左右两块溢出区遮罩外缘完全对齐
     （`docs/_selfcheck/guide-overflow-1700.png`）；
  2. 竖线 x=720 由 138→913px 贯通到底；从左侧标尺把竖线拖进溢出区得到 `x=-61` 并保留
     （`guide-vertical-in-bleed-1700.png`）；
  3. 拖出画布松手 → 该线被删除（`guide-after-delete-1700.png`）；
  4. `doc=58` 库内数据未改动（items 1 条、guides 1 条，updated_at 未变）。
- **· 迭代（同日下午，第二轮）：横线可以一直拖到画布底部**（用户：「参考线不能往下拖动底部，
  我的需要，参考线 PS 那些，想拖到哪就哪」）。原来纵向落点被钳在「内容高（最小 620）」上，
  内容只有一张卡时线拖到 620 就到头；现在改成钳到**画布可见底部**：
  `max(内容高, (scrollTop + clientHeight) / 缩放)`，页面标尺拉线用同一个上限。
  验证：内容只有 280 高的卡，横线从 `y=420` 一路拖到 `y=1410`（屏幕 967px，画布底缘）并保留；
  从上方标尺直接拉一条到最底部也成立（截图 `docs/_selfcheck/guide-drag-down-after.png`）。

---

## 2026-11-12 · 修复：删掉的筛选栏又被「自愈」装回来

- **现象**：确认删除筛选栏后，它立刻又出现在画布上（用户实测：「删完立刻又回来」）。
- **根因**：两个地方在**编辑过程中**就做结构自愈 ——
  1. 前端「还没选平台时先显示第一套」的兜底 effect，从 **doc.items** 里取共用筛选栏；
  2. 后端 `view_items_for()` 在每次 `/render` 时从 `items_map` 捞回筛选栏。
  用户删掉筛选栏后 doc 里还留着，下一次渲染/兜底就把它装回画布。
- **处理（按用户定的时序）**：自愈只在**保存 / 发布**时跑，编辑过程中完全不参与。
  1. 前端兜底 effect 的共用部分改成只认「画布上现在真实存在的」`items`，不再从 doc 补；
  2. 后端新增 `heal_view_filters()`：把「误存进平台套的筛选栏」挪回页面级 `items` 并从平台套剔除、
     按 key 去重；**页面级一条都没有时不会凭空补**；只在 `validate_doc(..., heal=True)`（即 PUT 保存/发布）时调用；
  3. `/render` 路径不再自愈（编辑态渲染不参与）。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`、`backend/app/dashboards/models.py`、
  `backend/app/dashboards/router.py`
- **怎么验证**（无头浏览器用注入 token 的方式，绕开反复登录被踢）：
  1. 删筛选栏 → 弹确认 → 点删除 → 1.2s 后 `卡片 12→11、筛选控件 4→0`，**4.7s 后仍是 0**（截图 `docs/_selfcheck/2026-11-12-filter-deleted.png`）；
  2. 切平台：天猫 12 卡/4 筛选 → 拼多多 11 卡/**4 筛选仍在**，KPI 从 26 变 999+（截图 `docs/_selfcheck/2026-11-12-platform-pdd-ok.png`）；
  3. 面板跟随平台：选拼多多 → 面板平台标「拼多多」，把「品类」改成「品类X」→ 切回天猫仍是「品类」（互不污染）；
  4. 后端保存行为：删筛选栏后 PUT → 回读 items 为空（不补回）；把筛选栏塞进天猫套再 PUT → 回读自动挪回 items、平台套清干净；
  5. 以上测试均在浏览器内存态进行，`doc=58` 库内数据未被修改（items 仍为 1，已核对）。

---

## 2026-11-12 · 新增：删除筛选栏前提示「绑定了平台」，确认后真删

- **用户口径**：筛选栏如果绑了平台（平台切换器 / 按平台各配的字段），点删除要先提示
  「有捆绑平台，删掉会导致数据异常」，确认后才真正从画布移除；没绑平台的直接删。
- **改了什么**：
  1. 新增 `boundPlatforms()`：从筛选栏的「平台」切换器 `dataset_map` 与 `fields_map` 收集平台清单；
  2. 删除统一入口 `requestDelete()`：绑了平台 → 弹确认框（标题「删除筛选栏」，正文列出平台名，
     说明删除后这些平台的筛选条件会失效）；没绑 → 立即删；
  3. 键盘 Delete 与卡片右上 ✕ 两条删除路径都走这个入口；
  4. 后端 `_shared_filter_items()` 去掉「从 items_map 把筛选栏捞回来」的兜底 ——
     这正是「删了又被加载回来」的根源，渲染端不再补回用户删掉的筛选栏。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`、`backend/app/dashboards/models.py`
- **怎么验证**：`tsc --noEmit` 通过；后端 `view_items_for()` 单测仍全过。
  **界面端到端验证受阻**：无头脚本反复登录会把会话踢成 `/login?reason=kicked`（仓库已知坑），
  切换/保存类操作校验不可信，需真机确认（见交付说明）。

---

## 2026-11-12 · 重构：筛选栏按平台独立配置（平台入口共用）+ 修掉「筛选栏删不掉」

- **用户口径**：筛选栏里只要有「平台」这个切换器，其余字段就**按平台各配一套**——点拼多多看到的是拼多多那套，
  点天猫看到的是天猫那套；「平台」切换器本身共用一份。没有「平台」字段时，仍是单一通用配置。
- **改了什么**：
  1. `FilterFieldsEditor` 新增 `platform` 入参：画布把当前平台传下去，面板**自动锁定到该平台那套字段**
     （顶部不再让手选平台，改成一颗平台标），首次进入自动把通用那套复制一份当起点；
     组件库编辑页不传 platform，保持原来的「通用 + 手动切平台」形态。
  2. 修 `bindColumn()` 取错数组的老 bug：平台套里改「绑定字段」原来读的是通用那份，字段会错位/取不到。
  3. **回退上一版的运行时「自动补回筛选栏」**：那段逻辑会在用户删掉筛选栏后又把它从 `items_map` 捞回来，
     造成「筛选栏删不掉」。筛选栏回到「普通共用元素」语义：删了就是删了，保存后不再出现。
  4. 切平台时保留选中（共用筛选栏在新平台上还在，不用再点一次）。
- **涉及文件**：`frontend/src/features/components/editor/FilterFieldsEditor.tsx`、
  `frontend/src/pages/CanvasBoardPage.tsx`、`backend/app/dashboards/models.py`
- **怎么验证**：
  - 后端 `view_items_for()` 5 个场景单测通过（正常 / 筛选栏误存平台套 / type 存成 chart / 平台套重复 / 旧看板）；
  - `tsc --noEmit` 通过；
  - 端到端界面验证**被登录态打断**：无头浏览器脚本反复登录会把上一个会话踢成 `/login?reason=kicked`（仓库已知坑），
    切换平台后的截图因此不可信，**需真机点一遍确认**（见交付说明）。

---

## 2026-11-12 · 修复：切平台后筛选栏可能整条消失（筛选栏必须页面级共用）

- **现象**：筛选栏「平台 → 拼多多」之后，整条筛选栏不见了。
- **根因（两条）**：
  1. 「是不是筛选栏」原来只认 `item.type === "filter"`，历史文档里有 type 存成 `chart`、靠 `component=base.filter`
     标识的筛选栏，于是被当成「平台专属卡片」，切到没有它的平台就不见了；
  2. 平台那套 `items_map[平台]` 里可能已混进筛选栏的副本，切换时又没剔除，导致「共用 + 平台那套」口径打架。
- **处理（前后端同时硬化 + 自愈）**：
  - 前端 `CanvasBoardPage`：新增 `isFilterBarItem()`（type / kind / component 三选一判定）与 `dedupeByKey()`；
    切平台时先把所有平台套里的筛选栏剥掉、再与页面级筛选栏合并去重；
    若页面级里没有筛选栏（历史坏数据），自动从平台套里捞回来当共用；
  - 后端 `view_items_for()`：同一套规则（筛选栏永不计入平台那套、丢失时从 items_map 捞回、按 key 去重），
    保证发布/预览渲染与编辑器一致。
- **涉及文件**：`frontend/src/pages/CanvasBoardPage.tsx`、`backend/app/dashboards/models.py`
- **怎么验证**：
  - 后端单测 5 个场景全过：正常 / 筛选栏被误塞进某平台套 / type 存成 chart / 平台套重复带筛选栏 / 旧看板无 items_map，
    结果都是「共用筛选栏 + 该平台卡片」且筛选栏只出现一次；
  - 真实页面（无头 Chrome，`doc=58`）：初始 4 个筛选控件 + 12 张卡 → 切拼多多 4 个筛选控件 + 11 张卡（筛选栏保留），
    筛选栏可见（bounding box 850×45，opacity 1）；截图 `docs/_selfcheck/2026-11-12-platform-pdd.png`；`tsc --noEmit` 通过。

---

## 2026-11-12 · 修复：排行卡三个显示开关是死按钮（配置面板全量审计）

- **现象**：组件编辑器里排行卡的「显示分值 / 显示标签」点了没用，序号也没有开关。
- **原因**：`RankSpec.show_rank / show_score / show_tags` 三个字段只被面板写入、渲染器从没读过，
  而且 `build_rank` 也没把它们带进 payload —— 渲染器根本拿不到。
- **处理**：
  1. `build_rank` 把三个开关带进 payload；`RankListCard` 按开关渲染（缺省视为显示，老看板不倒退）；
  2. `RankSpec` 默认值改为三个都显示；组件库 `base.rank_list` 同步；
  3. 组件编辑器里「填了标签字段」自动打开「显示标签」，避免配了却看不见；
  4. 已有看板 doc 2 / doc 3 的 12 张排行卡补成显示（改前备份 `/tmp/doc{2,3}-backup.json`）。
- **同轮审计结论**（为什么别处没再出问题）：
  - 逐字段核对 `spec.py` 全部配置类 × 渲染器/计算引用：7 个疑似死参数，其中 `min_height`（高度输入 + 缩略图）、
    `filter.fields_map`（分平台筛选）、`layout.h`（画布高度）都有真实消费；`FilterFieldSpec.multiple` 没做 UI 入口，属未实现字段；
  - 面板写入的 key × spec 定义：**0 个拼错**（不会出现「写了但被校验丢掉」）；
  - 项目自带 `npm run audit:config` 通过，但它的判定是「字段名在 renderers/editor 出现过」，
    `compute.format` 因为明细表读过就放过了排行卡 —— 这类按 kind 的漏检已记录，后续要按 kind 做矩阵审计。
- **涉及文件**：`backend/app/components/spec.py`、`compute.py`、`frontend/.../renderers/RankListCard.tsx`、
  `frontend/src/pages/ComponentEditorPage.tsx`、`bi_component`(105)、`bi_canvas`(doc 2/3)
- **怎么验证**：API 预览排行卡 → payload 带 `show_rank/show_score/show_tags`，两种取值都正确返回；
  画布 doc 58 排行卡渲染正常（序号/名称/数值），截图 `docs/_selfcheck/2026-11-12-rank-check.png`；`tsc --noEmit` 通过。

---

## 2026-11-12 · 修复：排行/柱状/横条/组合图的「数字格式」点了没反应

- **现象**：排行条形等组件里把「数字格式」切到金额/万/百分比，卡片数值纹丝不动。
- **原因**：面板写的是 `spec.compute.format`，但前端 `skin/format.ts` 的 `formatValue()` 只认
  `transform=share`、`prefix/suffix` 和 `chart.label_format`，**从来没读 `compute.format`** —— 这个控件是死按钮
  （指标卡/明细表各自走了后端 `fmt_number` 与表格内置 switch，所以那两个看起来正常）。
- **处理**：`formatValue()` 优先按 `compute.format` 出数（整数 / 万 / 百分比 / 金额 / 日期 / 文本），
  前后缀仍然叠加；整数格式再回落到图表的 `label_format`（万/k/百分比），保持既有行为。
- **涉及文件**：`frontend/src/features/components/skin/format.ts`
- **怎么验证**：`tsc --noEmit` 通过；真实页面操作（无头 Chrome）——
  排行条形卡片数值 `萌维兔 8` → 切「金额」变 `¥8.00` → 切「万」回 `8`（<1 万不缩）→ 切回「整数」恢复 `8`；
  指标卡 `26` → 金额 `¥26.00`。截图存 `docs/_selfcheck/2026-11-12-rankbar-money.png`。

---

## 2026-11-12 · 新增：源库英文列自动起中文名（拖进卡片标题就是中文）

- **改了什么**：直连数据集导入源库列时，按 `app/semantic/aliases.py` 的字典把英文列翻成中文**字段名**
  （`source_column` 仍是英文，查询不变）：`brand→品牌`、`price_avg→均价`、`sales_lower→销量下限`、
  `dt→日期`、`heat_score→热销指数` …（29 列全覆盖）。规则是「仅当字段名仍等于源列名（没人工命名过）才翻译」，
  用户手改过的名字不会被覆盖。已有 3 个直连数据集（22/27/28）已回填，58 个字段中文化，0 个英文残留。
- **为什么**：源库视图按英语命名（给 SQL 用），拖进卡片后标题、图例、筛选器全是 `brand` `price_avg`，业务看不懂；
  之前每次都要手动改名。
- **涉及文件**：`app/semantic/aliases.py`（新增）、`app/semantic/repository.py`（`add_field` 自动翻译）
- **怎么验证**：接口建直连数据集（字段名故意传源列名）→ 返回
  `['日期','链接ID','品牌','种类','榜单','均价','销量下限','热销指数']`，源列仍是 `dt/product_id/brand/...`；
  渲染 dataset 27 的指标卡 → 口径显示「热销指数」、值 6,018、SQL 别名也是中文。

---

## 2026-11-12 · 修复：直连数据集放进画布卡片仍报「表不在白名单内」

- **现象**：直连数据集在「数据集查询」里能跑，但拖成画布卡片后报 `表不在白名单内：dm.v_tmall_bangdan`。
- **原因**：卡片渲染走的是另一条链路 —— `app/components/resolver.py`（画布 / 组件库预览 / 看板 render 三处都经它），
  它固定用 `execute_query(..., allowed_tables=ALLOWED_TABLES)`，只认本地白名单表；上一轮只把 `/bi/semantic/datasets/{id}/query` 接到了直连。
- **处理**：新增 `resolver._execute_dataset(db, dataset, query, user)`，按 `dataset.conn_mode` 分流：
  `live` → `run_live`（源库执行，白名单按源库存在性、行级权限/脱敏照旧）；`extract` → 原来的本地执行。
  三处执行点（摘要卡 / 头标卡统计 / 主查询）统一走它。
- **涉及文件**：`backend/app/components/resolver.py`
- **怎么验证**：用 `dm.v_tmall_bangdan` 绑定的直连数据集渲染指标卡（`MAX(heat_score)`）→ 200，
  `value = 6,018`，SQL 为 `SELECT MAX("heat_score") FROM "dm"."v_tmall_bangdan"`（在源库执行）；
  抽取数据集（id=2）渲染仍 200，回归正常。

---

## 2026-11-12 · 修复：删数据源没检查「直连数据集」的引用

- **现象**：直连数据集只记 `source_id`，不走已接入表；而删数据源原本只校验「同步出来的本地表有没有被数据集引用」，
  所以删掉数据源后，直连数据集的图会直接红（报「数据集绑定的数据源不存在」）。
- **处理**：`delete_source` 先查 `bi_dataset where source_id = ? and conn_mode = 'live'`，有引用就拒绝并列出前 3 个数据集名，
  提示「先删掉这些数据集或改绑其它数据源」。错误走原有 `SourceError → 400 detail` 通道，前端 Toast 直接显示。
- **涉及文件**：`backend/app/sources/repository.py`（`delete_source`）
- **怎么验证**：临时建直连数据集「临时·保护测试」挂在数据源 4 上 → `DELETE /bi/sources/4` 返回
  `400「有直连数据集在用它：临时·保护测试，先删掉这些数据集或改绑其它数据源」`；数据源 4 完好（3 个数据源仍在）。
  验证后临时数据集已删除。

---

## 2026-11-12 · 新增：双轨取数——数据集可选「直连 / 抽取」

- **改了什么**：数据集新增 `conn_mode`（`extract` 默认 / `live`）+ `source_id`。
  选 `live` 时图表查询不再读本地副本，而是按同一套查询契约在源库执行（Superset 式 Live Query）。
  安全口径与抽取模式对齐：源库表白名单（按源缓存 5 分钟）、行级权限 WHERE 照拼、结果落 BI 后脱敏、
  语句超时 30s、结果上限 5000 行；源库连接池按「数据源 + 连接串指纹」缓存。
  `POST/PATCH /bi/semantic/datasets` 支持创建/切换取数方式；`POST /datasets/{id}/query` 返回 `mode`。
- **为什么**：用户明确要求两条路线都能走——小表/源库会断网时用抽取，要大明细或强实时时切直连。
- **涉及文件**：`app/query/live.py`（新增）、`app/query/builder.py`（`quote()` 支持 `schema.table` 逐段加引号）、
  `app/semantic/models.py`、`app/semantic/repository.py`（建/改数据集、字段校验按模式分流）、
  `app/semantic/router.py`、`schema/migrations/014_live_mode.sql`
- **怎么验证**：
  1. 建直连数据集（源 3 → `dm.v_bangdan`）→ `POST /datasets/22/query` 返回 `mode=live`，
     SQL 为 `SELECT ... FROM "dm"."v_bangdan" GROUP BY "platform"`，真实返回天猫 26 / 拼多多 36；
  2. 时间维度 → `date_trunc('day', "dt")` 正常出两天；筛选 `平台 = '天猫'` → 绑定参数正确；
  3. 直连指向不存在的表 → 400「源库里没有这张表」（白名单生效），临时数据集已删除；
  4. 抽取模式回归：dataset 2 / 20 查询 200 且 `mode=extract`；把 20 切 live 再切回 extract 均正常。
- **迭代（同日补完界面与缓存）**：
  - 新建数据集对话框改为三档：`抽取 · 物理表` / `直连 · 源库` / `自定义 SQL`；直连档选「数据源 + 源库表/视图」，
    自动按源库列类型导入字段（date/timestamp→时间、int/numeric→度量、其余→维度），空状态有加载指示。
  - 数据集列表给直连数据集加「直连」小标；编辑器「基本信息」新增只读「取数方式」；
    编辑器里「同步物理列」对直连改为从源库拉列补字段（不再去本地 information_schema 找表）。
  - 新建图表的数据集下拉里，直连数据集名称后标「直连」。
  - 直连结果加 60s TTL 缓存（key 含数据源 + 用户 + SQL + 参数，脱敏之后才入缓存），第二次查询 `elapsed_ms=0.0`。
  - 源库表清单接口补 `column_types`（供字段角色推断）。
  - **验证**：界面实建「直连·天猫榜单（UI 建）」→ 列表带「直连」标、29 字段自动导入、查询 200（`FROM "dm"."v_bangdan"`）；
    临时行级规则（`platform = '天猫'`）生效 → 只返回天猫 26 行、`rls=true`，规则删除后恢复两平台（验证数据已清理）；
    临时数据集已删除。截图见 `docs/_selfcheck/2026-11-12-dataset-*.png`。

---

## 2026-11-12 · 新增：数据源按 dt 增量同步（历史与更新都能看）

- **改了什么**：数据源同步从「每次 DROP + 全量重写」改成**按 dt 幂等追加**——源里有 `dt` 列且本地表结构一致时，
  只删掉本批的 dt 再插入，历史快照原样保留；无 dt / 表结构变化才回退覆盖。同步记录 `dt_min / dt_max / dt_count`，
  接口 `/bi/sources/files` 直接带出来。数据源新增 `refresh_sql`（单条 SELECT，如 `select dm.refresh_bangdan()`），
  同步前先跑它，远端新增的那一天才会并进视图。另加每日定时任务 `backend/scripts/daily_refresh.py` +
  LaunchAgent `com.mingcebi.daily-refresh`（每天 08:00：先刷远端视图，再增量同步已接入表）。
- **为什么**：用户要「历史数据和更新的数据都能看到」。原来的全量重写等于每次都把历史冲掉，且数据一大就重灌全表；
  按 dt 追加后同一天跑多少遍结果都一样（幂等），历史自然累积。
- **涉及文件**：`backend/app/sources/repository.py`（`_write_local` / `_sync_stats` / `_register` / `sync_tables` /
  `run_refresh_sql`）、`backend/app/sources/router.py`（sync 返回 refresh 结果）、
  `backend/schema/migrations/013_source_dt.sql`、`backend/scripts/daily_refresh.py`、
  `~/Library/LaunchAgents/com.mingcebi.daily-refresh.plist`
- **怎么验证**：
  1. 连跑两次同步 `dm.v_bangdan` → 第一次 `replace 62 行`，第二次 `append 62 行 dt=2026-11-10,2026-11-11`，总行数仍 62（幂等）；
  2. 本地只重灌 11-11 那天 → 总数 62、`11-10` 仍 36 行（历史未被冲掉）；
  3. 模拟新增 11-12 三行 → 总 65，分布 `36 / 26 / 3`；验证后已删除该 3 行，恢复 62；
  4. `launchctl kickstart` 实跑定时任务 → 日志 `/tmp/mcbi_daily_refresh.log` 输出「失败 0 个」；
  5. `GET /bi/sources/files` → `bi_src_3_dm_v_bangdan_3f9fa5` 行 62、`dt 2026-11-10~2026-11-11（2 天）`。
- **未做（下一步）**：「已接入表」列表还没显示日期范围列（后端字段已就绪），看板侧也还没加「数据日期」筛选器。

---

## 2026-11-11 · 规则：动「组件配置能力」必须同步组件库

- 用户点名要求：**改组件配置能力（面板控件 / 校验 / 默认绑定 / 某 kind 口径）时，必须同步组件库模板**，
  否则类型栏拖出来的卡还是旧配置，看起来像界面没生效。
- 落地到 `AGENTS.md` §5（三件事：改种子 → 改库里那一行 → 全表核对）+ §2 交付流程加一步。
- 顺手全表审计 18 个模板，修掉一处同类问题：**词云模板**引用了演示数据集里不存在的 `主卖点 / SKU数`，
  拖出来就是报错卡 —— 改成「品牌 × 热销指数（SUM）」，种子同步。
- 文件：`AGENTS.md`、`app/components/seed_base.py`、`bi_component.spec`

---

## 2026-11-11 · 修复：指标卡还挂着旧版的「维度」，得手动删才变干净

- **现象**：选中指标卡，中栏还是「维度 + 指标」两块（维度里挂着换数据集之前留下的字段，比如「商品标题」在天猫表里根本不存在），
  要手动点 ✕ 删掉维度才变成正常的「只有一个指标」。
- **原因**：面板按「取数规则 / 副标题规则」决定要不要显示维度区，而卡片里只要还残留 `binding.dimension` 就会冒出来；
  后端也照旧按它分组 —— 面板显示的和实际查询的口径不一致。
- **处理**：指标卡 / 结论卡 / 分节标题**彻底没有维度概念**——
  - 面板不再显示维度区（只有「指标 + 聚合」）；
  - 加载时清掉旧卡残留的维度；
  - 后端也不再按维度分组（面板上没有的东西，不在后端偷偷生效）。按维度看请用柱状图 / 饼图 / 明细表。
  - 文件：`editor/QueryPanel.tsx`（`needsDimension`）、`pages/CanvasBoardPage.tsx`（`toCanvasItem` 清理）、`app/components/resolver.py`（`_request_for`）
  - 验证：带残留维度「品牌」的 KPI → 220,645，与无维度一致（不再分组取首条）；`tsc --noEmit`、`ui_rules.sh` 通过
  - **· 迭代（同日，找到真正的源头）**：面板改完还看到维度，是因为**组件库模板本身**就带着维度 ——
    `bi_component.base.kpi`「指标卡」的 `binding.dimension = 商品标题`（种子 `seed_base.py` 里也是这么写的），
    从类型栏拖出来的指标卡天然继承它。已修：模板与种子都清掉维度（`dim=None`），新增/转换到 kpi/insight/section 时再兜一层；
    老卡在打开时由 `toCanvasItem` 清掉，保存即落库。

---

## 2026-11-11 · 平台切换 = 换一整套卡片（各平台独立，互不影响）

- **之前是「一套卡片 + 换表」**：删卡片、挪位置、改指标都是全局的，两个平台共用一套版面。现在按用户要求改成 **每平台一套卡片**：
  - **筛选栏共用**（它是平台跳转的中转站，只该有一份）；
  - 头标卡 / 分节标题 / 指标卡 / 图表 / 明细表按平台各存一份，删、挪、加都只影响当前平台；
  - 某平台第一次切过去时，自动把当前这套**复制一份**当起点（复制完即独立，之后互不影响）；
  - 没配平台切换的看板行为完全不变（`items` 原样渲染）。
  - 存储：`ViewDef.items_map = {平台: [元素…]}`，`items` 只留共用元素；渲染统一走 `view_items_for(view, platform)`，
    覆盖画布实时预览（清掉库里那份分平台内容，避免叠加）、看板页、弹窗「查看更多」、发布页。
  - 文件：`app/dashboards/models.py`（`items_map` + `view_items_for`）、`app/dashboards/render.py`、`app/dashboards/router.py`（现场版面、rows 走 `find_item`）、
    `features/components/types.ts`、`pages/CanvasBoardPage.tsx`（平台切换装/存 + 保存拆两半 + 撤销栈随平台重置）、`pages/DashboardPage.tsx`
  - 验证：接口层——同一看板「拼多多 1 张卡 / 天猫 2 张卡 / 京东 0 张卡（只剩筛选栏）」各取各的，天猫 126,033、拼多多 220,645；
    存库再读回结构不变；现场版面渲染只用现场卡片；旧格式看板（无 `items_map`）渲染结果与改前一致。临时验证看板已删

---

## 2026-11-11 · 筛选字段支持「按平台不同选项」（品类 / 榜单 / 价格带各自一份）

- **问题**：平台一换，品类 / 榜单 / 价格带的取值也可能不一样，但选项只有一份通用的，切过去就串味。
- **处理**：每个筛选字段多一个 `options_map`（平台 → 选项 + 档位区间）：
  - 面板「选项」标题右侧多一个下拉：**通用 / 拼多多 / 天猫**，选哪个就编辑哪一份，没单独配的平台回落到「通用」；
  - 平台字段（数据集切换器）的选项仍由表映射生成，不参与这套；
  - 换平台后，若当前选中的值在新平台不存在，自动退回「全部」——不会出现「显示天猫某档、实际按拼多多那档过滤」的错位；
  - 档位区间也按平台各算一份（价格带这种 `<20元` / `>=80元` 的映射两支不会互相污染）。
  - 文件：`app/components/spec.py`（`options_map` + 校验）、`app/dashboards/render.py`（`_platform_value` / `_field_slice`）、
    `features/components/types.ts`、`renderers/FilterBar.tsx`（按平台取选项 + 失效值回落）、`editor/FilterFieldsEditor.tsx`（选项的平台切换）
  - 验证：接口层——同一份 `价格带` 字段，拼多多 `<20` 命中、天猫 `<25` 命中（各用各自的 ranges）；`tsc --noEmit` + `ui_rules.sh` 通过
  - **· 迭代（同日，用户纠正）**：平台维度应该是**整栏字段**，不是字段内的选项 —— 改成「筛选栏按平台各一套字段」：
    面板顶部多一个「通用 / 拼多多 / 天猫」开关，选平台就把通用那套复制一份当起点、之后随便加删改（品类/榜单/价格带/搜索、
    选项、默认值全部互不影响）；**平台入口本身永远取通用那份**（映射只配一处）。
    后端 `FilterSpec.fields_map` + `collect_param_defs(params)` 按当前平台解析；画布侧 `FilterBar` 用 `fieldsMap` 同样解析。
    字段级的 `options_map` 保留兼容、不再提供入口（避免两个平台入口打架）。
    接口验证：拼多多 → 平台+品类(猫咪零食)+榜单；天猫 → 平台+品类(鸟食品)（无榜单字段）；切天猫后卡片取到 126,033。
  - **· 迭代（同日，用户反馈「这功能怎么不见」）**：上一版把「切换数据集」在平台那套字段里藏掉了，用户直接以为功能没了。
    改成：**任何作用域下都看得到平台入口**（抽成 `PlatformMap` 组件，通用里挂在「平台」字段卡上，平台作用域里挂在顶部卡片上），
    改的永远是通用那一份 —— 一处定义、处处可见，不再玩隐藏。

---

## 2026-11-11 · 指标卡：选/拖指标，卡片标题自动跟着变

- **之前换指标，标题一直叫「指标卡」**，还得手动改一遍；现在选指标（左栏点 / 拖进「指标」槽 / 换指标下拉）标题自动同步成指标名。
- 只动**系统起的名字**：标题为空、等于组件默认名（指标卡 / 柱状图…）、或等于上一次的字段名时才同步；
  **用户自己改过的标题一律保留**，改完一次就不再自动跟。
- 同步的是「指标优先、没有指标才用维度名」，所以柱状图这类双字段的卡不会被维度覆盖掉指标名。
  - 文件：`pages/CanvasBoardPage.tsx`（`syncTitle`，`handlePick` 改走 `applySpec` 同一条路径）
  - 验证：`tsc --noEmit` 通过；新建指标卡 → 点左栏「均价」→ 标题变「均价」
  - **· 迭代（同日，用户要求）**：标题**已有名字也照换** —— 拖/选指标一律把标题更新成新指标名（上一版「改过一次就不跟」取消）；
    只换维度时，仅在没有指标的情况下才改名（饼图/词云会跟，柱状图不会用维度名冲掉指标名）。副标题始终不动。

---

## 2026-11-11 · 选中卡片时，左侧数据集跟着「当前平台」走

- **问题**：配好切换映射后，卡片在实际读拼多多的表，左侧「数据集」却还显示卡片绑定的那张（天猫），
  指标 / 维度 / 列列表也是错表的字段 —— 看着对不上，也没法照着当前平台挑字段。
- **处理**：选中卡片时先算出「它在当前平台下真正读的那张表」（绑定的表 ∈ 切换映射 → 按当前参数换成对应表），
  左侧数据集、字段列表、口径都按它走；换平台时自动跟着变。没有配置切换的看板行为不变。
  - 顺带：新建卡片的默认数据集也变成「当前平台那张表」，不会又落回另一张。
  - 文件：`pages/CanvasBoardPage.tsx`（`followedDatasetId`）
  - 验证：`tsc --noEmit` 通过；平台切天猫 → 左侧显示榜单端-天猫，切拼多多 → 显示榜单端-拼多多

---

## 2026-11-11 · 修复：「切换数据集」里把平台名删空，整行会消失

- **现象**：把行里的平台名删到空，那一行连同输入框直接没了（看着像「默认退出」），没法清空重打。
- **原因**：名称框是受控输入，每敲一个字都写回 `dataset_map`；而写回时「空名字」会被过滤掉，行是从映射里渲染的，于是空名字 = 删行。用「空值即删除」表达输入态，必然删不到空。
- **处理**：名称改成**本地草稿 + 失焦/回车提交**（空着不动就保留原名，删行仍然点 ✕）；重名自动加序号不覆盖。
  - 顺手：新增行优先挑名字里带平台成员的表（榜单端-拼多多 / 榜单端-天猫），不再默认塞一张「演示数据」表。
  - 文件：`features/components/editor/FilterFieldsEditor.tsx`
  - 验证：`tsc --noEmit` 通过；清空名称再输入新名字，行不消失（HMR 生效）

---

## 2026-11-11 · 规则：门户事件按组件树冒泡（写进 AGENTS §7）

- 画布上的「点空白取消选中」不能用 `closest()` 单独判定：下拉菜单 / 弹窗是 React 门户，
  DOM 在 `body`、事件却按组件树冒泡，会被误判成点空白（实际表现为「点一下下拉，右侧配置面板就退出」）。
- 正解：先 `e.currentTarget.contains(e.target)` 排掉门户事件，再判卡片。已同步到 `AGENTS.md` §7 第 8 条。

---

## 2026-11-11 · 修复：点画布上的下拉菜单，选中态和配置面板一起被清掉

- **现象**：选中筛选栏（右侧配置面板正开着），在画布上点开「平台 → 天猫」，配置面板立刻变成「未选中元素」，正在配的字段没了落脚处。
- **原因**：下拉菜单是 React 门户，DOM 挂在 `body` 上，事件却按**组件树**冒泡回画布。`BoardSurface` 的空白点击判定用的是 `e.target.closest("[data-board-key]")`——门户节点在 DOM 上不在卡片里，于是被误判成「点了空白」，`onBlankSelect()` 清空选中。
- **处理**：判定前先 `e.currentTarget.contains(e.target)`，门户事件直接放行；真空白区（画布本体）仍照常取消选中。同类「卡片里开浮层」的交互（表格查看更多、图内菜单）一并修好。
  - 文件：`features/components/board/BoardSurface.tsx`
  - 验证：`tsc --noEmit` 通过；改后点筛选栏下拉选项，卡片保持选中、右侧面板不退出（HMR 生效，无需刷新）

---

## 2026-11-11 · 筛选栏「平台」可以切数据集（多平台多张表）

- **两个平台各一张采集表以后，行过滤就不够用了** —— 之前「平台」只能靠 `平台 = 参数` 过滤同一张表里的行（拼多多/天猫合表时就是这套）；分成两张表后，一张卡只绑一张表，点天猫取不到天猫的数据。现在补上**数据集切换**：
  - 筛选字段新增 `dataset_map`（选项值 → 数据集 id）；配了它，这个字段从「过滤一行」变成「换一张表」：**选项由映射生成**（不再手填，也不设「全部」），下面的卡片自动跟着切；
  - 卡片**不用逐张改**：只要卡片绑的是映射里的某张表，就自动跟随当前平台；不在这组里的卡（需求端等）保持原样；
  - 字段同名自动匹配到新表的同名字段（语义层本来就做这件事），**不同名就报错提醒**，报错信息带平台名：`天猫：字段「日销量」是文本列，SUM 用不了…`；
  - 卡片里写死的行过滤（如 `平台 = 拼多多`）在新表没有该列时自动跳过，不当错误；
  - 口径一处生效：画布实时预览、发布页、弹窗「查看更多」、顶部统计全部同步切（`resolve()` 里统一处理，五个入口共用）。
  - 文件：`app/components/spec.py`（`FilterFieldSpec.dataset_map`）、`app/components/resolver.py`（`apply_dataset_switch` + 报错带平台名）、`app/dashboards/render.py`（`dataset_switches`，先切表再挂页面筛选）、`app/dashboards/router.py`（查看更多）、`features/components/types.ts`、`renderers/FilterBar.tsx`（选项来自映射、无「全部」）、`editor/FilterFieldsEditor.tsx`（「切换数据集」：平台名 + 数据集 + 添加平台）
  - 验证：临时看板（拼多多表 15 ↔ 天猫表 21）同一批卡切换——热销指数 220,645 → 126,033、均价 ¥46.65 → ¥76.14、差评数 15,009 → 10,520、品牌 TOP10 与明细表整表换掉；日销量在天猫侧按预期报错（文本列不能求和）。截图：`docs/_selfcheck/switch-01-pdd.png`、`switch-03-tmall.png`、`switch-07-editor-panel.png`、`switch-08-error-card.png`；临时看板验完已删

## 2026-11-11 · 「气泡大小」常驻 + 选了自动进气泡模式

- **上一版把「气泡大小」只在气泡模式显示，用户找不到入口** —— 改成：**气泡大小一直可见**，
  - 选了指标 → 自动切到「气泡」模式并立即重查（`dataSig` 纳入 `x_key / y_key / size_key / scatter_mode`，否则改完不生效）；
  - 清空（选「不用」）→ 自动退回「点」模式；
  - 模式按钮切到「点」时会清掉气泡字段，不留不生效的配置；
  - 渲染端改为**以当前配置的模式为准**（之前读服务端 payload 里的旧 mode，改完会滞后一帧）。
  - 文件：`editor/QueryPanel.tsx`、`editor/ChartOptionsPanel.tsx`、`renderers/ScatterCard.tsx`、`pages/CanvasBoardPage.tsx`
  - 验证：点模式下「气泡大小」输入框 = 1 个（常驻）；选「差评数」后模式按钮自动高亮「气泡」；卡面气泡大小随差评数变化（`docs/_selfcheck/scatter-dot-size.png` 为点大小对照）

## 2026-11-11 · 散点补「点大小」

- **点大小之前是写死的** —— `ScatterCard` 里点半径硬编码 8px（气泡/四象限按固定系数放大），没法调。现在：
  - 后端 `ChartSpec` 新增 `dot_size`（默认 8，范围 3~24）；
  - 面板「散点」分区新增 **点大小** 输入框，改完即时生效；
  - 气泡 / 四象限模式以它为基准等比放大（气泡 0.75~3.0 倍、四象限 0.62~2.37 倍），所以调大点也不会让气泡尺寸关系失真。
  - 文件：`app/components/spec.py`、`types.ts`、`skin/format.ts`、`renderers/ScatterCard.tsx`、`editor/ChartOptionsPanel.tsx`
  - 验证：演示看板第 1 张卡把点大小从 8 调到 24 → 点明显变大且趋势线仍在；验完已复位为 8

## 2026-11-11 · 散点补「模式」开关（点 / 气泡 / 四象限）

- **「气泡大小」之前是个死控件** —— 面板里有这个下拉，但**没有任何地方能切到气泡模式**（`chart.scatter_mode` 只能靠库里写死），所以填了什么都不会变。补齐：
  - 新增「散点」分区：**点 / 气泡 / 四象限** 三选一 + 横轴刻度（线性 / 对数）、纵轴刻度（线性 / 对数）；
  - **「气泡大小」只在气泡模式下出现**（其它模式隐藏，避免又出现「填了没反应」）；
  - 演示看板 57 的第二张卡改成气泡示例：X 热销指数、Y 日销量、气泡 = 差评数（越靠右上气泡越大）。
  - 文件：`editor/ChartOptionsPanel.tsx`（新增散点分区）、`editor/QueryPanel.tsx`（气泡大小按模式显示）
  - 验证：DOM 计数——「点」模式气泡大小输入框 **0 个**，「气泡」模式 **1 个**；模式按钮「点/气泡/四象限」齐全

## 2026-11-11 · 演示数据加了真实相关性 + 演示看板「散点相关性」

- **演示数据重造成「有规律」的样本**（原来是确定性伪随机，散点出来是一团噪声，看不出相关）—— 现在 240 行 SKU 按业务常识生成：
  - 均价 ↑ → 日销量 ↓（r = **-0.91**）
  - 热销指数 ↑ → 日销量 ↑（r = **+0.965**）
  - 差评数 ↔ 日销量（r = +0.68，弱正相关：量大有差评）
  - 霸榜天数 / 销量增速 ↔ 日销量（r ≈ -0.11 / -0.02，作为「无相关」对照）
  - 另外 **商品标题补了序号变成 240 个唯一值** —— 之前标题只有 12 个不同值，散点按维度聚合后只剩 12 个点（这是查出来才发现的真问题）。
  - 文件：`app/components/seed_demo.py`（生成逻辑 + `force` 重刷参数）
- **新建演示看板 `57「演示 · 散点相关性」`**（2×2 四张散点，全部开趋势线，数据源 = 演示数据 · SKU 榜单）：
  | 卡片 | X | r | 看点 |
  | --- | --- | --- | --- |
  | 均价 × 日销量 | 均价 | -0.91 | 负相关，虚线向右下 |
  | 热销指数 × 日销量 | 热销指数 | +0.965 | 强正相关，几乎成一条斜线 |
  | 差评数 × 日销量 | 差评数 | +0.68 | 正相关但点很散（噪声大） |
  | 霸榜天数 × 日销量 | 霸榜天数 | -0.11 | 无相关对照，虚线接近水平 |
  - 验证：`resolve()` 直接读四张卡的 payload，点数均 240、x 范围符合字段取值；相关系数与预期一致

## 2026-11-11 · 散点图改成真正的「两个数值看相关」

- **按散点图的语义重构了面板** —— 之前 X 轴还是从「维度」里选（商品标题这种文本），点和点没法比。现在：
  - **横轴（数值）**：从**指标**里选（写 `chart.x_key`），可以是均价、热销指数这种连续数值；
  - **纵轴（数值）**：指标 + 聚合；
  - **点名称（可选）**：维度只作为点的标签（tooltip / 四象限着色用），不再是 X 轴；
  - **气泡大小**：选一个指标做第三维度（气泡图）；
  - **趋势线**：显示开关里新增，最小二乘拟合，虚线画在图上，正相关向上、负相关向下，一眼看强弱。
  - 后端 `ChartSpec` 新增 `trend_line`；前端 `ScatterCard` 自行拟合（不额外查库）。
  - 文件：`app/components/spec.py`、`types.ts`、`skin/format.ts`、`renderers/ScatterCard.tsx`、`editor/QueryPanel.tsx`、`editor/ChartOptionsPanel.tsx`、`editor/axisLabels.ts`
  - 验证：临时看板里「均价 × 日销量」（40 个 SKU 点、趋势线开）→ 点云 + 灰色虚线趋势线；面板实测有「横轴（数值）/ 气泡大小 / 趋势线 / 点名称」；验完已删临时看板

## 2026-11-11 · 散点图面板按规范收口

- **用户问「这算规范设置吗」，按 3 处不规范改了**：
  1. **横轴只能是数值 / 时间字段** —— 之前可以选「商品标题」这种文本字段，散点会退化成没有意义的分布。现在选项里只列数值 / 时间，当前已选文本字段时显示成「商品标题（文本字段·不可作横轴）」提示要换；
  2. **粒度只对时间字段出现** —— 文本 / 数值字段旁边挂个「粒度」下拉是误导（柱/线/散点统一）；
  3. **散点的第二个指标从「纵轴」里挪到独立「附加」分区** —— 之前「均价 AVG」跟纵轴指标并列堆在纵轴槽里，语义不对；附加指标实际是气泡大小 / 四象限的另一轴，按钮文案也写明了。
  - 顺带修一个自己写的运行时 bug：`dimensionFieldIsTime` 引用了尚未初始化的 `b`（TDZ），导致整个 QueryPanel 白屏 —— `tsc` 查不出来，靠浏览器报错才发现，已把声明移到 `b` 之后。
  - 文件：`editor/QueryPanel.tsx`
  - 验证：散点面板实测「横轴 / 纵轴 / 附加（气泡大小·四象限）/ 计算」，粒度不再出现；`bash scripts/ui_rules.sh` 全绿

## 2026-11-11 · 散点图同步横轴 / 纵轴

- **散点的槽位与轴名统一** —— 维度 → **横轴**、指标 → **纵轴**（口径块显示「X 字段 / Y 数值」）；轴名优先级改为**手填「横轴标题 / 纵轴标题」→ 四象限/气泡的键名 → 字段名**，所以既可自定义也默认有名字；标题、右上说明同样受「标题 / 说明」开关控制（手填说明优先，否则回退四象限计数）。
  - 文件：`editor/axisLabels.ts`、`renderers/ScatterCard.tsx`
  - 验证：临时看板散点（日销量 × 热销指数，轴标题填入）→ 面板有「横轴 / 纵轴 / 横轴标题 / 纵轴标题」，卡面左上显示「热销指数」、右上显示「日销量 × 热销指数」；验完已删临时看板

## 2026-11-11 · 修：散点图提示框被卡片裁掉

- **tooltip 超出卡片被 `overflow:hidden` 裁切** —— 卡片容器是 `overflow:hidden`（为了圆角和光晕），ECharts 的提示框默认允许画到图表区域之外，悬停边缘的数据点时提示框左侧被切掉一半（散点图实测）。
  - 改法：统一在 `skin/tokens.ts` 的 `TOOLTIP` 里加 **`confine: true`**（提示框始终限制在图表内），柱/线/面积/组合/散点/饼/环形/热力全部生效；`HeatmapCard` 自带 tooltip 配置，单独补了一份。
  - 文件：`skin/tokens.ts`、`renderers/HeatmapCard.tsx`；同时把这条写进 `AGENTS.md` §7 已知的坑
  - 验证：散点图正常渲染、提示框不再越界（`confine` 会把提示框贴边翻转）；`tsc` 通过

## 2026-11-11 · 折线图 / 面积图同步坐标轴叫法

- **折线、面积也改成横轴 / 纵轴** —— 槽位叫法扩到 `line / area`：维度 → **横轴（时间 / 分类）**、指标 → **纵轴（数值）**，口径块同步成「时间或分类 / 聚合数值」；「文字」分区里的横轴标题 / 纵轴标题对它们同样可用（填了才显示），右上说明与标题隐藏也一并生效（面积图复用折线渲染器，改一处两张都生效）。
  - 文件：`editor/axisLabels.ts`、`renderers/LineCard.tsx`
  - 验证：临时看板里折线 + 面积各一张（上架时间 × SUM 日销量，轴标题填入）→ 面板显示「横轴（时间 / 分类）/ 纵轴（数值）/ 横轴标题 / 纵轴标题」，卡面左上出现「SUM(日销量)」、右上出现说明「按上架时间」；验完已删临时看板

## 2026-11-11 · 指标卡「右上说明」改为底部「副标题」

- **指标卡的说明放到大数字下面**（对齐参考稿）：原来放到右上角会跟徽标抢位置，也不像参考稿。现在：
  - 卡片结构 = 左上标题 · 右上徽标 · 大数字（+单位）· **底部副标题**；
  - 面板里这一项对指标卡/结论卡直接叫 **「副标题」**（其它图仍叫「右上说明」）；
  - 外观里那个原来是「副标题」的下拉（不显示 / 前N合计 / …）改名 **「副标题规则」**，两者语义分开：规则负责自动生成，手填副标题优先覆盖它；
  - 有副标题时卡片内边距 14→10、行距 12→8，保证 104 高的卡不把最后一行挤出去（此前被 `overflow:hidden` 裁掉）。
  - 文件：`renderers/KpiCard.tsx`、`editor/ChartOptionsPanel.tsx`（标签按 kind）、`editor/StylePanel.tsx`（副标题规则）
  - 验证：临时看板两张指标卡——手填副标题的显示「24 小时内 · 前十合计 1.6 万 单」，没填的显示规则生成的「前10合计 18,500」；截图见 `docs/_selfcheck/kpi-subtitle-bottom.png`

## 2026-11-11 · 「右上说明」在所有卡片生效

- **指标卡填了「右上说明」没反应** —— KPI 卡是自绘卡片（不走 `CardShell`），右上角只画了徽标，没读 `spec.subtitle`。修好后右上角顺序为：**说明文字 → 徽标**，并受「说明」开关控制；「标题」开关也能单独隐藏左侧标题。
  - 顺带把其它卡片的右上说明统一成同一规则：**手填的「右上说明」优先，没填才回退原来的默认文案**（排行条形/折线回退指标名、饼图回退 TOP1 占比、排行列表回退「共 N 项」、词云回退「N 个词」、明细表回退「共 N 条 + 导出按钮」），且都受「说明」开关控制。
  - 文件：`renderers/KpiCard.tsx`、`HbarCard.tsx`、`LineCard.tsx`、`PieCard.tsx`、`RankListCard.tsx`、`WordCloudCard.tsx`、`TableCard.tsx`
  - 验证：临时看板里指标卡设 `subtitle=阿萨斯` → 卡面显示「指标卡 阿萨斯 TOP10 › 2,000 单」；`bash scripts/ui_rules.sh` 全绿（tsc ✓）

## 2026-11-11 · 演示数据集 + 柱状图/组合图模板对齐画布配置

- **新建专用演示数据（与业务数据完全隔离）** —— 新建表 `bi_demo_sku`（240 行确定性模拟数据：2 平台 / 6 品类 / 8 品牌 / 7 榜单 / 5 价格带 / 日销量 / 热销指数 / 均价 / 差评数 / 榜龄 / 增速 / 上架时间），并注册成数据集 **「演示数据 · SKU 榜单」**（id 20，15 个字段）。`app/components/seed_demo.py` 幂等：表不在就建、行数不对就补，可反复跑。
  - 组件库里所有**数据类组件模板默认绑定这个演示库**（`ensure_base(db, 业务库, 演示库)`），所以组件库卡片墙、新建前的预览都是有数的（截图里柱状图 45,600 / 饼图猫咪零食 17% / 明细表共 240 条）。
  - **最终以用户自定义为准**：画布上新建卡片时，前端一律用**当前看板的数据集**覆盖模板里的演示绑定（`CanvasBoardPage.addChart`），不会把演示数据带进真实看板。
  - 白名单：`bi_demo_sku` 加入 `app/query/whitelist.py`（本系统自建的只读演示表）。
- **柱状图 / 柱线组合的模板配置对齐画布** —— `base.bar`：标题「柱状图」+ 右上说明「按价格带」、横轴 价格带 / 纵轴 SUM(日销量)、柱宽 26；`base.combo`：说明「柱=平均日销量 · 线=平均热销指数」、柱 AVG(日销量) / 线 AVG(热销指数)、右轴开、平滑开。
  - 文件：`app/components/seed_demo.py`（新增）、`app/components/seed_base.py`（模板配置 + 演示库绑定）、`app/bootstrap.py`（启动建演示库）、`app/query/whitelist.py`、`pages/CanvasBoardPage.tsx`（数据集优先级）
  - 验证：库里 `base.bar/base.combo/base.kpi/base.table` 解析均出数（5/5 系列、指标卡 20,700）；组件库页面截图全是演示数据；画布侧新建卡片沿用当前看板数据集

## 2026-11-11 · 修：重启会把组件库配置覆盖回种子

- **后端每次启动都会用种子覆盖组件库** —— `seed_base.ensure_base()` 走 `upsert_builtin()`，而后者「存在则更新 spec」，于是：用户在库里调过的筛选栏（平台/品类/榜单/价格带/搜索 5 项）在下次重启后被还原成种子的 1 项（实测 `base.filter` 字段数 5 → 1，`updated_at` 每次重启都变）。这属于**静默改数据**，必须先修。
  - 改法：`upsert_builtin(..., overwrite_spec=False)` 默认**只插入缺失组件、已存在的一律保留**；需要让种子改动生效时用 `MINGCEBI_RESEED=1` 启动一次。
  - 文件：`app/components/repository.py`
  - 验证：重新把筛选栏 5 项同步进库 → 重启后端 → `base.filter` 仍是 5 项、`updated_at` 不再被刷新



- **`scripts/ui_rules.sh`：把「同一语义只能一个入口」变成可执行的检查** —— 用户要求「不能再犯错」，光靠记规矩不够，所以落成脚本，交付前跑一遍：
  1. 列出面板里所有 `label` 及其出现次数（重名的逐个人工确认是否同义）；
  2. 统计关键 spec 字段（`title / subtitle / x_title / y_title / bar_name / line_name / note / export_scope / global_nav …`）被写入的次数，>1 说明存在第二条路径；
  3. 扫出仍用 `spacing={1|1.25|1.5}` 的竖排组（浮动标签需 ≥16px）；
  4. 跑 `tsc --noEmit`（唯一硬门槛）。
  - 已写进 `AGENTS.md` §2 交付流程第 2 步。
  - 文件：`scripts/ui_rules.sh`（新增）、`AGENTS.md`
  - 验证：本地跑通，当前状态「过密行距 ✓ / tsc ✓」，label 与字段清单供人工复核

## 2026-11-11 · 面板间距全量校准（8 → 16）

- **整块面板统一按「浮动标签 16px 行距」重排** —— 除了「文字」分区，其余位置（坐标轴、饼图参数、外观网格、分组卡片内部、筛选字段卡、组合图右轴行）也一并从 8/10/12 提到 16，保证任意两个上下相邻的输入框都不会出现「上一行下边框贴住下一行标签」。
  - 具体：`ChartOptionsPanel` 各行 `mb 8→16`；`StylePanel` 网格 `gap 12→16`；`GROUP_CARD_SX` 卡片内 `gap 10→14`；`FilterFieldsEditor` 卡片内 `gap 12→16`；组合图「右轴（线）」行 `mt 8→16`。
  - 文件：`editor/ChartOptionsPanel.tsx`、`editor/StylePanel.tsx`、`editor/PanelSection.tsx`、`editor/FilterFieldsEditor.tsx`、`editor/QueryPanel.tsx`
  - 验证：DOM 遍历面板所有带浮动标签的相邻输入框，**最小间距 = 16px**；整块面板截图无压字；`tsc` 通过

## 2026-11-11 · 修正面板竖排输入的间距

- **浮动标签输入框行距太挤** —— 面板里上下叠放的输入框用 8~10px 行距，而 MUI 浮动标签压在上边框上，导致「右上说明」的下边框几乎贴住下一行「柱名称」的标签（用户截图指出）。现在统一按「浮动标签至少 16px 行距」来排：
  - 「文字」分区行距 8 → **16**（实测 右上说明 与 柱名称 之间 16px）；
  - 面板内其余竖排输入组（导航卡品牌/右侧状态、头标卡标题文案、统计卡等）10 → **14**。
  - 文件：`editor/ChartOptionsPanel.tsx`、`editor/QueryPanel.tsx`
  - 验证：DOM 实测间距 16px；截图对齐无压字；`tsc` 通过

## 2026-11-11 · 过滤与运算合成「计算」分区

- **过滤 / 行限制·排序 / 运算归入同一个「计算」分区** —— 原来「过滤」和「运算」分别在面板两处，都是影响数字怎么算的，现在合成一组：
  ```
  计算
    过滤          ← 已有条件 + 拖入区
    行限制 / 排序
    运算 ⌄        ← 折叠；开了会在标题后标「已启用」
  ```
  面板顺序变成：口径 → 维度/横轴 → 指标/纵轴 → **计算** → 外观 → 文字 → 柱·线 → 坐标轴 → 显示开关。
  - 文件：`editor/ComputeFields.tsx`（新增：运算折叠块，从 ChartOptionsPanel 抽出并加了「已启用」提示）、`editor/ChartOptionsPanel.tsx`（移除运算）、`editor/QueryPanel.tsx`（「计算」分区包住过滤 + 行限制/排序 + 运算）
  - 验证：面板分区顺序实测为 计算 → 外观 → 文字 → 柱 · 线 → 坐标轴；`运算` 仍默认折叠；`tsc` 通过

## 2026-11-11 · 「可改名字」的控件收进同一个「文字」分区

- **卡片标题 / 右上说明 / 柱名称 / 线名称 / 横轴标题 / 纵轴标题 合到一组** —— 原来它们散落在「标题」「柱 · 线」「坐标轴」三个分区里，都是「改名字」却分三处。现在统一在 **「文字」** 分区，两列对齐排布：
  ```
  文字
  [卡片标题]            ← 全宽
  [右上说明]            ← 全宽
  [柱名称] [线名称]      ← 仅组合图
  [横轴标题] [纵轴标题]  ← 仅坐标轴类
  ```
  「柱 · 线」只剩右轴 / 曲线平滑，「坐标轴」只剩 Y 范围 / 柱宽 / 数值格式 / 标签旋转。
  - 同时按 §3.1 的规矩做了唯一性自检（同一语义只有一个输入框，`标题右侧说明` 计数为 0）。
  - 文件：`editor/ChartOptionsPanel.tsx`（新增「文字」分区并搬入六项）、`editor/QueryPanel.tsx`（删掉重复的「标题」分区）
  - 验证：组合图面板实测六个 label 各 **1 个**；结构为 文字 → 柱 · 线 → 坐标轴 → 显示开关；`tsc` 通过

## 2026-11-11 · 规则：面板控件同一语义只能有一个入口

- **用户明确批评（「这么低级的错误你都会犯」）** —— 组合图的「说明」同时出现在「标题」分区（右上说明→`subtitle`）和「柱 · 线」分区（标题右侧说明→`combo.note`），两条路径写出不一致的配置，属低级错误。已把规则写进 `AGENTS.md` §3.1：加/改面板控件前先 grep 现有 label 与它写的 spec 字段，同一语义的输入框数量必须为 1，交付前自检。
  - 文件：`AGENTS.md`（新增 §3.1）
  - 本次已修：组合图重复的说明框已删（见上一条）

## 2026-11-11 · 去掉组合图重复的说明输入框

- **「柱 · 线」分区里重复的「标题右侧说明」删掉** —— 卡片右上说明已统一由「标题」分区的「右上说明」（`spec.subtitle`）负责，组合图里那个只改 `combo.note` 的输入框是第二条路径，容易两边填了不一样。现在说明只有一个入口：`右上说明` → 留空时组合图自动回退「柱 X · 线 Y」，柱状图回退指标名。
  - 文件：`editor/ChartOptionsPanel.tsx`（删输入框）、`renderers/ComboCard.tsx`（优先级改为 subtitle > combo.note > 自动）
  - 验证：组合图面板只剩一个「右上说明」；`tsc` 通过

## 2026-11-11 · 柱状图标题 / 右上说明可改可藏

- **柱状图也支持标题与右上说明** —— 标题走「标题」分区的「卡片标题」（本来就通，现独立成区）；右上说明原来固定显示指标名（如「日销量」），现在：面板加「右上说明」输入框（留空则仍用指标名），显示开关里的 **「说明」** 可整条隐藏、**「标题」** 可隐藏标题行。
  - 文件：`features/components/editor/QueryPanel.tsx`（标题分区 + 右上说明）、`features/components/renderers/BarCard.tsx`（meta 取自定义副标题 / 指标名，受 show_meta 控制）、`renderers/ComboCard.tsx`（说明优先级：combo.note > 副标题 > 自动）
  - 验证：临时看板里柱状图显示「柱状图 · 按价格带看销量」；关掉「标题」「说明」后卡片只剩图体与坐标轴；验完已删临时看板

## 2026-11-11 · 卡片标题独立成「标题」分区

- **卡片标题更好找** —— 之前「标题」和「行限制 / 排序」挤在同一行，容易忽略（用户问「标题怎么改」）。现在它独立成一个「标题」分区、全宽的「卡片标题」输入框，改完即时反映到卡片上（`BoardCard` 已用当前 spec 覆盖 payload 的 title）。
  - 文件：`features/components/editor/QueryPanel.tsx`
  - 验证：临时看板里在「卡片标题」输入文字，卡片标题同步变化（此前实测「组合」→ 输入后变成「价格带组合」）；`tsc` 通过
  - 备注：卡片标题可改；要**隐藏**用显示开关里的「标题」（上一版已加）

## 2026-11-11 · 卡片标题 / 说明可改可隐藏

- **组合图的标题、右上说明、图例都能改能藏** ——
  - **标题**（如「组合」）：文字本来就能改；新增开关「标题」，关掉整条标题行消失、图体拿到全部高度（`CardShell` 支持 `hideTitle`）；
  - **右上说明**（如「柱 平均日销量 · 线 平均热销指数」）：新增输入框「标题右侧说明」可自定义文字（留空则自动 `柱 X · 线 Y`）+ 开关「说明」可整条隐藏；
  - **图例**：名称跟着「柱名称 / 线名称」走，开关「图例」可隐藏（原有能力，已确认可用）。
  - 后端：`ChartSpec` 新增 `show_title / show_meta`，`ComboSpec` 新增 `note`；前端 `CardShell` 新增 `hideTitle`，`ComboCard / BarCard` 读取开关，面板在「显示开关」一排加「标题 / 说明」。
  - 文件：`app/components/spec.py`、`skin/CardShell.tsx`、`renderers/ComboCard.tsx`、`renderers/BarCard.tsx`、`editor/ChartOptionsPanel.tsx`、`types.ts`
  - 验证：临时看板里点「标题」「说明」两个开关 → 「组合」和「柱 … · 线 …」都消失、图例保留；文字框可自定义说明；验完已删临时看板

## 2026-11-11 · 柱线组合可配（横轴 / 左轴 / 右轴）

- **柱线组合补上配置能力** —— 原来面板对它只有「维度 / 指标」两个槽，**线（右轴）既选不了指标，也没有轴标题/柱线名称**，等于半残。现在：
  - 槽位叫法：维度 → **横轴（分类）**、指标 → **左轴（柱）**，并新增 **右轴（线）** 指标 + 聚合（选「不画线」即纯柱状）；
  - 新增分区 **柱 · 线**：柱名称 / 线名称 / 右轴开关 / 曲线平滑；
  - **坐标轴**分区对组合图开放：可填横轴标题 / 纵轴标题（留空不显示），配合上一版「图表选项即时生效」的修复，改完立刻可见。
  - 文件：`editor/axisLabels.ts`（combo 映射）、`editor/QueryPanel.tsx`（右轴指标行）、`editor/ChartOptionsPanel.tsx`（AXIS_KINDS 加 combo + 柱·线分区）
  - 验证：临时看板里组合图（日销量柱 + 均价线）渲染出双轴、图例「日销量 / 均价」、左上轴标题「日销量 / 均价」；面板实测出现「横轴（分类）/ 左轴（柱）/ 右轴（线）/ 柱 · 线 / 坐标轴」；验完已删临时看板

## 2026-11-11 · 修：画布上改图表选项不即时生效

- **画布编辑时改「图表选项」不生效** —— 柱状图里填了横轴标题 / 纵轴标题，图上不出现。原因：画布把后端返回的 `payload.chart`（渲染结果里的那份配置）交给图表渲染器，面板改的是 `spec.chart`，而 `spec.chart` 不在「需要重查」的签名里 —— 所以配置改了但渲染器读到的还是旧值。修法：`BoardCard` 交给渲染器的 payload 里**用当前 spec 覆盖 `chart / combo / ui`**（和原来覆盖 title/subtitle 同一条思路），改完立刻生效、不用等重查。
  - 文件：`features/components/board/BoardCard.tsx`
  - 验证：临时看板里在面板输入「横轴标题 = 销量」→ 图上横轴下方立刻出现「销量」（截图 `/tmp/axis-typing.png`，验证完已删临时看板）
  - 顺带：轴标题留空 = 不显示；面板占位提示会带出绑定字段名

## 2026-11-11 · 柱状图轴标题（填了才显示）

- **柱状图轴标题改为「面板里填才显示」** —— 上一版是自动用字段名当轴名，用户指出轴标题本该在面板「坐标轴」里填写、并能自己决定显不显示。现在：`X 轴标题 / Y 轴标题`（改名 **横轴标题 / 纵轴标题**）**留空就不显示、填了就显示**；输入框占位提示自动带出绑定字段（横轴 `价格带`、纵轴 `日销量`），知道该填什么。
  - 文件：`features/components/renderers/BarCard.tsx`（轴名只认手填标题；斜排刻度时轴名自动让位、底部留 20）、`editor/ChartOptionsPanel.tsx`（改名 + 占位提示）
  - 验证：临时看板里两张对照 —— 留空时轴上没有轴名；填「价格带（元） / SUM(日销量)」后横轴下方与左上角分别出现轴名，刻度不重叠；验完已删临时看板
  - 注：只影响渲染轴名，查询 / 明细表 / 导出一律不变

## 2026-11-11 · 柱状图横轴显示字段名（已被下一版取代）

- **柱状图的横轴补上字段名** —— 原来横轴只有刻度值（40–60元 / ≥80元…），看不出这一轴是哪个字段。现在：手填的「X 轴标题」优先，没填就**自动显示绑定的分组字段名**（如「价格带」），排斜标签时轴名间距自动让开（nameGap 46）、底部留 20 给轴名，不与刻度打架。纵轴不做自动名字，避免和卡片标题挤在一起。
  - 文件：`features/components/renderers/BarCard.tsx`
  - 验证：临时看板（柱子按价格带 × SUM 日销量）里横轴下方显示「价格带」，斜排刻度与轴名不重叠；验完已删临时看板
  - 注：只加渲染层轴名，查询与数据不变；导出/明细表不受影响

## 2026-11-11 · 柱状图配置改成「横轴 / 纵轴」叫法

- **柱状图面板的槽位改用坐标轴语言** —— 「维度 → 横轴（分类）」、「指标 → 纵轴（数值）」，顶部口径块同步成「分组字段 / 聚合数值」，更贴近看柱状图时的直觉。**只改了文案**：`binding.dimension / metric` 数据结构、查询口径、卡片渲染全不动，所以已保存的看板和明细表显示完全不变（明细表仍是「字段」模式，面板里不出现横轴）。
  - 文件：`features/components/editor/axisLabels.ts`（新增映射，目前只有 `bar` 一条）、`editor/QueryPanel.tsx`（槽位标签走映射）、`editor/DataCheckPanel.tsx`（口径块标签可传）
  - 验证：临时看板（柱状图 + 明细表）实测柱状图面板显示「横轴（分类）价格带 / 纵轴（数值）SUM(日销量) / 口径：分组字段 · 聚合数值 · 合计 51,793」；切到明细表面板仍是「字段 … 36 行」、无横轴字样；验完已删临时看板

## 2026-11-11 · 配置面板统一排版（全部组件）

- **所有组件的中栏配置面板统一成一套排版语言** —— 抽了三个基元 `features/components/editor/PanelSection.tsx`：`PanelTitle`（面板标题 12/700 `#0F172A`）、`PanelSection`（分区标题 11.5/600 `#64748B`，段间 24、标题下 12，可带右侧动作）、`GROUP_CARD_SX`（重复项的浅底卡：`#FBFCFE` + 发丝边 + 圆角 + hover 显删除）。然后逐个组件对齐：
  - **指标卡 / 明细表 / 柱线饼等数据卡**：面板顶部补标题（取 `KIND_LABEL`），口径 → 维度 → 指标 → 过滤 → 外观 全部分区；**运算默认折叠**（`ChartOptionsPanel` 里「运算 ⌄」，点开才是换算/乘数/加数/前后缀），面板一屏就能看完
  - **导航菜单卡**：品牌 → 菜单项（每条一张浅底卡，动作「按页面填充 / 添加」收到分区标题右侧）→ 右侧状态 → 按钮（每条一张卡）→ 导出 → 外观；「跳转页全展示」收进菜单项分区末尾，用发丝边分隔
  - **头标卡**：标题文案 → 右侧统计（每条一张卡 + 运算折叠）→ 外观 → 描边（上一轮已完成，这次改用共享基元）
  - **筛选栏字段编辑器 / 外观面板**：分区标题间距与字号统一
  - 文件：`editor/PanelSection.tsx`（新增）、`editor/QueryPanel.tsx`、`editor/ChartOptionsPanel.tsx`、`editor/StylePanel.tsx`
  - 验证：指标卡面板 = 指标卡/口径/维度/指标/过滤/标题/外观/运算⌄ 八段；导航卡 = 品牌/菜单项/右侧状态/按钮/导出/外观；`tsc` 通过
  - 注：纯布局改动，组件库 spec 不变

## 2026-11-11 · 配置面板重排（头标卡）

- **头标卡配置面板重排** —— 原来「右侧统计」三个统计项各占 3~4 行、字段宽窄不一、全挤在一起，看着乱。改为检视器式分区：面板标题（头标卡）→ **分区小标题**（标题文案 / 右侧统计 / 外观 / 描边）→ 每个统计项包进一张浅底卡片（`#FBFCFE` + 发丝边 + 圆角 2），带「统计 N」编号、删除按钮 hover 才出现；卡内固定两行：`[统计字段][数值/汇总]`、`[格式][单位][说明]`；**运算**（乘数/加数/小数位/前缀/后缀）折叠成一行「运算 ⌄」，点开才展开，平时不占视觉。
  - 文件：`features/components/editor/QueryPanel.tsx`（头标卡分支重写；`openStatOps` 折叠状态）
  - 验证：选中头标卡后面板分四区、三张统计卡对齐一致；折叠「运算」时高度减半；`tsc` 通过
  - 注：纯布局改动，组件库 spec 不变

## 2026-11-11 · 头标卡统计补上「运算」与完整聚合

- **头标卡的统计项补齐「运算」和聚合方式** —— 聚合下拉与指标卡一致（`SUM / AVG / MIN / MAX / COUNT / COUNT_DISTINCT`），并在绑了字段后多出一组**运算**：乘数 / 加数 / 小数位 / 前缀 / 后缀（在结果集上换算，不动 SQL，与指标卡的「运算」同一口径）。例：`日销量 SUM × 0.0001 + 0 位 → 5.18万`。
  - 后端：`components/spec.py`（`BannerStat` 加 scale/offset/decimals/prefix/suffix，agg 走 `AGGREGATES` 校验）、`components/resolver.py`（`_fmt_stat` 先算后格式化）
  - 前端：`types.ts`、`editor/QueryPanel.tsx`（聚合 6 项 + 运算两行；未绑字段时仍是静态数值）、`pages/CanvasBoardPage.tsx`（绑了统计字段但没选数据集时自动落到当前数据集）
  - 修复：画布里的头标卡一直显示静态值 —— 后端把 banner 内容摊平在 payload 顶层（`payload.stats`），画布却读 `payload.banner.stats`，改为读顶层
  - 验证：临时看板（`SUM 日销量 ×0.0001 2 位 后缀万` + `COUNT_DISTINCT 商品标题`）在**画布**里渲染为 `5.18万 / 62`；预览页同值；验完已删临时看板

## 2026-11-11 · 头标卡右侧统计可绑数据集指标

- **头标卡「右侧统计」支持绑数据集字段** —— 原来三项只有静态的「数值 / 单位 / 说明」，写死 36、14、6，跟数据无关。现在每项可选**统计字段**（数据集指标）+ **汇总**（SUM/AVG/COUNT/MAX/MIN）+ **格式**（数值/整数/百分比/金额），没绑字段时退回静态数值；绑了之后由后端按数据集实时聚合（同一套筛选 / 参数 / 行级权限口径），页面筛选变化自动跟着变。
  - 后端：`components/spec.py`（`BannerStat.metric/agg/format`）、`components/resolver.py`（`_banner_values` 一次查询算完所有绑定项，仅 banner 生效）、`components/compute.py`（`build_content` 把实时值按 index 注入）
  - 前端：`types.ts`（BannerStat 扩展）、`editor/QueryPanel.tsx`（统计字段/汇总/格式三个控件 + 未绑时显示静态数值）、`renderers/BannerCard.tsx`（`computedStats` 优先）、`board/BoardCard.tsx`（传后端算好的值）、`pages/CanvasBoardPage.tsx`（头标卡也允许绑定数据集；`dataSig` 纳入统计字段，改字段即重算）
  - 验证：临时看板里绑「COUNT 商品标题 / SUM 日销量 / 静态 6」，预览渲染为 **62 在榜 SKU · 51,793 日销量 · 6 种覆盖种类**，静态项保持原样；验完已删临时看板
  - 注：能力改动，组件库 spec 无需同步（模板仍是静态示例值）

## 2026-11-11 · 筛选栏「搜索」打通明细表

- **搜索控件现在真的筛明细表** —— 原来「搜索」只有绑了列（`column`）才生效、且只匹配单列；没绑列时输入什么都不会过滤。现在：没绑列的搜索框作为**关键词**，在明细表**挂载的所有文本列**里做 `OR ILIKE` 模糊匹配（`WHERE (col1 ILIKE %kw% OR col2 ILIKE %kw% …)`，仍然走绑定参数、不拼 SQL），并且与其它筛选、行级权限一起 AND 生效；「查看更多」和导出的全量行同一口径。
  - 后端：`query/contract.py`（新增 `KeywordSpec` + `QueryObject.keyword`）、`query/builder.py`（渲染 OR 组）、`semantic/compiler.py`（列名映射成物理列，只取 `text` 类型）、`components/resolver.py`（`resolve(..., keywords=)`，仅 table 生效）、`dashboards/render.py`（`_page_filters` 返回 `(filters, keywords)`）、`dashboards/router.py`（查看更多/导出同样带关键词）
  - 验证：`榜单端 · 市场分析` 预览页「共 36 条」→ 搜索框输入「高汤」→ **共 1 条**，首行「高汤鲜肉猫罐头…」；API 层同口径核对：不搜索 10 行、搜索后 1 行，且返回行里都含关键词
  - 边界：空值 / `all` / `全部` 不过滤；数字与日期列不参与（避免 ILIKE 类型错误）；组件库 spec 未改，无需同步

## 2026-11-11 · 明细表默认通栏

- **明细表默认宽度到版面边界** —— 新增明细表原来越过 `KIND_SIZE` 的兜底变成 420×300（小方卡），现在归入整版块：`x=0`、宽 1440、默认高 560（表头 + 10 行 + 「查看更多」那一行）。和头标卡 / 导航菜单卡 / 筛选栏一样由 `FULL_WIDTH_KINDS` 统一管，拖到画布任意位置也贴左铺满。
  - 文件：`pages/CanvasBoardPage.tsx`（`FULL_WIDTH_KINDS` 加 `table`、`KIND_SIZE.table`）
  - 验证：从类型栏加明细表，实测 `left: 0 / width: 1440 / height: 560`，右缘正好压在版面边界；面板「高度」显示 560
  - 注：这是新版默认落版尺寸，已有卡片尺寸不变；组件库 spec 未改，无需同步

## 2026-11-11 · 去掉「存为组件库默认」按钮

- **移除面板底部的「存为组件库默认」按钮** —— 用户明确表示不要这个手点入口：**改完卡片由 agent 自动把配置同步进组件库**，不需要她在界面上再点一次。同步能力保留在库里（`PUT /bi/components/{id}`），只是不再做 UI；`CanvasItem.component`（来源 code）继续保留，便于回查与同步。
  - 文件：`pages/CanvasBoardPage.tsx`（移除按钮与 `saveAsLibraryDefault`）、`boardTypes.ts`（注释改述）、`AGENTS.md`（§5 写明「不要加手点按钮，同步由 agent 做」）
  - 验证：中栏面板底部不再出现该按钮；`tsc` 通过

## 2026-11-11 · 筛选栏去掉白底卡片

- **筛选栏底层那块白背景去掉** —— `FilterBar` 根容器原来自带 `bgcolor:#fff` + 14px 圆角 + 描边 + 阴影，画布和预览页又在外面套了第二层白卡（`bgcolor:#fff` + 1px 边框），一条筛选栏叠了两层底。现在根容器**只留排版**（透明、无边框、无阴影、`px/py:0`），画布与预览页的外壳也改成透明 + 垂直居中，控件直接铺在版面/页面底色上。
  - 文件：`renderers/FilterBar.tsx`、`board/BoardCard.tsx`、`pages/DashboardPage.tsx`
  - 验证：画布实测外壳 `background: rgba(0,0,0,0)`、`border: 0`、`radius: 0`、`box-shadow: none`；控件（平台/品类/榜单/价格带/搜索）落在同一基线上
  - 注：这是渲染层改动，组件库 spec 未变、无需同步

## 2026-11-11 · 开发规则文件

- **新增 `AGENTS.md`（仓库根）** —— 把散落在对话里的规矩收拢成一份可执行的开发规则：一句话原则（改一次就对）、仓库与运行（端口 / 重启后端 / 看板在 `bi_canvas.doc`）、**固定交付四步**（改代码 → `tsc` → 逐屏截图进 `docs/_selfcheck` → 更新日志顶部记一条）、视觉与设计令牌、**布局算式**（1440 版面、间距 16、一排 N 张的宽度公式、整版块贴左铺满）、组件库↔画布链路与「改完必须同步进库」、数据安全红线、7 条已知的坑（MUI 圆角 ×8、Divider 颜色、大文件替换事故与救回、不要 curl 登录、别查错表…）、验证脚手架、交互文案口味。
  - 文件：`AGENTS.md`（新增）、`README.md`（目录树挂链）
  - 用途：以后接手的人或 AI 先读这一份；新规矩当天补进去，不要只留在对话里

## 2026-11-11 · 编辑画布与组件库

### 新增

- **「存为组件库默认」** —— 组件库是模板、画布上的卡是副本，改副本**不会**回写库（这是有意的，否则改一张卡会影响以后所有新卡）。所以在中栏面板底部加了这个显式按钮：选中一张来自组件库的卡（底部会出现按钮）→ 点它就把**当前这套配置**写回该组件的 `spec`，之后从类型栏新加的同类卡直接是这套。仅对来自组件库的卡出现（手搓的元素没有 code，不显示）。
  - 文件：`pages/CanvasBoardPage.tsx`（`saveAsLibraryDefault` + 面板底部按钮）、`boardTypes.ts`（`CanvasItem.component` 记录来源 code，保存时随 doc 落库）
  - 验证：选中「榜单端 · 市场分析」的筛选栏（平台/品类/榜单/价格带/搜索 5 项）→ 点按钮 → 提示「已存为「筛选栏」的组件库默认」；库里 `base.filter` 的 fields 由 1 项变 5 项（首项 平台、次项 品类）
  - 已执行（第二轮，整份照抄）：`page/modules` 之外的顶层键（`title`/`ui`/`filter`/`table_view`/`chart`/`content`/`nav`/`rank`/`combo`/`compute`/`layout`）全部以实例为准写入，只把 `binding.dataset_id` 置空；组件库页那张筛选栏卡片的预览已变成「平台 拼多多 / 品类 全部品类 / 榜单 全部榜单 / 价格带 全部价格带 / 搜索 标题/品牌/榜单」
  - 已执行：按用户要求把该实例的实际配置正式同步入库 —— `base.filter` 现为 平台(select)/品类(select)/榜单(select)/价格带(select)/搜索(search 210)、`inline: true`；`binding.dataset_id` 置空（模板不写死数据集）
- **画布撤销 / 重做** —— 工具栏「溢出区」右侧加 ↶ ↷ 两个箭头（无历史时置灰），支持 `⌘Z` / `⇧⌘Z`（输入框内不拦）。历史按「版面快照」记：**一次拖拽/拉尺寸算一步**（按下时存快照、松手时若变了就入栈），面板里改属性 / 点按钮增删按 500ms 静默合并成一步；切页、重新载入时清空历史；最多留 80 步。
  - 文件：`pages/CanvasBoardPage.tsx`
  - 验证：加元素 → 撤销回 24 个元素、重做回 25 个；`⌘Z` 同步生效；拖动 KPI 卡（12,470 → 168,546）后撤销精确回到 (12,470)
- **多页面（同一看板下的页面）** —— 顶栏右侧变成页面切换器：`主视图 页面2 …＋`，点即切页；**双击就地重命名**、**右键菜单**（重命名 / 复制页面 / 删除页面，只剩一页时删除置灰）、`＋` 新建页并直接进入命名。页面属于同一个看板（存在 `doc.views`），每页有独立版面与参考线；切页前会把当前页写回 doc，**来回切不丢未保存改动**、单纯切页也不会误标「未保存」。窄屏顶栏不再换行：看板 chip 在 <1536px 自动收起，页面条横向滚动，按钮不折行。
  - 文件：`pages/CanvasBoardPage.tsx`
  - 验证：新建两页 → 改名「榜单端」→ 再建「页面3」→ 切回主视图，版面原样回来（4 个元素）；1904 / 1440 / 1280 三档顶栏无换行、无遮挡
  - 迭代：导航卡「点击跳页」已接上（见下方导航菜单卡条目的「· 迭代」）
- **导航菜单卡组件（nav）** —— 页头导航条：左侧品牌标记（渐变方块 + 三根白柱）+ 品牌名（尾段渐变强调），中间菜单（彩色圆点 + 标签，当前页为高亮胶囊），右侧灰色状态字 + 绿色徽标 + 主/次按钮。默认整版宽 1440×64；菜单 ≤6 项、按钮 ≤2 个，都可增删改；缩略图尺寸自动降级（≤1100 收灰字、≤760 只留圆点、≤620 收徽标与按钮），组件库里也是一条能认出的迷你导航。
  - 文件：`frontend/src/features/components/renderers/NavCard.tsx`（渲染）、`editor/QueryPanel.tsx`（品牌 / 菜单项 / 状态 / 按钮编辑）、`editor/StylePanel.tsx`（外观与描边）、`app/components/spec.py` / `compute.py` / `resolver.py` / `seed_base.py`（后端 `nav` 链路与种子 `base.nav`）
  - 验证：组件库 18 张卡含导航菜单卡；画布加卡得 1440×64、改菜单标签即时生效；缩略图显示品牌 + 圆点；`tsc` 通过
  - 迭代：**菜单项可挂载跳页** —— 菜单项配置里每一项多一个「跳转页面」下拉（选项=不跳转 / 本看板各页面），挂上后预览页点这一项即切到对应页面；「当前页」高亮由「目标页 = 当前页」自动推导（没挂载才用配置里的 active）；编辑画布内点击仍是选中卡片、不跳页，避免编辑时误切；目标页被删除后该项自动变成不可跳（不会炸）。
  - 迭代验证：建临时看板（2 页 + 带挂载的导航卡）→ 预览点「榜单端」→ URL 变 `view=page_two`、页签「第二页」选中、内容切换；验完已删除临时看板；`tsc` 通过
  - 迭代：**跳转页全展示** —— 菜单项配置下方新增开关「跳转页全展示」；开启后这张导航在**每个页面都渲染**（当前页没放就叠在最上面，只在渲染层注入、不写回文档），跳页后导航不再消失；高亮由「目标页 = 当前页」推导，且**只要有一项挂到当前页就只亮那一项**（不会出现两个都亮）；编辑画布在非归属页以 55% 透明度的只读影格 + 「全展示」角标显示，让版面所见即所得又不会误编辑。
  - 迭代验证：临时看板（主视图放全局导航、第二页只有标题）→ 预览从第一页点「第二页」→ URL `view=p2`、内容切到第二页且**导航仍在**；编辑画布切到第二页可见影格；验完已清理；`tsc` 通过
  - 修复：**点过去跳不回来** —— 用户实际只给「市场总览」挂了 `页面2`，「榜单端」等三项 `page` 为空，所以点它们不跳（不是交互失效，是没挂载）。三条改进：① 新建导航菜单卡时**自动按本看板页面铺好菜单并挂好目标页**；② 菜单项标题行加「按页面填充」一键重建菜单（每页一项、自动挂 page）；③ 未挂页的菜单项在标签右侧显示琥珀点（hover 提示「未挂页：点击不会跳转」），配置缺口一眼可见。
  - 修复验证：往返实测 第一页 →（点第二页）→ 第二页（导航仍在）→（点总览）→ 第一页，URL 同步 `?view=main`；「按页面填充」点击后未挂页提示从 3 个变 0；`tsc` 通过
- **头标卡组件（banner）** —— 页头渐变大图卡：kicker 小字 + 大标题（尾段渐变强调）+ 副标题 + 右侧统计（数值/单位/说明）。浅色渐变底 + 右上光环 + 右下弧线波形，纯 CSS/SVG 无图片资源；4 套底色（天蓝 / 靛蓝 / 青绿 / 暖橙）；容器查询自适应（≤900px 缩字号、≤620px 收统计，组件库缩略图里也是完整缩小版）。
  - 文件：`frontend/src/features/components/renderers/BannerCard.tsx`（渲染）、`editor/QueryPanel.tsx`（内容编辑）、`editor/StylePanel.tsx`（外观）、`app/components/spec.py` / `compute.py` / `resolver.py` / `seed_base.py`（后端链路与种子）
  - 验证：画布加卡 → 改标题/统计即时生效（不重查）→ 预览页渲染一致；`tsc` 通过
- **编辑画布「溢出区」浅灰提醒 + 开关** —— 1440 版面左右外侧铺一层浅灰（13% 灰）并压一条内缘细线，越界内容会被压暗起提醒作用；灰层 `pointer-events: none` 不拦拖拽，版面比视口矮时通到底、画布比视口高时滚动连续。工具栏「溢出区」按钮可开可关，默认开。
  - 文件：`features/components/board/BoardSurface.tsx`、`pages/CanvasBoardPage.tsx`
  - 验证：开/关两态、1800×1000 / 1800×560（滚动）/ 1260×800 三档截图，命中测试确认不拦交互
- **元素四边缩放（上 / 下 / 左 / 右）** —— 原来只有右下角；现在拖哪条边对边钉住、吸附只对正在拖的那条边生效，⌥ 关磁吸照旧。抓手按屏幕 10px 换算回设计坐标，画布缩到 65% 也不变细；悬停时边上一根细靛蓝线。最小尺寸按类型：图表 180×110、标题/文字 120×36、分割线 120×16。
  - 文件：`features/components/board/BoardCard.tsx`、`board/snapping.ts`
  - 验证：文字元素四边各拖一次（左 −42/宽 +42、右 +40、上 −31、下 +60），对边不动；最小尺寸不误跳
- **右侧「图表类型」栏由组件库驱动** —— 栏内列表来自 `GET /bi/components`，与组件库同一份数据：按分类分组（页面模块 → 指标卡 → 明细表 → 分布 → 占比 → 时间序列 → 排名 → 关系 → 矩阵 → 组合 → 词频 → 内容），未知分类排末尾仍显示；点选=按库里那份 spec 生成实例，拖拽带上 component code。同时补齐组件库缺失的「分节标题」(`base.section`)，库里共 17 张卡。
  - 文件：`features/components/editor/ChartTypeRail.tsx`、`pages/CanvasBoardPage.tsx`、`app/components/seed_base.py`
  - 验证：`/bi/components` 17 张卡 → 类型栏 17 项且分组正确；点头标卡得 1440×200 头图卡、点分节标题得 56 高分节

### 优化

- **画布选中筛选栏时中栏显示的是「口径 / 维度 / 指标」表配置** —— 面板按 `item.type` 路由，而组件库加出来的筛选栏 `type` 记的是 `chart`（只有工具栏那条路径才是 `filter`），于是落进了数据卡面板。改成**按 kind 判断**（`type==="filter" || kind==="filter"`），两条来源都进「筛选字段」编辑器；同时组件库加出来的筛选栏本身 `type` 也直接记成 `filter`，新文档不再有这种混搭。
  - 文件：`pages/CanvasBoardPage.tsx`（`isFilterItem`、`isChart`、`addChart`）
  - 验证：选中「榜单端 · 市场分析」的筛选栏，中栏显示「筛选字段 / 名称 / 控件 / 绑定字段 / 快捷填入 / 选项 / 默认值 / 宽度」，`查看 SQL` 不再出现
- **组件库那张筛选栏的「配置」页字段参数不全** —— `组件编辑页`（`/bi/components/{id}/edit`）里筛选字段原来只有「id / 标签 / 类型 / 选项 / 默认」挤在一行，没有绑定字段、快捷填入、拖入、宽度、多选。把画布中栏那套**筛选字段编辑器抽成共用组件** `features/components/editor/FilterFieldsEditor.tsx`，两处用同一份实现：名称 / 控件 / 绑定字段（含快捷填入 + 拖入 + 自动取该列候选值）/ 选项 / 默认值 / 宽度 / 删除。组件库里没有数据集上下文，`columns` 传空数组、`datasetId` 传 null（自动取值跳过）。
  - 文件：`features/components/editor/FilterFieldsEditor.tsx`（新增，共用）、`pages/CanvasBoardPage.tsx`（原本地实现改成薄包装）、`pages/ComponentEditorPage.tsx`（复用）
  - 验证：`/bi/components/107/edit` 配置页现显示 5 个字段的完整参数（平台 下拉 / 选项 天猫|天猫、拼多多|拼多多 / 默认 拼多多 / 宽度 0）；画布中栏行为不变
- **画布只在进页面时拉一次组件库，改了库不刷新就看不到** —— 加「回到页面自动重拉」：`window.focus` / `visibilitychange` 时静默重取 `/bi/components`（失败不覆盖已有列表）。这样在组件库页改过配置、或点过「存为组件库默认」后切回画布，类型栏与新增卡片立刻用新配置，不需要手动刷新。
  - 文件：`pages/CanvasBoardPage.tsx`
  - 验证：`tsc` 通过（组件列表刷新逻辑与保存为默认后的重取共用同一接口）
- **工具栏「筛选栏」不读组件库、永远生成一个搜索框** —— 新增筛选栏有两条入口（工具栏按钮 / 右侧类型栏），前者走的是硬编码的最小 spec，所以组件库里同步好的那套（平台/品类/榜单/价格带/搜索、含选项与默认值）从工具栏加不出来。改成**两条入口都读组件库**（`base.filter` 的 spec），库里没有才退回最小默认；同时把 `component` code 一并写上，便于后续「存为组件库默认」。
  - 文件：`pages/CanvasBoardPage.tsx`（`addFilter`）
  - 验证：工具栏点「筛选栏」→ 新卡 1440×76，内容为「平台 拼多多 / 品类 全部品类 / 榜单 全部榜单 / 价格带 全部价格带 / 搜索」，与组件库那份一致
- **筛选栏默认宽度只到 1200** —— 改成通栏：`x=0 / 宽 1440`，右缘正好压在版面边界（不进溢出区）。工具栏「筛选栏」和组件库里那张都走同一规则；把已有图表切成筛选栏时也归位。整版块组件现在统一由 `FULL_WIDTH_KINDS = {banner, nav, filter}` 管：贴左铺满、拖放落点不影响。
  - 文件：`pages/CanvasBoardPage.tsx`（`addFilter`、`KIND_SIZE.filter`、`FULL_WIDTH_KINDS`）
  - 验证：两条入口新增筛选栏实测 `left: 0 / width: 1440 / height: 76`
- **指标卡默认尺寸太大** —— 按「版面 1440 一排排 6 张、留 16 间距不溢出」反推：`(1440 − 5×16) / 6 ≈ 226.7`，取 8 的倍数得 **224×104**（6×224 + 5×16 = 1424，右侧还余 16）。原来 420×132 一排只放得下 3 张。另外修了「把大卡切成指标卡/结论卡时沿用原尺寸」的问题（表 1428×704 切过去就是一张 1428 宽的空壳），现在切成这两类会归位到它们自己的默认尺寸。
  - 文件：`pages/CanvasBoardPage.tsx`（`KIND_SIZE.kpi`、`pickComponent`）
  - 验证：新增指标卡实测 224×104；1428×704 的明细表切成指标卡后同样归位到 224×104
- **导航卡的「导出 CSV」变成真导出** —— 成品页点这个按钮，会把**当前页用到的数据集整表**导出成 CSV（每个数据集一个文件，文件名 `数据集名-日期.csv`）：列＝该数据集全部字段（不只是卡片上显示的那几列），行＝走同一套查询链路（RLS / 脱敏 / 当前筛选），带 BOM 所以 Excel 打开中文不乱码；单表上限 5000 行，超了会在提示里标出来。编辑画布内按钮保持装饰、不触发。
  - 迭代：**导出范围可配 + 表格自带导出** —— ① 导航卡面板的「导出范围（导出 CSV 用）」改成**显式选数据集**：选项列出本页实际用到的数据集（名称 + 引用卡片数），直接选「榜单端-拼多多」就只导那一份，不再靠"引用最多"隐式猜；另有「仅主数据集」「全部数据集」两项兜底。② **明细表卡自带导出**：表头「共 N 条」右边一个下载图标，导的就是这张表绑定的数据集（比导航栏按钮更符合直觉，一次只会出一个文件）。起因：「榜单端·市场分析」同时用了数据集 2（14 张卡）与 15（2 张卡），从导航卡导出会出两个文件。
  - 文件：`pages/DashboardPage.tsx`（`exportCurrentPageData` + CSV 助手）、`features/components/renderers/NavCard.tsx`（`onAction`）
  - 验证：成品页点「导出 CSV」→ 抓到的 CSV 头为数据集 24 个字段，首行是真实数据；右下角提示「已导出 1 个数据集 CSV」
- **标题元素的下划线跟随文字** —— 从「钉在盒子底边」改成「距文字行 6px」，元素拉高拉矮线都贴着文字。（`BoardCard.tsx`）
- **预览页去掉页头标题栏与页面页签** —— 标题栏不属于设计页面，整条移除：设计页面 `y=0` 直接接在顶栏下方，与编辑画布一致；「编辑」改右上角悬浮胶囊（不占版面）；**多页面也不再显示页签**（成品页只留导航卡一条导航，页面切换靠导航卡跳转或 `?view=` 深链）。（`pages/DashboardPage.tsx`）
- **头标卡外观可调** —— 圆角（0–28px）、描边开关、线宽（极细 0.5 / 细 1 / 较细 1.5 / 中 2 / 粗 3 px）、描边深浅（淡 10 / 常规 22 / 深 36 / 浓 52%）、阴影（无 / 弱 / 中 / 强）；描边关掉时线宽/深浅自动隐藏。数据存 `ui.radius / edge / edge_px / edge_alpha / shadow_px`，后端 `UiSpec` 做范围校验。（`BannerCard.tsx`、`StylePanel.tsx`、`app/components/spec.py`）
- **中栏面板重排与间距节奏** —— 头标卡：内容字段一组（14px 间距）→ 分割线（上下 16px）→ 右侧统计（行间 10px、行内 8px）→ 外观（两列 12px 网格）→ 描边（整行可点的设置行，20px 上方留白）。分隔线改用全站发丝色，数值右对齐 + 等宽数字，删除按钮改成 hover / focus 才显现。（`QueryPanel.tsx`、`StylePanel.tsx`）
- **新增元素居中夹到版面内** —— 980 宽的标题居中会顶进右侧溢出区，改为按元素宽度居中并在 `0 … 1440-w` 内夹住。（`CanvasBoardPage.tsx`）

### 修复

- **头标卡圆角被放大 8 倍** —— `sx` 里数字 `borderRadius` 会乘 `theme.shape.borderRadius`（本项目 8），12 渲染成 96px（库里存 18 的更是 144px），看着像大圆角胶囊。改为带单位字符串，默认 12px。（`BannerCard.tsx`）
- **导航菜单卡默认带着「导入 CSV」** —— 默认按钮精简为只有一个主按钮「导出 CSV」（组件库种子 `base.nav` + 画布新建导航卡两处同步）；已保存的演示看板里那张导航卡也一并去掉该按钮（改前备份在 `/tmp/doc29-backup.json`）。
  - 文件：`app/components/seed_base.py`、`pages/CanvasBoardPage.tsx`
  - 验证：预览页 `body` 已无「导入」，只剩「导出 CSV」
- **头标卡 / 导航菜单卡的默认宽度会越过版面右侧** —— 默认宽 1440 但落点沿用拖放位置（x 可能 > 0）或旧图表的位置，右侧就压进溢出区。改为这两类卡**固定 x=0、宽 1440 贴左铺满**，拖到画布任意位置也贴左；把已有图表切成这两类时同样归位。
  - 文件：`pages/CanvasBoardPage.tsx`
  - 验证：新增两张卡实测设计坐标 `left: 0px / width: 1440px`（右缘正好落在版面边界，不越界）
- **描边开关位置越界 / 拇指脱轨** —— 负边距把开关盒推出内容列 6px，自定义 `.MuiSwitch-switchBase` 内边距让拇指比轨道低 5px。去掉两个 hack，实测开关盒右缘 = 内容列、拇指与轨道同中线。（`StylePanel.tsx`）
- **手动重跑组件库种子会清掉数据组件的数据集绑定** —— 直接 `seed_base.ensure_base(db)`（不传 dataset_id）会按种子默认值 upsert，把 18 个组件的 `binding.dataset_id` 写成 null，组件库预览全变占位条。重跑必须走 `component_seed.ensure_dataset(db)` 拿到 id 再 `ensure_base(db, dataset_id)`（bootstrap 启动时就是这么做的）。
  - 文件：`backend/app/components/seed_base.py`
  - 验证：重跑后 18 个组件 `spec.binding.dataset_id` 均为 2，组件库预览恢复正常
- **窄屏顶栏工具条压住文档 chip** —— 工具条原来是绝对居中，1260 宽时会盖住左侧文档 chip；改成在 chip 与右侧操作按钮之间居中（流式布局），窄屏不再重叠。（`CanvasBoardPage.tsx`）

### 重构

- **`QueryPanel.tsx` 误删事故与恢复** —— 脚本字符串替换把文件写崩（95MB），从 Vite 内存模块的 inline sourcemap `sourcesContent` 完整还原（684 行，含类型与 JSX），`tsc` 通过、明细表面板实测正常。后续改大文件改用逐段 `edit` 替换并核对文件体积。

---

<!-- 新增条目模板（复制到上面 2026-xx-xx 区块里）

## YYYY-MM-DD · 主题

### 新增
- **功能名** —— 一句话说清做了什么、给谁用。
  - 文件：`路径`
  - 验证：怎么证明它是好的

-->
