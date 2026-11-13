-- 画布 → 看板发布：记录画布对应的看板 id
ALTER TABLE public.bi_canvas
    ADD COLUMN IF NOT EXISTS dashboard_id integer;

CREATE INDEX IF NOT EXISTS idx_bi_canvas_dashboard ON public.bi_canvas (dashboard_id);
