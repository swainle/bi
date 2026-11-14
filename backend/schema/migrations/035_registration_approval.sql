-- 注册审批（2026-11-14）
-- 背景：注册时可以直接选「股东高层」，账号建好就能看核心数据 —— 有数据泄露风险。
-- 改为：注册只提交申请（pending，不能登录），由管理员或该部门负责人审批通过后才可用。
ALTER TABLE users       ADD COLUMN IF NOT EXISTS approval_status  varchar(20)  NOT NULL DEFAULT 'approved';
ALTER TABLE users       ADD COLUMN IF NOT EXISTS approved_by      integer;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS approved_at      timestamp;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS reject_reason    varchar(200);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS leader_id        integer;

-- 历史账号一律视为已通过（本功能上线前注册/创建的都是正式账号）
UPDATE users SET approval_status = 'approved' WHERE approval_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_approval_status
    ON users (approval_status, created_at DESC);

COMMENT ON COLUMN users.approval_status IS 'pending=待审批 / approved=已通过 / rejected=已驳回';
COMMENT ON COLUMN departments.leader_id IS '部门负责人：可审批本部门的注册申请（管理员始终可审批）';
