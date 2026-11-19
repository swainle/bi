-- 看板文档 v2：把「组件库 + 页面参数 + 视图 + 动作」存进 bi_canvas.doc
-- 旧画布（layout 数组）保持原样，向后兼容。

ALTER TABLE public.bi_canvas
    ADD COLUMN IF NOT EXISTS doc jsonb;

ALTER TABLE public.bi_canvas
    ADD COLUMN IF NOT EXISTS code varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_canvas_code
    ON public.bi_canvas (code) WHERE code IS NOT NULL;
