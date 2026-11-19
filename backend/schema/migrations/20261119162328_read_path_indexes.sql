-- 常用读路径索引：我的看板、组件取数、权限查询（低风险，只加快读取）
CREATE INDEX IF NOT EXISTS idx_bi_canvas_owner_updated
    ON public.bi_canvas (owner_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bi_dataset_field_dataset
    ON public.bi_dataset_field (dataset_id);

CREATE INDEX IF NOT EXISTS idx_bi_dataset_metric_dataset
    ON public.bi_dataset_metric (dataset_id);

CREATE INDEX IF NOT EXISTS idx_bi_dash_item_source_dashboard
    ON public.bi_dash_item_source (dashboard_id);

CREATE INDEX IF NOT EXISTS idx_bi_dash_item_source_dataset
    ON public.bi_dash_item_source (dataset_id);

CREATE INDEX IF NOT EXISTS idx_bi_resource_permissions_lookup
    ON public.bi_resource_permissions (resource_type, resource_id, user_id);

CREATE INDEX IF NOT EXISTS idx_bi_template_market_visible
    ON public.bi_template_market (is_public, category, downloads DESC);
