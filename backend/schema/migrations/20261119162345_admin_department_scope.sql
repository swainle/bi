-- 部门级管理员范围（2026-11-14）
-- 规则：role=admin 时，按部门决定管理范围：
--   * 部门标记 is_global_admin=true（IT运维 / 股东高层）或没有部门 → 全后台；
--   * 其它部门管理员 → 只有「概览 / 用户管理 / 注册审批 / 角色权限」，且只能管本部门的人与申请。
-- 角色新增 dept_id：部门管理员创建的角色归本部门，只能改/删自己部门创建的角色，系统角色与全局角色只读。
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_global_admin boolean NOT NULL DEFAULT false;
ALTER TABLE roles       ADD COLUMN IF NOT EXISTS dept_id integer;

-- 现有两个「全后台」部门；其余保持 false
UPDATE departments SET is_global_admin = true
WHERE name IN ('IT运维', '股东高层') AND COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_roles_dept ON roles (dept_id);

COMMENT ON COLUMN departments.is_global_admin IS '该部门的管理员拥有整个管理后台（否则只能管本部门的用户/审批/角色）';
COMMENT ON COLUMN roles.dept_id IS '部门管理员自建的角色归属部门；NULL = 全局角色（由全局管理员维护）';
