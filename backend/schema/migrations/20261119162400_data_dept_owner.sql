-- 数据归属部门（2026-11-14）：数据源 / 数据集新建时可选「部门」
-- 用途：数据管理列表按部门可见；AI / MCP 取数时按部门判定是否放行。
-- NULL = 全局（所有人可见），与存量数据行为一致。

ALTER TABLE public.bi_dataset ADD COLUMN IF NOT EXISTS dept_id integer;
ALTER TABLE public.bi_source  ADD COLUMN IF NOT EXISTS dept_id integer;

CREATE INDEX IF NOT EXISTS idx_bi_dataset_dept ON public.bi_dataset (dept_id);
CREATE INDEX IF NOT EXISTS idx_bi_source_dept  ON public.bi_source (dept_id);

COMMENT ON COLUMN public.bi_dataset.dept_id IS '归属部门；NULL = 全局。用于列表可见性与取数权限';
COMMENT ON COLUMN public.bi_source.dept_id  IS '归属部门；NULL = 全局';
