-- 组件库 + 榜单端数据源（增量、幂等、不动已有表）

-- 1) 组件定义：一个组件 = 图表类型 + 数据绑定 + 计算规则 + UI 样式
CREATE TABLE IF NOT EXISTS public.bi_component (
    id              serial PRIMARY KEY,
    code            varchar(64) NOT NULL UNIQUE,   -- 稳定标识（内置组件用它做幂等种子）
    name            varchar(120) NOT NULL,
    category        varchar(32) NOT NULL DEFAULT '通用',
    kind            varchar(32) NOT NULL,          -- kpi / bar / heatmap / wordcloud / table / line
    description     text DEFAULT '',
    spec            jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_builtin      boolean NOT NULL DEFAULT false,
    owner_id        integer,
    created_at      timestamp without time zone NOT NULL DEFAULT now(),
    updated_at      timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_component_kind ON public.bi_component (kind);
CREATE INDEX IF NOT EXISTS idx_bi_component_cat  ON public.bi_component (category);

-- 2) 榜单端数据（来自「市场部BI看板模板」榜单端三份 CSV）
CREATE TABLE IF NOT EXISTS public.bi_rank_board (
    id              serial PRIMARY KEY,
    link_id         varchar(32) NOT NULL UNIQUE,
    title           text NOT NULL,
    platform        varchar(16) NOT NULL,
    brand           varchar(64) DEFAULT '',
    category        varchar(64) DEFAULT '',
    board           varchar(120) DEFAULT '',
    listed_date     date,
    band            varchar(32) DEFAULT '',
    price           numeric(12,2),
    sales           integer DEFAULT 0,
    sales_raw       varchar(16) DEFAULT '',
    rank            integer DEFAULT 0,
    heat            integer DEFAULT 0,
    days_on_board   integer DEFAULT 0,
    days_listed     integer DEFAULT 0,
    neg             integer DEFAULT 0,
    url             text DEFAULT '',
    main_sell       text DEFAULT '',
    sub_sell        text DEFAULT '',
    pain            text DEFAULT '',
    is_real         boolean NOT NULL DEFAULT false,
    source_file     varchar(200) DEFAULT '',
    updated_at      timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_rank_board_platform ON public.bi_rank_board (platform);
CREATE INDEX IF NOT EXISTS idx_bi_rank_board_board    ON public.bi_rank_board (board);
CREATE INDEX IF NOT EXISTS idx_bi_rank_board_sales    ON public.bi_rank_board (sales DESC);
