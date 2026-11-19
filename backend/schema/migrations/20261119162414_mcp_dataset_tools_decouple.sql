-- 数据集类 MCP 工具与「数据集入口」权限解耦
--   背景：bi:nav:datasets 只用于控制前端「数据集」导航，全站角色默认都没开，
--         结果导致只有管理员能用 MCP 读数据。MCP 的数据边界应由
--         用户的数据集 ACL（归属部门 / owner / 行级规则）+ 分级预算来管，
--         而不是前端导航权限。这里把必需权限清空，visible 与否仍受「客户端工具开关 + 授权」控制。
UPDATE public.bi_mcp_tool
SET required_permissions = '[]'::jsonb
WHERE code IN (
  'bi_list_datasets', 'bi_get_dataset_schema', 'bi_query_dataset',
  'bi_list_metrics', 'bi_get_metric', 'bi_query_metric'
);
