# 明策BI（MingzeBI）

自研 BI 底座 —— 数据源接入、数据集、**可拖拽画布看板编辑器**、AI 生成看板、企业级权限与审计。
与原始协作平台（MYweb）**完全解耦**，独立仓库、独立数据库、独立部署。

> 图表图形内核使用 Apache ECharts；画布引擎（布局 / 渲染调度 / 状态）、数据源适配层、自然语言转 SQL 的 AI 管线、权限审计均为自研。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + TypeScript + Vite 5 + MUI 5 + ECharts 6 |
| 布局引擎 | `@mylayout/core`（本仓库内独立包，`packages/mylayout`） |
| 后端 | FastAPI + SQLAlchemy 2 + Pydantic 2 |
| 数据库 | PostgreSQL 16 + pgvector（AI 元数据向量检索） |
| 可选 | Redis（布局缓存 / 分布式限流）、Doris（大表加速） |
| AI | 任意 OpenAI 兼容接口（默认 DeepSeek） |

---

## 目录结构

```
MingzeBI/
├── backend/
│   ├── app/
│   │   ├── main.py                 # 应用入口（中间件 / 路由 / 健康检查）
│   │   ├── config.py               # 配置（环境变量优先）
│   │   ├── database.py             # 引擎 / 会话 / 连接池监控
│   │   ├── bootstrap.py            # 建表 / 示例数据 / 默认管理员（幂等）
│   │   ├── middleware/             # auth / csrf / audit / rate-limit / logging
│   │   ├── models/                 # users / rbac
│   │   ├── routers/
│   │   │   ├── auth.py             # 登录 / 刷新 / 资料 / 头像
│   │   │   ├── bi_engine.py        # BI 引擎主体（查询 / 看板 / AI / 模板 / 权限）
│   │   │   ├── bi_datasource.py    # 数据源连接与测试
│   │   │   ├── bi_team.py          # 看板团队共享
│   │   │   └── bi_admin.py         # 看板权限 + 操作审计
│   │   └── services/
│   │       ├── bi_ai_engine.py     # 元数据采集 / SQL 生成与校验
│   │       ├── bi_ai_agent.py      # 三阶段管线（清洗 → 校验 → 生成）
│   │       ├── bi_ai_phase2.py     # 布局计算 / 图表推断
│   │       ├── bi_ai_phase3.py     # 看板组装
│   │       ├── bi_persistence_engine.py  # 卡片批量持久化 / 快照
│   │       ├── bi_csv_import.py    # CSV 解析导入
│   │       ├── bi_share_links.py   # 分享链接
│   │       └── query_router.py     # PG / Doris 路由
│   ├── security/                   # 安全内核（独立，不依赖路由）
│   │   ├── errors.py               # 统一异常族
│   │   ├── denylist.py             # 危险函数 / 写节点
│   │   ├── masking.py              # 列脱敏
│   │   ├── sql_guard/              # 只读网关（sqlglot AST）
│   │   └── rls/                    # 行级权限（编译 / 注入 / 指纹）
│   ├── query/                      # 查询契约
│   │   ├── contract.py             # QueryObject
│   │   ├── grain.py                # 时间粒度（多方言）
│   │   ├── builder.py              # SQL 编译（参数绑定）
│   │   ├── executor.py             # 执行 + RLS + 脱敏
│   │   ├── column_types.py         # 列类型（自动 cast）
│   │   └── async_jobs/             # 异步任务（store / runner）
│   ├── semantic/                   # 语义层
│   │   ├── models.py               # 数据集 / 字段 / 指标
│   │   ├── repository.py           # 仓储
│   │   ├── validator.py            # 建模期校验
│   │   ├── compiler.py             # 语义名 → QueryObject
│   │   └── router*.py              # 数据集 / 字段 / 指标 API
│   ├── schema/
│   │   ├── schema.sql              # 38 张表 + 序列 + 索引 + 触发器
│   │   ├── migrations/             # 增量迁移（启动时幂等执行）
│   │   └── seed.sql                # 电商示例数据（拼多多 / 天猫 / 抖音）
│   ├── tests/                      # pytest（83 用例）
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── Dockerfile
│   ├── run.sh
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # 路由（/login、/bi、/bi/view/:id、/bi/canvas、/bi/dashboards/:id、/bi/components、/bi/audit）
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── BiDashboardPage.tsx # 看板列表 / 数据源 / SQL 面板 / 团队共享
│   │   │   ├── BiViewPage.tsx      # 看板查看 / 大屏 / 导入向导 / 水印
│   │   │   ├── CanvasBoardPage.tsx # 统一编辑画布（数据集字段 / 口径 / 维度 / 指标 / 过滤 / 外观 / 运算）
│   │   │   ├── DashboardPage.tsx   # 业务看板页（页面元素 + 卡片 + 参数筛选 + 就地编辑）
│   │   │   ├── ComponentLibraryPage.tsx / ComponentEditorPage.tsx
│   │   │   └── AuditLogPage.tsx
│   │   ├── features/bi-dashboard/
│   │   │   ├── engines/LayoutEngine.ts    # 双模式布局（12 列栅格 / 自由悬浮）
│   │   │   ├── engines/RenderEngine.ts    # ECharts 实例池 / 节流重绘
│   │   │   ├── engines/StateEngine.ts     # 撤销重做 / 状态
│   │   │   ├── ChartPanel.tsx / ChartConfigPanel.tsx
│   │   │   ├── DataSources.tsx / ImportWizard.tsx / SqlQueryPanel.tsx
│   │   │   └── BigScreen.tsx / PddCockpitView.tsx / TeamPanel.tsx
│   │   ├── components/             # TopBar / WatermarkOverlay / 通用组件
│   │   ├── contexts/               # AuthContext / ThemeContext
│   │   └── api/                    # axios 客户端（JWT + CSRF + 自动刷新）
│   ├── packages/mylayout/          # @mylayout/core 布局引擎
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
├── docs/
│   ├── 更新日志.md                  # 功能与界面改动的日记（只追加，顶部最新）
│   ├── _selfcheck/                 # 交付前逐屏截图自检
│   └── 看板截图/
├── AGENTS.md                       # 开发规则（视觉令牌 / 布局算式 / 组件链路 / 数据红线 / 已知的坑）
└── README.md
```

---

## 端口约定

| 服务 | 端口 | 说明 |
|---|---|---|
| 前端（dev / docker） | **5300** | `npm run dev` 与 docker 前端同一口 |
| 前端（preview） | **5301** | `npm run build && npm run preview` |
| 后端 API | **8300** | `./run.sh` / docker 宿主侧 |
| 数据库（仅 docker） | **5433** | 宿主机映射，避开本机已占用的 5432 |

改端口只需动三处：前端 `frontend/vite.config.ts`（`server`/`preview` 的 `port` 与 `proxy.target`）、后端 `backend/run.sh` 的 `PORT` 默认值（或临时 `PORT=9000 ./run.sh`）、`docker-compose.yml` 的宿主侧端口。

局域网访问：前端 Vite 已监听 `0.0.0.0`，同一 WiFi / 网段内的设备用 `http://<本机局域网IP>:5300` 打开即可（后端仍只绑 `127.0.0.1:8300`，由 Vite 代理转发，无需暴露）。查本机 IP：`ipconfig getifaddr en0`。
macOS 防火墙对未签名的 node 会拦外部连接 —— `scripts/dev.sh` 固定用 `/usr/local/bin/node`（已加入防火墙白名单）；若手动 `npm run dev` 后局域网打不开，在弹出「是否允许 node 接受传入连接」时点允许，或把该 node 路径加入防火墙。

---

## 快速开始

### 方式一：Docker（推荐）

```bash
cd ~/MingzeBI
export JWT_SECRET="$(openssl rand -base64 48)"
docker compose up -d --build
```

- 前端：http://localhost:5300
- 后端健康检查：http://localhost:8300/api/health
- 首次启动自动建表 + 导入示例数据 + 创建管理员（默认 `admin` / `Admin@123456`，用 `ADMIN_PASSWORD` 覆盖）

### 方式二：本地开发

前置：PostgreSQL 16（需安装 pgvector 扩展）、**Python 3.10+**（3.12 推荐；系统自带 3.9 会因运行时注解语法启动失败）、Node 20+。

```bash
# 1. 建库
createdb mingzebi
psql mingzebi -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 2. 后端
cd backend
cp .env.example .env          # 修改 DATABASE_URL / LLM_API_KEY
./run.sh                      # 自动建 venv、装依赖、初始化库、启动 :8300

# 3. 前端（另开终端）
cd frontend
npm install                   # .npmrc 已配置 legacy-peer-deps
npm run dev                   # http://localhost:5300
```

初始化动作也可以单独跑：

```bash
cd backend
python -m app.bootstrap            # 幂等：建表 / 种子 / 管理员
python -m app.bootstrap --reset    # 清空重建（需 ALLOW_RESET=1）
```

---

## 功能清单

### 数据接入
- 数据源类型：MySQL / MariaDB / PostgreSQL / Oracle / SQL Server / TiDB / 达梦 / 人大金仓 / ClickHouse / Doris / StarRocks / Presto / Kylin / Elasticsearch 等 17+
- 连接测试、SQL 查询面板、CSV / Excel 导入向导、PDD 利润表结构化导入（含 AI 列映射推断）
- 数据表元数据自动采集（JSONB 字段信息 + pgvector 向量，供 AI 检索）

### 分析画布
- 双模式布局：12 列栅格 / 自由悬浮；碰撞避让、磁吸吸附、撤销重做
- 图表类型：柱 / 堆叠柱 / 折线 / 面积 / 饼 / 环 / 雷达 / 漏斗 / 散点 / 热力 / 指标卡 / 表格 / 词云
- 图层管理、属性面板、内联富文本、看板级筛选、大屏模式、水印
- 编辑器批量持久化（卡片 UPSERT + 布局快照 + 乐观锁版本）

### AI 能力
- 自然语言转 SQL（带表结构上下文 + SQL 安全校验，拦截 DDL/DML）
- 一键生成看板（元数据 → 布局 → 图表配置 → 落库）
- 诊断 / 优化建议 / 异常检测 / 根因分析 / 图表推荐 / 指标解释
- 三阶段 Agent 管线：数据清洗 → 质量校验 → 看板生成（LLM 不可用时降级本地规则）

### 企业能力
- 看板权限（owner / 查看 / 编辑）、公开分享、分享链接（`/bi/share/{token}`）
- 行级权限、字段脱敏、操作审计日志、看板版本快照
- 缓存（连接池 / 查询缓存 / 布局缓存）、物化加速、PG→Doris 同步路由

### 查询契约与语义层（`app/query` · `app/semantic`）

| 能力 | 端点 | 说明 |
|---|---|---|
| 查询契约 | `POST /api/bi/query/run` | 传 `QueryObject`（维度/指标/粒度/筛选/排序/limit），服务端生成 SQL |
| 异步查询 | `POST /api/bi/query/async` · `GET /api/bi/query/jobs/{id}` | 长查询走有界线程池，轮询取结果（30 分钟过期） |
| 时间粒度 | `GET /api/bi/query/grains` | `hour/day/week/month/quarter/year`，按方言翻译（PG/MySQL/ClickHouse/TSQL/Oracle） |
| 语义层 | `GET/POST /api/bi/semantic/datasets` | 数据集 = 物理表 + 语义字段 + 指标表达式 |
| 语义查询 | `POST /api/bi/semantic/datasets/{id}/query` | 前端只说「按店铺看总收入」，不碰物理列名 |

**统一安全链**：白名单 → 行级权限（WHERE 下推，fail-closed）→ 参数绑定 → 列脱敏，
四条链路（`/data`、`/query`、`/query_builder`、语义查询、异步任务）共用同一套实现，
代码在 `app/security/`（`sql_guard/` 只读网关 + `rls/` 行级权限 + `masking.py` 脱敏）。

### 组件库（`app/components` · `/bi/components`）

一个组件 = **图表类型 + 数据绑定 + 计算规则 + 界面样式**，存在 `bi_component.spec`（jsonb），
渲染时经语义层取数，因此「同类型只搭一个，换字段即可复用」。

| 能力 | 端点 | 说明 |
|---|---|---|
| 组件列表 | `GET /api/bi/components` | 按 `kind` / `category` / 关键词过滤 |
| 新建 / 更新 / 删除 | `POST` `PUT` `DELETE /api/bi/components/{id}` | 内置组件不可删，可复制为副本 |
| 渲染 | `POST /api/bi/components/{id}/render` | 返回渲染数据 + 生成的 SQL + 耗时 |
| 实时预览 | `POST /api/bi/components/preview` | 配置未保存也能看效果（拖字段即时反馈） |
| 可选项 | `GET /api/bi/components/meta` | 类型 / 配色 / 格式 / 聚合 / 计算规则枚举 |
| 图表类型目录 | `GET /api/bi/components/catalog` | 按「图表类型」分类的 9 类 15 种图表 |
| 按目录新建 | `POST /api/bi/components/from-catalog` | 传 `entry_id` + `dataset_id`，可带 `case_id` 用案例字段预填 |

**分类按图表类型**（不是业务域）：指标 / 表格 / 分布 / 时间序列 / 占比 / 排名 / 词频 / 矩阵 / 关系

**图表类型（15 种 · 一类只有一个）**：`kpi` 数字 · `table` 明细表 · `bar` 柱状 · `hbar` 排行条形 · `line` 折线 · `area` 面积 · `pie` 饼图 · `donut` 环形 · `scatter` 散点（点/气泡/四象限）· `heatmap` 热力矩阵 · `wordcloud` 词云 · `combo` 柱线组合 · `rank_list` 排行列表 · `insight` 结论卡 · `filter` 筛选栏

> 组件库只保留「类型」：同类需求不新建组件，差异进实例配置；
> 标题 / 文字 / 分割线是**页面元素**，不进组件库（见下一节「业务看板」）。

**页面结构**（展示页与编辑页分离）：

| 路由 | 角色 | 内容 |
|---|---|---|
| `/bi/components` | 组件库列表 | 卡片墙（缩略图 + 名称 + 类型 + 分类）、搜索、分类筛选、「新建图表」 |
| 新建对话框 | 创建流程 | ① 选择数据源 → ② 按分类选图表类型（缩略图 + 搜索）→ 创建新图表 |
| `/bi/components/:id/edit` | **卡片编辑页** | 左：数据源字段解析（Σ 指标 / # 数字列 / Ss 文本列 / ◷ 时间）；中：维度·粒度、指标·聚合、附加指标、过滤、行限制、排序、标题、图表类型切换；右：实时预览 + 生成 SQL |

字段来源是语义数据集的 `fields` + `metrics`：点左侧字段即加入查询，已用字段置灰。
所有修改即时预览（320ms 防抖），保存写回 `bi_component.spec`。

**组件库内容 = 15 个 `base.*` 基础组件**（一类一个）。

早期复刻模板时按业务卡建过 82 个变体组件，已按「同类不重复」原则**归档**（`bi_component.archived`，
不删除、可追溯），库列表默认不返回归档项；看板实例自带 spec，因此归档不影响已拼好的页面。

**榜单端数据**来自模板的 3 份 CSV（62 条 SKU），导入命令：

```bash
cd backend && ./.venv/bin/python -m scripts.import_rank_board        # 幂等 upsert
./.venv/bin/python -m scripts.import_rank_board --dry-run            # 只看数量
RANK_TEMPLATE_DIR=/path/to/template ./.venv/bin/python -m scripts.import_rank_board
```

启动时 `bootstrap.ensure_components()` 会自动建「榜单端·SKU」语义数据集并写入内置组件
（幂等，不会覆盖你复制出来的自定义组件）。

### 业务看板（`app/dashboards` · `/bi/dashboards`）

一个看板文档 = **页面元素 + 页面参数 + 视图**，存在 `bi_canvas.doc`（jsonb, v2.1）：

```jsonc
{
  "version": 2.1,
  "header": { "kicker": "…", "title": "…", "subtitle": "…",
              "stats": [{ "label": "在榜 SKU", "component": "base.kpi", "spec": { … } }] },
  "views": [
    { "key": "main", "title": "榜单端", "items": [
      { "key": "h1", "type": "heading", "text": "一、榜单概况", "note": "当前平台 · 六维指标", "index": "一", "icon": "grid", "span": 12, "h": 56 },
      { "key": "kpi_sales", "type": "chart", "component": "base.kpi", "span": 2, "h": 112,
        "spec": { "title": "日销量", "binding": { "dataset_id": 2, "dimension": "商品标题", "metric": "日销量", … },
                  "filters": [{ "column": "平台", "op": "=", "valueFrom": "param:platform" }] },
        "action": { "type": "modal", "title": "日销量 TOP10", "component": "base.rank_list", "spec": { … } } }
    ] }
  ]
}
```

**元素类型**：`chart`（组件实例，自带 spec）· `filter`（筛选栏实例，产出页面参数）·
`heading`（标题：编号+标题+说明）· `text`（文字）· `divider`（分割线）。

**参数链路**：筛选栏字段 → 页面参数 → 组件 `binding.filters[].valueFrom = "param:<id>"` →
语义查询（`ranges` 支持档位→区间映射，`"all"` 视为不过滤）。

**动作**：`action` / `row_action` = 目标 spec + 覆盖参数；`params` 支持 `"$row.字段"`，
行点击把该行字段带进抽屉/弹窗。浮层复用同一套渲染器，不另造「弹窗专用表」。

| 能力 | 端点 |
|---|---|
| 看板列表 / 详情 | `GET /api/bi/dashboards` · `GET /api/bi/dashboards/{id}` |
| 按 code 取 | `GET /api/bi/dashboards/by-code/{code}` |
| 保存文档 | `PUT /api/bi/dashboards/{id}` |
| 渲染当前视图 | `POST /api/bi/dashboards/{id}/render` `{view, params}` |
| 浮层渲染 | `POST /api/bi/dashboards/{id}/overlay` `{item_key, trigger, params, action_params}` |

**统一编辑窗口 = `/bi/canvas`**（`?doc=<看板id>` 切换看板，默认榜单端）——只有这一个编辑页。

- 顶部：看板切换、预览、保存（编辑后 900ms 自动保存）；
- 功能区：`标题 / 文字 / 分割线 / 筛选栏`，右侧「图表类型」点选即插入组件；
- 画布：自由拖拽 + 右下缩放（8px 吸附），按 1440 设计宽度自动等比适配窗口；
- 左栏：选中组件时是字段面板（Σ 指标 / 维度），选中文本时是文案/字号/字重/对齐；
- 中栏：组件的数据配置（维度·粒度、指标·聚合、过滤、行限制、排序、标题、外观）；
- 右栏：图表类型（15 种，一类一个）；
- 视图切换（榜单端 1 个视图；需求端 4 个视图）在功能区右侧。

查看页 `/bi/dashboards/:id` 用同一份自由坐标只读渲染，点「编辑」回到 `/bi/canvas?doc=<id>`。
布局坐标存在文档元素的 `layout {x,y,w,h}` 里；旧数据由 `scripts/layout_dashboards_free.py` 一次性换算。

**种子**：启动时 `seed_base.ensure_base()` 建 15 个基础组件；
`dashboards/seed_docs/*.json` 载入两个成品看板（不存在才创建，不覆盖改动）。
归档/迁移脚本：`scripts/migrate_dashboards_v21.py`（文档已备份到 `backend/data/`）。

**核对与审计**：

```bash
cd backend
./.venv/bin/python -m scripts.verify_metrics        # 模板数 vs BI 数（需求端 6 卡逐项对）
./.venv/bin/python -m scripts.audit_dashboards      # 每个页面元素 → 基础组件，未注册/失配即失败
./.venv/bin/python -m scripts.smoke_dashboards      # 全部视图渲染 + 参数切换 + 浮层动作
```

### 看板画布（`app/canvas` · `/bi/canvas`）

一张画布 = **多张卡片自由排布**，每张卡内嵌自己的图表类型与字段配置（不额外建组件行）。

| 能力 | 说明 |
|---|---|
| 拖入 | 从右侧「图表类型」拖任意类型进画布，可反复拖，位置按落点吸附 8px |
| 选中配置 | 点卡片 → 左栏字段、中栏维度/指标/过滤、外观都作用于**这一张** |
| 移动/缩放 | 拖标题栏移动、拖右下角缩放；删除按钮在卡片标题栏右侧 |
| 批量渲染 | `POST /api/bi/canvas/{id}/render` 一次算完整块画布，单张失败不影响其它 |
| 保存 | 布局（含每张卡的 spec）整体存 `bi_canvas.layout`（jsonb） |
| **发布** | 「发布到我的看板」把画布写成一张 `bi_dashboards`（panels = 画布卡片），出现在「我的看板」入口；重复发布更新同一张 |
| 查看 | 点开看板走 `/bi/view/:id`，检测到画布格式（卡片带 `kind`+`spec`）就用只读画布布局渲染 |

| 端点 | 说明 |
|---|---|
| `GET /api/bi/canvas/mine` | 我的默认画布（没有自动创建） |
| `PUT /api/bi/canvas/{id}` | 保存整块布局 `{name, items:[{key,kind,spec,x,y,w,h}]}` |
| `POST /api/bi/canvas/{id}/render` | 批量渲染（可传未保存的 items，支持边改边看） |
| `POST /api/bi/canvas/{id}/publish` | 发布成看板，返回 `dashboard_id`（首次新建，之后更新） |

单卡精修仍在 `/bi/components/:id/edit`（字段 / 查询 / 样式 + 标尺画布）。

---

### 数据库迁移

`backend/schema/schema.sql` 仍是建表事实来源；后续结构变更走增量迁移：

```bash
# 新增文件即生效，启动时自动执行（记录在 schema_migrations 表）
backend/schema/migrations/002_xxx.sql
```

---

## 数据与安全

- 认证：JWT（access 24h + refresh 7 天）+ token_version 单设备登录
- CSRF：Double Submit Cookie，前端 axios 拦截器自动附加
- SQL 安全：sqlglot AST 校验（单语句 / 仅 SELECT / 禁 DDL,DML / 禁危险函数），替代正则黑名单
- 行级权限：规则存 `bi_row_permissions`，查询期下推为 WHERE；规则损坏时 fail-closed（403 而非放行）
- 敏感内容不入库：`.env`、`.jwt_secret` 已在 `.gitignore`
- 建表：`schema.sql` + `schema/migrations/*.sql`，启动时幂等执行

### 测试

```bash
cd backend && ./.venv/bin/python -m pytest     # 83 用例：SQL 网关 / 行级权限 / 粒度 / 契约 / 语义层 / 异步
```

---

## 与旧仓库的关系

本仓库由旧平台中的自研 BI 模块抽取而来，已剔除：
- Superset / DataEase 等第三方 BI 嵌入（`/bi` 直接由自研引擎承载）
- 笔记 / 待办 / 思维导图 / 在线办公 / 白板等非 BI 业务
- OpenClaw 外部 Agent 依赖（AI 管线改为 OpenAI 兼容接口直连 + 本地规则降级）

后续在本仓库独立演进。
