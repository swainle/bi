-- 部门默认业务入口（2026-11-14）
-- 用途：某些部门默认就开放某个入口，例如 IT运维 默认开 SQL 查询；
-- 只允许业务入口类权限（bi:nav:*），不会授予管理后台权限。
ALTER TABLE departments ADD COLUMN IF NOT EXISTS default_permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE departments
SET default_permissions = '["bi:nav:sql"]'::jsonb
WHERE name = 'IT运维' AND COALESCE(is_deleted, false) = false;

COMMENT ON COLUMN departments.default_permissions IS '部门默认业务入口（仅 bi:nav:*，与角色权限取并集）';
