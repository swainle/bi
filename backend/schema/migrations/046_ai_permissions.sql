-- AI 能力权限码（2026-11-14，S0）
-- 背景：/api/bi/engine/ai/* 此前多数端点连登录都不需要，任何人不登录即可调用。
-- 本次一次性补齐「登录 + 权限码」，并回填现有角色以保持现有功能不中断。

INSERT INTO permissions (code, name, "group") VALUES
  ('bi:ai:use',    'AI 分析',    'AI 能力'),
  ('bi:ai:sql',    'AI 生成 SQL', 'AI 能力'),
  ('bi:ai:export', 'AI 导出',    'AI 能力')
ON CONFLICT (code) DO NOTHING;

-- 回填 1：除访客外，现有角色保留「AI 分析」（此前对全部登录用户开放）
-- 管理员不受影响（is_admin 直通）；管理层可随时在「角色权限」里撤销
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'bi:ai:use' FROM roles r WHERE r.code <> 'viewer'
ON CONFLICT DO NOTHING;

-- 回填 2：已经有 SQL 入口的角色同时拿到「AI 生成 SQL」（其余默认关闭，高危）
INSERT INTO role_permission (role_id, permission_code)
SELECT rp.role_id, 'bi:ai:sql'
FROM role_permission rp
WHERE rp.permission_code = 'bi:nav:sql'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE permissions IS '权限码定义表：管理后台分区 / 业务入口 / AI 能力';
