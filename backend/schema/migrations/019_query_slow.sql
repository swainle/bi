-- 慢查询采样（查询治理第二批）
-- 只落超过阈值的查询（BI_SLOW_SAMPLE_MS，默认 1000ms），SQL 截断存储；由后台线程批量写入。
CREATE TABLE IF NOT EXISTS public.bi_query_slow (
    id          bigserial PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now(),
    user_id     integer,
    table_name  varchar(200),
    elapsed_ms  numeric(10, 1) NOT NULL,
    source      varchar(20) NOT NULL DEFAULT 'internal',
    sql_text    text
);

CREATE INDEX IF NOT EXISTS idx_bi_query_slow_created
    ON public.bi_query_slow (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_query_slow_user
    ON public.bi_query_slow (user_id, created_at DESC);
