-- 定时报表：服务端渲染的 PDF（无头 Chrome），供邮件链接 / 站内下载
ALTER TABLE public.bi_report_run
    ADD COLUMN IF NOT EXISTS pdf_path varchar(500) NOT NULL DEFAULT '';
