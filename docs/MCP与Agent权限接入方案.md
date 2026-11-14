# MCP × Agent 权限接入方案（对齐现有 BI 权限模型）

> 依据：`落地的企业BI+AI+MCP+Agent 全权限底层架构总表-BI权限.md`，结合本仓库现有 RBAC + 数据范围 + 数据集行列权限 + RLS 实现整理。
> 目标：MCP 只做「Agent 的受控工具网关」，**Agent 不拥有独立权限，100% 继承当前用户**。

---

## 0. 一句话结论

现有系统已经具备七层里的 **L1 身份 / L2 RBAC / L3 部分 ABAC（数据集行列）/ L7 部分 RLS**；
缺的是 **L4 AI 能力权限、L5 MCP 工具网关、L6 Agent 代持鉴权**，以及 **L3/L7 的「部门级数据隔离」**。
本方案把参考文档的七层落到本仓库的具体表、权限码、接口与文件上。

---

## 1. 七层鉴权 × 本项目对照

| 层 | 参考要求 | 本项目现状 | 缺口 / 落点 |
| --- | --- | --- | --- |
| L1 IAM 身份 | 统一身份、用户/部门唯一来源 | JWT + `users` / `departments` + 注册审批 + `token_version` | 增加 MCP OAuth 客户端与用户授权 |
| L2 RBAC 功能权限 | 角色管功能/菜单/资源 | `roles` + `role_permission` + `data_scope`；7 个后台分区 + 5 个业务入口 | 新增 AI / MCP / 导出类权限码 |
| L3 ABAC 数据范围 | 部门/人员/敏感级 | `roles.data_scope`（后台列表）+ `bi_dataset_row_rule` / `bi_column_masks` / `bi_dataset_column_mask`（按 user/role 静态条件） | **缺部门维度**：数据集没有「按当前用户部门过滤」的规则类型 |
| L4 AI 能力权限 | 是否允许用 AI、能用到哪一步 | `/ai/*` 接口已存在（nl_to_sql、gen_chart、agent-pipeline…）**没有权限码，且多数端点连 `get_current_user` 都没有**（`bi_engine.py` 路由无全局鉴权依赖，`/api/bi/engine/ai/*` 不登录即可调用） | 新增 `bi:ai:*`；先补登录鉴权，再挂权限码。**这一项独立于 MCP，先行修复** |
| L5 MCP 工具网关 | 工具级独立授权、高危默认关闭 | 无 MCP Server / 工具目录 / 客户端策略 | 本方案核心（见 §4-§6） |
| L6 Agent 执行 | Agent 继承用户、禁止越权 | 无 MCP 调用链；内部 `run_agent_pipeline` 是服务端流水线 | MCP token（用户代持）+ 每次调用重新鉴权 |
| L7 DB RLS 兜底 | 部门/个人/敏感表强制过滤 | `app/security/rls/*` 表级 RLS + 数据集行级规则；fail-closed | 物理表部门策略；与 ABAC 同时 AND |

**结论**：L2 已是标准 RBAC + 数据范围；L5/L6 需要新建；L3/L7 的部门隔离是当前最大的安全缺口（参考文档里的「部门数据隔离」现在只能靠看板/数据集人工配置，不是强制）。

---

## 2. 新增权限码（白名单内）

| 权限码 | 名称 | 说明 | 默认 |
| --- | --- | --- | --- |
| `bi:ai:use` | AI 分析 | 允许在 BI 内使用 AI 问答/解读/图表建议 | 管理员默认，其余按角色开 |
| `bi:ai:sql` | AI 生成 SQL | 允许 AI 把自然语言转 SQL（高危） | 默认关闭 |
| `bi:ai:export` | AI 导出 | 允许 AI 触发导出 | 默认关闭 |
| `bi:mcp:use` | Agent 代调用 | 允许把自己的权限授予 Agent。**语义 = 角色给「可授权」资格，用户再签 `bi_mcp_grant` 才真正生效**（两段式）；权限码本身不能由用户自助开通 | 角色默认关闭 |
| `bi:mcp:manage` | MCP 管理 | 创建/停用 MCP 客户端、配置工具策略 | 仅全局管理员 |
| `bi:data:export:summary` | 汇总导出 | PDF / 汇总级导出 | 管理员/高层 |
| `bi:data:export:detail` | 明细导出 | Excel 明细（高危） | 默认关闭 |
| `bi:resource:delete` | 删除资源 | 删除看板/数据集/组件（高危） | 仅管理员 |

说明：
- **新增的 `bi:ai:*` / `bi:mcp:*` / `bi:data:export:*` / `bi:resource:delete` 必须同时加进 `admin/permissions.py` 的 `VISIBLE_PERMISSION_CODES`**。
  否则 `has_permission()` 对非管理员恒 False、`allowed_permissions()` 还会被白名单再交集一次，表现是「角色权限页勾了也不生效」；
- **工具本身不再单独造一套角色权限码**：每个 MCP 工具声明 `required_permissions`，鉴权时与用户有效权限取交集；
- 高危工具的控制是「角色权限 + 客户端工具策略 + 用户授权」三重 AND，不是单点开关。

---

## 3. 角色 / 部门基线（对齐参考文档，落到现有角色）

| 参考角色 | 本项目角色（code） | 数据范围 | 关键权限 | MCP 默认工具 |
| --- | --- | --- | --- | --- |
| 超级管理员（IT运维） | `admin`（管理员） | `all` | 全部系统级 | 全部（高危需显式开启） |
| BI 数据管理员 | 自定义角色（如 `bi_admin`） | `all` | 数据集/看板/权限/模型 | 查询 + 图表 + 汇总导出 |
| 高层股东/老板 | 自定义角色（如 `executive`） | `all` | 只读 + 汇总导出 | 查询 + AI 解读 + PDF；禁 SQL/明细 |
| 部门主管/经理/总监 | `manager` / `dept_manager` / `director` | `dept_and_children` | 本部门用户/角色/审批 + 本部门看板 | 查询 + AI 分析 + 图表；禁跨部门 |
| 部门员工 | `member`（员工） | `self` | 本部门看板只读 | 查询 + AI 分析；禁导出明细 |
| 访客 | `viewer`（访客） | `self` | 只读看板 | 只读查询；禁 AI/导出 |

部门只决定数据范围与审批归属，**不绑定角色**（IT运维是部门，不是角色）。

补充：「高层」**不新增数据范围枚举** —— `roles.data_scope` 只有 `all / dept_and_children / dept / self`。
高层 = 新建角色（`sort_order` 高于管理员之下的其余角色）+ `data_scope=all` + 只读权限集 + `bi:data:export:summary`，
禁 `bi:ai:sql` / `bi:data:export:detail` / 任何写权限。

---

## 4. MCP 工具目录（v1 建议）

工具命名统一 `bi_*`，全部走同一网关；`risk` 决定默认策略。

| 工具 | 能力（复用现有服务） | 必需权限 | 默认 | 风险 |
| --- | --- | --- | --- | --- |
| `bi_list_dashboards` | 我的看板 / 团队看板列表 | 登录 + 看板可见性 | 开 | 低 |
| `bi_get_dashboard` | 看板文档 + 元信息 | `_can_read` | 开 | 低 |
| `bi_render_dashboard` | 渲染看板（复用 `render_dashboard`） | `_can_read` | 开 | 低 |
| `bi_list_datasets` | 数据集列表（带数据范围过滤） | `bi:nav:datasets` | 开 | 低 |
| `bi_get_dataset_schema` | 字段/指标口径 | 同上 | 开 | 低 |
| `bi_query_dataset` | 维度/指标聚合查询（禁裸 SQL） | 同上 + 数据集 ACL | 开 | 中 |
| `bi_list_metrics` / `bi_get_metric` | 指标目录与口径 | 同上 | 开 | 低 |
| `bi_query_metric` | 指标取数（复用查询构建器） | 同上 | 开 | 中 |
| `bi_ai_analyze` | AI 解读（数据+问题） | `bi:ai:use` | 开（有权限者） | 中 |
| `bi_export_summary` | PDF / 汇总导出 | `bi:data:export:summary` | 关 | 中 |
| `bi_run_sql` | 自定义 SQL（走 SQL Guard） | `bi:nav:sql` + `bi:ai:sql` | **关** | 高 |
| `bi_export_detail` | Excel 明细 | `bi:data:export:detail` | **关** | 高 |
| `bi_create_chart` / `bi_modify_dashboard` | 生成/编辑看板 | `bi:nav:editor` | **关** | 高 |
| — Agent 编排看板（细粒度工具组） | 见 §13，v1 只用只读 + 预览 | `bi:mcp:write` | **关** | 高 |
| `bi_delete_resource` | 删除看板/数据集/组件 | `bi:resource:delete` | **关** | 高 |

**不暴露**：用户/角色/模型配置/运维/错误日志的写接口（这些是系统级后台能力，不走 Agent）。

---

## 5. Agent 身份与令牌

### 5.1 身份原则
1. Agent **没有独立账号、没有独立权限**；
2. 每次工具调用都带「用户授权令牌」，网关按**当前用户**重新鉴权；
3. 工具可见列表 = 用户有效权限 ∩ 客户端已启用工具 ∩ 用户已授权范围；
4. 高危工具额外要求：角色权限 + 客户端策略 + 用户授权（三重 AND），默认全关。

### 5.2 流程
```
管理员创建 MCP 客户端（名称/回调/启用工具，默认只读）
        ↓
用户在「授权页」同意 → bi_mcp_grant（user_id, client_id, scopes, expires）
        ↓
Agent 获得 access_token（aud=mcp, sub=user, scopes=用户权限∩工具权限, 1h）
        ↓
tools/list：按权限过滤
tools/call：验 token → 客户端启用 → 用户状态/审批 → 工具策略 → 权限 → 数据范围
        ↓
执行（复用内部 service，不绕 HTTP）→ 写 bi_mcp_audit
```

### 5.3 失效
- 用户停用 / 改密 / 审批状态变化 → `token_version` 已推进，MCP 每次调用校验用户状态，立即失效；
- 客户端停用 / 授权撤销 → token 拒绝；
- token 带 `jti`，支持单条吊销；默认 1 小时，refresh 7 天且可撤销。

---

## 6. 数据模型（建议迁移 046）

```sql
-- 工具目录（代码内置种子，表用于策略与展示）
bi_mcp_tool (
  code text primary key, name text, description text,
  risk text check (risk in ('low','medium','high')),
  required_permissions jsonb,  -- ["bi:nav:datasets", ...]
  default_enabled boolean default false
);

-- MCP 客户端（Agent）
bi_mcp_client (
  id serial primary key, name text, description text,
  client_id text unique, secret_hash text,
  owner_id int references users(id),
  enabled boolean default true, created_at timestamptz
);

-- 客户端级工具策略（管理员配）
bi_mcp_client_tool (
  client_id int references bi_mcp_client(id) on delete cascade,
  tool_code text references bi_mcp_tool(code),
  enabled boolean default false,
  granted_by int, granted_at timestamptz,
  primary key (client_id, tool_code)
);

-- 用户授权（用户同意把哪些工具/范围给这个 Agent）
bi_mcp_grant (
  id serial primary key, user_id int, client_id int,
  scopes jsonb, expires_at timestamptz, revoked_at timestamptz
);

-- 访问令牌：不建 token 表，用 JWT（aud=mcp, sub=user, jti, scopes, 1h）；
-- 只建吊销名单，失效链与 token_version 一致
bi_mcp_token_revoke (
  jti text primary key, user_id int, client_id int,
  expires_at timestamptz, revoked_at timestamptz, reason text
);

-- Agent 创建的看板归属（写工具只准改这里登记的看板；不写 doc.meta，保存会被 Pydantic 丢掉）
bi_mcp_dashboard (
  id serial primary key,
  client_id int references bi_mcp_client(id) on delete cascade,
  dashboard_id int references bi_canvas(id) on delete cascade,
  user_id int references users(id),
  created_at timestamptz, published_at timestamptz,
  unique (client_id, dashboard_id)
);

-- 审计（每次调用，含拒绝）
bi_mcp_audit (
  id bigserial primary key, user_id int, client_id int,
  tool text, risk text, args_summary jsonb,
  dataset_id int, sql_hash text, row_count int,
  status text, error text, duration_ms int, ip text, created_at timestamptz
);

-- 部门级数据隔离（数据集配置，ABAC）
bi_dataset_scope_rule (
  dataset_id int references bi_dataset(id) on delete cascade,
  column_name text not null,          -- 如 dept_id / 部门
  mode text check (mode in ('department','self','all')),
  created_by int, created_at timestamptz
);
```

---

## 7. 部门数据隔离（当前最大缺口）

现状：`roles.data_scope` 只作用于**管理后台列表**；BI 数据（看板/数据集查询）没有部门强制过滤，只能靠人工配 `bi_dataset_row_rule`（按用户/角色静态条件），**MCP 一旦开放查询，必须补上**。

推荐落地顺序：

1. **数据集级部门规则（推荐，改动小、与现有查询链路一致）**
   - 数据集配置「部门列 + 模式」；
   - 查询执行器（`query/executor.run`、`query/live.run_live`）统一注入 `col = :dept_id`（或 `IN (本部门及下级)`）；
   - 规则缺失/配置错误 → **fail-closed 403**；
   - MCP 的 `bi_query_dataset`/`bi_render_dashboard` 走同一条执行器，自动继承；
2. 物理表 RLS：给带 `dept_id` 的表加 policy，连接设置 `app.user_id/app.dept_id`，兜底直连；
3. 高层/跨部门：数据范围 `all` 的角色不注入（但仍受列脱敏）。

> 没有部门列的数据集：要么补列，要么只能「按数据集授权给部门」（数据集 ACL），不能假装隔离。

---

## 8. 接入点（代码落点）

| 能力 | 文件 |
| --- | --- |
| 权限码 / 工具权限校验 | `backend/app/admin/permissions.py`（加码）、新增 `backend/app/mcp/permissions.py` |
| MCP 网关（鉴权 / 工具分发 / 审计） | 新增 `backend/app/mcp/gateway.py`、`router.py` |
| 工具实现（复用服务层） | 新增 `backend/app/mcp/tools/*.py`，内部调用 dashboards / semantic / query 服务，**不绕 HTTP** |
| 部门隔离注入 | `backend/app/query/executor.py`、`backend/app/security/dataset_rules.py`、`dashboards/render.py` |
| AI 权限 | `backend/app/routers/bi_engine.py` 的 `/ai/*` 全部挂 `require("bi:ai:use"/"bi:ai:sql")`；**先补 `get_current_user`（当前多数端点无鉴权）** |
| 审计 | 网关写 `bi_mcp_audit`，复用 `log_audit` 风格 |
| 管理界面 | **新增第 8 个后台分区**（`bi:mcp:manage`）：「管理后台 → MCP」，含客户端列表、工具开关（高危二次确认）、授权记录、调用审计。落地要同时改 `BI_PERMISSIONS`、`VISIBLE_PERMISSION_CODES`、`rbac_seed`、前端分区路由 |

---

## 9. 分阶段落地

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0（1-2 天） | 权限码 + 工具目录 + 客户端/授权/令牌表 + 网关骨架 + 4 个只读工具 + 审计 + 高危默认拒绝 | 越权工具 403；无授权 401；高危默认 403；审计有记录 |
| P1（2-3 天） | 数据集查询 + 看板渲染 + 汇总导出 + 部门隔离规则 | MCP 与 UI 同一用户结果一致；跨部门 403 |
| P2 | AI 分析工具 + 指标口径 + PDF 导出 | AI 输出复用用户 ABAC；`bi:ai:use` 未授权 403 |
| P3 | 高危工具（SQL/明细/编辑/删除）+ 二次确认 | 三重 AND 生效；默认全关 |
| P4 | 物理表 RLS 部门策略 + 告警 | 直连数据库也无法跨部门 |
| P1.5 | **编辑器 AI 助手**（§12：一键整理版面 / 一句话排版），只依赖 `bi:ai:use`，与 MCP 解耦，可与 P1 并行 | AI 操作一次撤销可回退；版面符合 §4 算式 |
| P3.5 | **Agent 编排看板**（§13：草稿态新建 + 版面写入 + 预览 + 发布确认） | 草稿不出现在团队页；不能改用户手工看板；渲染有错拒绝保存 |

---

## 10. 安全验收清单（并入 `scripts/admin_permission_matrix.py`）

- 未授权工具 / 未启用客户端 → 403
- token `aud != mcp` / 过期 / 已吊销 / 用户停用 → 401
- 跨部门查询（MCP 与 UI 各一次）→ 403
- 高危工具默认关闭；仅角色权限不够，需客户端策略 + 用户授权
- 同一问题同一用户：MCP 结果 = UI 结果（数据集行列规则一致）
- AI 生成 SQL 不绕过 SQL Guard / 数据集规则
- 每次调用（含拒绝）都有 `bi_mcp_audit` 记录，参数脱敏

---

## 11. 已拍板（2026-11-14）

1. **部门隔离**：按 §7 的「数据集级部门规则」做（注入点在 `executor.run` / `live.run_live` 现有的 `row_conditions` 旁，与数据集规则 AND），
   物理表 RLS 留到 P4 兜底。
2. **MCP 客户端**：仅管理员统一创建，用户只做授权，不支持自助创建。
3. **v1 工具范围**：只读（查询 / 渲染 / 汇总导出）**+ `bi_ai_analyze`**。
   AI 工具的前置条件是先补 `/ai/*` 的登录鉴权与 `bi:ai:*` 权限码，否则等于把无鉴权 AI 端点上新暴露一层。
4. **角色与入口**：新建「高层」角色（不新增 `data_scope` 枚举，用 `all` + 只读 + 汇总导出）；
   MCP 管理页作为**第 8 个后台分区** `bi:mcp:manage`，不挂运维分区。

评审中另修正的 5 处（已落进正文）：L4 现状描述（AI 端点实际无鉴权）、新增权限码必须进 `VISIBLE_PERMISSION_CODES`、
`bi:mcp:use` 改为两段式、高层不新增枚举、令牌只留 JWT + `bi_mcp_token_revoke`。

---

## 12. 编辑器 AI 助手（AI 自动对齐 / 排版）

**结论：可实现，且是这两条需求里成本最低的一条。** 排版所需的纯函数和位置模型已经全部存在，缺的只是「把意图翻译成布局操作」的那一层和入口 UI。

### 12.1 已有路基（直接复用，不要另写一套）

| 能力 | 位置 |
| --- | --- |
| 元素位置模型 `layout {x,y,w,h}` | 后端 [models.py#L67](file:///Users/cavan-m4max/MingzeBI/backend/app/dashboards/models.py#L67)；前端 [types.ts#L463-L482](file:///Users/cavan-m4max/MingzeBI/frontend/src/features/components/types.ts#L463-L482) |
| 磁吸：8 栅格 + 元素边/中线 + 画布中线，拖动/缩放/拖参考线三种 | [snapping.ts](file:///Users/cavan-m4max/MingzeBI/frontend/src/features/components/board/snapping.ts)（`snapMove / snapResize / snapGuide`） |
| 多选对齐 6 向 + 等间距（两端固定、无累积误差） | [CanvasBoardPage.tsx#L1451-L1505](file:///Users/cavan-m4max/MingzeBI/frontend/src/pages/CanvasBoardPage.tsx#L1451-L1505) |
| 撤销栈（整份 items+guides 快照） | [CanvasBoardPage.tsx#L1131-L1219](file:///Users/cavan-m4max/MingzeBI/frontend/src/pages/CanvasBoardPage.tsx#L1131-L1219) |
| 版面算式（1440 宽 / 间距 16 / 一排 N 张 / 整宽元素） | `AGENTS.md` §4 + 前端 `FULL_WIDTH_KINDS` |

### 12.2 硬原则：AI 只出「布局操作」，不直接改文档

1. AI 返回 `ops: [{key, x, y, w, h}]`，由**前端**套用并用现成的 snap/边界裁剪再收敛一次；
2. 一次 AI 操作 = **一个撤销步**（只 `pushHistory` 一次），用户 `⌘Z` 能整体回退；
3. 不自动保存、不写库，仍走现有 `dirty → 保存` 流程（AI 出错最坏情况是「按一次撤销」）。

模型**不参与算坐标**：坐标一律由确定性算法产出（可测试、可复现）。LLM 只在「一句话排版」里把自然语言翻译成**结构意图**
（例如 `{rows: [{count: 6, kind: "kpi"}, {count: 2, kind: "chart"}]}`），再由算法按 §4 算式算具体 x/y/w/h。

### 12.3 能力清单（按优先级）

| 编号 | 能力 | 交互 | 依赖 |
| --- | --- | --- | --- |
| A1 | 一键整理版面 | 工具栏「AI 整理」：去重叠 → 按行归组 → 行内等分 → 统一间距 16 → 贴左/整宽归一 | 纯前端 + 后端规则接口 |
| A2 | 选区对齐/等分 | 选中 ≥2 时只整理选区（复用 `alignSelection` / `distributeSelection`） | 纯前端 |
| A3 | 一句话排版 | 输入「上面 6 张指标卡一行，下面两张图各占一半」，产出结构意图 | LLM（`bi:ai:use`） |
| A4 | 补齐/推荐组件 | 按当前数据集字段推荐 3~5 个组件并落到空位 | LLM + `chart_catalog` |
| A5 | 文案润色 | 标题/说明改写，**仅建议，需点击应用** | LLM |

### 12.4 接口与落点

```
POST /api/bi/ai/layout
  { scope: "all" | "selection", instruction?: string,
    design: { width: 1440, gap: 16, full_width_kinds: [...] },
    items: [{ key, type, kind, title, x, y, w, h }] }
→ { ops: [{key, x, y, w, h}], guides?: [{axis,pos}], summary: string }
```

- 后端新增 `backend/app/ai/layout.py`：`plan_layout(items, design)` 纯函数（±8 收敛、行归组、等分、去重叠、整宽强制 `x=0,w=1440`）；
  `POST /api/bi/ai/layout` 只做参数校验 + 权限 + 审计，返回 ops；
- 前端新增 `frontend/src/features/components/editor/AiLayoutBar.tsx`（工具栏胶囊 + 结果确认条：应用 / 撤销 / 重试）；
  应用时调用 `patchItems`，一次性入栈；
- 权限：`bi:ai:use`，与 §14 的 AI 鉴权修复同批上线。

### 12.5 边界情况（改这块前先逐条确认）

- **分套页面**：只整理当前平台那套（`items_map[platform]`），筛选栏 `type=filter` 永远 `x=0 / w=1440` 且不参与等分；
  「分套依据」字段不动（见 `AGENTS.md` §5.1）；
- **形状/文字元素**（`type=text / divider / board`）：允许层叠，A1 不把它们拆开，只吸附到栅格与网格线；
- **画板内嵌元素**（`type=board`）：整理时按整块处理，不进内部；
- **越界**：ops 应用前统一 `x = max(0, min(x, 1440-w))`，`w = max(MIN_W, w)`；后端的 ops 只作建议，前端兜底；
- **空态 / 单元素**：A1 按钮置灰，不调 AI（不搞「点了没反应」或假 loading）；
- **缩放 <1 / 窄屏**：坐标只在设计坐标系里算，不受 stage scale 影响（现有 snapping 已是这个口径）。

### 12.6 验收

- 6 张指标卡 → 每张 224×104、x = 0/240/480/720/960/1200，间距 16（§4 算式），y 对齐；
- 任意重叠元素 A1 后两两无交集（层叠形状除外）；
- AI 整理后按一次 `⌘Z` 完整回到整理前；
- 选中 3 个元素点 A2，其余元素坐标逐字节不变；
- 未登录 / 无 `bi:ai:use` → 403；LLM 超时 → 前端提示「AI 暂不可用，可手动整理」，按钮回可点，不卡死。

---

## 13. MCP 授权 Agent 新建看板并编排（组件库 → 版面）

**结论：可实现，但必须按「写工具」标准做（P3 风险级）。** 现有链路已经能把「新建 → 写 doc → 保存 → 失效缓存 → 重建账本」整条跑通，Agent 只是换了调用者，不该另写一套。

### 13.1 复用链路（不绕 HTTP，全部走服务层）

| 步骤 | 复用函数 / 接口 |
| --- | --- |
| 新建项目 | `repo.create(db, name, doc, owner_id)`（与 [router.py#L216-L233](file:///Users/cavan-m4max/MingzeBI/backend/app/dashboards/router.py#L216-L233) 同一条） |
| 组件库 / 类型目录 | `repo.list_components`（[components/router.py#L56-L70](file:///Users/cavan-m4max/MingzeBI/backend/app/components/router.py#L56-L70)）、`chart_catalog.catalog()`（`/catalog`） |
| 文档校验 | `validate_doc(raw, heal=True)`（[models.py#L308](file:///Users/cavan-m4max/MingzeBI/backend/app/dashboards/models.py#L308)） |
| 保存 | `repo.save` + `render_cache.invalidate` + `sources.rebuild`（[router.py#L380-L401](file:///Users/cavan-m4max/MingzeBI/backend/app/dashboards/router.py#L380-L401)） |
| 渲染自检 | `render_dashboard`（[render.py#L382](file:///Users/cavan-m4max/MingzeBI/backend/app/dashboards/render.py#L382)） |
| 草稿态 | `_blank_doc()` 本来就把 `published=false` 写进 doc（[router.py#L207-L213](file:///Users/cavan-m4max/MingzeBI/backend/app/dashboards/router.py#L207-L213)）；**注意「我的看板」默认 `published_only=false`，草稿照样会列出**——隔离靠「不分享 + 前端打标」，不能假设它不显示（[router.py#L102-L134](file:///Users/cavan-m4max/MingzeBI/backend/app/dashboards/router.py#L102-L134)） |

### 13.2 工具设计（P3，默认全关，需 `bi:mcp:write`）

| 工具 | 说明 | 附加约束 |
| --- | --- | --- |
| `bi_list_components` | 组件库 + 类型目录 | `bi:nav:components` |
| `bi_create_dashboard` | 新建空草稿（owner = 当前用户，`published=false`） | 每人每日新建上限（默认 20） |
| `bi_add_item` | 从组件库条目加一个元素（`key` 由后端生成） | 字段必须存在于 `bi_dataset_field` |
| `bi_set_layout` | 批量写 `layout`（复用 §12 的 `plan_layout` 归一） | 越界/间距不符 → 400，不静默改 |
| `bi_preview_dashboard` | 渲染草稿，返回每张卡状态 | 只读 |
| `bi_save_dashboard` | 保存草稿（不发布） | 渲染有 error → 拒绝 |
| `bi_publish_dashboard` | 发布草稿（`published=true`） | **必须用户在前端二次确认**，Agent 单独调用 → 403 |

### 13.3 安全设计（缺一条就别上线）

1. **草稿隔离**：Agent 新建一律 `published=false`、**不分享、不进模板库**，所以团队页 / 模板库天然看不到；
   「我的看板」仍会列出（现有列表不按 published 过滤），由前端打「Agent 生成 · 待确认」标，用户点发布才转正；
2. **只准改自己建的**：写工具校验 `owner_id = 当前用户`，且该看板在 `bi_mcp_dashboard`（迁移 046 建）里有归属记录
   `(client_id, dashboard_id, user_id)`；**不要把标记写进 `doc.meta`** —— `DashboardDoc` 没有 `meta` 字段，
   Pydantic 校验会把多余键丢掉，前端保存也会重建 doc，标记活不过一次保存；
   想改用户手工看板必须显式 `allow_existing=true` + 前端二次确认，否则 403；
3. **不做 last-write-wins**：保存带 `updated_at` 乐观锁，不一致返回 409 + 「看板已被修改，请重新预览」；
4. **数据集不越权**：`dataset_id` 必须来自用户有权的数据集；字段必须在该数据集存在（复用 `_prune_missing` 口径），
   禁止 Agent 编造 dataset/字段名；
5. **版面必须合规**：`bi_set_layout` 后端用 §12 的 `plan_layout` 归一（8 的倍数、间距 16、`x+w ≤ 1440`、
   整宽元素强制 `x=0,w=1440`），不合规直接 400；
6. **保存前必须渲染通过**：任一卡片 `status=error`（缺字段/权限不足/查询失败）→ 拒绝保存，避免交付「整页红条」；
7. **三重 AND**：角色权限 `bi:mcp:write` ∩ 客户端已启用 ∩ 用户已签 `bi_mcp_grant`，缺一 403；默认全关；
8. **审计**：每次写操作落 `bi_mcp_audit`（tool / dashboard_id / 变更摘要 / status / duration）+ `log_audit`。

### 13.4 典型编排（Agent 侧的工具序列）

```
bi_list_datasets → bi_get_dataset_schema
→ bi_list_components（选模板）
→ bi_create_dashboard（草稿）
→ bi_add_item ×N → bi_set_layout（一次写完版面）
→ bi_preview_dashboard（自检，失败就修）
→ 返回链接给用户；用户在前端点「发布」
```

### 13.5 前端配合

- 「我的看板」卡片：`published=false` 显示「草稿 · Agent 生成」标；
- 打开草稿页顶部提示条：「此看板由 Agent 生成，确认无误后点发布」+ 一键「用 AI 整理版面」（即 §12 A1）；
- 草稿也走同一个编辑器与同一个 doc，用户手动改完可直接发布 —— 两条需求在这里汇合，不重复实现。

### 13.6 验收

- Agent 建草稿 → 只出现在 owner 的「我的看板」（带草稿标），团队页与模板库不可见；
- 未授权 / 客户端未启用 / 未签 grant / 缺 `bi:mcp:write` → 逐项 403（矩阵脚本覆盖）；
- Agent 改用户手工看板 → 403；并发编辑 → 409 且不覆盖用户改动；
- `bi_set_layout` 传越界或间距错 → 400；合规版面渲染与手工一致；
- 含错误卡片的草稿无法保存；
- 每次写操作都能在 `bi_mcp_audit` 查到（含被拒）；每日额度超限 → 429/403 并留审计。

---

## 14. 补充：AI 鉴权修复（§12/§13 的共同前置）

`/api/bi/engine/ai/*` 目前多数端点无 `get_current_user`（见 §1 L4）。在 A3/A4 与 `bi_ai_analyze` 上线前必须先修：

1. 逐个端点补 `current_user = Depends(get_current_user)`；
2. 按能力挂 `bi:ai:use`（解读/推荐/排版）与 `bi:ai:sql`（nl_to_sql / optimize_sql / auto_model）；
3. 权限码加进 `VISIBLE_PERMISSION_CODES`；
4. 回归：匿名调用 → 401，无权限 → 403，`scripts/admin_permission_matrix.py` 增加对应用例。
