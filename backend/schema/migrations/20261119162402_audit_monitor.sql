-- 操作监控（S7，2026-11-14）
-- 权限码：管理后台第 9 个分区「操作监控」；审计查询按时间倒序，补索引避免全表扫。

INSERT INTO permissions (code, name, "group") VALUES
  ('bi:audit:view', '操作监控', '管理后台')
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON public.bi_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_created
  ON public.bi_ai_audit_log (created_at DESC);

COMMENT ON INDEX public.idx_audit_logs_created IS '操作监控：按时间倒序翻页';
