-- MCP 客户端的看板范围：限定这个 Agent 只能操作哪几页看板（进而限定可查的数据集）
--   没有记录 = 不限看板（兼容已有客户端）
--   有记录   = 只能操作这些看板；数据集工具按这些看板实际引用的数据集收口
CREATE TABLE IF NOT EXISTS public.bi_mcp_client_dashboard (
  client_id    integer NOT NULL REFERENCES public.bi_mcp_client(id) ON DELETE CASCADE,
  dashboard_id integer NOT NULL REFERENCES public.bi_canvas(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, dashboard_id)
);

CREATE INDEX IF NOT EXISTS idx_bi_mcp_client_dashboard_client
  ON public.bi_mcp_client_dashboard (client_id);
