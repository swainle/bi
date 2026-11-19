-- P2 告警：规则（看板某张指标卡 + 阈值）+ 事件（触发记录 / 未读状态 / 通知结果）

CREATE TABLE IF NOT EXISTS public.bi_alert_rule (
    id                 bigserial PRIMARY KEY,
    dashboard_id       integer NOT NULL REFERENCES public.bi_canvas (id) ON DELETE CASCADE,
    item_key           varchar(80) NOT NULL,
    name               varchar(120) NOT NULL DEFAULT '',
    metric             varchar(120) NOT NULL DEFAULT '',
    op                 varchar(4) NOT NULL DEFAULT '>',
    threshold          numeric(20, 6) NOT NULL DEFAULT 0,
    change_pct         numeric(10, 2),
    channel            varchar(20) NOT NULL DEFAULT 'inapp',
    webhook_url        varchar(500) NOT NULL DEFAULT '',
    enabled            boolean NOT NULL DEFAULT true,
    cooldown_minutes   integer NOT NULL DEFAULT 30,
    created_by         integer,
    last_value         numeric(20, 6),
    last_checked_at    timestamp without time zone,
    last_triggered_at  timestamp without time zone,
    created_at         timestamp without time zone NOT NULL DEFAULT now(),
    updated_at         timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_alert_rule_dashboard
    ON public.bi_alert_rule (dashboard_id);

CREATE INDEX IF NOT EXISTS idx_bi_alert_rule_enabled
    ON public.bi_alert_rule (enabled) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.bi_alert_event (
    id            bigserial PRIMARY KEY,
    rule_id       bigint REFERENCES public.bi_alert_rule (id) ON DELETE CASCADE,
    dashboard_id  integer,
    item_key      varchar(80) NOT NULL DEFAULT '',
    rule_name     varchar(120) NOT NULL DEFAULT '',
    value         numeric(20, 6),
    threshold     numeric(20, 6),
    message       text NOT NULL DEFAULT '',
    status        varchar(12) NOT NULL DEFAULT 'unread',
    notified      varchar(16) NOT NULL DEFAULT 'inapp',
    notify_error  text NOT NULL DEFAULT '',
    created_at    timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_alert_event_created
    ON public.bi_alert_event (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bi_alert_event_unread
    ON public.bi_alert_event (created_at DESC) WHERE status = 'unread';

CREATE INDEX IF NOT EXISTS idx_bi_alert_event_rule
    ON public.bi_alert_event (rule_id);
