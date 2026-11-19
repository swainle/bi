-- 部门默认角色（2026-11-14）：新注册账号自动获得该角色
-- 权限只存在角色上；部门只负责「入职默认给哪个角色」，避免权限两处配置。
ALTER TABLE departments ADD COLUMN IF NOT EXISTS default_role_code text;

UPDATE departments
SET default_role_code = 'it_ops'
WHERE name = 'IT运维' AND COALESCE(is_deleted, false) = false;

COMMENT ON COLUMN departments.default_role_code IS '新注册/新入职默认角色 code（权限仍由角色决定）';
