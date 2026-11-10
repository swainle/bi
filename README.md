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
│   ├── schema/
│   │   ├── schema.sql              # 38 张表 + 序列 + 索引 + 触发器
│   │   └── seed.sql                # 电商示例数据（拼多多 / 天猫 / 抖音）
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── run.sh
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # 路由（/login、/bi、/bi/view/:id、/bi/editor、/bi/audit）
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── BiDashboardPage.tsx # 看板列表 / 数据源 / SQL 面板 / 团队共享
│   │   │   ├── BiViewPage.tsx      # 看板查看 / 大屏 / 导入向导 / 水印
│   │   │   ├── EditorPage.tsx      # 画布编辑器（组件面板 / 图层 / 属性）
│   │   │   └── AuditLogPage.tsx
│   │   ├── features/bi-dashboard/
│   │   │   ├── engines/LayoutEngine.ts    # 双模式布局（12 列栅格 / 自由悬浮）
│   │   │   ├── engines/RenderEngine.ts    # ECharts 实例池 / 节流重绘
│   │   │   ├── engines/StateEngine.ts     # 撤销重做 / 状态
│   │   │   ├── ChartPanel.tsx / ChartConfigPanel.tsx
│   │   │   ├── DataSources.tsx / ImportWizard.tsx / SqlQueryPanel.tsx
│   │   │   ├── BigScreen.tsx / PddCockpitView.tsx / TeamPanel.tsx
│   │   │   └── BIEditorCanvas.tsx / LayerPanel.tsx
│   │   ├── components/             # TopBar / WatermarkOverlay / 通用组件
│   │   ├── contexts/               # AuthContext / ThemeContext
│   │   └── api/                    # axios 客户端（JWT + CSRF + 自动刷新）
│   ├── packages/mylayout/          # @mylayout/core 布局引擎
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
└── README.md
```

---

## 快速开始

### 方式一：Docker（推荐）

```bash
cd ~/MingzeBI
export JWT_SECRET="$(openssl rand -base64 48)"
docker compose up -d --build
```

- 前端：http://localhost:8080
- 后端健康检查：http://localhost:8000/api/health
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
./run.sh                      # 自动建 venv、装依赖、初始化库、启动 :8000

# 3. 前端（另开终端）
cd frontend
npm install                   # .npmrc 已配置 legacy-peer-deps
npm run dev                   # http://localhost:5173
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

---

## 数据与安全

- 认证：JWT（access 24h + refresh 7 天）+ token_version 单设备登录
- CSRF：Double Submit Cookie，前端 axios 拦截器自动附加
- 敏感内容不入库：`.env`、`.jwt_secret` 已在 `.gitignore`
- 建表脚本 `backend/schema/schema.sql` 为唯一 DDL 事实来源，启动时自动执行

---

## 与旧仓库的关系

本仓库由旧平台中的自研 BI 模块抽取而来，已剔除：
- Superset / DataEase 等第三方 BI 嵌入（`/bi` 直接由自研引擎承载）
- 笔记 / 待办 / 思维导图 / 在线办公 / 白板等非 BI 业务
- OpenClaw 外部 Agent 依赖（AI 管线改为 OpenAI 兼容接口直连 + 本地规则降级）

后续在本仓库独立演进。
