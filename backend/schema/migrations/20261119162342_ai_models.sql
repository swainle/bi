-- AI 模型配置（管理后台「模型配置」）
-- 为什么入库：原来只有 backend/data/ai_models.json 与环境变量两条路，界面上看不到、改不了，
-- 换 Key / 换模型要登服务器。现在默认模型由管理后台维护，AI 生成链路统一从这里取，
-- 库里没有可用配置时仍回退 JSON / 环境变量（老部署升级后行为不变）。
CREATE TABLE IF NOT EXISTS bi_ai_model (
    id              serial PRIMARY KEY,
    name            varchar(80)  NOT NULL,
    provider        varchar(40)  NOT NULL DEFAULT 'deepseek',
    base_url        varchar(300) NOT NULL,
    model           varchar(120) NOT NULL,
    -- API Key 用 app/services/crypto.py 加密后存；接口只回掩码，不再返回明文
    api_key_enc     text         NOT NULL DEFAULT '',
    temperature     numeric(4, 2) NOT NULL DEFAULT 0.3,
    max_tokens      integer      NOT NULL DEFAULT 4096,
    enabled         boolean      NOT NULL DEFAULT true,
    is_default      boolean      NOT NULL DEFAULT false,
    last_test_at    timestamp,
    last_test_ok    boolean,
    last_test_ms    integer,
    last_test_error text,
    created_at      timestamp    NOT NULL DEFAULT now(),
    updated_at      timestamp    NOT NULL DEFAULT now()
);

-- 默认模型只能有一个：并发勾「设为默认」时由库兜底
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_ai_model_default
    ON bi_ai_model ((is_default)) WHERE is_default;

COMMENT ON TABLE bi_ai_model IS 'AI 模型配置（管理后台维护，AI 生成链路按 is_default + enabled 取用）';
