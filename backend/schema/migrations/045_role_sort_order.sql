-- 角色按职级排序（2026-11-14）：管理员 → 总监 → 经理 → 主管 → 员工 → 访客
ALTER TABLE roles ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

UPDATE roles SET sort_order = 100 WHERE code IN ('admin', 'super_admin');
UPDATE roles SET sort_order = 90  WHERE code = 'director';
UPDATE roles SET sort_order = 80  WHERE code = 'dept_manager';
UPDATE roles SET sort_order = 70  WHERE code = 'manager';
UPDATE roles SET sort_order = 60  WHERE code = 'member';
UPDATE roles SET sort_order = 50  WHERE code = 'viewer';

COMMENT ON COLUMN roles.sort_order IS '职级排序（越大越高）：管理员100/总监90/经理80/主管70/员工60/访客50';
