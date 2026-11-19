-- 055 · MCP 生产化（R7–R11）
-- 1) 目录与实现对齐：删掉只在目录里、没有实现的工具；
-- 2) 幂等键表：client + tool + key 唯一，重复请求返回首次结果。

DELETE FROM bi_mcp_tool WHERE code IN (
  'bi_export_summary', 'bi_export_detail', 'bi_run_sql',
  'bi_create_chart', 'bi_modify_dashboard', 'bi_delete_resource'
);

CREATE TABLE IF NOT EXISTS public.bi_mcp_idempotency (
  id         bigserial PRIMARY KEY,
  client_id  integer NOT NULL,
  tool       text NOT NULL,
  idem_key   text NOT NULL,
  user_id    integer,
  result     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, tool, idem_key)
);

CREATE INDEX IF NOT EXISTS idx_mcp_idem_created ON public.bi_mcp_idempotency (created_at DESC);

COMMENT ON TABLE public.bi_mcp_idempotency IS 'MCP 写工具幂等键：同一客户端同一工具同一 key 只执行一次';
