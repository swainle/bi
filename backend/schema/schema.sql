-- ============================================================
-- 明策BI · 数据库 Schema（PostgreSQL 16）
-- 由 grMYweb 运行库导出：36 张表 + 序列 + 索引 + 约束
-- 用法: psql "$DATABASE_URL" -f schema/schema.sql
-- ============================================================

-- 扩展（向量检索用于 AI 元数据知识库）
CREATE EXTENSION IF NOT EXISTS vector;

-- 触发器函数（建表前必须先存在）
CREATE OR REPLACE FUNCTION public.trg_bi_douyin_live_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_douyin_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_finance_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_pdd_annual_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_pdd_ops_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_pdd_traffic_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_products_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_tmall_campaigns_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_tmall_monthly_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.trg_bi_tmall_updated()
 RETURNS trigger LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $function$;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Homebrew)
-- Dumped by pg_dump version 16.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bi_ai_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_ai_audit_log (
    id integer NOT NULL,
    user_id integer,
    query_text text,
    generated_sql text,
    generated_config jsonb,
    dashboard_id integer,
    latency_ms integer,
    status text DEFAULT 'success'::text,
    error_msg text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bi_ai_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_ai_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_ai_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_ai_audit_log_id_seq OWNED BY public.bi_ai_audit_log.id;


--
-- Name: bi_ai_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_ai_knowledge (
    id integer NOT NULL,
    query text NOT NULL,
    sql_template text NOT NULL,
    embedding public.vector(384),
    usage_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_ai_knowledge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_ai_knowledge_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_ai_knowledge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_ai_knowledge_id_seq OWNED BY public.bi_ai_knowledge.id;


--
-- Name: bi_ai_sql_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_ai_sql_cache (
    id integer NOT NULL,
    original_sql text NOT NULL,
    optimized_sql text,
    table_name text,
    query_time_ms integer,
    optimized_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_ai_sql_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_ai_sql_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_ai_sql_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_ai_sql_cache_id_seq OWNED BY public.bi_ai_sql_cache.id;


--
-- Name: bi_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_alerts (
    id integer NOT NULL,
    name text NOT NULL,
    table_name text NOT NULL,
    metric_col text NOT NULL,
    operator text DEFAULT '>'::text,
    threshold numeric NOT NULL,
    enabled boolean DEFAULT true,
    owner_id integer,
    last_triggered timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_alerts_id_seq OWNED BY public.bi_alerts.id;


--
-- Name: bi_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_audit_logs (
    id integer NOT NULL,
    user_id integer,
    action character varying(50) NOT NULL,
    resource_type character varying(50) NOT NULL,
    resource_id integer,
    detail jsonb DEFAULT '{}'::jsonb,
    ip character varying(45),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_audit_logs_id_seq OWNED BY public.bi_audit_logs.id;


--
-- Name: bi_column_masks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_column_masks (
    id integer NOT NULL,
    table_name text NOT NULL,
    column_name text NOT NULL,
    mask_type text,
    mask_pattern text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT bi_column_masks_mask_type_check CHECK ((mask_type = ANY (ARRAY['phone'::text, 'id_card'::text, 'email'::text, 'custom'::text])))
);


--
-- Name: bi_column_masks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_column_masks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_column_masks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_column_masks_id_seq OWNED BY public.bi_column_masks.id;


--
-- Name: bi_dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_dashboards (
    id integer NOT NULL,
    name text NOT NULL,
    owner_id integer,
    panels jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    table_map jsonb DEFAULT '{}'::jsonb,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_public boolean DEFAULT false NOT NULL
);


--
-- Name: bi_dashboards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_dashboards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_dashboards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_dashboards_id_seq OWNED BY public.bi_dashboards.id;


--
-- Name: bi_dataset_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_dataset_versions (
    id integer NOT NULL,
    table_name text NOT NULL,
    version_name text NOT NULL,
    row_count integer,
    snapshot_data text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_dataset_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_dataset_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_dataset_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_dataset_versions_id_seq OWNED BY public.bi_dataset_versions.id;


--
-- Name: bi_douyin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_douyin (
    id integer NOT NULL,
    date text NOT NULL,
    plays integer,
    engagement_rate numeric(5,1),
    gmv numeric(14,2),
    new_followers integer,
    live_hours numeric(4,1),
    avg_online integer,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_douyin_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_douyin_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_douyin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_douyin_id_seq OWNED BY public.bi_douyin.id;


--
-- Name: bi_douyin_live; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_douyin_live (
    id integer NOT NULL,
    session text NOT NULL,
    viewers integer,
    peak_online integer,
    gmv numeric(14,2),
    cvr numeric(5,1),
    gmv_per_k integer,
    new_followers integer,
    engagement_rate numeric(5,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_douyin_live_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_douyin_live_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_douyin_live_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_douyin_live_id_seq OWNED BY public.bi_douyin_live.id;


--
-- Name: bi_filter_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_filter_templates (
    id integer NOT NULL,
    name text NOT NULL,
    filters jsonb DEFAULT '[]'::jsonb,
    owner_id integer,
    table_name text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_filter_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_filter_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_filter_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_filter_templates_id_seq OWNED BY public.bi_filter_templates.id;


--
-- Name: bi_finance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_finance (
    id integer NOT NULL,
    month text NOT NULL,
    revenue numeric(14,2),
    cost numeric(14,2),
    net_profit numeric(14,2),
    gross_margin numeric(5,1),
    expense_rate numeric(5,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_finance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_finance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_finance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_finance_id_seq OWNED BY public.bi_finance.id;


--
-- Name: bi_knowledge_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_knowledge_metrics (
    id integer NOT NULL,
    metric_name text NOT NULL,
    formula text,
    description text,
    category text,
    embedding public.vector(384),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bi_knowledge_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_knowledge_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_knowledge_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_knowledge_metrics_id_seq OWNED BY public.bi_knowledge_metrics.id;


--
-- Name: bi_knowledge_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_knowledge_templates (
    id integer NOT NULL,
    template_name text NOT NULL,
    description text,
    panels_config jsonb,
    embedding public.vector(384),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bi_knowledge_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_knowledge_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_knowledge_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_knowledge_templates_id_seq OWNED BY public.bi_knowledge_templates.id;


--
-- Name: bi_metadata_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_metadata_fields (
    id integer NOT NULL,
    table_name text NOT NULL,
    column_name text NOT NULL,
    data_type text,
    comment_text text,
    is_dimension boolean DEFAULT false,
    is_measure boolean DEFAULT false,
    sample_values jsonb,
    embedding public.vector(384),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bi_metadata_fields_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_metadata_fields_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_metadata_fields_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_metadata_fields_id_seq OWNED BY public.bi_metadata_fields.id;


--
-- Name: bi_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_metrics (
    id integer NOT NULL,
    name text NOT NULL,
    formula text NOT NULL,
    description text,
    category text,
    business_line text DEFAULT '通用'::text,
    owner_id integer,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT bi_metrics_category_check CHECK ((category = ANY (ARRAY['财务'::text, '运营'::text, '销售'::text, '通用'::text])))
);


--
-- Name: bi_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_metrics_id_seq OWNED BY public.bi_metrics.id;


--
-- Name: bi_pdd_annual; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_pdd_annual (
    id integer NOT NULL,
    month text NOT NULL,
    gmv numeric(14,2),
    ad_spend numeric(14,2),
    roi numeric(5,1),
    avg_order numeric(8,2),
    repurchase_rate numeric(5,1),
    return_rate numeric(5,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_pdd_annual_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_pdd_annual_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_pdd_annual_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_pdd_annual_id_seq OWNED BY public.bi_pdd_annual.id;


--
-- Name: bi_pdd_ops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_pdd_ops (
    id integer NOT NULL,
    date text NOT NULL,
    pv integer,
    uv integer,
    gmv numeric(14,2),
    conversion_rate numeric(5,1),
    avg_order numeric(8,2),
    refund_rate numeric(5,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_pdd_ops_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_pdd_ops_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_pdd_ops_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_pdd_ops_id_seq OWNED BY public.bi_pdd_ops.id;


--
-- Name: bi_pdd_profit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_pdd_profit (
    id integer NOT NULL,
    person character varying(100) DEFAULT ''::character varying,
    store character varying(255) DEFAULT ''::character varying,
    revenue numeric(14,2) DEFAULT 0,
    positive_rev numeric(14,2) DEFAULT 0,
    refund numeric(14,2) DEFAULT 0,
    special_rev numeric(14,2) DEFAULT 0,
    positive_orders numeric(12,0) DEFAULT 0,
    reverse_orders numeric(12,0) DEFAULT 0,
    postage_income numeric(14,2) DEFAULT 0,
    cost numeric(14,2) DEFAULT 0,
    product_cost numeric(14,2) DEFAULT 0,
    gift_cost numeric(14,2) DEFAULT 0,
    special_cost numeric(14,2) DEFAULT 0,
    damage numeric(14,2) DEFAULT 0,
    gross numeric(14,2) DEFAULT 0,
    gross_rate numeric(8,6) DEFAULT 0,
    logistics numeric(14,2) DEFAULT 0,
    express numeric(14,2) DEFAULT 0,
    other_logistics numeric(14,2) DEFAULT 0,
    promo numeric(14,2) DEFAULT 0,
    product_promo numeric(14,2) DEFAULT 0,
    wujie_promo numeric(14,2) DEFAULT 0,
    platform_fee numeric(14,2) DEFAULT 0,
    platform_commission numeric(14,2) DEFAULT 0,
    labor numeric(14,2) DEFAULT 0,
    op_labor numeric(14,2) DEFAULT 0,
    alloc_labor numeric(14,2) DEFAULT 0,
    other_expense numeric(14,2) DEFAULT 0,
    rent numeric(14,2) DEFAULT 0,
    utility numeric(14,2) DEFAULT 0,
    admin_alloc numeric(14,2) DEFAULT 0,
    other_income numeric(14,2) DEFAULT 0,
    net_profit numeric(14,2) DEFAULT 0,
    net_rate numeric(8,6) DEFAULT 0,
    data_month character varying(10) DEFAULT '2026-05'::character varying,
    is_loss boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_pdd_profit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_pdd_profit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_pdd_profit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_pdd_profit_id_seq OWNED BY public.bi_pdd_profit.id;


--
-- Name: bi_pdd_stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_pdd_stores (
    id integer NOT NULL,
    store text DEFAULT ''::text,
    department text DEFAULT ''::text,
    revenue numeric DEFAULT 0,
    revenue_clean numeric DEFAULT 0,
    refund numeric DEFAULT 0,
    special_rev numeric DEFAULT 0,
    tmall_1688 numeric DEFAULT 0,
    order_count integer DEFAULT 0,
    return_orders numeric DEFAULT 0,
    special_orders numeric DEFAULT 0,
    shipping_rev numeric DEFAULT 0,
    cogs numeric DEFAULT 0,
    gift_cost numeric DEFAULT 0,
    cost_adj numeric DEFAULT 0,
    special_cost numeric DEFAULT 0,
    damage numeric DEFAULT 0,
    gross_profit numeric DEFAULT 0,
    gross_margin numeric DEFAULT 0,
    express_cost numeric DEFAULT 0,
    packaging_cost numeric DEFAULT 0,
    warehouse_rent numeric DEFAULT 0,
    warehouse_labor numeric DEFAULT 0,
    other_logistics numeric DEFAULT 0,
    packaging_import numeric DEFAULT 0,
    promo_cost numeric DEFAULT 0,
    platform_cost numeric DEFAULT 0,
    labor_cost numeric DEFAULT 0,
    other_cost numeric DEFAULT 0,
    net_profit numeric DEFAULT 0,
    profit_rate numeric DEFAULT 0,
    data_month text DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: bi_pdd_stores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_pdd_stores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_pdd_stores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_pdd_stores_id_seq OWNED BY public.bi_pdd_stores.id;


--
-- Name: bi_pdd_traffic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_pdd_traffic (
    id integer NOT NULL,
    channel text NOT NULL,
    impressions integer,
    clicks integer,
    ctr numeric(5,1),
    gmv numeric(14,2),
    cvr numeric(5,1),
    avg_rank numeric(4,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_pdd_traffic_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_pdd_traffic_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_pdd_traffic_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_pdd_traffic_id_seq OWNED BY public.bi_pdd_traffic.id;


--
-- Name: bi_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_products (
    id integer NOT NULL,
    product text NOT NULL,
    monthly_sales integer,
    gmv numeric(14,2),
    rating numeric(5,1),
    repurchase_rate numeric(5,1),
    return_rate numeric(5,1),
    avg_order numeric(8,2),
    gross_margin numeric(5,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_products_id_seq OWNED BY public.bi_products.id;


--
-- Name: bi_resource_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_resource_permissions (
    id integer NOT NULL,
    resource_type text NOT NULL,
    resource_id integer NOT NULL,
    user_id integer,
    permission text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT bi_resource_permissions_permission_check CHECK ((permission = ANY (ARRAY['view'::text, 'edit'::text, 'manage'::text]))),
    CONSTRAINT bi_resource_permissions_resource_type_check CHECK ((resource_type = ANY (ARRAY['datasource'::text, 'dataset'::text, 'dashboard'::text])))
);


--
-- Name: bi_resource_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_resource_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_resource_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_resource_permissions_id_seq OWNED BY public.bi_resource_permissions.id;


--
-- Name: bi_row_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_row_permissions (
    id integer NOT NULL,
    table_name text NOT NULL,
    user_id integer,
    role_name text,
    filter_rule text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_row_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_row_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_row_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_row_permissions_id_seq OWNED BY public.bi_row_permissions.id;


--
-- Name: bi_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sales (
    id integer NOT NULL,
    month character varying(10),
    revenue numeric(12,2),
    profit numeric(12,2),
    orders integer,
    category character varying(30)
);


--
-- Name: bi_sales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_sales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_sales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_sales_id_seq OWNED BY public.bi_sales.id;


--
-- Name: bi_sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_sync_logs (
    id integer NOT NULL,
    table_name text NOT NULL,
    sync_type text,
    rows_synced integer DEFAULT 0,
    duration_ms integer,
    status text,
    error_message text,
    retry_count integer DEFAULT 0,
    started_at timestamp without time zone DEFAULT now(),
    finished_at timestamp without time zone,
    CONSTRAINT bi_sync_logs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'retrying'::text]))),
    CONSTRAINT bi_sync_logs_sync_type_check CHECK ((sync_type = ANY (ARRAY['full'::text, 'incremental'::text])))
);


--
-- Name: bi_sync_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_sync_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_sync_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_sync_logs_id_seq OWNED BY public.bi_sync_logs.id;


--
-- Name: bi_template_market; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_template_market (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    panels jsonb DEFAULT '[]'::jsonb,
    table_map jsonb DEFAULT '{}'::jsonb,
    downloads integer DEFAULT 0,
    rating numeric(2,1) DEFAULT 0,
    author_id integer,
    is_official boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT bi_template_market_category_check CHECK ((category = ANY (ARRAY['拼多多'::text, '天猫'::text, '财务'::text, '产品部'::text])))
);


--
-- Name: bi_template_market_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_template_market_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_template_market_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_template_market_id_seq OWNED BY public.bi_template_market.id;


--
-- Name: bi_tmall; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_tmall (
    id integer NOT NULL,
    date text NOT NULL,
    gmv numeric(14,2),
    uv integer,
    paying_buyers integer,
    avg_order numeric(8,2),
    roi numeric(5,1),
    ad_spend numeric(14,2),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_tmall_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_tmall_campaigns (
    id integer NOT NULL,
    campaign text NOT NULL,
    gmv numeric(14,2),
    visitors integer,
    new_customers integer,
    ad_spend numeric(14,2),
    roi numeric(5,1),
    avg_order numeric(8,2),
    coupon_usage numeric(5,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_tmall_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_tmall_campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_tmall_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_tmall_campaigns_id_seq OWNED BY public.bi_tmall_campaigns.id;


--
-- Name: bi_tmall_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_tmall_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_tmall_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_tmall_id_seq OWNED BY public.bi_tmall.id;


--
-- Name: bi_tmall_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_tmall_monthly (
    id integer NOT NULL,
    month text NOT NULL,
    gmv numeric(14,2),
    visitors integer,
    pay_cvr numeric(5,1),
    avg_order numeric(8,2),
    ad_spend numeric(14,2),
    roi numeric(5,1),
    new_customer_rate numeric(5,1),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_tmall_monthly_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_tmall_monthly_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_tmall_monthly_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_tmall_monthly_id_seq OWNED BY public.bi_tmall_monthly.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    parent_id integer,
    sort_order integer,
    is_deleted boolean,
    created_at timestamp without time zone
);


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    "group" character varying(50)
);


--
-- Name: role_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permission (
    role_id integer NOT NULL,
    permission_code character varying(50) NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    code character varying(50) NOT NULL,
    description character varying(200),
    is_system boolean,
    created_at timestamp without time zone
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: user_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_role (
    user_id integer NOT NULL,
    role_id integer NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(120) NOT NULL,
    phone character varying(20),
    password_hash character varying(128) NOT NULL,
    role character varying(20) DEFAULT 'user'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    permissions text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    department_id integer,
    avatar_url character varying(500),
    token_version integer DEFAULT 0 NOT NULL,
    plan character varying(30),
    plan_expires_at timestamp without time zone,
    oauth_provider character varying(20),
    oauth_id character varying(200),
    avatar character varying(500),
    storage_quota_bytes bigint DEFAULT '5368709120'::bigint NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: bi_ai_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ai_audit_log ALTER COLUMN id SET DEFAULT nextval('public.bi_ai_audit_log_id_seq'::regclass);


--
-- Name: bi_ai_knowledge id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ai_knowledge ALTER COLUMN id SET DEFAULT nextval('public.bi_ai_knowledge_id_seq'::regclass);


--
-- Name: bi_ai_sql_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ai_sql_cache ALTER COLUMN id SET DEFAULT nextval('public.bi_ai_sql_cache_id_seq'::regclass);


--
-- Name: bi_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_alerts ALTER COLUMN id SET DEFAULT nextval('public.bi_alerts_id_seq'::regclass);


--
-- Name: bi_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.bi_audit_logs_id_seq'::regclass);


--
-- Name: bi_column_masks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_column_masks ALTER COLUMN id SET DEFAULT nextval('public.bi_column_masks_id_seq'::regclass);


--
-- Name: bi_dashboards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_dashboards ALTER COLUMN id SET DEFAULT nextval('public.bi_dashboards_id_seq'::regclass);


--
-- Name: bi_dataset_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_dataset_versions ALTER COLUMN id SET DEFAULT nextval('public.bi_dataset_versions_id_seq'::regclass);


--
-- Name: bi_douyin id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_douyin ALTER COLUMN id SET DEFAULT nextval('public.bi_douyin_id_seq'::regclass);


--
-- Name: bi_douyin_live id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_douyin_live ALTER COLUMN id SET DEFAULT nextval('public.bi_douyin_live_id_seq'::regclass);


--
-- Name: bi_filter_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_filter_templates ALTER COLUMN id SET DEFAULT nextval('public.bi_filter_templates_id_seq'::regclass);


--
-- Name: bi_finance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_finance ALTER COLUMN id SET DEFAULT nextval('public.bi_finance_id_seq'::regclass);


--
-- Name: bi_knowledge_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_knowledge_metrics ALTER COLUMN id SET DEFAULT nextval('public.bi_knowledge_metrics_id_seq'::regclass);


--
-- Name: bi_knowledge_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_knowledge_templates ALTER COLUMN id SET DEFAULT nextval('public.bi_knowledge_templates_id_seq'::regclass);


--
-- Name: bi_metadata_fields id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_metadata_fields ALTER COLUMN id SET DEFAULT nextval('public.bi_metadata_fields_id_seq'::regclass);


--
-- Name: bi_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_metrics ALTER COLUMN id SET DEFAULT nextval('public.bi_metrics_id_seq'::regclass);


--
-- Name: bi_pdd_annual id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_annual ALTER COLUMN id SET DEFAULT nextval('public.bi_pdd_annual_id_seq'::regclass);


--
-- Name: bi_pdd_ops id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_ops ALTER COLUMN id SET DEFAULT nextval('public.bi_pdd_ops_id_seq'::regclass);


--
-- Name: bi_pdd_profit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_profit ALTER COLUMN id SET DEFAULT nextval('public.bi_pdd_profit_id_seq'::regclass);


--
-- Name: bi_pdd_stores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_stores ALTER COLUMN id SET DEFAULT nextval('public.bi_pdd_stores_id_seq'::regclass);


--
-- Name: bi_pdd_traffic id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_traffic ALTER COLUMN id SET DEFAULT nextval('public.bi_pdd_traffic_id_seq'::regclass);


--
-- Name: bi_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_products ALTER COLUMN id SET DEFAULT nextval('public.bi_products_id_seq'::regclass);


--
-- Name: bi_resource_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_resource_permissions ALTER COLUMN id SET DEFAULT nextval('public.bi_resource_permissions_id_seq'::regclass);


--
-- Name: bi_row_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_row_permissions ALTER COLUMN id SET DEFAULT nextval('public.bi_row_permissions_id_seq'::regclass);


--
-- Name: bi_sales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sales ALTER COLUMN id SET DEFAULT nextval('public.bi_sales_id_seq'::regclass);


--
-- Name: bi_sync_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sync_logs ALTER COLUMN id SET DEFAULT nextval('public.bi_sync_logs_id_seq'::regclass);


--
-- Name: bi_template_market id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_template_market ALTER COLUMN id SET DEFAULT nextval('public.bi_template_market_id_seq'::regclass);


--
-- Name: bi_tmall id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_tmall ALTER COLUMN id SET DEFAULT nextval('public.bi_tmall_id_seq'::regclass);


--
-- Name: bi_tmall_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_tmall_campaigns ALTER COLUMN id SET DEFAULT nextval('public.bi_tmall_campaigns_id_seq'::regclass);


--
-- Name: bi_tmall_monthly id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_tmall_monthly ALTER COLUMN id SET DEFAULT nextval('public.bi_tmall_monthly_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: bi_ai_audit_log bi_ai_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ai_audit_log
    ADD CONSTRAINT bi_ai_audit_log_pkey PRIMARY KEY (id);


--
-- Name: bi_ai_knowledge bi_ai_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ai_knowledge
    ADD CONSTRAINT bi_ai_knowledge_pkey PRIMARY KEY (id);


--
-- Name: bi_ai_sql_cache bi_ai_sql_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ai_sql_cache
    ADD CONSTRAINT bi_ai_sql_cache_pkey PRIMARY KEY (id);


--
-- Name: bi_alerts bi_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_alerts
    ADD CONSTRAINT bi_alerts_pkey PRIMARY KEY (id);


--
-- Name: bi_audit_logs bi_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_audit_logs
    ADD CONSTRAINT bi_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bi_column_masks bi_column_masks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_column_masks
    ADD CONSTRAINT bi_column_masks_pkey PRIMARY KEY (id);


--
-- Name: bi_column_masks bi_column_masks_table_name_column_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_column_masks
    ADD CONSTRAINT bi_column_masks_table_name_column_name_key UNIQUE (table_name, column_name);


--
-- Name: bi_dashboards bi_dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_dashboards
    ADD CONSTRAINT bi_dashboards_pkey PRIMARY KEY (id);


--
-- Name: bi_dataset_versions bi_dataset_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_dataset_versions
    ADD CONSTRAINT bi_dataset_versions_pkey PRIMARY KEY (id);


--
-- Name: bi_douyin_live bi_douyin_live_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_douyin_live
    ADD CONSTRAINT bi_douyin_live_pkey PRIMARY KEY (id);


--
-- Name: bi_douyin bi_douyin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_douyin
    ADD CONSTRAINT bi_douyin_pkey PRIMARY KEY (id);


--
-- Name: bi_filter_templates bi_filter_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_filter_templates
    ADD CONSTRAINT bi_filter_templates_pkey PRIMARY KEY (id);


--
-- Name: bi_finance bi_finance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_finance
    ADD CONSTRAINT bi_finance_pkey PRIMARY KEY (id);


--
-- Name: bi_knowledge_metrics bi_knowledge_metrics_metric_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_knowledge_metrics
    ADD CONSTRAINT bi_knowledge_metrics_metric_name_key UNIQUE (metric_name);


--
-- Name: bi_knowledge_metrics bi_knowledge_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_knowledge_metrics
    ADD CONSTRAINT bi_knowledge_metrics_pkey PRIMARY KEY (id);


--
-- Name: bi_knowledge_templates bi_knowledge_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_knowledge_templates
    ADD CONSTRAINT bi_knowledge_templates_pkey PRIMARY KEY (id);


--
-- Name: bi_metadata_fields bi_metadata_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_metadata_fields
    ADD CONSTRAINT bi_metadata_fields_pkey PRIMARY KEY (id);


--
-- Name: bi_metadata_fields bi_metadata_fields_table_name_column_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_metadata_fields
    ADD CONSTRAINT bi_metadata_fields_table_name_column_name_key UNIQUE (table_name, column_name);


--
-- Name: bi_metrics bi_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_metrics
    ADD CONSTRAINT bi_metrics_pkey PRIMARY KEY (id);


--
-- Name: bi_pdd_annual bi_pdd_annual_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_annual
    ADD CONSTRAINT bi_pdd_annual_pkey PRIMARY KEY (id);


--
-- Name: bi_pdd_ops bi_pdd_ops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_ops
    ADD CONSTRAINT bi_pdd_ops_pkey PRIMARY KEY (id);


--
-- Name: bi_pdd_profit bi_pdd_profit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_profit
    ADD CONSTRAINT bi_pdd_profit_pkey PRIMARY KEY (id);


--
-- Name: bi_pdd_stores bi_pdd_stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_stores
    ADD CONSTRAINT bi_pdd_stores_pkey PRIMARY KEY (id);


--
-- Name: bi_pdd_traffic bi_pdd_traffic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_pdd_traffic
    ADD CONSTRAINT bi_pdd_traffic_pkey PRIMARY KEY (id);


--
-- Name: bi_products bi_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_products
    ADD CONSTRAINT bi_products_pkey PRIMARY KEY (id);


--
-- Name: bi_resource_permissions bi_resource_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_resource_permissions
    ADD CONSTRAINT bi_resource_permissions_pkey PRIMARY KEY (id);


--
-- Name: bi_resource_permissions bi_resource_permissions_resource_type_resource_id_user_id_p_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_resource_permissions
    ADD CONSTRAINT bi_resource_permissions_resource_type_resource_id_user_id_p_key UNIQUE (resource_type, resource_id, user_id, permission);


--
-- Name: bi_row_permissions bi_row_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_row_permissions
    ADD CONSTRAINT bi_row_permissions_pkey PRIMARY KEY (id);


--
-- Name: bi_row_permissions bi_row_permissions_table_name_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_row_permissions
    ADD CONSTRAINT bi_row_permissions_table_name_user_id_key UNIQUE (table_name, user_id);


--
-- Name: bi_sales bi_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sales
    ADD CONSTRAINT bi_sales_pkey PRIMARY KEY (id);


--
-- Name: bi_sync_logs bi_sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_sync_logs
    ADD CONSTRAINT bi_sync_logs_pkey PRIMARY KEY (id);


--
-- Name: bi_template_market bi_template_market_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_template_market
    ADD CONSTRAINT bi_template_market_pkey PRIMARY KEY (id);


--
-- Name: bi_tmall_campaigns bi_tmall_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_tmall_campaigns
    ADD CONSTRAINT bi_tmall_campaigns_pkey PRIMARY KEY (id);


--
-- Name: bi_tmall_monthly bi_tmall_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_tmall_monthly
    ADD CONSTRAINT bi_tmall_monthly_pkey PRIMARY KEY (id);


--
-- Name: bi_tmall bi_tmall_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_tmall
    ADD CONSTRAINT bi_tmall_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (code);


--
-- Name: role_permission role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_pkey PRIMARY KEY (role_id, permission_code);


--
-- Name: roles roles_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_code_key UNIQUE (code);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: user_role user_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role
    ADD CONSTRAINT user_role_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user_time ON public.bi_audit_logs USING btree (user_id, created_at);


--
-- Name: idx_bi_metadata_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_metadata_embedding ON public.bi_metadata_fields USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='50');


--
-- Name: idx_bi_metadata_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_metadata_lookup ON public.bi_metadata_fields USING btree (table_name);


--
-- Name: idx_bi_metrics_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_metrics_embedding ON public.bi_knowledge_metrics USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='10');


--
-- Name: idx_bi_perm_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_perm_resource ON public.bi_resource_permissions USING btree (resource_type, resource_id);


--
-- Name: idx_bi_perm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_perm_user ON public.bi_resource_permissions USING btree (user_id);


--
-- Name: idx_bi_templates_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bi_templates_embedding ON public.bi_knowledge_templates USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='10');


--
-- Name: idx_pdd_profit_loss; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdd_profit_loss ON public.bi_pdd_profit USING btree (is_loss);


--
-- Name: idx_pdd_profit_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdd_profit_person ON public.bi_pdd_profit USING btree (person);


--
-- Name: idx_pdd_profit_revenue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdd_profit_revenue ON public.bi_pdd_profit USING btree (revenue DESC);


--
-- Name: idx_pdd_profit_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdd_profit_store ON public.bi_pdd_profit USING btree (store);


--
-- Name: ix_bi_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_bi_audit_logs_action ON public.bi_audit_logs USING btree (action);


--
-- Name: ix_users_department_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_department_id ON public.users USING btree (department_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_oauth_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_oauth_id ON public.users USING btree (oauth_id);


--
-- Name: ix_users_oauth_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_oauth_provider ON public.users USING btree (oauth_provider);


--
-- Name: ix_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_phone ON public.users USING btree (phone);


--
-- Name: ix_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);


--
-- Name: bi_douyin_live trg_bi_douyin_live_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_douyin_live_set_updated BEFORE UPDATE ON public.bi_douyin_live FOR EACH ROW EXECUTE FUNCTION public.trg_bi_douyin_live_updated();


--
-- Name: bi_douyin trg_bi_douyin_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_douyin_set_updated BEFORE UPDATE ON public.bi_douyin FOR EACH ROW EXECUTE FUNCTION public.trg_bi_douyin_updated();


--
-- Name: bi_finance trg_bi_finance_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_finance_set_updated BEFORE UPDATE ON public.bi_finance FOR EACH ROW EXECUTE FUNCTION public.trg_bi_finance_updated();


--
-- Name: bi_pdd_annual trg_bi_pdd_annual_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_pdd_annual_set_updated BEFORE UPDATE ON public.bi_pdd_annual FOR EACH ROW EXECUTE FUNCTION public.trg_bi_pdd_annual_updated();


--
-- Name: bi_pdd_ops trg_bi_pdd_ops_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_pdd_ops_set_updated BEFORE UPDATE ON public.bi_pdd_ops FOR EACH ROW EXECUTE FUNCTION public.trg_bi_pdd_ops_updated();


--
-- Name: bi_pdd_traffic trg_bi_pdd_traffic_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_pdd_traffic_set_updated BEFORE UPDATE ON public.bi_pdd_traffic FOR EACH ROW EXECUTE FUNCTION public.trg_bi_pdd_traffic_updated();


--
-- Name: bi_products trg_bi_products_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_products_set_updated BEFORE UPDATE ON public.bi_products FOR EACH ROW EXECUTE FUNCTION public.trg_bi_products_updated();


--
-- Name: bi_tmall_campaigns trg_bi_tmall_campaigns_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_tmall_campaigns_set_updated BEFORE UPDATE ON public.bi_tmall_campaigns FOR EACH ROW EXECUTE FUNCTION public.trg_bi_tmall_campaigns_updated();


--
-- Name: bi_tmall_monthly trg_bi_tmall_monthly_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_tmall_monthly_set_updated BEFORE UPDATE ON public.bi_tmall_monthly FOR EACH ROW EXECUTE FUNCTION public.trg_bi_tmall_monthly_updated();


--
-- Name: bi_tmall trg_bi_tmall_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bi_tmall_set_updated BEFORE UPDATE ON public.bi_tmall FOR EACH ROW EXECUTE FUNCTION public.trg_bi_tmall_updated();


--
-- Name: bi_ai_audit_log bi_ai_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_ai_audit_log
    ADD CONSTRAINT bi_ai_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bi_alerts bi_alerts_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_alerts
    ADD CONSTRAINT bi_alerts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: bi_audit_logs bi_audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_audit_logs
    ADD CONSTRAINT bi_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bi_dashboards bi_dashboards_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_dashboards
    ADD CONSTRAINT bi_dashboards_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: bi_filter_templates bi_filter_templates_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_filter_templates
    ADD CONSTRAINT bi_filter_templates_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: bi_metrics bi_metrics_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_metrics
    ADD CONSTRAINT bi_metrics_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: bi_resource_permissions bi_resource_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_resource_permissions
    ADD CONSTRAINT bi_resource_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bi_row_permissions bi_row_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_row_permissions
    ADD CONSTRAINT bi_row_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bi_template_market bi_template_market_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_template_market
    ADD CONSTRAINT bi_template_market_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: departments departments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.departments(id);


--
-- Name: role_permission role_permission_permission_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_permission_code_fkey FOREIGN KEY (permission_code) REFERENCES public.permissions(code) ON DELETE CASCADE;


--
-- Name: role_permission role_permission_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permission
    ADD CONSTRAINT role_permission_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_role user_role_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role
    ADD CONSTRAINT user_role_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_role user_role_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role
    ADD CONSTRAINT user_role_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- PostgreSQL database dump complete
--

-- ─────────────────────────────────────────────────────────────
-- 运行时补充表：编辑器卡片持久化 / 布局快照 / 看板乐观锁版本
-- 说明：原库中这三处能力由代码动态写入，表需显式建立
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bi_dashboard_cards (
    id           serial PRIMARY KEY,
    card_id      text UNIQUE NOT NULL,
    dashboard_id integer,
    title        text DEFAULT '',
    chart_type   text DEFAULT 'bar',
    layout_info  jsonb DEFAULT '{}'::jsonb,
    chart_config jsonb DEFAULT '{}'::jsonb,
    sort_order   integer DEFAULT 0,
    updated_at   timestamp without time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bi_cards_dashboard ON public.bi_dashboard_cards (dashboard_id);

CREATE TABLE IF NOT EXISTS public.bi_dashboard_snapshots (
    id            serial PRIMARY KEY,
    dashboard_id  integer NOT NULL,
    snapshot_name text DEFAULT '',
    cards_data    jsonb DEFAULT '[]'::jsonb,
    created_at    timestamp without time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bi_snapshots_dashboard ON public.bi_dashboard_snapshots (dashboard_id);

ALTER TABLE public.bi_dashboards ADD COLUMN IF NOT EXISTS version integer DEFAULT 0;
