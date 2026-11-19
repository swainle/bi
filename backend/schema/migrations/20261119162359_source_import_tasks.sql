CREATE TABLE IF NOT EXISTS public.bi_source_import (
    id bigserial PRIMARY KEY,
    job_id varchar(32) NOT NULL,
    source_id integer NOT NULL REFERENCES public.bi_source(id) ON DELETE CASCADE,
    owner_id integer NOT NULL,
    source_table text NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'reading', 'writing', 'done', 'failed')),
    rows_read integer NOT NULL DEFAULT 0,
    rows_written integer NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT '',
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_import_active
    ON public.bi_source_import (source_id, source_table)
    WHERE state IN ('queued', 'reading', 'writing');
CREATE INDEX IF NOT EXISTS ix_source_import_job ON public.bi_source_import(job_id);
CREATE INDEX IF NOT EXISTS ix_source_import_owner ON public.bi_source_import(owner_id, created_at DESC);
