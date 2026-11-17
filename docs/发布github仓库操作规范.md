# 明策BI · 仓库操作规范与发布记录

> **这份文件是仓库的操作宪法。** 每次改动仓库、每次发版前先读它，按第 2 节的清单走。
> 适用于人类协作者和 AI 助手，双方同等遵守。

| 项 | 值 |
|---|---|
| 仓库 | `github.com/cavan199/MingceBI`（私有）· 平台镜像 `gitea`=`cbb888/mingcebi` |
| 默认分支 | `main` |
| 当前版本 | `v0.3.0` |
| 规范建立 | 2026-11-14 |
| 最后更新 | 2026-11-17（文件更名为 `发布github仓库操作规范.md`） |

---

## 1. 五条硬规则

这五条是用户明确定下的底线，任何情况下不得违反。

### 规则一：推送前必须脱敏

脱敏包含**两件事**：业务数据（第三方平台信息）和密钥凭据（API Key / 令牌 / 口令）。

#### 1.1 业务数据

**仓库里不允许出现第三方平台的真实经营数据。**

| 禁止入库 | 说明 |
|---|---|
| 真实商品 ID / 商品链接 | `yangkeduo.com`、`detail.tmall.com` 等一律换成 `example.com` |
| 真实品牌名 | 麦斯蒂 / 麦富迪 / 网易严选 / 迪格宠物 → 示例品牌甲/乙/丙/丁 |
| 真实商品主图 / 详情图 | 换成同尺寸占位图（约 30 KB/张） |
| 真实评论原文 / 差评标签 | 程序合成 |
| 平台导出文件（生意参谋 xlsx 等） | 改名 + 合成数据 |
| 采集方法论文档 | 不随项目分发 |

**演示数据统一号段**（一眼可辨是否为合成）：

- 拼多多演示：`700000000001` – `700000000199`（真实数据的脱敏替身用 `700000000301+`）
- 天猫演示：`810000000001` – `810000000199`

**脱敏后必须自查**（22 个敏感词，零残留才算通过）：
`608759849830` `728776378115` `998862917451` `1012508376391` `634916920054`
`麦斯蒂` `麦富迪` `网易严选` `迪格宠物` `yangkeduo` `tmall.com`
`胀袋发酸` `肉质发稀` `吃完呕吐` `便便变软` `包装漏液` `有腥味` `品质下滑`
`95%含肉量` `颗粒碎末多` `猫不爱吃` `第一次买`

#### 1.2 密钥与凭据

**任何能直接或间接换取权限的字符串，一律不得入库。**

| 禁止入库 | 常见形态 |
|---|---|
| AI 服务密钥 | `sk-…`（OpenAI / DeepSeek / Anthropic） |
| 代码托管令牌 | `ghp_…` `gho_…` `github_pat_…` `glpat-…` |
| 云厂商密钥 | `AKIA…`（AWS）、`AIza…`（Google） |
| 应用私有令牌 | `xoxb-…`（Slack）等 |
| 私钥文件 | `-----BEGIN (RSA/OPENSSH/EC) PRIVATE KEY-----` |
| 真实的 JWT / session 令牌 | `eyJhbGciOi…` |
| 短信 / 邮件 / 支付等第三方密钥 | 各家 `xxx_secret` / `xxx_key` |
| 带明文口令的连接串 | `postgresql://user:真实口令@host/db` |
| Sentry / GlitchTip DSN | 含公钥的完整 DSN |
| `.env` / `.jwt_secret` 本身 | 整个文件都不进仓库 |

**正确做法**

| 场景 | 做法 |
|---|---|
| 代码里要用 | 只读环境变量：`os.getenv("LLM_API_KEY")`，不写默认值 |
| 需要示例 | 用占位符：`<your-api-key>`、`sk-xxxx`、`***` |
| 配置模板 | 提交 `.env.example`，值留空 |
| 要展示界面 | 接口只回掩码（如 `sk-d****-key`），前端不接收原文 |
| 存库的密钥 | 加密后入库（本项目 `services/crypto`），不落明文 |

**推送前的检查（必跑）**

```bash
bash scripts/scan_secrets.sh          # 退出码 0 才允许继续
```

脚本覆盖 10 类凭据形态、连接串明文口令，并检查 `.env` / `.jwt_secret` 是否被误跟踪。
需要时单独扫暂存区：`bash scripts/scan_secrets.sh --staged`。

**万一已经提交了**

> **不要改写历史**（违反规则四），正确顺序是：**① 立刻轮换该密钥作废 → ② 清理文件内容 → ③ 正常提交**。
> 已经被推送的提交即使删掉文件，内容仍留在历史里，所以"轮换"才是唯一有效的止损。


### 规则二：不是必要的文件不进仓库

仓库只放**源码 + 文档 + 必要的小体积素材**。

| 类型 | 入库 | 原因 |
|---|---|---|
| 后端/前端源码 | ✅ | 核心资产 |
| 数据库迁移 SQL | ✅ | 部署必需 |
| 文档（含更新日志） | ✅ | 必需 |
| README 用图（压缩后 ≤ 1 MB） | ✅ | 首页展示 |
| 测试与脚本 | ✅ | 可复现 |
| `node_modules` / `.venv` | ❌ | 四百多 M 的构建产物，`npm ci` / `pip install` 可重建 |
| `dist` / `storybook-static` | ❌ | 构建产物 |
| `.env` / `.jwt_secret` | ❌ | 密钥 |
| 模板市场素材（190 MB） | ❌ | 运行时数据 |
| 过程截图（`docs/_selfcheck/`、`docs/看板截图/`） | ❌ | 自检产物，几十 M |
| 脱敏后的交付包 | ❌ | 交付物，不随源码走 |

`.gitignore` 是这条规则的执行文件，新增目录时同步更新它。

### 规则三：版本号必须迭代

每次发布都要有**独立版本号**，不能一个版本反复覆盖。

| 变更性质 | 版本位 | 例子 |
|---|---|---|
| 破坏性变更 / 大重构 | 主版本 `x.0.0` | `v1.0.0` |
| 新功能（向后兼容） | 次版本 `0.x.0` | `v0.1.1 → v0.2.0` |
| 修复 / 文档 / 小优化 | 修订号 `0.0.x` | `v0.1.0 → v0.1.1` |

每个版本必须**同时具备**三样，缺一不可：

1. Git 标签 `vX.Y.Z`（annotated tag，含说明）
2. GitHub Release（中文说明：本版重点 / 验证结果 / 升级说明 / 已知限制）
3. 数据库快照（`pg_dump`，因为迁移是单向的）

### 规则四：历史永不删除

**只做加法，新的叠在旧的上面。**

允许：新增提交、新增 tag、新增 release
禁止以下六种"删历史"的操作：

| 禁止操作 | 后果 |
|---|---|
| `git push --force` | 覆盖远端历史 |
| `git commit --amend` 后强推已推送的提交 | 改写历史 |
| 对已推送的提交 `git rebase` 后强推 | 整段换 SHA |
| `git reset --hard` 后强推 | 丢弃该点之后的提交 |
| 删除 tag / 删除分支 | 丢版本锚点 |
| 删除仓库 | 全没 |

**若本地与远端分叉**：先建备份分支（`git branch backup/<日期>`），再 `git pull --rebase`，
最后用**快进**方式推送。永不强推。

### 规则五：首页说明随版本更新

每次功能有实质变化，同步更新这五处：

| 位置 | 更新什么 |
|---|---|
| `README.md` 首屏 | 一句话定位、技术徽章 |
| `README.md` 能力速览 | 四栏能力表 |
| `README.md` 界面 | 截图墙（新增模块补图，16:10 等宽等高） |
| `README.md` 技术架构 | 目录树补新模块、迁移编号区间 |
| 仓库描述 / topics | `gh repo edit --description/--add-topic` |
| 社交预览图 | 大版本时重做 1280×640 |

配套：`docs/更新日志.md` 逐条追加（只加不改），Release notes 与它保持一致。

---

## 2. 每次发版的固定流程（八步）

按顺序执行，每步都要有可核对的输出。

### 步骤 1 · 检查工作区

```bash
git status                    # 看清有多少改动、哪些文件
git log --oneline v<上一版>..HEAD   # 这次包含哪些提交
```

### 步骤 2 · 密钥扫描（规则一 · 1.2）

```bash
bash scripts/scan_secrets.sh      # 退出码必须是 0
```

脚本覆盖 `sk-` / `ghp_` / `AKIA` / 私钥 / JWT / 明文连接串等 10 类形态，
并检查 `.env`、`.jwt_secret` 是否被误跟踪。有任何命中就先处理，不要往下走。

### 步骤 3 · 脱敏检查

按规则一的自查词表扫一遍；`docs/images/` 里的截图若含真实品牌名，需重拍。

### 步骤 4 · 跑验证（不通过不发布）

```bash
cd backend && ./.venv/bin/python -m pytest        # 期望 278+ passed
cd frontend && npm run build                      # tsc --noEmit + vite build
cd frontend && npm test                           # vitest，期望 52+ passed
```

### 步骤 5 · 分逻辑提交

**一次提交只做一件事。** 按后端 / 前端 / 部署 / 文档 / 杂项拆开，
**逐组 `git add <明确路径>`，绝不用 `git add -A`**（会把别人的在途改动卷进来）。

**add 之前必须先看 diff**（2026-11-14 踩过的坑）：

```bash
git diff --stat -- <待提交的每个文件>   # 行数与本次改动对得上才继续
git diff -- <文件>                     # 逐行确认没有夹带
```

文件名眼熟 ≠ 内容只属于本次改动。同一个文件里可能躺着别人（或自己更早）的在途修改——
2026-11-14 就因为只改了一行却整文件 add，把 AI 鉴权的在途改动一起提交了。

```
feat(backend):  ...
feat(frontend): ...
docs:           ...
chore:          ...
```

### 步骤 6 · 推送

```bash
git push origin main
git push gitea HEAD:main     # 平台镜像仓库（ssh://git@gitea/cbb888/mingcebi.git）
```

本机到 GitHub 有间歇性 TLS 握手超时，失败时用 HTTP/1.1 重试：

```bash
git -c http.version=HTTP/1.1 push origin main    # 最多重试 3 次
```

### 步骤 7 · 打标签 + 发 Release

```bash
git tag -a vX.Y.Z -m "明策BI vX.Y.Z — <一句话>"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z · <标题>" --notes-file <说明文件>
```

Release 说明必须包含：本版重点、验证结果、升级说明、已知限制。

### 步骤 8 · 核对远端 + 数据库快照

```bash
git rev-parse HEAD origin/main        # 两行必须一致
gh release view vX.Y.Z                # 非 draft
pg_dump -Fc -d mingcebi_dev -f ~/Desktop/MingceBI-版本备份/vX.Y.Z/db.dump
```

---

## 3. 入库边界速查

```
✅ 入库                              ❌ 不入库
────────────────────────────────────────────────────────
backend/app/**                       backend/.venv/
backend/schema/**                    backend/.env
backend/tests/**                     backend/.jwt_secret
frontend/src/**                      frontend/node_modules/
frontend/packages/**                 frontend/dist/
deploy/**                            frontend/storybook-static/
docs/*.md                            docs/_selfcheck/
docs/images/*.jpg（≤1MB）             docs/看板截图/
README / LICENSE / 声明文件            市场部BI看板模板/
.github/**                           市场部BI看板模板-已脱敏/
scripts/**                           组件样式/
```

---

## 4. 禁用命令清单

| 命令 | 为什么禁用 |
|---|---|
| `git push --force` / `-f` | 覆盖历史，违反规则四 |
| `git add -A` / `git add .` | 会卷进在途改动和误加文件 |
| `git commit --amend`（已推送后） | 改写历史 |
| `git rebase`（已推送的提交） | 改写历史 |
| `git tag -d` / `git push --delete` | 丢版本锚点 |
| `rm -rf` 任何含数据的目录 | 违反"不能删除数据" |

---

## 5. 常见故障处理

| 症状 | 处理 |
|---|---|
| `push` 报 TLS / `Empty reply` | `git -c http.version=HTTP/1.1 push origin main` 重试 3 次 |
| `push` 被拒（non-fast-forward） | 远端有新提交：建备份分支 → `git pull --rebase` → 再推 |
| `401 / Bad credentials` | `gh auth login --web --git-protocol https` 重新授权 |
| `git push` 要求密码 | 检查 `gh auth setup-git`，或重新 `gh auth login` |
| 数据库迁移失败 | 用 `~/Desktop/MingceBI-版本备份/` 里的 dump 回滚 |

---

## 6. 发布记录

> 每次正式发布在此追加一行，只加不改。

| 版本 | 日期 | 提交 | 主要内容 | 验证 |
|---|---|---|---|---|
| `v0.1.0` | 2026-11-13 | `1f8d326` | 首个打标签版本：数据源类型目录、六类连接器、数据集安全与沙箱、指标治理、模型导入、Sentry/GlitchTip、Helm Chart | pytest 270 · tsc + build |
| `v0.1.1` | 2026-11-14 | `57074b4` | 管理后台六分区、6 个权限码（现算）、部门体系（11 个默认部门）、注册审批、AI 模型配置、每日异常日报、修复连接池泄漏 | pytest 278 · vitest 52 · tsc + build |
| `docs` | 2026-11-14 | `2a09a28` | README 同步 v0.1.1 能力、管理后台截图、目录树更新（非版本发布） | 预览渲染自检 |
| `docs` | 2026-11-14 | — | 规范补充 1.2 密钥与凭据脱敏；新增 `scripts/scan_secrets.sh` 发布前门禁 | 脚本双向验证（干净=0 / 假 key=1）、全历史扫描无命中 |
| `fix` | 2026-11-14 | `81311d1` | 移除数据库默认弱口令：缺 `DATABASE_URL` 即报错；query_router / doris_sync 统一复用 settings | pytest 278；缺配置场景实测抛错；正常配置行为不变 |
| `feat` | 2026-11-14 | `8aedfb4` | AI 接口鉴权（MCP 方案 S0）：`bi:ai:use/sql/export` 权限码、迁移 046、角色回填、QA 矩阵 | pytest 278 |

---

## 7. 已知问题与待办

| 项 | 状态 | 说明 |
|---|---|---|
| README 截图含真实品牌 | ⚠️ 待处理 | `detail-table.jpg` 等含麦斯蒂 / 麦富迪等真实品牌与商品图，与规则一冲突，需用脱敏数据重拍 |
| 中国地图审图号 | ⚠️ 未解决 | `backend/app/maps/china.json` 无审图号，仅限内部使用，对外发布前须替换 |
| `xlsx@0.18.5` CVE | ⚠️ 未解决 | CVE-2023-30533 / CVE-2024-22363，建议 Excel 解析迁到后端 `openpyxl` |
| main 分支保护 | ❌ 未开启 | 私库保护需付费计划；目前靠 tag 兜底 |
| 源码内置开发默认口令 | ✅ 已修复（2026-11-14） | 4 处兜底默认值已移除：`config.py` 改为缺 `DATABASE_URL` 即抛出明确错误，`query_router` / `doris_sync` 统一复用 `settings.database_url`，CI 显式注入 `DATABASE_URL` |
| 模板包脱敏版 | ✅ 已完成 | `市场部BI看板模板-已脱敏/`（98 MB），22 敏感词零残留 |

---

## 8. 变更本规范

修改本文件需在提交信息中写明 `docs(rules):`，并在第 6 节记录一次。
规则的增删由仓库所有者决定，AI 助手的职责是**遵守并提醒**，不是自行放宽。
