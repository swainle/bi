-- 需求端：构成统计视图 + 数值字段允许筛选（人气档 / 点击率档 / 转化率档需要能 WHERE）

UPDATE public.bi_dataset_field
   SET is_filterable = true
 WHERE data_type IN ('numeric', 'integer');

CREATE OR REPLACE VIEW public.bi_demand_overview AS
SELECT '搜索词（人气）'::text AS source_name, count(*)::bigint AS words,
       sum(v)::numeric AS v_sum,
       count(*) FILTER (WHERE v >= 10000)::bigint AS big_words
  FROM public.bi_demand_hot
UNION ALL
SELECT '搜索词（增速）', count(*), sum(v), count(*) FILTER (WHERE v >= 10000)
  FROM public.bi_demand_grow
UNION ALL
SELECT '相关搜索词', count(*), sum(v), count(*) FILTER (WHERE v >= 10000)
  FROM public.bi_demand_rel
UNION ALL
SELECT '去重合计', count(*), sum(v), count(*) FILTER (WHERE v >= 10000)
  FROM public.bi_demand_merged;
