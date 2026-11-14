-- 注册审批范围（2026-11-14）
-- 规则：注册填的哪个部门，由该部门「主管级别以上」（role=manager/admin/super_admin）
-- 或该部门负责人审批；跨部门不可审批。
-- 特例：股东高层部门的主管以上可审批所有部门 —— 用部门标记控制，避免写死部门名。
ALTER TABLE departments ADD COLUMN IF NOT EXISTS approves_all_registrations boolean NOT NULL DEFAULT false;

UPDATE departments
SET approves_all_registrations = true
WHERE name = '股东高层' AND COALESCE(is_deleted, false) = false;

COMMENT ON COLUMN departments.approves_all_registrations IS '该部门主管级以上可审批所有部门的注册申请（股东高层）';
