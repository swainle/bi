-- 054 · MCP 令牌治理（R12）
-- 授权记录补设备 / 用途信息与最近使用时间；客户端区分「服务账号」与个人客户端。

ALTER TABLE bi_mcp_grant ADD COLUMN IF NOT EXISTS device_name varchar(80) NOT NULL DEFAULT '';
ALTER TABLE bi_mcp_grant ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE bi_mcp_grant ADD COLUMN IF NOT EXISTS last_ip varchar(80) NOT NULL DEFAULT '';
ALTER TABLE bi_mcp_grant ADD COLUMN IF NOT EXISTS last_user_agent varchar(400) NOT NULL DEFAULT '';
ALTER TABLE bi_mcp_grant ADD COLUMN IF NOT EXISTS grant_kind varchar(20) NOT NULL DEFAULT 'personal';

ALTER TABLE bi_mcp_client ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_mcp_grant_user_active
  ON bi_mcp_grant (user_id) WHERE revoked_at IS NULL;
