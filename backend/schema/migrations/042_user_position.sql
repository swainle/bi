-- 用户属性拆分（2026-11-14）：权限（账号类型）/ 职位 / 部门
-- users.role 仍作为权限载体（角色权限页维护），但用户管理界面按 权限 + 职位 展示与编辑。
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS position text NOT NULL DEFAULT 'member';

UPDATE users SET account_type = 'admin' WHERE role IN ('admin', 'super_admin');
UPDATE users SET position = 'director' WHERE account_type = 'admin';
UPDATE users SET position = 'supervisor' WHERE role = 'manager' AND account_type = 'user';

-- 部门经理 / 部门总监 两个岗位角色（权限先与部门主管一致，可在角色权限页调整）
INSERT INTO roles (name, code, description, is_system, data_scope)
SELECT '部门经理', 'dept_manager', '部门经理：审批与数据范围为部门及下级', true, 'dept_and_children'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'dept_manager');

INSERT INTO roles (name, code, description, is_system, data_scope)
SELECT '部门总监', 'director', '部门总监：审批与数据范围为部门及下级', true, 'dept_and_children'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'director');

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, rp.permission_code
FROM roles r
JOIN roles m ON m.code = 'manager'
JOIN role_permission rp ON rp.role_id = m.id
WHERE r.code IN ('dept_manager', 'director')
  AND NOT EXISTS (
    SELECT 1 FROM role_permission x WHERE x.role_id = r.id AND x.permission_code = rp.permission_code
  );

COMMENT ON COLUMN users.account_type IS '权限/账号类型：admin 管理员 / user 普通用户';
COMMENT ON COLUMN users.position IS '职位：member 普通成员 / supervisor 部门主管 / manager 部门经理 / director 部门总监';
