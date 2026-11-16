-- MCP 工具网关基础设施（2026-11-14，S1）
-- 只建表、权限码与工具目录种子；网关与工具实现在 S2 / S5。
-- 口径见 docs/MCP与Agent权限接入方案.md §6。

-- ── 权限码（角色权限页可勾选；管理员直通）──────────────────────────
INSERT INTO permissions (code, name, "group") VALUES
  ('bi:mcp:use',              'Agent 代调用', 'MCP 能力'),
  ('bi:mcp:write',            'Agent 写看板', 'MCP 能力'),
  ('bi:mcp:manage',           'MCP 客户端',   '管理后台'),
  ('bi:data:export:summary',  '汇总导出',     '数据能力'),
  ('bi:data:export:detail',   '明细导出',     '数据能力'),
  ('bi:resource:delete',      '删除资源',     '数据能力')
ON CONFLICT (code) DO NOTHING;

-- ── 工具目录（代码里的实现由 app/mcp/tools 提供，本表用于策略与展示）──
CREATE TABLE IF NOT EXISTS public.bi_mcp_tool (
  code                 text PRIMARY KEY,
  name                 text NOT NULL,
  description          text NOT NULL DEFAULT '',
  risk                 text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  required_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_enabled      boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bi_mcp_tool IS 'MCP 工具目录：risk 决定默认策略，required_permissions 与用户有效权限取交集';

INSERT INTO public.bi_mcp_tool (code, name, description, risk, required_permissions, default_enabled) VALUES
  ('bi_list_dashboards',    '我的看板',     '列出当前用户可见的看板',                 'low',    '[]'::jsonb,                                  true),
  ('bi_get_dashboard',      '看板详情',     '读取看板文档与元信息',                   'low',    '[]'::jsonb,                                  true),
  ('bi_render_dashboard',   '渲染看板',     '按当前筛选渲染整页看板',                 'low',    '[]'::jsonb,                                  true),
  ('bi_list_datasets',      '数据集列表',   '列出有权限的数据集',                     'low',    '["bi:nav:datasets"]'::jsonb,                 true),
  ('bi_get_dataset_schema', '数据集结构',   '字段、指标口径与候选值',                 'low',    '["bi:nav:datasets"]'::jsonb,                 true),
  ('bi_query_dataset',      '聚合查询',     '按维度/指标聚合取数（禁裸 SQL）',         'medium', '["bi:nav:datasets"]'::jsonb,                 true),
  ('bi_list_metrics',       '指标目录',     '列出数据集下的指标',                     'low',    '["bi:nav:datasets"]'::jsonb,                 true),
  ('bi_get_metric',         '指标口径',     '单个指标的聚合口径与格式',               'low',    '["bi:nav:datasets"]'::jsonb,                 true),
  ('bi_query_metric',       '指标取数',     '按指标取数（复用查询构建器）',           'medium', '["bi:nav:datasets"]'::jsonb,                 true),
  ('bi_ai_analyze',         'AI 解读',      '基于数据回答业务问题',                   'medium', '["bi:ai:use"]'::jsonb,                       true),
  ('bi_export_summary',     '汇总导出',     'PDF / 汇总级导出',                       'medium', '["bi:data:export:summary"]'::jsonb,          false),
  ('bi_run_sql',            '自定义 SQL',   '自定义 SQL（走 SQL Guard）',             'high',   '["bi:nav:sql", "bi:ai:sql"]'::jsonb,         false),
  ('bi_export_detail',      '明细导出',     'Excel 明细导出',                         'high',   '["bi:data:export:detail"]'::jsonb,           false),
  ('bi_create_chart',       '生成图表',     '根据需求生成单个图表',                   'high',   '["bi:nav:editor"]'::jsonb,                   false),
  ('bi_modify_dashboard',   '编辑看板',     '修改已有看板文档',                       'high',   '["bi:nav:editor"]'::jsonb,                   false),
  ('bi_delete_resource',    '删除资源',     '删除看板 / 数据集 / 组件',               'high',   '["bi:resource:delete"]'::jsonb,              false),
  -- S5 才实现（先占目录，默认关闭）
  ('bi_list_components',    '组件库',       '组件库与图表类型目录',                   'low',    '["bi:nav:components"]'::jsonb,               false),
  ('bi_create_dashboard',   '新建看板草稿', '新建空草稿（owner=当前用户）',           'high',   '["bi:nav:editor", "bi:mcp:write"]'::jsonb,   false),
  ('bi_add_item',           '添加元素',     '从组件库加一个元素到草稿',               'high',   '["bi:nav:editor", "bi:mcp:write"]'::jsonb,   false),
  ('bi_set_layout',         '写入版面',     '批量写入元素坐标（按版面算式归一）',     'high',   '["bi:nav:editor", "bi:mcp:write"]'::jsonb,   false),
  ('bi_preview_dashboard',  '预览草稿',     '渲染草稿并返回每张卡状态',               'medium', '["bi:nav:editor", "bi:mcp:write"]'::jsonb,   false),
  ('bi_save_dashboard',     '保存草稿',     '保存草稿（渲染有错拒绝）',               'high',   '["bi:nav:editor", "bi:mcp:write"]'::jsonb,   false),
  ('bi_publish_dashboard',  '发布草稿',     '发布 Agent 草稿（需用户二次确认）',       'high',   '["bi:nav:editor", "bi:mcp:write"]'::jsonb,   false)
ON CONFLICT (code) DO NOTHING;

-- ── MCP 客户端（Agent）────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bi_mcp_client (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  client_id    text NOT NULL UNIQUE,
  secret_hash  text NOT NULL,
  owner_id     integer REFERENCES public.users(id) ON DELETE SET NULL,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

COMMENT ON TABLE public.bi_mcp_client IS 'MCP 客户端：只由管理员创建；secret 只存哈希，明文只在创建时返回一次';

-- ── 客户端级工具策略（管理员配；默认关闭 = 三重 AND 的第一道）──────
CREATE TABLE IF NOT EXISTS public.bi_mcp_client_tool (
  client_id  integer NOT NULL REFERENCES public.bi_mcp_client(id) ON DELETE CASCADE,
  tool_code  text NOT NULL REFERENCES public.bi_mcp_tool(code) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  granted_by integer,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, tool_code)
);

-- ── 用户授权（用户同意把哪些能力给这个 Agent）───────────────────────
CREATE TABLE IF NOT EXISTS public.bi_mcp_grant (
  id         serial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id  integer NOT NULL REFERENCES public.bi_mcp_client(id) ON DELETE CASCADE,
  scopes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_mcp_grant_user ON public.bi_mcp_grant (user_id, client_id);

-- ── 访问令牌吊销名单（token 本体是 JWT，失效链与 users.token_version 一致）──
CREATE TABLE IF NOT EXISTS public.bi_mcp_token_revoke (
  jti        text PRIMARY KEY,
  user_id    integer,
  client_id  integer,
  expires_at timestamptz,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason     text NOT NULL DEFAULT ''
);

-- ── Agent 创建的看板归属（写工具只准改这里登记的草稿）────────────────
CREATE TABLE IF NOT EXISTS public.bi_mcp_dashboard (
  id           serial PRIMARY KEY,
  client_id    integer NOT NULL REFERENCES public.bi_mcp_client(id) ON DELETE CASCADE,
  dashboard_id integer NOT NULL REFERENCES public.bi_canvas(id) ON DELETE CASCADE,
  user_id      integer REFERENCES public.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (client_id, dashboard_id)
);

-- ── 调用审计（每次调用都写，含被拒）────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bi_mcp_audit (
  id           bigserial PRIMARY KEY,
  user_id      integer,
  client_id    integer,
  tool         text NOT NULL,
  risk         text NOT NULL DEFAULT '',
  args_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  dataset_id   integer,
  sql_hash     text,
  row_count    integer,
  status       text NOT NULL DEFAULT 'ok',
  error        text,
  duration_ms  integer,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_mcp_audit_user ON public.bi_mcp_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_mcp_audit_client ON public.bi_mcp_audit (client_id, created_at DESC);

-- ── 数据集级部门隔离规则（S3 生效；先建表，未配置 = 行为不变）────────
CREATE TABLE IF NOT EXISTS public.bi_dataset_scope_rule (
  dataset_id  integer PRIMARY KEY REFERENCES public.bi_dataset(id) ON DELETE CASCADE,
  column_name text NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('department', 'self', 'all')),
  created_by  integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bi_dataset_scope_rule IS '数据集部门隔离：查询执行器注入 col = 本部门(含下级)；配置错误 fail-closed';
