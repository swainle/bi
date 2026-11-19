-- 安全指纹（S7 操作监控二期，2026-11-14）
-- 目的：不是「登录用户」的操作（匿名扫描 / 过期令牌 / 越权尝试 / 暴力破解 / 直连数据库）
-- 也要有一条带指纹的记录，管理员能在「操作监控 → 安全事件」里追溯。

CREATE TABLE IF NOT EXISTS public.bi_security_event (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  event_type    text NOT NULL,                    -- denied / rate_limited / suspicious / db_external_session …
  user_id       integer,
  username      text NOT NULL DEFAULT '',
  ip            text NOT NULL DEFAULT '',
  forwarded_for text NOT NULL DEFAULT '',
  user_agent    text NOT NULL DEFAULT '',
  device_id     text NOT NULL DEFAULT '',
  fingerprint   varchar(32) NOT NULL DEFAULT '',
  method        varchar(10) NOT NULL DEFAULT '',
  path          text NOT NULL DEFAULT '',
  status_code   integer NOT NULL DEFAULT 0,
  request_id    varchar(64) NOT NULL DEFAULT '',
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_security_event_created
  ON public.bi_security_event (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_event_ip
  ON public.bi_security_event (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_event_fp
  ON public.bi_security_event (fingerprint, created_at DESC);

COMMENT ON TABLE public.bi_security_event IS '安全事件：匿名/越权/扫描/限流/外部数据库会话，均带 IP + UA + 指纹';

-- 操作审计也带上指纹（log_audit 自动写入；老行留空）
ALTER TABLE public.bi_audit_logs
  ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '';
ALTER TABLE public.bi_audit_logs
  ADD COLUMN IF NOT EXISTS fingerprint varchar(32) NOT NULL DEFAULT '';
