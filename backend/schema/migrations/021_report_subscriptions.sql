-- P2 订阅与定时报表：订阅（看板 + 频率 + 时间 + 渠道）+ 每次生成的报表文件记录

CREATE TABLE IF NOT EXISTS public.bi_report_subscription (
    id             bigserial PRIMARY KEY,
    dashboard_id   integer NOT NULL REFERENCES public.bi_canvas (id) ON DELETE CASCADE,
    name           varchar(120) NOT NULL DEFAULT '',
    view_key       varchar(80) NOT NULL DEFAULT '',
    frequency      varchar(10) NOT NULL DEFAULT 'daily',
    send_time      varchar(5) NOT NULL DEFAULT '09:00',
    week_day       smallint NOT NULL DEFAULT 1,
    channel        varchar(20) NOT NULL DEFAULT 'inapp',
    webhook_url    varchar(500) NOT NULL DEFAULT '',
    enabled        boolean NOT NULL DEFAULT true,
    created_by     integer,
    last_run_at    timestamp without time zone,
    last_status    varchar(12) NOT NULL DEFAULT '',
    last_error     text NOT NULL DEFAULT '',
    next_run_at    timestamp without time zone,
    created_at     timestamp without time zone NOT NULL DEFAULT now(),
    updated_at     timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_report_sub_dashboard
    ON public.bi_report_subscription (dashboard_id);

CREATE INDEX IF NOT EXISTS idx_bi_report_sub_due
    ON public.bi_report_subscription (next_run_at) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.bi_report_run (
    id              bigserial PRIMARY KEY,
    subscription_id bigint REFERENCES public.bi_report_subscription (id) ON DELETE CASCADE,
    dashboard_id    integer,
    status          varchar(12) NOT NULL DEFAULT 'success',
    html_path       varchar(500) NOT NULL DEFAULT '',
    xlsx_path       varchar(500) NOT NULL DEFAULT '',
    summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
    error           text NOT NULL DEFAULT '',
    delivered       varchar(16) NOT NULL DEFAULT 'inapp',
    triggered_by    varchar(12) NOT NULL DEFAULT 'schedule',
    created_at      timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_report_run_sub
    ON public.bi_report_run (subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bi_report_run_dashboard
    ON public.bi_report_run (dashboard_id, created_at DESC);

-- 站内通知：报表就绪事件复用告警事件表（rule_id 为空 = 报表事件），补一个可点击链接
ALTER TABLE public.bi_alert_event ADD COLUMN IF NOT EXISTS link varchar(500) NOT NULL DEFAULT '';
