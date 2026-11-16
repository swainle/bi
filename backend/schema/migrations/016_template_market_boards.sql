-- 模板库支持「看板分享」：模板带上完整看板文档 + 复制出来的数据集，并可按成员设置可见性
ALTER TABLE public.bi_template_market
    ADD COLUMN IF NOT EXISTS kind text DEFAULT 'engine',
    ADD COLUMN IF NOT EXISTS doc jsonb,
    ADD COLUMN IF NOT EXISTS dataset_ids jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS shared_user_ids jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_board_id integer;

-- 分类放开「通用」：从看板直接分享出来的模板不强制归到行业分类
ALTER TABLE public.bi_template_market
    DROP CONSTRAINT IF EXISTS bi_template_market_category_check;
ALTER TABLE public.bi_template_market
    ADD CONSTRAINT bi_template_market_category_check
    CHECK (category = ANY (ARRAY['拼多多'::text, '天猫'::text, '财务'::text, '产品部'::text, '通用'::text]));

-- 可见性过滤（按作者 / 公开 / 指定成员）
CREATE INDEX IF NOT EXISTS idx_bi_template_market_author
    ON public.bi_template_market (author_id);
