-- 邮件通知：告警规则 / 定时报表订阅增加收件人字段（渠道 = email 时使用）

ALTER TABLE public.bi_alert_rule
    ADD COLUMN IF NOT EXISTS email_to varchar(500) NOT NULL DEFAULT '';

ALTER TABLE public.bi_report_subscription
    ADD COLUMN IF NOT EXISTS email_to varchar(500) NOT NULL DEFAULT '';
