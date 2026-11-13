-- 需求端（天猫生意参谋）+ 看板 v2 所需的派生列（增量、幂等）

-- 1) 榜单端：给明细表搜索用的合并文本列（标题 / 品牌 / 榜单）
ALTER TABLE public.bi_rank_board
    ADD COLUMN IF NOT EXISTS search_text text
    GENERATED ALWAYS AS (
        coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(board, '')
    ) STORED;

-- 2) 需求端：搜索词（人气）
CREATE TABLE IF NOT EXISTS public.bi_demand_hot (
    id              serial PRIMARY KEY,
    word            varchar(200) NOT NULL,
    rank_no         integer,
    class_path      text DEFAULT '',
    cls_l1          varchar(80) DEFAULT '',
    cls_l2          varchar(80) DEFAULT '',
    cls_l3          varchar(80) DEFAULT '',
    v               numeric(14,2),          -- 搜索人气（区间中值）
    v_text          varchar(40) DEFAULT '', -- 原始区间文案 "4万 ~ 8万"
    ctr             numeric(10,4),          -- 点击率（小数，0.79 = 79%）
    cvr             numeric(10,2),          -- 支付转化率（百分数，32.5 = 32.5%）
    cvr_text        varchar(40) DEFAULT '', -- 原始区间文案 "30% ~ 35%"
    period_start    date,
    period_end      date,
    source_file     varchar(200) DEFAULT '',
    updated_at      timestamp without time zone NOT NULL DEFAULT now(),
    UNIQUE (word, period_start, period_end)
);

-- 3) 需求端：搜索词（增速）
CREATE TABLE IF NOT EXISTS public.bi_demand_grow (
    id              serial PRIMARY KEY,
    word            varchar(200) NOT NULL,
    rank_no         integer,
    class_path      text DEFAULT '',
    cls_l1          varchar(80) DEFAULT '',
    cls_l2          varchar(80) DEFAULT '',
    cls_l3          varchar(80) DEFAULT '',
    g               numeric(14,2),          -- 搜索增速（百分数，546 = +546%）
    v               numeric(14,2),
    v_text          varchar(40) DEFAULT '',
    ctr             numeric(10,4),
    cvr             numeric(10,2),
    cvr_text        varchar(40) DEFAULT '',
    period_start    date,
    period_end      date,
    source_file     varchar(200) DEFAULT '',
    updated_at      timestamp without time zone NOT NULL DEFAULT now(),
    UNIQUE (word, period_start, period_end)
);

-- 4) 需求端：相关搜索词（相关分析 · 环比）
CREATE TABLE IF NOT EXISTS public.bi_demand_rel (
    id              serial PRIMARY KEY,
    word            varchar(200) NOT NULL,
    v               numeric(14,2),
    v_text          varchar(40) DEFAULT '',
    ctr             numeric(10,4),
    cvr             numeric(10,2),
    cvr_text        varchar(40) DEFAULT '',
    buy             numeric(14,2),          -- 支付买家数（区间中值）
    buy_text        varchar(40) DEFAULT '',
    ds              numeric(14,2),          -- 需求供给比
    tm              numeric(10,6),          -- 天猫商品点击占比（小数）
    period_start    date,
    period_end      date,
    source_file     varchar(200) DEFAULT '',
    updated_at      timestamp without time zone NOT NULL DEFAULT now(),
    UNIQUE (word, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_demand_hot_word  ON public.bi_demand_hot (word);
CREATE INDEX IF NOT EXISTS idx_demand_grow_word ON public.bi_demand_grow (word);
CREATE INDEX IF NOT EXISTS idx_demand_rel_word  ON public.bi_demand_rel (word);
CREATE INDEX IF NOT EXISTS idx_demand_hot_v     ON public.bi_demand_hot (v DESC);
CREATE INDEX IF NOT EXISTS idx_demand_grow_g    ON public.bi_demand_grow (g DESC);

-- 5) 需求端合并视图：三表按词去重，字段互补，来源标记（人气·增速·相关）
CREATE OR REPLACE VIEW public.bi_demand_merged AS
WITH unioned AS (
    SELECT word, v, ctr, cvr, NULL::numeric AS g, NULL::numeric AS ds,
           NULL::numeric AS buy, NULL::numeric AS tm, '人气'::text AS src
      FROM public.bi_demand_hot
    UNION ALL
    SELECT word, v, ctr, cvr, g, NULL::numeric, NULL::numeric, NULL::numeric, '增速'
      FROM public.bi_demand_grow
    UNION ALL
    SELECT word, v, ctr, cvr, NULL::numeric, ds, buy, tm, '相关'
      FROM public.bi_demand_rel
)
SELECT
    word,
    max(v)   AS v,
    max(ctr) AS ctr,
    max(cvr) AS cvr,
    max(g)   AS g,
    max(ds)  AS ds,
    max(buy) AS buy,
    max(tm)  AS tm,
    array_to_string(
        array_remove(ARRAY[
            CASE WHEN bool_or(src = '人气') THEN '人气' END,
            CASE WHEN bool_or(src = '增速') THEN '增速' END,
            CASE WHEN bool_or(src = '相关') THEN '相关' END
        ], NULL), '·') AS sources,
    word AS search_text
FROM unioned
GROUP BY word;
