-- 数据源（Superset 的 Database 层）：连接配置持久化，密码加密存储
-- 链路：数据源 → 选表同步成本地物理表 → 数据集 → 图表

CREATE TABLE IF NOT EXISTS public.bi_source (
    id          serial PRIMARY KEY,
    name        varchar(120) NOT NULL,
    ds_type     varchar(32)  NOT NULL,
    host        varchar(200) NOT NULL DEFAULT '',
    port        integer,
    db_name     varchar(120) NOT NULL DEFAULT '',
    username    varchar(120) NOT NULL DEFAULT '',
    password    text         NOT NULL DEFAULT '',
    uri         text         NOT NULL DEFAULT '',
    owner_id    integer,
    created_at  timestamp without time zone NOT NULL DEFAULT now(),
    updated_at  timestamp without time zone NOT NULL DEFAULT now()
);

-- 已接入的物理表：源库表 / 上传文件 → 本地物理表（数据集从这里选表）
CREATE TABLE IF NOT EXISTS public.bi_source_table (
    id           serial PRIMARY KEY,
    source_id    integer,
    source_table varchar(200) NOT NULL,
    local_table  varchar(120) NOT NULL UNIQUE,
    row_count    integer NOT NULL DEFAULT 0,
    kind         varchar(16) NOT NULL DEFAULT 'db',
    owner_id     integer,
    synced_at    timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_source_table_src ON public.bi_source_table (source_id);

-- 自定义 SQL 数据集（Superset 的 virtual dataset：关联 / 清洗 / 计算都写在 SQL 里）
ALTER TABLE public.bi_dataset ADD COLUMN IF NOT EXISTS sql_text text;
