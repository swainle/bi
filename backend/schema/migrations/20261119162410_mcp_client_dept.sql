-- MCP 部门范围 + 按用户签发凭据
--   dept_id：客户端开放给哪个部门（NULL = 全员可用），本部门及下级部门的人可见
--   secret_hash：每个授权自己的 secret（不再共用客户端级 secret），团队可自助生成接入串
ALTER TABLE public.bi_mcp_client
  ADD COLUMN IF NOT EXISTS dept_id integer REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bi_mcp_client_dept ON public.bi_mcp_client (dept_id);

ALTER TABLE public.bi_mcp_grant
  ADD COLUMN IF NOT EXISTS secret_hash text;
