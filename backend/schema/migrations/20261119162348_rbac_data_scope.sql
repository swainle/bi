-- 规范化权限模型（2026-11-14）：RBAC + 数据范围 + 部门树
-- 角色 = 功能权限（permissions）+ 数据范围（data_scope）
-- data_scope: all 全部部门 / dept_and_children 本部门及下级 / dept 本部门 / self 本人
ALTER TABLE roles ADD COLUMN IF NOT EXISTS data_scope text NOT NULL DEFAULT 'dept';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_id integer;

-- 内置角色数据范围
UPDATE roles SET data_scope = 'all'  WHERE code IN ('admin', 'super_admin');
UPDATE roles SET data_scope = 'dept_and_children' WHERE code = 'manager';
UPDATE roles SET data_scope = 'self' WHERE code IN ('member', 'viewer');

-- 部门主管 = 有审批权限 + 本部门及下级（不再靠「主管角色自动审批」的隐式逻辑）
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'bi:user:approve'
FROM roles r
WHERE r.code = 'manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp
    WHERE rp.role_id = r.id AND rp.permission_code = 'bi:user:approve'
  );

COMMENT ON COLUMN roles.data_scope IS '数据范围：all 全部 / dept_and_children 本部门及下级 / dept 本部门 / self 本人';
COMMENT ON COLUMN departments.parent_id IS '上级部门；NULL = 一级部门';
