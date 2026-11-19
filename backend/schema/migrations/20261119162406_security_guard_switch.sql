-- 安全卫士开关（2026-11-14）
-- 目的：管理员可在「操作监控 → 安全卫士」里直接启停，无需改环境变量、无需重启。
-- 生效优先级：数据库设置 > 环境变量 BI_GUARD_ENABLED（默认 1）。

CREATE TABLE IF NOT EXISTS public.bi_app_setting (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_by  integer,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bi_app_setting IS '运行时开关（键值）；目前用于安全卫士启停';
