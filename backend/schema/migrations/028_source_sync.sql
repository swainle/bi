-- 028_source_sync.sql
-- 已接入表的定时同步与最近一次同步结果（P4：数据新鲜度 / 定时同步）
--
-- 口径：
--   sync_interval_minutes = 0 表示不自动同步；>0 时后台线程按「synced_at + 间隔」判断到期；
--   last_sync_status 区分手动 / 自动最近一次是成功还是失败，失败原因留在 last_sync_error。

ALTER TABLE bi_source_table
    ADD COLUMN IF NOT EXISTS sync_interval_minutes integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_sync_status      varchar(16),
    ADD COLUMN IF NOT EXISTS last_sync_error       text;

COMMENT ON COLUMN bi_source_table.sync_interval_minutes IS '自动同步间隔（分钟，0 = 关闭）';
COMMENT ON COLUMN bi_source_table.last_sync_status      IS '最近一次同步结果：ok / failed';
COMMENT ON COLUMN bi_source_table.last_sync_error       IS '最近一次同步失败原因（截断 300 字）';

-- 调度扫描：只看到期且有数据源的表
CREATE INDEX IF NOT EXISTS idx_bi_source_table_due
    ON bi_source_table (synced_at)
    WHERE sync_interval_minutes > 0 AND kind = 'db';
