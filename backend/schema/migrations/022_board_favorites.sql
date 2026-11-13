-- P2 交互分析：收藏视图（看板 + 视图 + 当前筛选参数，按用户个人保存）

CREATE TABLE IF NOT EXISTS public.bi_board_favorite (
    id           bigserial PRIMARY KEY,
    dashboard_id integer NOT NULL REFERENCES public.bi_canvas (id) ON DELETE CASCADE,
    name         varchar(80) NOT NULL,
    view_key     varchar(80) NOT NULL DEFAULT '',
    params       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by   integer,
    created_at   timestamp without time zone NOT NULL DEFAULT now(),
    updated_at   timestamp without time zone NOT NULL DEFAULT now(),
    UNIQUE (dashboard_id, created_by, name)
);

CREATE INDEX IF NOT EXISTS idx_bi_board_favorite_owner
    ON public.bi_board_favorite (dashboard_id, created_by, updated_at DESC);
