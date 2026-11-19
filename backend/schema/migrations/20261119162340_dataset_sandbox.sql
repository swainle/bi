-- 「测试数据集」页支持自建测试数据集（公共、跟随项目、管理员可建可删）
--   is_sandbox = true 的数据集：出现在「测试数据集」页，不进「数据集」页；owner 为 NULL（公共）
ALTER TABLE bi_dataset ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bi_dataset_sandbox ON bi_dataset (is_sandbox) WHERE is_sandbox;
