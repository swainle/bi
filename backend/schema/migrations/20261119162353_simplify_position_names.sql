-- 职位名称精简（2026-11-14）：员工 / 主管 / 经理 / 总监
UPDATE roles SET name = '员工', description = '员工：默认只读看板' WHERE code = 'member';
UPDATE roles SET name = '主管', description = '主管：管本部门用户、角色与审批' WHERE code = 'manager';
UPDATE roles SET name = '经理', description = '经理：管本部门及下级的用户、角色与审批' WHERE code = 'dept_manager';
UPDATE roles SET name = '总监', description = '总监：管本部门及下级的用户、角色与审批' WHERE code = 'director';
