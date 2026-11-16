-- 解冻后的观察期：管理员解冻时给该授权一段宽限，避免同一个异常窗口立刻再次冻结
ALTER TABLE public.bi_mcp_grant
  ADD COLUMN IF NOT EXISTS anomaly_grace_until timestamptz;
