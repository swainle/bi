# 明策BI · 架构与板块化扩展说明

> **一句话**：明策BI 是一套「稳定内核 + 可插拔板块」的自研 BI 底座——内核只提供装配、存储、查询执行与治理，业务能力全部以板块（block）为单位独立开发、独立验收、可单独摘除；新增功能 = 新增板块，不改内核。
>
> **本文定位**：这是**地图**，不是**规则**。规则以 `AGENTS.md` 为准，数据字段细节以 `docs/组件数据契约.md` 为准；本文负责回答「系统由哪些板块组成、板块之间怎么连、新板块怎么加」。
>
> **口径**：v0.2.0（2026-11-17）。规模：后端 253 个 API 路径、88 张表（含系统表）、61 个增量迁移、23 类组件、44 个板块；前端 11 个页面、4 个功能域。
>
> **注意**：44 块是**逻辑职责**，不是 44 个文件夹。哪些已经落到独立目录、哪些还散在多处，见 [§9.4 板块落地状态](#94-板块落地状态2026-11-17-审计防止把地图当现状)；不要把本文当成「已拆完」的证明。

---

## 目录

1. [架构总览](#1-架构总览)
2. [板块化：这套系统怎么拆](#2-板块化这套系统怎么拆)
3. [板块清单（44 块）](#3-板块清单44-块)
4. [六条关键链路](#4-六条关键链路)
5. [数据契约（四层）](#5-数据契约四层)
6. [安全边界（七层）](#6-安全边界七层)
7. [新增一个板块的标准动作](#7-新增一个板块的标准动作)
8. [五类典型扩展（文件级清单）](#8-五类典型扩展文件级清单)
9. [现状矩阵与下一批板块](#9-现状矩阵与下一批板块)
10. [附录](#10-附录)

---

## 1. 架构总览

先看它服务什么，再看怎么搭出来的：

| 能力域 | 用户能做什么 | 主要板块 |
|---|---|---|
| 数据接入 | 连 15 类数据库 / 传 CSV·Excel，抽成可查询的物理表 | B06 B07 |
| 语义与指标 | 给字段定角色、给指标定口径，改表不改看板 | B08 B09 B10 |
| 分析画布 | 拖拽拼看板、筛选联动、下钻、平台分套、导出 | B15–B18、B25–B28 |
| 协作与交付 | 模板库、团队协同、收藏视图、定时报表、告警 | B17 B19–B21 |
| AI | 自然语言生成看板、AI 整理版面、AI 解读 | B38 B39 |
| Agent | 外部 Agent 经 MCP 查询 / 建看板（受权限与预算约束） | B40 B41 |
| 治理 | 角色 + 数据范围、行/列权限、操作审计、自动封禁 | B32–B37 |

### 1.1 运行时拓扑

```text
┌──────────────────── 浏览器 ────────────────────┐
│ React 18 SPA（Vite 构建，路由 /bi/*）            │
│ 画布编辑器 · 组件渲染器 · 管理后台 · MCP 授权页   │
└───────────────┬────────────────────────────────┘
                │ HTTP/JSON：Bearer 或 Cookie 会话 + CSRF
┌───────────────▼──────────────────────────────────────────────┐
│ FastAPI 入口（app/main.py）                                   │
│ 中间件由外到内：SecurityWatch → CSRF → 限流 → 请求日志 →      │
│                 审计上下文 → GZip → CORS                      │
├──────────────────────────────────────────────────────────────┤
│ 板块（按业务域，互不 import 对方的 router）                    │
│ auth · sources · semantic · query · components · dashboards   │
│ canvas · alerts · reports · templates · admin · security      │
│ mcp · ai · errors · maps · metrics                            │
├──────────────────────────────────────────────────────────────┤
│ 执行内核（所有取数唯一出口）                                    │
│ QueryObject → builder（白名单/方言/参数绑定）→ executor        │
│              （超时/并发/配额/RLS/脱敏）                       │
└───────┬──────────────────────────────┬───────────────────────┘
        │                              │
┌───────▼────────┐          ┌──────────▼──────────┐
│ PostgreSQL 16  │          │ Redis（可选）        │
│ 业务 + 元数据  │          │ 缓存 / 配额 / 队列    │
└───────┬────────┘          └─────────────────────┘
        │ 只读抽取
┌───────▼──────────────────────────────────────────────────────┐
│ 外部数据源：PG · MySQL 家族 · ClickHouse · SQL Server ·        │
│ Oracle · Db2 · Presto · Hive · Impala · Redshift · Doris      │
└──────────────────────────────────────────────────────────────┘
```

**旁路（不阻塞请求）**

| 机制 | 周期 | 说明 |
|---|---|---|
| 告警评估 | 60s | `alerts/evaluate.py`，PG advisory lock 去重 |
| 定时报表 | 60s | `reports/scheduler.py`，到点生成 HTML/Excel/PDF |
| 数据源自动同步 | 60s | `sources/sync_scheduler.py`，按表配置的间隔重拉 |
| 5 分钟增量刷新 | 300s | `routers/bi_engine/common.py::_refresh_once`，只刷有 `updated_at` 的表 |
| 外部直连会话采样 | 60s | `security/security_events.py`，记 `db_external_session` |
| BI 元数据采集 | 启动一次 | `services/bi_ai_engine.collect_metadata`，失败不影响启动 |
| 异步查询 worker | 独立进程 | `query/async_jobs/worker.py`（`BI_JOB_EXECUTOR=worker` 时） |

### 1.2 代码分层与依赖方向

```text
┌──────────────────────────────────────────────────────────────┐
│ L4 前端交互层   frontend/src/{pages,features,components}      │
└───────────────────────────┬──────────────────────────────────┘
                            │ 只通过 /api/**（axios client）
┌───────────────────────────▼──────────────────────────────────┐
│ L3 接入装配层   app/main.py · middleware/ · routers/          │
└───────────────────────────┬──────────────────────────────────┘
                            │ 登录态 / 权限码 / 数据范围
┌───────────────────────────▼──────────────────────────────────┐
│ L2 板块服务层   sources semantic components dashboards canvas │
│                 alerts reports templates admin security mcp ai│
└───────────────────────────┬──────────────────────────────────┘
                            │ 只调用内核，不互相穿透
┌───────────────────────────▼──────────────────────────────────┐
│ L1 执行内核层   query/{contract,builder,executor}             │
│                 security/{dataset_rules,rls_backstop,masking} │
└───────────────────────────┬──────────────────────────────────┘
                            │ SQLAlchemy Session
┌───────────────────────────▼──────────────────────────────────┐
│ L0 存储层       database.py · models/ · schema/migrations     │
└──────────────────────────────────────────────────────────────┘
```

**依赖铁律**（违反即视为板块设计错误）：

1. 依赖只能**向下**：L3 → L2 → L1 → L0；禁止 L1 import L2/L3。
2. 板块之间**不 import 对方的 router**；需要复用就调对方 `repository.py` / `render.py` 这类服务函数。
3. 前端不 import 后端；后端不渲染前端；跨端只认 JSON 契约。
4. 共享账本表（如 `bi_dash_item_source`、`bi_audit_logs`）只允许通过归属板块的 repository 写，其它板块只读。
5. 横切能力（审计、指标、限流、密码学）可被任意层调用，但只能由归属板块实现。

### 1.3 一次请求怎么走

以「打开看板 → 渲染一张卡」为例：

```text
POST /api/bi/dashboards/57/render
  │
  ├─ ① SecurityWatch     记 IP/UA/指纹，拦封禁、拦扫描路径
  ├─ ② CSRF              校验 cookie 与 X-CSRF-Token 一致
  ├─ ③ RateLimit         默认 300 次/分钟/IP，超限 429
  ├─ ④ RequestLogging    生成 request_id，记录耗时/状态码
  ├─ ⑤ AuditUser         从 JWT sub 写审计上下文（线程池同样生效）
  ├─ ⑥ 路由依赖          get_current_user → require_nav/_require_read
  │
  ├─ ⑦ dashboards/router 校验看板可读（owner / 团队权限 / 管理员）
  ├─ ⑧ render_cache      命中（15s TTL，key 含用户/updated_at/视图/参数）
  ├─ ⑨ render_dashboard  逐元素：筛选栏汇总参数 → 组件 spec → resolver
  │      └─ resolver     语义名 → 物理列 → semantic.compile_query → QueryObject
  ├─ ⑩ executor          RLS + 部门隔离 + 列脱敏 → builder 生成 SQL
  │                      → 语句超时 / 并发配额 / 慢查询采样
  ├─ ⑪ compute           聚合口径 / 派生统计（机会分、四象限、占比）
  └─ ⑫ 响应              {view, platform, header, stats, cards[]}
```

单卡失败不拖垮整页：`render` 对每张卡独立 Session，错误只写进该卡的 `error` 字段。

---

## 2. 板块化：这套系统怎么拆

### 2.1 什么算一个「板块」

满足全部三条才算板块，否则只是板块内部的模块：

| 判定 | 标准 | 反例 |
|---|---|---|
| **独立的业务职责** | 能用一句话说清「它负责什么、不负责什么」 | 一个 `utils.py` |
| **独立的对外契约** | 有路由 / 服务函数 / 契约模型，其它板块不需要知道它的表结构 | 一个纯内部辅助类 |
| **独立的验收与摘除** | 有回归脚本或测试；关掉它，主链路仍能跑 | 与看板渲染强耦合的一段逻辑 |

板块粒度对照（用户视角 → 代码视角）：

| 用户说的板块 | 代码落点 | 说明 |
|---|---|---|
| 前端 | `frontend/src/**` | 内部再分 7 块（B24–B30） |
| 后端 | `backend/app/**` + `backend/schema/**` | 内部再分 30+ 块 |
| 前端的组件库 | `components/spec.py` + `frontend/src/features/components` | 前后端各一半，契约是 `ComponentSpec` |
| 后端的权限 | `admin/permissions.py` + `rbac_seed.py` + `admin/router/`（7 分区） | 含 RBAC、数据范围、审批 |
| 后端的安全卫士 | `security/guard.py` + `middleware/security_watch.py` | 含命中计数、自动封禁、后台解封 |

### 2.2 板块地图（8 个域 × 44 块）

| 域 | 编号 | 板块 | 职责一句话 |
|---|---|---|---|
| 平台底座 | B01 | 应用装配与启动 | 只做装配：中间件、路由、启动序列 |
| | B02 | 存储与迁移 | 引擎/会话/连接池；增量迁移只增不改 |
| | B03 | 认证与会话 | 登录、刷新、改密、`token_version` 踢会话 |
| | B04 | 请求中间件 | 限流、CSRF、日志、审计上下文、安全指纹 |
| | B05 | 可观测与错误 | Sentry、进程指标、慢查询、错误日志 |
| 数据接入 | B06 | 数据源连接器 | 15 类类型目录、方言、加密口令、测试连接 |
| | B07 | 接入与同步 | 建表、重拉、结构漂移、自动同步、CSV 导入 |
| | B08 | 语义层 | 数据集/字段/指标；语义名 → 物理列的唯一边界 |
| | B09 | 指标治理与血缘 | 版本、认证、引用账本、字段级血缘 |
| | B10 | 数据集安全规则 | 行规则、列脱敏、部门隔离、沙箱归属 |
| 查询执行 | B11 | 查询契约 | `QueryObject` 与结构校验（不接受用户 SQL 片段） |
| | B12 | SQL 构建 | 方言引用、参数绑定、权限下推、`NULLS LAST` 降级 |
| | B13 | 执行治理 | 超时、并发配额、取消、慢查询、异步任务 |
| | B14 | 查询 API | `/api/bi/query/*` 契约入口 + SQL 工作台 |
| 展现（后端） | B15 | 组件规格与组件库 | 23 类 `kind`、spec 校验、组件 CRUD、种子 |
| | B16 | 组件解析与计算 | spec → QueryObject → 渲染 payload 的唯一链路 |
| | B17 | 看板文档与渲染 | v2.1 文档、渲染、缓存、联动、下钻、收藏 |
| | B18 | 画布与项目 | 自由画布 CRUD、发布、只读渲染 |
| | B19 | 模板市场与分享 | 看板深拷贝 + 数据副本 + 只读分享链接 |
| | B20 | 告警 | 指标卡规则、事件、Webhook 通知 |
| | B21 | 定时报表 | 订阅、HTML/Excel/PDF、签名下载 |
| | B22 | 通知渠道 | 站内 / Webhook / 钉钉 / 企微 / 邮件 |
| | B23 | 地图数据 | 省级 GeoJSON，ETag + 缓存一天 |
| 前端交互 | B24 | 应用壳与导航 | 路由、权限守卫、主题、侧栏/顶栏 |
| | B25 | 画布编辑器 | 拖拽、8px 吸附、撤销栈、三栏面板 |
| | B26 | 组件渲染器 | 23 种渲染 + 四尺寸收敛（CardFit） |
| | B27 | 组件库与配置面板 | 库列表、组件编辑页、字段/样式/查询面板 |
| | B28 | 看板查看 | 只读渲染、导出、收藏视图、分享 |
| | B29 | 数据工作台 | 数据源/数据集/SQL/导入/团队/测试数据 |
| | B30 | 管理后台前端 | 9 个分区面板，按权限显隐 |
| | B31 | MCP 授权页 | 客户端授权、令牌、连接说明 |
| 治理安全 | B32 | RBAC 与数据范围 | 角色=权限+范围；部门树；注册审批 |
| | B33 | 审计与操作监控 | 操作/AI/MCP 三流水合并 + 敏感标 |
| | B34 | 安全卫士 | 攻击型事件计数 → IP/指纹/账号封禁 |
| | B35 | 物理表 RLS | 直连也拦跨部门；fail-closed |
| | B36 | 外发与内容防护 | SSRF 防护、提示词注入、敏感字段、水印 |
| | B37 | 业务入口守卫 | `bi:nav:*` 拦写操作，菜单只是显隐 |
| AI 与 Agent | B38 | AI 引擎 | 模型候选回退、真实调用、配额、审计 |
| | B39 | AI 排版与推荐 | 纯函数版面算法 + 字段推荐 |
| | B40 | MCP 网关 | grants/token/rpc，七层鉴权每次重算 |
| | B41 | MCP 工具与策略 | 17 个工具、数据分级、行数预算、熔断 |
| 交付与质量 | B42 | 部署与探针 | livez/readyz、compose、Helm、GlitchTip |
| | B43 | 质量门禁 | pytest、vitest、e2e、visual、storybook、预算 |
| | B44 | 规则与文档 | AGENTS、仓库规范、更新日志、本说明 |

### 2.3 板块契约（10 条硬规矩）

| # | 规矩 | 落点 |
|---|---|---|
| 1 | **一块一目录（目标）**：后端 `app/<block>/`，前端 `features/<block>/`；当前 38/44 有目录承载，未达标的见 §9.4 | 目录结构即边界 |
| 2 | **一块一入口**：后端一个 `router.py`，前端一条路由 | `main.py` 一行注册 |
| 3 | **一块一契约**：对外只用 Pydantic / dataclass，不裸传 dict | `spec.py`、`contract.py` 是范例 |
| 4 | **一块一迁移**：新表只追加迁移，不改历史文件 | `schema/migrations/0xx_*.sql` |
| 5 | **一块一权限**：新增能力必须落到权限码白名单 | `admin/permissions.py` |
| 6 | **写操作必审计**：敏感写接口补 `log_audit` | `middleware/audit.py` |
| 7 | **取数必过内核**：任何板块取数只能 `executor.run` / `semantic.compile_query` | 不允许板块内自己拼 SQL |
| 8 | **失败语义明确**：权限 403 / 参数 400 / 冲突 409 / 配额 429 / 容量 503 | 错误映射表见 §6.2 |
| 9 | **可观测**：新板块至少一条 `metrics.incr` + 错误落库 | `query/metrics.py` |
| 10 | **可摘除**：关开关 + 藏菜单后主链路仍可用 | 摘除演练见 §7.5 |

### 2.4 「无限拓展」靠什么成立

| 机制 | 现状 | 说明 |
|---|---|---|
| 内核稳定 | ✅ | `main.py` 只装配；板块增减不碰中间件与内核 |
| 注册点收敛 | ⚠️ 4 处手工 | 路由注册、权限码表、前端菜单、迁移编号 |
| 契约先行 | ✅ | 四层契约（§5）挡住跨板块耦合 |
| 数据隔离 | ✅ | 一板块一张表前缀 + 迁移；跨板块只读账本 |
| 可摘除 | ⚠️ 部分 | 告警/报表/同步有 `BI_*_INTERVAL_SECONDS=0` 开关 |
| 演进方向 | 建议 | 用一份 `blocks.yaml` 驱动菜单/权限/文档（§9.3），把 4 处手工注册收敛成 1 处 |

---

## 3. 板块清单（44 块）

> 每块给：**职责 · 代码根 · 主要入口 · 依赖**。标 ★ 的是核心板块，在各小节有展开说明。

### 3.1 平台底座

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B01 ★ | 应用装配与启动 | FastAPI 实例、中间件顺序、24 个 include_router、启动序列（建表→迁移→种子→RBAC→RLS→管理员）、后台线程启动 | `app/main.py`、`app/config.py`、`app/bootstrap.py` | `uvicorn app.main:app` | B02–B05、全部板块 |
| B02 | 存储与迁移 | 连接池（20+10，LIFO/recycle/`application_name`）、声明式模型、增量迁移器（事务内 SQL + 记录） | `app/database.py`、`app/models/`、`app/schema_migrations.py`、`schema/migrations/` | 启动自动跑 | 无 |
| B03 ★ | 认证与会话 | 登录/刷新/改密/资料/头像；JWT 带 `token_version`，改密与停用立刻失效；`/api/auth/me` 现算权限 | `auth/{router,service,deps}.py`、`features/auth/{AuthContext,useAuth}.tsx` | `/api/auth/*` | B02、B32 |
| B04 | 请求中间件 | 安全指纹、CSRF（Double Submit）、限流、请求日志、审计上下文 | `app/middleware/` | 全局 | B02、B32、B33 |
| B05 | 可观测与错误 | Sentry 初始化（DSN 空则不加载）、进程指标、慢查询采样、错误日志、连接池耗尽 503 | `observability/{sentry,metrics,slowlog,router}.py`、`observability/errors/` | `/api/metrics`、`POST /api/report` | B02 |

**启动序列（B01 的实质内容）**：`ensure_schema → create_all → ensure_migrations → ensure_item_sources → ensure_project_names → ensure_components → ensure_rbac_seed → ensure_rls_backstop → ensure_seed_data → ensure_admin`，全部幂等；任何一步失败都会阻断启动（除元数据采集）。

### 3.2 数据接入与语义

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B06 ★ | 数据源连接器 | **类型目录唯一来源**（15 类，驱动可用性实时探测）；方言映射；口令加密存储；连接串拼装与测试连接 | `sources/types_catalog.py`、`sources/repository.py`、`routers/bi_datasource.py`、`services/crypto.py` | `/api/bi/sources/types`、`/api/bi/sources/test` | B02、B36 |
| B07 | 接入与同步 | 接入表快照、单表重拉、结构漂移对比、按间隔自动同步、CSV/Excel 落表 | `sources/router.py`、`sources/sync_scheduler.py`、`services/bi_csv_import.py` | `/api/bi/sources/*`、`/api/bi/sources/sync/due` | B06、B08 |
| B08 ★ | 语义层 | 数据集/字段/指标；语义名→物理列唯一边界；`compile_query` 把语义请求编译成 `QueryObject`；指标表达式校验；dbt/LookML 导入 | `semantic/` | `/api/bi/semantic/datasets*` | B02、B11 |
| B09 | 指标治理与血缘 | 口径版本 +1、自动取消认证、版本快照、引用账本（看板元素）、字段级使用次数 | `semantic/repository.py`、`semantic/router_items.py`、`semantic/lineage.py` | `/metrics/{id}/versions`、`/fields/usages` | B08、B17 |
| B10 | 数据集安全规则 | 行级条件（表级 RLS 与数据集规则同时 AND）、列脱敏（表级→数据集级）、部门隔离、沙箱数据集归属 | `security/dataset/{rules,scope,masking,access}.py` | `/datasets/{id}/security*`、`/security/dept-scope` | B08、B32 |

**为什么语义层是「唯一边界」**：前端与看板文档里只出现语义名（`产品标题`、`日销量`），物理列名只存在于 `bi_dataset_field.source_column`。改物理表结构时只改语义映射，不动 189 个看板文档——这是 B08 存在的根本原因。

**数据集安全的三层叠加**（同一列同时命中时以更严为准）：

```text
SQL 生成时：  物理表 RLS（B35）  AND  数据集行规则（B10）  AND  部门隔离（B10）
结果返回前：  表级脱敏  →  数据集级脱敏（同列数据集优先）
准入判断：    can_access_dataset（公共 / 自己的 / 归属本部门及下级）
```

### 3.3 查询执行

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B11 ★ | 查询契约 | `QueryObject`（表/维度/指标/筛选/粒度/排序/limit/dataset_id/方言）；标识符与别名黑名单；聚合与排序结构化校验 | `query/contract.py`、`query/grain.py`、`query/column_types.py`、`query/whitelist.py` | 全部取数入口 | 无 |
| B12 | SQL 构建 | 标识符按方言引用（MySQL 反引号 / MSSQL 方括号 / 其余双引号）；值一律 `:param`；表必须白名单；`NULLS LAST` 按方言降级 | `query/builder.py`、`query/live.py` | 由 B13 调用 | B11 |
| B13 ★ | 执行治理 | 语句超时（PG 端取消）、同用户并发配额（可 Redis 全局）、查询取消、慢查询采样、异步任务（memory/redis + inline/worker） | `query/executor.py`、`running.py`、`async_jobs/`、`redis_bus.py` | 由板块调用 | B11、B12 |
| B14 | 查询 API | 查询契约的 HTTP 入口（拒绝 `subquery` 与 `metrics[].expression`）；粒度字典；慢查询列表 | `query/api.py` | `/api/bi/query/*` | B11–B13 |

**取数唯一出口**：不论 UI、导出、告警、报表还是 Agent，最终都落到 `executor.run(db, QueryObject, user, dataset_id=…)`。`dataset_id` 必须传——漏传意味着数据集行/列规则与部门隔离一起失效，这是历史踩过的坑。

### 3.4 展现与渲染（后端）

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B15 ★ | 组件规格与组件库 | 23 类 `kind`（18 数据 / 3 内容 / 1 结构 / 1 参数）；`validate_spec` 按 kind 校验；组件 CRUD；种子（内置模板不覆盖用户改动） | `components/spec.py`、`catalog.py`、`repository.py`、`seed_base.py`、`seed_pages.py` | `/api/bi/components*` | B08 |
| B16 ★ | 组件解析与计算 | spec → 参数展开（`valueFrom`）→ `compile_query` → executor → 计算规则；词云兜底计数；辅助列静默降级 | `components/resolver.py`、`compute.py` | 由 B17 调用 | B08、B13、B15 |
| B17 ★ | 看板文档与渲染 | v2.1 文档（视图/平台分套/元素/动作）；并行渲染 + 单卡隔离；15s 渲染缓存；联动、下钻、收藏视图；账本重建 | `dashboards/models.py`、`render.py`、`render_cache.py`、`router.py`、`drill.py`、`favorites.py` | `/api/bi/dashboards/{id}/render`、`/rows`、`/drill` | B15、B16 |
| B18 | 画布与项目 | 自由画布（卡片 = kind + spec + 坐标）CRUD、发布、只读渲染 | `canvas/repository.py`、`router.py` | `/api/bi/canvas/*` | B15 |
| B19 | 模板市场与分享 | 看板深拷贝 + 数据物理复制（`bi_tpl_*`）→ 克隆直接用模板数据；带过期时间的只读分享链接 | `templates/{market,share_links}.py` | `/api/bi/engine/market*` | B08、B17 |
| B20 | 告警 | 只支持指标卡；按创建者身份取数（RLS 一致）；冷却期去重；站内事件 + Webhook | `alerts/evaluate.py`、`repository.py`、`router.py` | `/api/bi/alerts/*` | B17、B22 |
| B21 | 定时报表 | 订阅（每天/每周）→ 生成 HTML + Excel + PDF（无头 Chrome）→ 站内通知；签名下载 | `reports/generate.py`、`scheduler.py`、`browser.py`、`tokens.py` | `/api/bi/reports/*` | B17、B22 |
| B22 | 通知渠道 | 统一 `send(channel, url, …)`：inapp/webhook/钉钉/企微/邮件；失败只记 failed | `notifications/core.py`、`security/outbound.py` | 由 B20/B21 调用 | B36 |
| B23 | 地图数据 | 中国省级 GeoJSON（419KB，gzip 117KB），ETag + 缓存一天，不进前端 bundle | `maps/router.py`、`maps/china.json` | `GET /api/bi/maps/china` | 无 |

**渲染板块的三条不变量**：

1. 组件库只有「类型」，页面实例自带完整 spec —— 库里不复制同类组件。
2. 标题/文字/分割线是页面元素，不进组件库。
3. 单卡失败返回 error 卡，不影响整页；渲染缓存 key 含用户、`updated_at`、视图、参数、现场版面、联动条件。

### 3.5 前端交互

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B24 | 应用壳与导航 | 路由（11 页）、`ProtectedRoute` 权限守卫、主题/壁纸、顶栏、侧栏菜单（按权限显隐） | `features/shell/{App,TopBar,BiSideNav,ThemeContext,ProtectedRoute}.tsx` | `/bi/*` | B03、B37 |
| B25 ★ | 画布编辑器 | 拖拽 + 缩放 + 8px 吸附 + 参考线；撤销栈；平台分套；三栏面板；900ms 自动保存 | `pages/CanvasBoardPage.tsx`、`pages/canvas/{spec,controls,panels}`、`features/components/{board,editor,skin}` | `/bi/canvas` | B17、B26 |
| B26 ★ | 组件渲染器 | 23 种渲染器 + 统一皮肤 + 四尺寸收敛（`CardFit`：图体 <56px 不画轴/标签）；Storybook 8 条 mock | `features/components/registry.tsx`、`renderers/`、`skin/` | 由 B25/B28 调用 | B15、B16 |
| B27 | 组件库与配置面板 | 库列表、组件编辑页、字段面板、查询面板、样式面板、表格明细设置 | `features/components/pages/`、`features/components/editor/` | `/bi/components` | B15、B26 |
| B28 | 看板查看 | 只读渲染（同一套渲染器）、导出、收藏视图、协同权限入口 | `features/viewer/{BiViewPage,DashboardPage,LayersPanel,Inspector,…}.tsx` | `/bi/view/:id`、`/bi/dashboards/:id` | B17 |
| B29 | 数据工作台 | 数据源、数据集、SQL、导入向导、团队看板、测试数据、驾驶舱视图 | `pages/BiDashboardPage.tsx`、`features/bi-dashboard/*` | `/bi` | B06–B14、B17 |
| B30 | 管理后台前端 | 9 个分区：概览/用户/审批/角色/模型/错误/监控/运维/MCP | `pages/AdminPage.tsx`、`features/admin/*` | `/bi/admin` | B32–B34、B38、B40 |
| B31 | MCP 授权页 | 客户端授权、令牌展示、连接说明、工具开关引导 | `features/mcp/{McpAccessPage.tsx,connector.ts}` | `/bi/mcp` | B40 |

**前端权限的两道门**：`ProtectedRoute permKey` 防深链，`BiSideNav` 的 `perm` 字段管菜单显隐；但两者都只是体验层，真正的边界在 B37 后端守卫。

### 3.6 治理与安全

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B32 ★ | RBAC 与数据范围 | 角色 = 功能权限 + 数据范围（all / dept_and_children / dept / self）；部门树；注册审批；每次请求现算 | `rbac/{permissions,seed,models}.py`、`admin/router/`（7 分区） | `/api/admin/*` | B02、B03 |
| B33 ★ | 审计与操作监控 | 操作流水（`log_audit`）、AI 流水、MCP 流水合并；敏感标；来源/状态/用户/关键词筛选 | `audit/{context,log,user_middleware,events,monitor}.py` | `/api/admin/monitor/*` | B02、B04 |
| B34 ★ | 安全卫士 | 只统计攻击型事件；300s/10 次 → IP+指纹+账号同时封 1800s；后台可关、可解封；白名单豁免 | `security/guard/{core,watch}.py` | `/api/admin/monitor/guard*` | B04、B33 |
| B35 | 物理表 RLS | 按 `bi_dataset_scope_rule` 建策略（ENABLE+FORCE）；缺会话变量一律拒绝；规则变更同步策略 | `security/rls_backstop.py`、`security/rls/` | 查询预检自动调用 | B02、B10 |
| B36 | 外发与内容防护 | 邮件/Webhook 域名白名单、内网与元数据地址拦截、不跟随重定向；提示词注入规则、敏感字段、水印 | `security/outbound.py`、`prompt_guard.py`、`denylist.py`、`sensitive_fields.py`、`sql_guard/`、`watermark.py` | 由 B20/B21/AI 调用 | 无 |
| B37 ★ | 业务入口守卫 | `bi:nav:*` 只拦写操作与 SQL 执行；共享读接口不拦（否则编辑与查看都断） | `security/nav/guard.py` | 路由依赖 | B32 |

**「权限现算」的含义**：JWT 只带 `sub` 与 `ver`；每个请求重新读用户状态、角色、角色权限、数据范围。改权限/停用/降级立刻生效，不依赖令牌过期——这条是 Yunith 时期踩过坑后固化下来的规则，本项目同样遵守。

### 3.7 AI 与 Agent

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B38 ★ | AI 引擎与模型配置 | 唯一解析入口 `candidate_configs()`（库默认 → 库其它 → `data/ai_models.json` → 环境变量）；逐个真实请求、失败换下一个；Key 加密、接口只回掩码；每日调用/token 配额；`ai.call` 审计 | `ai/engine/{core,phase2,phase3,agent,models,quota}.py`、`routers/bi_engine/ai.py`、`features/admin/ModelsPanel.tsx` | `/api/bi/engine/ai/*`、`/api/admin/models*` | B02、B32、B36 |
| B39 | AI 排版与推荐 | 纯函数版面算法（只出 ops，不写库）；字段→组件推荐；A4 与 `bi_add_item` 共用 `dashboards/items.py` | `ai/layout.py`、`ai/recommend.py`、`ai/router.py`、`editor/AiLayoutBar.tsx` | `/api/bi/ai/layout`、`/recommend` | B15、B17 |
| B40 ★ | MCP 网关 | 授权 → 令牌（1h JWT，`aud=mcp`）→ JSON-RPC；每次调用重算：令牌/吊销/`token_version`/用户状态/客户端启用/授权未撤/工具策略/权限码；幂等、循环防护、编排 | `mcp/gateway.py`、`auth.py`、`validate.py`、`orchestration.py`、`loop_guard.py`、`router.py` | `/api/mcp/*`、`/api/admin/mcp/*` | B13、B32 |
| B41 | MCP 工具与策略 | 17 个工具（只读 11 + 写看板 6）；一律走服务层、取数必带 `dataset_id`；数据分级、单次行数上限、每日预算、QPS、失败熔断、异常冻结 | `mcp/tools.py`、`security_policy.py`、`limits.py` | 由 B40 调用 | B08、B13、B17 |

**MCP 写工具的四个硬边界**（B40/B41 共同守）：

1. 只改自己建的草稿（`bi_mcp_dashboard` + `owner_id`），用户手工看板 403。
2. 保存前跑 `render_dashboard` 自检，任一卡 error 直接 400。
3. 乐观锁，冲突 409；布局越界 400。
4. 发布只能用户点，Agent 恒 403。

### 3.8 交付与质量

| 编号 | 板块 | 职责 | 代码根 | 主要入口 | 依赖 |
|---|---|---|---|---|---|
| B42 | 部署与探针 | `/api/livez` 不碰 DB、`/api/readyz` DB 不可用 503；compose（单/多 worker 叠加）、Helm（API/前端/worker/Ingress/HPA）、GlitchTip 自建 | `main.py` 探针段、`docker-compose*.yml`、`deploy/helm/mingcebi/`、`deploy/glitchtip/` | K8s / compose | 全部 |
| B43 | 质量门禁 | 后端 pytest 344；前端 vitest 58、tsc、build、budget；e2e 7 条、视觉回归 4 页；Storybook 编译；真实链路脚本 20+ 个 | `backend/tests/`、`frontend/e2e/`、`frontend/scripts/`、`scripts/*_check.py` | `pytest`、`npm run e2e` 等 | 全部 |
| B44 | 规则与文档 | 开发规则（AGENTS）、仓库操作规范、更新日志、组件契约/开发规范、MCP 与安全方案、本文 | `AGENTS.md`、`docs/` | 人读 | 无 |

---

## 4. 六条关键链路

### 4.1 登录 → 权限装载

```text
POST /api/auth/login
  → services/auth 校验口令/审批状态/启用状态
  → 签发 access + refresh（带 token_version）
  → 前端 AuthContext 存 token，拉 /api/auth/me
  → effective_permissions 现算（角色权限 ∪ 数据范围）
  → 菜单按 bi:nav:* 过滤；路由按 permKey 守卫
失败点：审批 pending → 不发 token；停用/改密 → token_version 不匹配 → 401
```

### 4.2 接入数据 → 建数据集

```text
新建数据源（B06：类型目录 → 连接串 → 测试连接）
  → 读表结构（B07）→ 落 columns_snapshot / schema_hash
  → 建数据集（B08）：选表 / 上传 CSV → 建物理表 bi_src_<id>_<名>_<hash>
  → 字段角色（dimension/time/measure/id）→ 指标口径（B08/B09）
  → 可选：部门归属（B10）→ 行/列规则 → RLS 策略（B35）
失败点：驱动未装 → 目录 available=false 置灰；方言不支持粒度 → 明确报错，不回退 PG
```

### 4.3 画看板 → 渲染

```text
编辑器（B25）保存文档（B17，bi_canvas.doc，v2.1）
  → 页面查看 /bi/view/:id
  → POST /render（B17）
  → render_cache（15s，key 含用户/doc.updated_at/视图/参数）
  → 逐元素 resolve（B16）：筛选栏汇总参数 → spec → compile_query（B08）
  → executor（B13）：RLS/脱敏 → builder（B12）→ SQL → 超时/配额
  → compute（B16）：聚合与派生统计
  → cards[] 回前端 → 渲染器（B26）按 kind 画
失败点：单卡 error 不影响整页；字段不存在 → 该卡报「未知字段」，不整页 500
```

### 4.4 导出 / 定时报表

```text
手动导出 POST /api/bi/reports/export/{id}（B21）
  → 权限按格式分：xlsx→bi:data:export:detail；html/pdf/png→summary
  → render_dashboard（与页面同口径）→ HTML（内联样式）+ Excel + 无头 Chrome PDF
  → 写审计 data.export.*
定时：scheduler 60s → 到期订阅 → 生成 → 站内事件 + Webhook（B22，过 B36 外发校验）
失败点：无 Chrome 只跳过 PDF；外发目标不合规 → 400/403，不影响站内通知
```

### 4.5 告警

```text
规则（指标卡 + 阈值/波动，B20）→ 后台 60s 评估（advisory lock）
  → render_dashboard（创建者身份，RLS 与看板一致）
  → 命中 → 冷却期判断 → 写 bi_alert_event（站内）→ Webhook/钉钉/企微/邮件
失败点：取数失败只记 failed；Webhook 超时 5s 不重试轰炸
```

### 4.6 Agent（MCP）

```text
用户授权 POST /api/mcp/grants → 拿 client_id + secret + refresh_token
Agent 换令牌 POST /api/mcp/token → 1h JWT（aud=mcp, jti）
调用 POST /api/mcp/rpc（initialize / tools/list / tools/call）
  → B40 七层重算 → B41 工具执行（服务层，不绕 HTTP）
  → executor（dataset_id 必传）→ 数据分级/行数预算/冻结判定
  → 写 bi_mcp_audit（含行数、耗时、拒绝原因）
失败点：权限 403 / 额度 429 / 冲突 409 / 参数 400 / 其它业务错误 200+error body
```

---

## 5. 数据契约（四层）

```text
① 语义层      DatasetField / DatasetMetric    （人话：字段与口径）
        │ semantic.compile_query
② 查询层      QueryObject                      （要什么，不写 SQL）
        │ builder + executor
③ 展示层      ComponentSpec                    （怎么画）
        │ dashboards.render
④ 版面层      DashboardDoc                     （放哪儿、几个视图、什么动作）
        │ render
⑤ 渲染结果    cards[]                          （前端只画，不再算）
```

### 5.1 语义层（`semantic/models.py`）

| 对象 | 关键字段 | 不变量 |
|---|---|---|
| `DatasetField` | `name`、`source_column`、`role∈{dimension,time,measure,id}`、`data_type`、`is_filterable`、`is_groupable`、`default_grain` | 物理列只在这里出现；`role=id` 可筛选但不分组不聚合 |
| `DatasetMetric` | `name`、`expression`、`agg`、`format`、`version`、`certified` | 表达式入库前过 `validate_metric_expression`；口径变了才 `version+1` |

### 5.2 查询契约（`query/contract.py`）

| 字段 | 说明 |
|---|---|
| `table` | 必须在白名单（`query/whitelist.py`，含 `bi_src_*`、`bi_tpl_*` 前缀） |
| `dimensions[]` | 语义字段名或物理列；中文与空格允许，引号由 builder 负责 |
| `metrics[]` | 指标（`agg` + `column` 或已校验的表达式），**不接受 HTTP 传入的表达式** |
| `filters[]` | `{column, op, value}`；op 白名单；值一律参数绑定 |
| `grain` | 时间粒度；方言不支持时明确报错 |
| `order_by / limit` | 结构化校验，不拼接字符串 |
| `dataset_id` | **必传**：行/列规则、部门隔离、缓存键都依赖它 |
| `dialect` | 由数据源类型收敛（MySQL / MSSQL / Hive / Impala / 其余） |

### 5.3 组件契约（`components/spec.py`）

| 段 | 内容 | 说明 |
|---|---|---|
| `ui` | `accent`、`min_height`、`compact`… | 外观令牌，渲染器只读 |
| `binding` | `dataset_id`、`dimension`、`metric`、`agg`、`metrics[]`、`top_n`、`sort`、`limit`、`grain`、`order_by_dimension`、`filters[]`、`dimensions[]` | 时间序列必须 `order_by_dimension=true`，否则会被按值重排 |
| `compute` | `headline`、`hint`、`format` | 派生统计口径只在这里算 |
| `chart / table_view / rank / filter / top / nav / banner` | 按 kind 启用的子段 | 面板控件与字段一一对应，同一语义只有一个入口 |
| `kind` | 23 类 | 新增 kind 必须同时改 5 处（§8.A） |

### 5.4 版面契约（`dashboards/models.py`）

| 部分 | 内容 | 说明 |
|---|---|---|
| `version` | 2.1 | 读取时 `validate_doc(heal=True)` 自愈旧结构；旧数据兼容见 `dashboards/models.py` |
| `header` | `kicker/title/subtitle/stats[]` | stats 也是组件实例 |
| `views[]` | `{key,title,items[],items_map{平台:[…]}}` | 平台分套：共用筛选栏在 `items`，各平台卡在 `items_map` |
| `items[]` | `chart / filter / heading / text / divider` | `chart` 自带 spec；`component` 只记基础类型 |
| `layout` | `{x,y,w,h}` | 8px 栅格，1440 设计宽度等比适配 |
| `action / row_action` | 目标 spec + 覆盖参数 | 浮层复用渲染器，不另造「弹窗专用表」 |

**参数链路**：筛选栏字段 → 页面参数 → 组件 `binding.filters[].valueFrom="param:<id>"` → 查询条件。参数**只能**经 `valueFrom` 进入 SQL，绝不字符串拼接。

---

## 6. 安全边界（七层）

### 6.1 七层拦截

| 层 | 拦什么 | 实现 | 失败表现 |
|---|---|---|---|
| ① 入口 | 扫描路径、限流、CSRF、已封禁来源 | `security_watch`、`rate_limit`、`csrf`、`guard` | 403/429 |
| ② 身份 | 无令牌、过期、`token_version` 变更、账号停用/待审批 | `middleware/auth`、`services/auth` | 401/403 |
| ③ 功能权限 | 能做什么（后台分区 / 业务入口 / AI / MCP / 导出 / 删除） | `admin/permissions.require()`、`nav_guard` | 403 |
| ④ 数据范围 | 能看哪些部门（all / dept_and_children / dept / self） | `permissions.data_scope`、`scoped_department_ids` | 403 或列表为空 |
| ⑤ 行级 | 能看哪些行（数据集规则 + 部门隔离 + 物理表 RLS） | `dataset_rules`、`dept_scope`、`rls_backstop` | 403（fail-closed） |
| ⑥ 列级 | 哪些列要脱敏 | `masking`、`dataset_column_mask` | 返回脱敏值 |
| ⑦ 外发/审计 | 数据发给谁、谁做了什么 | `outbound`、`log_audit`、`bi_mcp_audit`、`bi_ai_audit_log` | 400/403 + 审计留痕 |

### 6.2 错误语义（全站统一）

| 场景 | 状态码 | 约定 |
|---|---|---|
| 未登录 / 令牌无效 | 401 | 前端清会话跳登录 |
| 权限不足 / 越权 / 规则失效 | 403 | 不泄露「是否存在」 |
| 参数结构错误 / 版面越界 | 400 | 明确字段名 |
| 乐观锁冲突 | 409 | 提示重新加载 |
| 配额 / 限流 / 熔断 | 429 | 带 `Retry-After` |
| 连接池耗尽 / 数据库繁忙 | 503 | 带 `Retry-After`，不刷 Sentry |
| Agent 工具内部业务错误 | 200 + JSON-RPC error | 网关统一转换 |

### 6.3 审计留痕点

| 动作 | 表 / 通道 | 归属板块 |
|---|---|---|
| 登录、改密、权限、角色、部门、模型、导出、删除 | `bi_audit_logs`（`log_audit`） | B33 |
| 匿名/无效令牌/越权/限流/扫描 | `bi_security_event` | B33/B34 |
| 封禁命中与解封 | `bi_guard_hit` / `bi_security_block` | B34 |
| Agent 每次调用（含拒绝原因、行数） | `bi_mcp_audit` | B40 |
| AI 每次调用（含回退与失败） | `bi_ai_audit_log` | B38 |
| 外部直连数据库会话 | `bi_security_event`（`db_external_session` 采样） | B33 |

---

## 7. 新增一个板块的标准动作

### 7.1 动手前先写清三件事

1. **一句话职责**：它负责什么、**明确不负责什么**（防止板块膨胀）。
2. **契约**：对外暴露什么（HTTP 路径 / 服务函数 / 数据模型），依赖谁、被谁依赖。
3. **摘除方案**：关掉它，系统还能不能跑？如果会断主链路，说明边界划错了。

### 7.2 后端板块模板

```text
backend/app/<block>/
├── __init__.py
├── router.py        # 只做 HTTP 适配：解析 → 调服务 → 错误映射
├── repository.py    # 只做 SQL / 表访问（本板块私表）
├── service.py       # 业务规则（可纯函数化的部分单独拆）
└── models.py        # Pydantic 契约（对外）或 dataclass（内部）

backend/schema/migrations/0xx_<block>.sql   # 新表；不改历史迁移
```

```python
# router.py 骨架
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.admin.permissions import require
from app.database import get_db
from app.middleware.audit import log_audit
from app.middleware.auth import get_current_user

router = APIRouter()


@router.post("/items", dependencies=[Depends(require("bi:<domain>:<action>"))])
def create_item(payload: ItemIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    item = service.create(db, payload, user)
    log_audit(db, f"<domain>.create", "item", item.id, {"name": item.name})
    return item
```

### 7.3 前端板块模板

```text
frontend/src/features/<block>/
├── <Block>Panel.tsx     # 主视图
├── <Block>Dialog.tsx    # 浮层（需要时）
└── __tests__/           # 纯函数测试（格式化 / 判定类）
```

- 路由加在 `src/App.tsx`，需要权限就包 `ProtectedRoute permKey="bi:<...>"`；
- 菜单加在 `BiSideNav`（`perm` 字段）与/或管理后台 `AdminPage` 的分区表；
- 网络请求一律走 `src/api/client.ts`（自动带 token / CSRF / 错误上报）。

### 7.4 注册清单（当前必须手工改的 4 处）

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `backend/app/main.py` | `include_router(<block>.router, prefix="/api")` |
| 2 | `backend/app/admin/permissions.py` + `services/rbac_seed.py` | 新权限码（必须同时进 `VISIBLE_PERMISSION_CODES`） |
| 3 | `frontend/src/App.tsx` + `BiSideNav.tsx` / `AdminPage.tsx` | 路由 + 菜单 + 守卫 |
| 4 | `backend/schema/migrations/0xx_*.sql` | 新表（只追加） |

> 这 4 处就是「无限拓展」的成本上限。如果要继续降低，演进方向是 §9.3 的 `blocks.yaml` 注册表。

### 7.5 板块完成的定义（DoD）

| 维度 | 必须做到 | 怎么验 |
|---|---|---|
| 功能 | 真实链路跑通，正反两面都有证据 | 正例：真实数据返回；反例：断网/空数据/错误参数 |
| 权限 | 写接口挂权限码；敏感写写审计 | `scripts/admin_permission_matrix.py` 类断言 |
| 数据 | 新表有迁移；取数走 executor 且传 `dataset_id` | 查询日志 / 单测 |
| 前端 | 空态、加载、错误、窄屏、溢出都有处理 | 逐屏截图 + 视觉回归 |
| 丝滑度 | 高频事件先比较再 setState；落点/反馈符合 §3.2 | 真机拖拽/滚动验收 |
| 门禁 | `pytest` + `tsc` + `npm test` 通过；真实链路脚本通过 | CI / 本地命令 |
| 可摘除 | 关开关后主链路仍可用 | 摘除演练 |
| 文档 | 更新日志顶部一条；AGENTS / 本文登记 | 人工核对 |

---

## 8. 五类典型扩展（文件级清单）

### A. 新增一种图表组件（最高频）

必须同时动 **5 处后端 + 3 处前端**，并同步组件库：

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `backend/app/components/spec.py` | `KINDS`、`ROLES`、`_KIND_CN`、`validate_spec` 分支、必要的 `XxxSpec` |
| 2 | `backend/app/components/compute.py` | `build_content` 分支 |
| 3 | `backend/app/components/resolver.py` | 纯内容组件进 `KIND_CONTENT`（跳过 SQL） |
| 4 | `backend/app/components/seed_base.py` | `BASE` 里加种子（否则类型栏不出现） |
| 5 | `backend/app/components/repository.py` / 组件库同步 | 现有库行 `UPDATE bi_component.spec`；模板不写死 `dataset_id` |
| 6 | `frontend/src/features/components/types.ts` + `registry.tsx` | Kind 类型、`RENDERERS`、`KIND_LABEL`、`KIND_ROLE` |
| 7 | `frontend/src/features/components/renderers/XxxCard.tsx` | 渲染器（复用 `skin/CardShell` + `CardFit`） |
| 8 | `frontend/src/features/components/editor/QueryPanel.tsx` / `StylePanel.tsx` | 数据配置与外观分支 |

**验收**：四尺寸（224×104 / compact / 常规 / 大屏）不压叠不溢出；`npm run build-storybook` 通过；组件库缩略图不塌成灰条；`frontend/src/features/components/__tests__` 补边界用例。

### B. 新增一种数据源

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `backend/app/sources/types_catalog.py` | 类型条目（分类、图标、默认端口、驱动检查） |
| 2 | `backend/app/sources/repository.py` | `TYPE_DIALECT` 方言映射、连接串拼装 |
| 3 | `backend/requirements.txt` | 驱动依赖（写明发行版版本） |
| 4 | `backend/tests/test_source_types.py` / `test_source_urls.py` | 目录与方言一一对应、连接串拼装 |

**验收（缺一不可）**：真机连库、读表结构、查询、方言 SQL（引号 / 时间粒度 / `NULLS LAST` 降级）；缺驱动时目录返回 `available=false` 并在界面置灰。

### C. 新增一种治理/安全能力（横切板块）

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `backend/app/security/<capability>.py` | 纯函数优先（可单测），失败一律 fail-closed |
| 2 | `backend/app/middleware/` 或注入点 | 选择接入位置（入口 / 查询 / 外发），不要散落多处 |
| 3 | `backend/app/admin/router/` 或 `monitor.py` | 管理端开关与查询接口（如需） |
| 4 | `backend/schema/migrations/0xx_*.sql` | 命中流水 / 封禁 / 规则表 |
| 5 | `scripts/<capability>_check.py` | 真实链路回归（自带清场与状态恢复） |
| 6 | `AGENTS.md` + 更新日志 | 口径、旋钮、边界写清楚 |

**验收**：正例拦截生效、反例不误伤（白名单 / 正常用户 / 关闭开关）；多 worker 下的去重（advisory lock）。

### D. 新增一个前端页面

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `frontend/src/pages/XxxPage.tsx` | 页面（懒加载） |
| 2 | `frontend/src/App.tsx` | 路由 + `ProtectedRoute permKey` |
| 3 | `frontend/src/features/bi-dashboard/BiSideNav.tsx` | 菜单项 + `perm` |
| 4 | `frontend/src/api/client.ts`（或新 API 模块） | 接口封装 |
| 5 | `frontend/src/features/<domain>/` | 业务组件与纯函数测试 |

**验收**：空态 / 加载 / 错误 / 窄屏；权限不足时菜单不显示、深链 403 回落；视觉回归 4 页不漂移。

### E. 新增一个 Agent（MCP）工具

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `backend/app/mcp/tools.py` | `TOOLS` 注册表（schema + handler，只走服务层） |
| 2 | `backend/schema/migrations/0xx_*.sql` 或种子 | `bi_mcp_tool` 目录条目（高危默认关） |
| 3 | `backend/app/admin/permissions.py` | 需要新权限码时（`bi:mcp:*` 或数据能力） |
| 4 | `backend/app/mcp/security_policy.py` / `limits.py` | 若涉及取数：分级、行数上限、预算 |
| 5 | `scripts/mcp_gateway_check.py` / `mcp_write_check.py` | 补断言（拒绝路径、审计、额度） |

**验收**：取数必带 `dataset_id`；权限拒绝 403 + denied 审计；参数错误 200 + error body；幂等键防重复执行。

---

## 9. 现状矩阵与下一批板块

### 9.1 成熟度（按证据，不按感觉）

| 板块 | 状态 | 证据 |
|---|---|---|
| 组件规格/渲染/组件库 | **成熟** | 23 类组件、四尺寸收敛、Storybook 8 条、fixtures、视觉回归 |
| 语义层/查询内核 | **成熟** | 方言回归、字段血缘、数据集规则、连接串拼装全有 pytest |
| RBAC/数据范围 | **成熟** | `admin_permission_matrix.py` 189 项断言 |
| 安全卫士/审计/RLS | **生产可用** | 4 个真实链路脚本（10/9/17/32 项，自带清场） |
| MCP 网关与工具 | **生产可用** | gateway 15 项、write 34 项、production 检查 |
| 看板渲染/导出 | **可用** | 渲染 200 且单卡隔离；导出分权已接 |
| 告警/定时报表 | **可用** | 有代码与页面，回归偏薄（需真实 Webhook/SMTP 环境） |
| AI 引擎 | **可用** | 候选回退、配额、审计齐；质量受外部模型影响 |
| 前端数据工作台 | **可用但偏重** | `features/bi-dashboard/` 目录过大，页面与逻辑耦合 |
| 模板市场 | **可用** | 深拷贝 + 数据副本；缺独立回归脚本 |
| Doris 同步 | **试验** | 未接入调度，默认不启用 |
| 旧版引擎聚合路由 | **已拆分**（2026-11-17） | `routers/bi_engine/` 13 个模块 · 95 条路由；OpenAPI 253 路径不变 |

### 9.2 已识别的缺口（真实存在，不是推测）

| 缺口 | 影响 | 归属 |
|---|---|---|
| 客户端 CSV 导出（导航卡/明细表）未受导出权限约束 | 数据外带绕过权限码 | B37 / B21 |
| 告警/报表缺真实 Webhook + SMTP 的端到端回归 | 通道故障只能线上发现 | B20 / B21 / B22 |
| `bi_dashboards` 是遗留空表 | 排查时容易查错表 | B02 |
| Hive / Impala / Db2 未适配时间粒度 | 明确报错，但体验受限 | B11 / B12 |
| Storybook 未包含地图组件 | 地图只能真机验 | B26 |
| 多 worker 下 `/api/metrics` 是单进程口径 | 运维读数需分实例看 | B05 |
| 4 处手工注册（路由/权限/菜单/迁移） | 新板块仍有固定摩擦 | B01 |

### 9.3 建议的下一批板块（按投入产出排序）

| 优先级 | 新板块 | 为什么现在做 | 最小切口 |
|---|---|---|---|
| P0 | **板块注册表**（`blocks.yaml` → 路由/权限/菜单/文档） | 把「无限拓展」的 4 处手工注册收敛成 1 处，新板块只写一份元数据 | 先只驱动前端菜单 + 权限码目录，路由仍手写 |
| P0 | **导出权限统一板块** | 补上客户端 CSV 导出的分权与审计（当前绕过） | 前端导出改走报告导出接口，或加 `bi:data:export:*` 校验 |
| P1 | **任务中心板块** | 告警/报表/同步/刷新四套后台循环各自为政，缺统一视图与开关 | 抽出 `scheduler` 注册表 + `/api/admin/tasks` |
| P1 | **数据质量板块** | 结构漂移已有，但空值率/主键重复/口径突变没有 | 纯函数检查器 + 数据集页签，不阻塞查询 |
| P2 | **工作台前端拆分** | `features/bi-dashboard` 过大，拖慢迭代 | 按「数据接入 / 分析 / 团队 / 驾驶舱」拆目录，行为不变 |
| P3 | **Doris 同步接入调度** | 当前是死代码，要么接上要么标注弃用 | 接入 `sync_scheduler` 或删除入口 |

> 已完成（2026-11-17）：
> 1. 旧引擎路由拆包——`routers/bi_engine.py` 4219 行 / 95 个端点 → 13 个模块，URL 与 OpenAPI 完全不变；
> 2. `admin/router.py` 1677 行 → `admin/router/` 7 个分区 + common，URL 与 OpenAPI 不变；
> 3. `CanvasBoardPage.tsx` 第一刀 3403 → 2658 行（抽出 `pages/canvas/{spec,controls,panels}`）。

### 9.4 板块落地状态（2026-11-17 审计，防止把「地图」当「现状」）

> 判断口径：这一块的代码是否**主要落在一个目录**。44 块是逻辑职责，不等于 44 个文件夹。

| 状态 | 数量 | 说明 |
|---|---:|---|
| 有目录承载 | 38 | 其中 5 个目录是「多块共享」：`query/`（B11–B13）、`components/`（B15/B16）、`sources/`（B06/B07）、`mcp/`（B40/B41）、`security/`（B10/B35/B36/B37） |
| 单文件（职责清楚但未建目录） | 0 | B14 `routers/bi_query.py`、B22 `notifications.py`、B37 `security/nav_guard.py` |
| 跨 2 处以上（待收敛 / 保留） | 3 | 见下表 |
| 天然跨（交付 / 门禁 / 文档） | 3 | B42 部署、B43 质量门禁、B44 文档 |

**待收敛的 16 块（代码量 = 当前主要文件行数）**：

| 板块 | 当前落点 | 规模 | 收敛方向 |
|---|---|---|---|
| B01 应用装配 | `main.py`、`config.py`、`bootstrap.py`、`schema_migrations.py` | 4 个根文件 | 装配类可保留（不追求目录） |
| B02 存储与迁移 | `database.py`、`models/`、`schema_migrations.py`、`schema/migrations/` | 根文件 + 目录 | 影响面大，暂不动 |
| B25 画布编辑器 | `CanvasBoardPage.tsx`（**3403 → 1646**）+ `pages/canvas/{spec,controls,panels,PageTabs,CanvasDialogs,LeftDatasetPane,MiddleConfigPane,ChartRailPane,EditorToolbar,CanvasStage,useCanvasHistory,useCanvasClipboard}` + `components/{board,editor,skin}` | 已拆 12 个模块（9 UI + 2 hooks + types）；页面剩状态机与保存/分页编排（有意保留） | 组件层已拆完；如需更薄可再抽 pages/persist hooks |

> 已完成（2026-11-17）：B03 认证 → `app/auth/`（router / service / deps）+ `features/auth/`（AuthContext / useAuth）；
> 后端旧路径保留 re-export 垫片，前端 import 已全部切换。
>
> 已完成（2026-11-17）：B33 审计 → `app/audit/`（context / log / user_middleware / events / monitor）；
> `middleware/audit*.py`、`security/security_events.py`、`admin/monitor.py` 保留 re-export 垫片。
>
> 已完成（2026-11-17）：B38 AI 引擎 → `app/ai/engine/`（core / phase2 / phase3 / agent / models / quota）；
> `services/bi_ai_*.py`、`ai_models.py`、`ai_quota.py` 保留 re-export 垫片，`bi_engine/ai.py` 原地不动。
>
> 已完成（2026-11-17，批量收敛）：B05 可观测 → `app/observability/`；B09 血缘 → `semantic/lineage.py`；
> B10 数据集安全 → `security/dataset/`；B14 查询 API → `query/api.py`；B19 模板市场 → `app/templates/`；
> B22 通知 → `app/notifications/`；B24 应用壳 → `features/shell/`；B27 组件库页 → `features/components/pages/`；
> B28 看板查看 → `features/viewer/`（含 DashboardPage 拆分）；B31 MCP 页 → `features/mcp/`；
> B32 RBAC → `app/rbac/`；B34 安全卫士 → `security/guard/`；B37 入口守卫 → `security/nav/`。
> 三者以外的 B01/B02 仍为装配/存储的天然跨文件；B25 页面保留 1646 行状态机（有意）。

**建议收敛顺序**（每步都按「OpenAPI 快照 + pytest + 启动 + 冒烟」四道门禁）：

1. ~~B03 认证 → `app/auth/`~~ → ✅ 已完成（2026-11-17，旧后端路径留兼容垫片）
2. B32 RBAC → `app/rbac/`（`admin/router` 已拆；搬 permissions / rbac_seed / models 即可）
3. ~~B33 审计 → `app/audit/`~~ → ✅ 已完成（2026-11-17，旧路径留兼容垫片）
4. ~~B38 AI 引擎 → `app/ai/engine/`~~ → ✅ 已完成（2026-11-17，旧 services 路径留兼容垫片）
5. B19 模板市场 → `app/templates/`
6. B05 可观测 → `app/observability/`
7. ~~前端 B25 `CanvasBoardPage`~~ → ✅ 已完成（组件层 3403→1646，12 个模块；见更新日志）
8. 前端 B24 应用壳 / B28 看板查看 → `features/shell/`、`features/viewer/`
9. B14 / B22 / B37 单文件 → 建目录（收益低，最后做）

**不建议把 44 块逐一建目录**（2026-11-17 决策）：

- 物理模块保持在 **~18 个**（当前后端 20 个域目录），44 块继续作为**治理口径**（权限码、验收、文档、责任人），
  两层之间用本节的映射表对应，不追求 1:1。
- 理由：`query/`（3 块）、`components/`（2 块）、`sources/`（2 块）、`mcp/`（2 块）、`security/`（4–6 块）本来就是同一
  生命周期的代码；强行拆成 44 个包会出现大量 1–3 文件的空壳目录、跨包 import 与兼容 shim，review 与跳转成本反而上升。
- 真正值得拆的只有三类：① 千行级热点文件；② 跨 3 处以上、且没有单一归属的板块（B32 RBAC / B33 审计 / B38 AI 引擎）；③ 每次改动都要同时打开 3 个以上文件的链路。
- 千行文件的现状：**已拆** `bi_engine`(4219→13 模块)、`admin/router`(1677→8 文件)、`CanvasBoardPage`(3403→1646)；
  **待拆** `DatasetPanel` 1790、`DashboardPage` 1544、`QueryPanel` 1226、`bi_engine/ai.py` 1045。
- 单文件 / 装配 / 交付类板块（B01、B02、B14、B22、B37、B42–B44）**保持现状**，不为「整齐」付迁移成本。

---

## 10. 附录

### A. 目录速查

```text
backend/
├─ app/
│  ├─ main.py                 装配（中间件/路由/启动/异常/探针）
│  ├─ config.py  database.py  配置与连接池
│  ├─ bootstrap.py            启动序列（幂等）
│  ├─ middleware/             限流/CSRF/日志/审计/安全指纹
│  ├─ routers/                旧版聚合入口（auth/bi_engine/bi_query/...）
│  ├─ sources/                数据源类型目录/连接/同步
│  ├─ semantic/               数据集/字段/指标/编译/校验/导入
│  ├─ query/                  契约/SQL 构建/执行器/异步任务
│  ├─ components/             组件规格/解析/计算/种子
│  ├─ dashboards/             看板文档/渲染/缓存/下钻/收藏
│  ├─ canvas/                 自由画布
│  ├─ alerts/ reports/        告警与定时报表
│  ├─ admin/                  权限码/RBAC/管理接口/操作监控
│  ├─ security/               数据集规则/RLS/安全卫士/外发/守卫
│  ├─ mcp/                    网关/工具/取数策略/限额
│  ├─ ai/                     AI 排版与推荐
│  ├─ errors/ maps/           错误日志 / 地图数据
│  └─ services/               认证/AI/配额/加密/持久化/分享
├─ schema/migrations/         61 个增量迁移（编号 001–063，个别号跳过）
└─ tests/                     pytest 344

frontend/
├─ src/
│  ├─ App.tsx  main.tsx       路由与入口
│  ├─ api/                    axios 客户端（token/CSRF/错误上报）
│  ├─ components/             应用壳（顶栏/守卫/通用）
│  ├─ contexts/               认证 / 主题
│  ├─ pages/                  11 个页面
│  ├─ features/
│  │  ├─ components/          渲染器/编辑器/画布/皮肤/组件库
│  │  ├─ bi-dashboard/        数据工作台（数据源/数据集/SQL/团队）
│  │  ├─ admin/               9 个后台面板
│  │  └─ mcp/                 Agent 连接说明
│  ├─ observability/          Sentry 前端
│  └─ types/                  共享类型
├─ e2e/                       Playwright 主链路 + 视觉 + 性能
├─ packages/mylayout/         自研布局引擎（file: 依赖）
└─ scripts/                   预算/性能/配置一致性检查

scripts/                      真实链路回归（权限/安全/RLS/MCP/外发…）
deploy/                       helm（mingcebi）+ glitchtip
docs/                         规则、契约、方案、更新日志、本说明
```

### B. API 前缀表（253 个路径）

| 前缀 | 路径数 | 归属板块 |
|---|---|---|
| `/api/auth/*` | 10 | B03 |
| `/api/bi/engine/*` | 86 | 旧版聚合（B14/B19/B21/B38 等混装） |
| `/api/bi/semantic/*` | 27 | B08 / B09 / B10 |
| `/api/bi/sources/*` | 15 | B06 / B07 |
| `/api/bi/dashboards/*` | 14 | B17 |
| `/api/bi/components/*` | 9 | B15 |
| `/api/bi/query/*` | 8 | B14 |
| `/api/bi/alerts/*` | 8 | B20 |
| `/api/bi/reports/*` | 8 | B21 |
| `/api/bi/team/*` | 6 | B17（协同） |
| `/api/bi/canvas/*` | 5 | B18 |
| `/api/bi/datasource/*` | 4 | B06 |
| `/api/bi/ai/*` | 2 | B39 |
| `/api/admin/*` | 36 | B30 / B32 / B33 / B38 / B40 |
| `/api/mcp/*` | 6 | B40 |
| `/api/{health,livez,readyz,version,metrics,report}` | 6 | B05 / B42 |

### C. 数据表分组（88 张）

| 分组 | 代表表 | 归属 |
|---|---|---|
| 账号与权限 | `users`、`roles`、`permissions`、`role_permission`、`departments`、`bi_resource_permissions` | B32 |
| 语义与治理 | `bi_dataset`、`bi_dataset_field`、`bi_dataset_metric`、`bi_metric_version`、`bi_metadata_fields` | B08 / B09 |
| 安全规则 | `bi_dataset_row_rule`、`bi_dataset_column_mask`、`bi_dataset_scope_rule`、`bi_row_permissions`、`bi_column_masks` | B10 / B35 |
| 连接与同步 | `bi_source`、`bi_source_table`、`bi_sync_logs`、`bi_src_*`、`bi_tpl_*` | B06 / B07 |
| 画布与看板 | `bi_canvas`、`bi_component`、`bi_dash_item_source`、`bi_board_favorite`、`bi_template_market` | B15 / B17 / B18 / B19 |
| 告警与报表 | `bi_alert_rule`、`bi_alert_event`、`bi_report_subscription`、`bi_report_run` | B20 / B21 |
| 审计与安全 | `bi_audit_logs`、`bi_security_event`、`bi_security_block`、`bi_guard_hit`、`bi_error_log` | B33 / B34 / B05 |
| AI 与 MCP | `bi_ai_model`、`bi_ai_usage`、`bi_ai_audit_log`、`bi_mcp_*`（9 张） | B38 / B40 / B41 |
| 查询治理 | `bi_query_slow` | B13 |
| 业务样例 | `bi_demo_sku`、`bi_demand_*`、`bi_pdd_*`、`bi_tmall*`、`bi_rank_board` | 数据集（非板块） |
| 系统 | `schema_migrations`、`bi_app_setting` | B02 |

### D. 权限码（22 个，全部在 `VISIBLE_PERMISSION_CODES` 内）

| 分组 | 权限码 |
|---|---|
| 管理后台（9） | `bi:overview` `bi:user:manage` `bi:user:approve` `bi:role:manage` `bi:model:manage` `bi:error:view` `bi:audit:view` `bi:ops:manage` `bi:mcp:manage` |
| 业务入口（5） | `bi:nav:datasets` `bi:nav:datasources` `bi:nav:sql` `bi:nav:components` `bi:nav:editor` |
| AI 能力（3） | `bi:ai:use` `bi:ai:sql` `bi:ai:export` |
| MCP 能力（2） | `bi:mcp:use` `bi:mcp:write` |
| 数据能力（3） | `bi:data:export:summary` `bi:data:export:detail` `bi:resource:delete` |

> 不在白名单里的权限码（`kb:*`、`teamspace:*`、`user:*`、`system:*`）没有任何功能承载，勾了也不生效——新增权限码必须同时进白名单与种子。

### E. 关键环境变量（按板块）

| 板块 | 旋钮 |
|---|---|
| 查询治理 | `BI_QUERY_TIMEOUT_MS`、`BI_USER_MAX_CONCURRENT`、`BI_QUERY_QUOTA`、`DB_SLOW_QUERY_MS`、`BI_SLOW_SAMPLE_MS` |
| 渲染 | `BI_RENDER_WORKERS`、`BI_RENDER_MAX_THREADS`、`BI_RENDER_CACHE_TTL` |
| 连接池 | `DB_POOL_SIZE`、`DB_MAX_OVERFLOW`、`DB_POOL_TIMEOUT` |
| 异步任务 | `BI_JOB_STORE`、`BI_JOB_EXECUTOR`、`BI_ASYNC_WORKERS`、`BI_WORKER_POLL_SECONDS` |
| 安全卫士 | `BI_GUARD_ENABLED`、`BI_GUARD_WINDOW_SECONDS`、`BI_GUARD_MAX_HITS`、`BI_GUARD_BAN_SECONDS`、`BI_GUARD_WHITELIST_IPS` |
| RLS | `BI_RLS_APP_ROLE` |
| 外发 | `BI_OUTBOUND_EMAIL_DOMAINS`、`BI_OUTBOUND_WEBHOOK_HOSTS`、`BI_OUTBOUND_ALLOW_PRIVATE_HOSTS`、`BI_NOTIFY_TIMEOUT` |
| 后台循环 | `BI_ALERT_INTERVAL_SECONDS`、`BI_REPORT_INTERVAL_SECONDS`、`BI_SYNC_INTERVAL_SECONDS`、`BI_SYNC_MAX_PER_RUN` |
| AI | `LLM_API_BASE`、`LLM_API_KEY`、`LLM_MODEL`、`BI_AI_DAILY_CALLS`、`BI_AI_DAILY_TOKENS` |
| MCP | `BI_MCP_QPS`、`BI_MCP_DAILY_CALLS`、`BI_MCP_BREAKER_SECONDS`、`BI_MCP_DAILY_DASHBOARD_LIMIT` |
| 报表 | `BI_PDF_CHROME`、`BI_PDF_TIMEOUT`、`BI_REPORT_DIR`、`BI_PUBLIC_BASE_URL` |

### F. 文档索引

| 文档 | 什么时候读 |
|---|---|
| `AGENTS.md` | 动手前必读：规则、旋钮、踩坑记录 |
| `docs/组件数据契约.md` | 写渲染器 / 改 spec / 调 payload 时 |
| `docs/组件开发规范.md` | 新增或改组件、四尺寸验收 |
| `docs/平台分套_需求与技术方案.md` | 涉及平台分套、`items_map`、筛选栏专套 |
| `docs/底座优化方案.md` | 性能、连接器、语义治理的阶段计划 |
| `docs/安全与MCP优化方案.md` | 安全闭环与 MCP 生产化 |
| `docs/MCP与Agent权限接入方案.md` | MCP 七层鉴权、工具目录、写边界 |
| `docs/GlitchTip部署指南.md`、`docs/pgaudit配置指南.md` | 可观测与数据库审计部署 |
| `docs/仓库操作规范.md` | 发版、脱敏、入库边界 |
| **本文** | 找板块、看依赖、加新板块 |

### G. 术语表

| 术语 | 含义 |
|---|---|
| 板块 | 可独立开发/验收/摘除的业务单元（本文 §2.1） |
| 内核 | 装配 + 存储 + 查询执行 + 治理，不承载业务 |
| 契约 | 跨板块唯一通信方式（Pydantic / dataclass / JSON） |
| 语义名 | 看板与前端使用的字段名，物理列只在语义层 |
| 实例 spec | 页面元素自带的完整组件配置，组件库只存类型 |
| 平台分套 | 按某字段取值把一页拆成多套卡片，共用一条筛选栏 |
| 现场版面 | 前端把当前画布 items 一并传给 `/render`，避免库里旧版面叠加 |
| fail-closed | 规则编译失败/上下文缺失时拒绝，而不是放行 |

---

> **维护约定**：本文随板块增减更新；新增板块必须在上表登记一行，删除/合并板块必须同步更新 §2.2、§3、§9。数字（API 数、表数、组件数）在每次发版时校准一次，避免「文档写 15 种组件、代码其实 23 种」这类漂移。
