-- 056 · AI 成本配额（R14）—— 每用户每日调用次数与 token 预算

CREATE TABLE IF NOT EXISTS public.bi_ai_usage (
  user_id  integer NOT NULL,
  day      date NOT NULL DEFAULT CURRENT_DATE,
  calls    integer NOT NULL DEFAULT 0,
  tokens   bigint  NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

COMMENT ON TABLE public.bi_ai_usage IS 'AI 每日用量：超限 429，写审计；按自然日自动翻篇';
