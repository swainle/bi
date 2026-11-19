-- 027_source_schema.sql
-- 已接入表的结构快照与漂移记录（P4：schema 批量刷新 / 数据新鲜度）
--
-- 为什么要有快照：
--   源表加列 / 删列 / 改类型时，本地物理表不会自动变，图表会静默出错（查不到列 / 类型不匹配）。
--   接入时留一份字段快照，之后「检查结构」只需对比远端的字段清单即可提前发现。

ALTER TABLE bi_source_table
    ADD COLUMN IF NOT EXISTS columns_snapshot jsonb,
    ADD COLUMN IF NOT EXISTS schema_hash      varchar(16),
    ADD COLUMN IF NOT EXISTS checked_at       timestamp without time zone,
    ADD COLUMN IF NOT EXISTS drift            jsonb;

COMMENT ON COLUMN bi_source_table.columns_snapshot IS '上次同步成功时的字段快照 [{name,type}]';
COMMENT ON COLUMN bi_source_table.schema_hash      IS '字段快照的指纹（sha1 前 16 位）';
COMMENT ON COLUMN bi_source_table.checked_at       IS '上次结构检查时间';
COMMENT ON COLUMN bi_source_table.drift            IS '最近一次检查发现的字段变更 {added,removed,changed}；无变更为 NULL';
