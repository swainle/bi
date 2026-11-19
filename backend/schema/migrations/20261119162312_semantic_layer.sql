-- 语义层三表：数据集 / 字段 / 指标
-- 增量迁移，幂等；不触碰任何已有表

CREATE TABLE IF NOT EXISTS public.bi_dataset (
    id              serial PRIMARY KEY,
    name            varchar(120) NOT NULL UNIQUE,
    physical_table  varchar(120) NOT NULL,
    description     text DEFAULT '',
    owner_id        integer,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamp without time zone NOT NULL DEFAULT now(),
    updated_at      timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_dataset_table ON public.bi_dataset (physical_table);

CREATE TABLE IF NOT EXISTS public.bi_dataset_field (
    id              serial PRIMARY KEY,
    dataset_id      integer NOT NULL REFERENCES public.bi_dataset(id) ON DELETE CASCADE,
    name            varchar(120) NOT NULL,
    source_column   varchar(120) NOT NULL,
    role            varchar(16) NOT NULL DEFAULT 'dimension',
    data_type       varchar(32) DEFAULT 'text',
    is_filterable   boolean NOT NULL DEFAULT true,
    is_groupable    boolean NOT NULL DEFAULT true,
    default_grain   varchar(16),
    description     text DEFAULT '',
    UNIQUE (dataset_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bi_dataset_field_ds ON public.bi_dataset_field (dataset_id);

CREATE TABLE IF NOT EXISTS public.bi_dataset_metric (
    id              serial PRIMARY KEY,
    dataset_id      integer NOT NULL REFERENCES public.bi_dataset(id) ON DELETE CASCADE,
    name            varchar(120) NOT NULL,
    expression      text NOT NULL,
    format          varchar(16) DEFAULT 'number',
    description     text DEFAULT '',
    UNIQUE (dataset_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bi_dataset_metric_ds ON public.bi_dataset_metric (dataset_id);
