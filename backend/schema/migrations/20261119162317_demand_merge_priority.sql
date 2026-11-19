-- 需求端合并视图口径修正：与模板 dmMerged 一致 —— 同义词按「人气 > 增速 > 相关」优先级取首个非空值，
-- 不是 max()（max 会把增速表里更大的搜索人气顶上来，导致汇总数字偏大）。

CREATE OR REPLACE VIEW public.bi_demand_merged AS
WITH unioned AS (
    SELECT word, v, ctr, cvr, NULL::numeric AS g, NULL::numeric AS ds,
           NULL::numeric AS buy, NULL::numeric AS tm, '人气'::text AS src, 1 AS prio
      FROM public.bi_demand_hot
    UNION ALL
    SELECT word, v, ctr, cvr, g, NULL::numeric, NULL::numeric, NULL::numeric, '增速', 2
      FROM public.bi_demand_grow
    UNION ALL
    SELECT word, v, ctr, cvr, NULL::numeric, ds, buy, tm, '相关', 3
      FROM public.bi_demand_rel
)
SELECT
    word,
    (array_agg(v   ORDER BY prio) FILTER (WHERE v   IS NOT NULL))[1] AS v,
    (array_agg(ctr ORDER BY prio) FILTER (WHERE ctr IS NOT NULL))[1] AS ctr,
    (array_agg(cvr ORDER BY prio) FILTER (WHERE cvr IS NOT NULL))[1] AS cvr,
    max(g)   AS g,
    max(ds)  AS ds,
    max(buy) AS buy,
    max(tm)  AS tm,
    array_to_string(
        array_remove(ARRAY[
            CASE WHEN bool_or(src = '人气') THEN '人气' END,
            CASE WHEN bool_or(src = '增速') THEN '增速' END,
            CASE WHEN bool_or(src = '相关') THEN '相关' END
        ], NULL), '·') AS sources,
    word AS search_text
FROM unioned
GROUP BY word;
