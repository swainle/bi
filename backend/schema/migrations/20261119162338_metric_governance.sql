-- 029_metric_governance.sql
-- 语义治理：指标认证状态、版本历史（P4）
--
-- 为什么需要：
--   指标口径被改过之后，看板上的数字会静默变化，但没人知道改了什么、谁改的、影响哪些卡片。
--   这里给指标加「认证」标记 + 每次口径变更留一版快照，配合账本（bi_dash_item_source）做影响分析。

ALTER TABLE bi_dataset_metric
    ADD COLUMN IF NOT EXISTS certified    boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS certified_by integer,
    ADD COLUMN IF NOT EXISTS certified_at timestamp without time zone,
    ADD COLUMN IF NOT EXISTS version      integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN bi_dataset_metric.certified IS '是否已认证（口径确认过的指标）';
COMMENT ON COLUMN bi_dataset_metric.version   IS '口径版本号（每次表达式 / 格式变更 +1）';

CREATE TABLE IF NOT EXISTS bi_metric_version (
    id              serial PRIMARY KEY,
    metric_id       integer NOT NULL REFERENCES bi_dataset_metric(id) ON DELETE CASCADE,
    dataset_id      integer NOT NULL,
    version         integer NOT NULL,
    name            varchar(120) NOT NULL,
    expression      text         NOT NULL,
    format          varchar(16)  NOT NULL DEFAULT 'number',
    description     text         NOT NULL DEFAULT '',
    changed_by      integer,
    changed_by_name varchar(80)  NOT NULL DEFAULT '',
    changed_at      timestamp without time zone NOT NULL DEFAULT now(),
    note            varchar(200) NOT NULL DEFAULT '',
    UNIQUE (metric_id, version)
);

CREATE INDEX IF NOT EXISTS idx_bi_metric_version_metric
    ON bi_metric_version (metric_id, version DESC);
