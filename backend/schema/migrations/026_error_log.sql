-- 错误日志：前端 ErrorBoundary / 全局 JS 错误 + 后端未处理异常
CREATE TABLE IF NOT EXISTS public.bi_error_log (
    id          bigserial PRIMARY KEY,
    source      varchar(20)  NOT NULL DEFAULT 'frontend',
    level       varchar(16)  NOT NULL DEFAULT 'error',
    message     text         NOT NULL DEFAULT '',
    stack       text         NOT NULL DEFAULT '',
    url         varchar(1000) NOT NULL DEFAULT '',
    user_id     integer,
    username    varchar(120) NOT NULL DEFAULT '',
    user_agent  varchar(500) NOT NULL DEFAULT '',
    extra       jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_error_log_created ON public.bi_error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_error_log_source ON public.bi_error_log (source, created_at DESC);
