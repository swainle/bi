-- 安全卫士（S7 三期，2026-11-14）
-- 目的：把「攻击型 / 跨权限 / 扫描」从「只记录」升级为「自动封禁」。
-- 命中窗口内累计到阈值后，按 IP / 浏览器指纹 / 账号 三个维度临时封禁，管理员可解封。

CREATE TABLE IF NOT EXISTS public.bi_guard_hit (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  event_type  text NOT NULL,
  ip          text NOT NULL DEFAULT '',
  fingerprint varchar(32) NOT NULL DEFAULT '',
  user_id     integer
);
CREATE INDEX IF NOT EXISTS idx_guard_hit_created ON public.bi_guard_hit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guard_hit_ip ON public.bi_guard_hit (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guard_hit_fp ON public.bi_guard_hit (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guard_hit_user ON public.bi_guard_hit (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bi_security_block (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  dimension   text NOT NULL CHECK (dimension IN ('ip', 'fingerprint', 'user')),
  value       text NOT NULL,
  reason      text NOT NULL DEFAULT '',
  hits        integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  created_by  integer,
  released_at timestamptz,
  released_by integer
);
CREATE INDEX IF NOT EXISTS idx_security_block_active
  ON public.bi_security_block (dimension, value, expires_at);

COMMENT ON TABLE public.bi_security_block IS '安全卫士封禁：维度 ip/fingerprint/user，到期自动失效，可人工解封';
COMMENT ON TABLE public.bi_guard_hit IS '安全卫士命中流水：窗口内累计到阈值触发封禁，定期清理';
