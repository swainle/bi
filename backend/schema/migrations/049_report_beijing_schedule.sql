-- 只重排启用订阅的未来发送时间；历史发送记录保持不变。
WITH local_clock AS (
    SELECT now() AT TIME ZONE 'Asia/Shanghai' AS moment
), candidates AS (
    SELECT s.id, s.frequency, c.moment,
           c.moment::date + s.send_time::time
           + CASE WHEN s.frequency = 'weekly' THEN
               ((s.week_day - extract(isodow FROM c.moment)::int + 7) % 7) * interval '1 day'
             ELSE interval '0 days' END AS target
    FROM bi_report_subscription s CROSS JOIN local_clock c
    WHERE s.enabled IS TRUE
)
UPDATE bi_report_subscription s
SET next_run_at = (
    (CASE WHEN c.target <= c.moment THEN c.target +
        CASE WHEN c.frequency = 'weekly' THEN interval '7 days' ELSE interval '1 day' END
      ELSE c.target END) AT TIME ZONE 'Asia/Shanghai'
) AT TIME ZONE 'UTC'
FROM candidates c WHERE s.id = c.id;
