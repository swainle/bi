-- 演示数据集（bi_demo_sku）的内容指纹：CSV 一改就整表重刷，不再靠「行数 + 产品 id」猜
CREATE TABLE IF NOT EXISTS bi_demo_meta (
    key        varchar(64) PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamp without time zone NOT NULL DEFAULT now()
);
