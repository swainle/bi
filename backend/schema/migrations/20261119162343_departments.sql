-- 部门初始清单（注册时必选；管理后台「用户管理 · 部门管理」可继续增删改名）
-- 只在部门表还是空的时候灌一次，之后用户的增删改都不会被覆盖。
INSERT INTO departments (name, sort_order, is_deleted, created_at)
SELECT v.name, v.sort_order, false, now()
FROM (VALUES
    ('拼多多部门', 10),
    ('天猫部门', 20),
    ('客服部门', 30),
    ('财务部门', 40),
    ('人事部门', 50),
    ('产品部门', 60),
    ('市场部门', 70),
    ('供应链部门', 80),
    ('品牌部门', 90),
    ('AI部门', 100),
    ('股东高层', 110)
) AS v(name, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM departments WHERE COALESCE(is_deleted, false) = false
);
