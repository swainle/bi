-- MCP 用户授权补充（2026-11-14，S2）
-- 授权记录需要保存「刷新令牌的哈希」，Agent 用 client_id + secret + refresh_token 换 1 小时访问令牌。

ALTER TABLE public.bi_mcp_grant ADD COLUMN IF NOT EXISTS refresh_hash text;

CREATE INDEX IF NOT EXISTS idx_bi_mcp_grant_refresh ON public.bi_mcp_grant (refresh_hash);

COMMENT ON COLUMN public.bi_mcp_grant.refresh_hash IS '刷新令牌哈希；明文只在生成时返回一次';
