-- 删除「IT运维」角色（2026-11-14）：IT运维是部门，不是角色。
-- 角色只保留岗位级：管理员 / 部门主管 / 普通成员 / 访客。
DELETE FROM role_permission WHERE role_id IN (SELECT id FROM roles WHERE code = 'it_ops');
DELETE FROM roles WHERE code = 'it_ops';

-- 「入职默认角色」与部门绑定也一并移除：新注册账号统一为普通成员，需要 SQL 等入口由角色权限分配。
ALTER TABLE departments DROP COLUMN IF EXISTS default_role_code;
