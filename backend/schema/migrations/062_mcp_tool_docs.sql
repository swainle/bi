-- 工具说明对齐：讲清「渲染=展示颗粒度」「数据集=原始颗粒度」「AI 解读不取数」
UPDATE public.bi_mcp_tool
SET description = '按看板展示配置渲染整页看板，返回每个组件的结果（KPI/图表/表格/筛选栏）。表格按看板 page_size 返回（通常 10 行/页），全量明细请用 bi_query_dataset。'
WHERE code = 'bi_render_dashboard';

UPDATE public.bi_mcp_tool
SET description = '按维度/指标取数（禁裸 SQL）。查明细用 dimensions=[字段...]，limit 控制行数；受数据集行列权限、分级与每日行数预算约束。'
WHERE code = 'bi_query_dataset';

UPDATE public.bi_mcp_tool
SET description = 'AI 解读：只做文本推理，不直接取数；先把 bi_render_dashboard / bi_query_dataset 的结果放进 context。'
WHERE code = 'bi_ai_analyze';
