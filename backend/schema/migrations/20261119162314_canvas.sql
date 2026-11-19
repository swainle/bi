-- 看板画布：一张画布 = 多个组件卡片 + 各自位置尺寸

CREATE TABLE IF NOT EXISTS public.bi_canvas (
    id          serial PRIMARY KEY,
    name        varchar(120) NOT NULL DEFAULT '未命名画布',
    owner_id    integer,
    layout      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamp without time zone NOT NULL DEFAULT now(),
    updated_at  timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_canvas_owner ON public.bi_canvas (owner_id);
