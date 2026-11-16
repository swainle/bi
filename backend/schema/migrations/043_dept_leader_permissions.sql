-- 部门领导 = 本部门的管理者（2026-11-14）
-- 原则：管理员管系统级（模型/错误/运维/部门树）；部门领导管本部门（用户/角色权限/审批/概览）。
-- 数据范围仍是 dept_and_children，所以只能作用于自己部门及下级。
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
JOIN (VALUES ('bi:overview'), ('bi:user:manage'), ('bi:user:approve'), ('bi:role:manage')) AS p(code) ON true
WHERE r.code IN ('manager', 'dept_manager', 'director')
  AND NOT EXISTS (
    SELECT 1 FROM role_permission rp
    WHERE rp.role_id = r.id AND rp.permission_code = p.code
  );
