-- 组件库收敛：只保留「类型级」基础组件，业务变体归档（不删除）
ALTER TABLE public.bi_component
    ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bi_component_archived ON public.bi_component (archived);
