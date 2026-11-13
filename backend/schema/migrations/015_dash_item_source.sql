-- 组件 → 数据源账本：每个页面元素用了哪些数据集，落成可查询的行（不再只埋在 doc JSON 里）
-- 每次保存 / 发布按文档整体重建；dashboard_id + view_key + item_key 就是「看板 › 页面 ID › 元素 ID」。
-- dataset_id 非空：只有真正取数的元素才记；一个元素绑多个数据集（比如筛选栏的平台映射）会有多行。

CREATE TABLE IF NOT EXISTS public.bi_dash_item_source (
    dashboard_id integer NOT NULL,
    view_key     varchar(120) NOT NULL,
    item_key     varchar(120) NOT NULL,
    item_kind    varchar(32)  NOT NULL DEFAULT '',
    item_type    varchar(16)  NOT NULL DEFAULT 'chart',
    dataset_id   integer      NOT NULL,
    role         varchar(40)  NOT NULL DEFAULT 'primary',
    metric       varchar(120) NOT NULL DEFAULT '',
    dimension    varchar(200) NOT NULL DEFAULT '',
    updated_at   timestamp without time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (dashboard_id, view_key, item_key, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_dash_item_source_dataset
    ON public.bi_dash_item_source (dataset_id);

CREATE INDEX IF NOT EXISTS idx_dash_item_source_dash
    ON public.bi_dash_item_source (dashboard_id, view_key);
