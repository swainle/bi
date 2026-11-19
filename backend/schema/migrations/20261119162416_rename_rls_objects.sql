-- 项目英文名 MingzeBI → MingceBI：S6 的 RLS 只读角色与策略一并改名
--
-- 背景：2026-11-16 项目英文名统一改为 MingceBI，代码里的 ROLE / POLICY 常量已改成 mcbi_*。
-- 旧库（改名之前建的）里还有 mzbi_rls / mzbi_dept_scope，这里就地改名，**不删表、不删策略、不动数据**。
-- 幂等：目标已存在则跳过；本地新库没有这些对象时整段是空操作。

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mzbi_rls')
       AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcbi_rls') THEN
        ALTER ROLE mzbi_rls RENAME TO mcbi_rls;
    END IF;
END $$;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT schemaname, tablename
        FROM pg_policies
        WHERE policyname = 'mzbi_dept_scope'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = r.schemaname
              AND tablename = r.tablename
              AND policyname = 'mcbi_dept_scope'
        ) THEN
            EXECUTE format(
                'ALTER POLICY %I ON %I.%I RENAME TO mcbi_dept_scope',
                'mzbi_dept_scope', r.schemaname, r.tablename
            );
        END IF;
    END LOOP;
END $$;
