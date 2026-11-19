-- 看板软删除：「我的看板」里删除后不再出现在列表，种子看板也不会被启动初始化重新塞回来
-- 只加列，不改动已有数据；deleted_at IS NULL 即未删除。

ALTER TABLE public.bi_canvas
    ADD COLUMN IF NOT EXISTS deleted_at timestamp without time zone;

CREATE INDEX IF NOT EXISTS idx_bi_canvas_live
    ON public.bi_canvas (updated_at DESC)
    WHERE deleted_at IS NULL;
