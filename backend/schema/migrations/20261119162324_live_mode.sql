-- 双轨取数：数据集可选「抽取(extract)」或「直连(live)」
--   extract: 图表查询读本地物理表（默认，安全内核全生效）
--   live   : 图表查询直接打到源库（Superset 式），需绑定 source_id
ALTER TABLE public.bi_dataset ADD COLUMN IF NOT EXISTS conn_mode varchar(8) NOT NULL DEFAULT 'extract';
ALTER TABLE public.bi_dataset ADD COLUMN IF NOT EXISTS source_id integer;

CREATE INDEX IF NOT EXISTS idx_bi_dataset_source ON public.bi_dataset (source_id);
