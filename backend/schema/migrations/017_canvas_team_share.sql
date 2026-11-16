-- 「分享到我的团队」：看板本体变协同项目（不复制看板、不复制数据集）
ALTER TABLE public.bi_canvas
    ADD COLUMN IF NOT EXISTS team_shared boolean DEFAULT false;

-- 看板级权限（查看 / 编辑）；resource_type 增补 canvas（页面看板），与旧 dashboard 区分命名空间
ALTER TABLE public.bi_resource_permissions
    DROP CONSTRAINT IF EXISTS bi_resource_permissions_resource_type_check;
ALTER TABLE public.bi_resource_permissions
    ADD CONSTRAINT bi_resource_permissions_resource_type_check
    CHECK (resource_type = ANY (ARRAY['datasource'::text, 'dataset'::text, 'dashboard'::text, 'canvas'::text]));

CREATE INDEX IF NOT EXISTS idx_bi_resource_permissions_canvas
    ON public.bi_resource_permissions (resource_id, user_id)
    WHERE resource_type = 'canvas';

CREATE INDEX IF NOT EXISTS idx_bi_canvas_team_shared
    ON public.bi_canvas (updated_at DESC)
    WHERE team_shared IS TRUE AND deleted_at IS NULL;
