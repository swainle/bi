# 第三方组件与许可证声明

> 本文件依据 Apache-2.0 §4、MIT、BSD 等许可证的「保留版权声明 / 附许可声明」要求编制，
> 应随本软件的每一份分发副本一同提供。
> 机器可核验的完整清单见 `frontend/package-lock.json` 与 `backend/requirements.txt`。

---

## 一、结论摘要（可核验）

| 项 | 结果 |
|---|---|
| 前端依赖总数 | **484 个**（含传递依赖） |
| 许可证分布 | MIT 427 · Apache-2.0 20 · ISC 20 · BSD-3-Clause 7 · BlueOak-1.0.0 4 · BSD-2-Clause 2 · CC-BY-4.0 1 · 本地包 1 |
| 后端依赖 | 69 个已安装包（直接依赖 22 个） |
| **AGPL / GPL / SSPL / 非商用条款** | **0 个** —— 不存在被强制开源或被禁止商用的组件 |

核验方式：读取 `package-lock.json` 的 `license` 字段与 `site-packages/*.dist-info/METADATA`。

---

## 二、前端直接依赖

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| react / react-dom | 18.3 | MIT | 视图层 |
| react-router-dom | 6.23 | MIT | 路由 |
| @mui/material / @mui/icons-material | 5.15 | MIT | 界面组件 |
| @emotion/react / @emotion/styled | 11.11 | MIT | 样式引擎 |
| **echarts** | 6.1 | **Apache-2.0** | 图表渲染内核 |
| echarts-for-react | 3.0 | MIT | ECharts 的 React 封装 |
| echarts-wordcloud | 2.1 | ISC | 词云扩展 |
| **@hello-pangea/dnd** | 18.0 | **Apache-2.0** | 拖拽排序（团队面板） |
| **typescript** | 5.5 | **Apache-2.0** | 类型系统（构建期） |
| vite / @vitejs/plugin-react | 5.4 | MIT | 构建 |
| **xlsx (SheetJS)** | 0.18.5 | **Apache-2.0** | Excel 解析 |
| axios | 1.7 | MIT | HTTP 客户端 |
| html2canvas | 1.4 | MIT | 导出图片 |
| qrcode.react | 4.2 | ISC | 分享二维码 |
| react-dnd / react-dnd-html5-backend | 16.0 | MIT | 拖拽后端 |
| @mylayout/core | 本地 | 本项目自有 | 布局引擎（见第四节） |
| 开发期：@playwright/test | 1.65 | Apache-2.0 | 端到端测试 |
| 开发期：storybook / vitest 等 | — | MIT | 组件文档与单测 |

> **Apache-2.0 组件（echarts、@hello-pangea/dnd、typescript、xlsx、@playwright/test）**
> 分发时须保留其版权声明与许可证文本；若该组件自带 `NOTICE` 文件，还须一并保留。
> 当前 `frontend/dist` 由 Vite 构建，默认剥离注释 —— 因此**必须**通过本文件与构建期
> 生成的通知文件履行该义务，不能依赖产物自带的声明。

---

## 三、后端直接依赖

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| fastapi | 0.111 | MIT | Web 框架 |
| uvicorn | 0.29 | BSD-3-Clause | ASGI 服务器 |
| python-multipart | 0.0.9 | Apache-2.0 | 表单解析 |
| pydantic / pydantic-settings | 2.7 | MIT | 数据校验与配置 |
| email-validator | 2.1 | Unlicense | 邮箱校验 |
| SQLAlchemy | 2.0.30 | MIT | ORM |
| **psycopg2-binary** | 2.9.9 | **LGPL with exceptions** | PostgreSQL 驱动 |
| PyMySQL | 1.2.4 | MIT | MySQL 系驱动 |
| python-jose / bcrypt | 3.3 / 4.1 | MIT / Apache-2.0 | 令牌与口令散列 |
| pandas / numpy | 2.2 / 1.26 | BSD-3-Clause | 数据处理 |
| openpyxl | 3.1.2 | MIT | Excel 读写 |
| httpx / requests | 0.28 / 2.32 | BSD-3-Clause / Apache-2.0 | HTTP 客户端 |
| websockets | 13+ | BSD-3-Clause | 无头浏览器出图（CDP） |
| sqlglot | 30.30 | MIT | SQL AST 解析（只读网关） |
| structlog | 24+ | MIT OR Apache-2.0 | 结构化日志 |
| pypinyin | 0.50 | MIT | 中文目录命名 |
| redis | 5+ | MIT | 缓存客户端 |
| pytest | 9+ | MIT | 测试 |
| psutil | 5.9+ | BSD-3-Clause | 系统监控 |

### LGPL 说明（psycopg2-binary）

`psycopg2` 以 **LGPL（带例外条款）** 发布。本项目通过 Python 的动态导入机制使用它，
**未修改其源代码、未静态链接**，因此其许可不向本项目代码传染，本项目代码无需开源。
履行义务的方式：保留其版权与许可证声明（本文件即为履行），并提供获取其源码的途径 ——
`pip download psycopg2-binary==2.9.9 --no-binary :all:` 或
<https://pypi.org/project/psycopg2-binary/>。

---

## 四、运行时依赖（不随包分发，但构成运行环境）

| 组件 | 许可证 | 说明 |
|---|---|---|
| PostgreSQL 16 | PostgreSQL License（宽松） | 数据库服务 |
| Chromium / Chrome | BSD-3 等（含其自带第三方声明） | 报表 PDF / PNG 渲染，通过 CDP 调用系统浏览器 |
| Noto Sans / 思源黑体 | SIL OFL-1.1 | 界面与图表字体，随前端资源分发 |
| redis:7-alpine 镜像 | Redis 7.4 起为 RSALv2/SSPLv1 | 仅作内部缓存，不对外提供 Redis 服务；如需消除疑虑可固定 `redis:7.2-alpine`（BSD-3）或改用 Valkey |

---

## 五、传递依赖中的特别说明

| 组件 | 许可证 | 说明 |
|---|---|---|
| caniuse-lite | CC-BY-4.0 | 浏览器兼容数据，允许商用，需保留署名；建议在「关于」页放一处致谢 |
| jackspeak / minipass / path-scurry / package-json-from-dist | BlueOak-1.0.0 | 宽松许可，含专利授权，可商用 |
| certifi / orjson 等 | MPL-2.0 | 文件级 copyleft；未修改即合规，改了就须公开该文件 |
| Pygments / MarkupSafe 等 | BSD / MIT 系 | 宽松许可 |

---

## 六、履行方式

1. **本文件随副本分发**：私有化交付时，将 `LICENSE` 与 `THIRD-PARTY-NOTICES.md` 一并放入交付包根目录；
2. **构建期通知**：前端 `npm run build` 后，将本文件复制为 `dist/THIRD-PARTY-NOTICES.txt`；
3. **许可证全文**：各组件许可证原文可在 `frontend/node_modules/<包名>/LICENSE`
   与 PyPI / npm 对应页面获取；
4. **变更时更新**：新增依赖或升级大版本前，须复核其许可证，禁止引入 AGPL / SSPL /
   非商用（NC）条款的组件。

---

## 七、声明

本软件不包含任何 AGPL-3.0、GPL-2.0/3.0、SSPL 或带「非商用」限制的第三方代码。
若发现遗漏，请通过仓库 Issue 告知，将及时更正。

第三方组件的著作权归各自权利人所有，本文件不构成对其权利的任何主张或放弃。
