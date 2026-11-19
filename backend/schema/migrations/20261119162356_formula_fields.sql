-- 公式只保存定义，查询时计算，不修改源表。
ALTER TABLE public.bi_dataset_field
    ADD COLUMN IF NOT EXISTS expression text NOT NULL DEFAULT '';
