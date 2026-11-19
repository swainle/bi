-- 按 dt 增量同步（方案 A）：
--   1) 已接入表记录日期范围，界面能看出「历史到哪一天」
--   2) 数据源可带一条远端刷新语句（如 select dm.refresh_bangdan()），同步前先执行
ALTER TABLE public.bi_source       ADD COLUMN IF NOT EXISTS refresh_sql text NOT NULL DEFAULT '';

ALTER TABLE public.bi_source_table ADD COLUMN IF NOT EXISTS dt_min    date;
ALTER TABLE public.bi_source_table ADD COLUMN IF NOT EXISTS dt_max    date;
ALTER TABLE public.bi_source_table ADD COLUMN IF NOT EXISTS dt_count  integer NOT NULL DEFAULT 0;
