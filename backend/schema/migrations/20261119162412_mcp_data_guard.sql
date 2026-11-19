-- MCP 取数安全底座（完整版）
--   bi_dataset.data_class      数据分级：normal / confidential / financial（决定行数预算与查询形态）
--   bi_dataset.mcp_daily_rows  按数据集覆盖每日行数预算（NULL = 用分级默认）
--   bi_mcp_grant.frozen_at     授权被安全策略冻结的时间（冻结后令牌立即不可用，管理员可解冻）

ALTER TABLE public.bi_dataset
  ADD COLUMN IF NOT EXISTS data_class text NOT NULL DEFAULT 'normal';

ALTER TABLE public.bi_dataset
  ADD COLUMN IF NOT EXISTS mcp_daily_rows integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_bi_dataset_data_class'
  ) THEN
    ALTER TABLE public.bi_dataset
      ADD CONSTRAINT ck_bi_dataset_data_class
      CHECK (data_class IN ('normal', 'confidential', 'financial'));
  END IF;
END $$;

ALTER TABLE public.bi_mcp_grant
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz;

ALTER TABLE public.bi_mcp_grant
  ADD COLUMN IF NOT EXISTS frozen_reason text;

CREATE INDEX IF NOT EXISTS idx_bi_mcp_grant_frozen
  ON public.bi_mcp_grant (user_id, client_id) WHERE frozen_at IS NOT NULL;
