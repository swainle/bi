-- 030_dataset_security.sql
-- 数据集级行列权限（P4）
--
-- 与既有 bi_row_permissions / bi_column_masks 的关系：
--   那两张表按「物理表名」配，跟数据集没有直接关系；模板复制会把数据搬到新表（bi_tpl_…），
--   规则就跟着丢了。这里改成按 dataset_id 配，复制数据集时整组规则一起复制。
-- 生效顺序：
--   行级 —— 表级规则（bi_row_permissions）与数据集规则同时 AND 进 WHERE；
--   列级 —— 先套表级脱敏，再套数据集脱敏（同一列以数据集规则为准）。

CREATE TABLE IF NOT EXISTS bi_dataset_row_rule (
    id          serial PRIMARY KEY,
    dataset_id  integer NOT NULL REFERENCES bi_dataset(id) ON DELETE CASCADE,
    user_id     integer REFERENCES users(id) ON DELETE CASCADE,
    role_name   varchar(64),
    filter_rule text    NOT NULL,
    note        varchar(200) NOT NULL DEFAULT '',
    created_by  integer,
    created_at  timestamp without time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE bi_dataset_row_rule IS '数据集行级规则：user_id 精确到人，role_name 精确到角色（两者都空 = 所有人）';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_dataset_row_rule
    ON bi_dataset_row_rule (dataset_id, COALESCE(user_id, 0), COALESCE(role_name, ''));

CREATE TABLE IF NOT EXISTS bi_dataset_column_mask (
    id           serial PRIMARY KEY,
    dataset_id   integer NOT NULL REFERENCES bi_dataset(id) ON DELETE CASCADE,
    column_name  varchar(120) NOT NULL,
    mask_type    varchar(16)  NOT NULL,
    mask_pattern text         NOT NULL DEFAULT '',
    created_by   integer,
    created_at   timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT bi_dataset_column_mask_type_check
        CHECK (mask_type IN ('phone', 'id_card', 'email', 'custom'))
);

COMMENT ON TABLE bi_dataset_column_mask IS '数据集列级脱敏：column_name 是语义字段名（也兼容物理列名）';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_dataset_column_mask
    ON bi_dataset_column_mask (dataset_id, column_name);
