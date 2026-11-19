# PostgreSQL pgaudit 配置指南（直连数据库审计）

> 适用：需要记录**绕过应用直连数据库**的读写操作（psql / BI 工具 / 黑客连库）。
> 与「操作监控」的关系：应用内的匿名/越权/扫描由 `SecurityWatchMiddleware` 记录；
> 直连数据库目前只有 `pg_stat_activity` 采样（`db_external_session`，每 60s、只抓活跃超 5s 的会话）。
> **pgaudit 是直连审计的权威记录**，采样只是轻量补充。

当前开发机：PostgreSQL **16.14（Homebrew）**，**pgaudit 16.0 已安装并启用（2026-11-14）**；
配置路径 `/opt/homebrew/var/postgresql@16/postgresql.conf`，日志目录
`/opt/homebrew/var/postgresql@16/log/`。

## 本机已执行结果（2026-11-14）

| 项 | 结果 |
| --- | --- |
| 扩展安装 | `pgaudit.dylib` + `pgaudit--16.0.sql` 已装进 `/opt/homebrew/opt/postgresql@16` |
| 预加载 | `shared_preload_libraries = pgaudit`（已重启 `brew services restart postgresql@16`） |
| 扩展版本 | `CREATE EXTENSION pgaudit` → **16.0** |
| 应用账号 | `ALTER ROLE "cavan-m4max" SET pgaudit.log = 'none'`（业务查询不写审计） |
| 直连验证 | 临时只读角色查 `bi_demo_sku` → 日志出现 `AUDIT: SESSION,...,READ,SELECT,TABLE,public.bi_demo_sku,...` |
| 应用验证 | 通过 API 查同一张表 → `AUDIT` 增量 **0**（应用连接已静默） |
| 日志 | `log/postgresql-YYYY-MM-DD.log`（stderr）与 `.csv`（csvlog），按天滚动 |

> 临时测试角色 `qa_pgaudit_reader` 已删除；正式直连账号请按第 4 节创建 `bi_reader`（记得设强口令）。

---

## 1. 安装扩展

### macOS（Homebrew，源码编译）

Homebrew 没有 `pgaudit` formula，需要按 PostgreSQL 大版本编译：

```bash
# 1) 取与 PG 16 对应的 pgaudit（tag 16.0；没有该 tag 就用 REL_16_STABLE）
git clone --depth 1 --branch 16.0 https://github.com/pgaudit/pgaudit.git /tmp/pgaudit
# 2) 用当前 PG 的 pg_config 编译安装
cd /tmp/pgaudit
make install USE_PGXS=1 PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config
# 3) 确认扩展文件已就位
ls /opt/homebrew/share/postgresql@16/extension/pgaudit.control
```

### Linux

```bash
# Debian / Ubuntu（PGDG 源）
sudo apt install postgresql-16-pgaudit
# RHEL / Rocky
sudo dnf install pgaudit_16
```

### Docker

```dockerfile
FROM postgres:16
RUN apt-get update \
 && apt-get install -y postgresql-16-pgaudit \
 && rm -rf /var/lib/apt/lists/*
```

或在 `docker-compose.yml` 里挂载自定义 `postgresql.conf`（见下一步），启动命令追加
`-c shared_preload_libraries=pgaudit`。

### 云数据库（RDS / Aurora / 云托管）

控制台 → 参数组：`shared_preload_libraries = pgaudit`，保存后**重启实例**；随后在每个库执行
`CREATE EXTENSION pgaudit;`。云上不能改 `postgresql.conf` 文件本身。

---

## 2. 修改 `postgresql.conf`

```conf
# 必须放在 shared_preload_libraries，改完要重启
shared_preload_libraries = 'pgaudit'

# 审计范围：读、写、DDL、角色变更；要全量可改 'all'
pgaudit.log = 'read, write, ddl, role'
# 不记录系统表查询，减少噪声
pgaudit.log_catalog = off
# 不记录绑定参数（避免把密码/密钥写进日志）
pgaudit.log_parameter = off
# 记录涉及的表名
pgaudit.log_relation = on
# 每条语句都要有完整 AUDIT 行（便于 grep）
pgaudit.log_statement_once = off
pgaudit.log_level = log

# 日志落盘 + 按天滚动（csvlog 便于后续采集）
logging_collector = on
log_destination = 'csvlog'
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = '1d'
log_rotation_size = '100MB'
log_truncate_on_rotation = on
```

> 只想先观察、不想被日志量吓到：把 `pgaudit.log` 设为 `'ddl, role'`，确认链路后再加 `read, write`。

重启：

```bash
brew services restart postgresql@16        # macOS
sudo systemctl restart postgresql-16       # Linux
docker compose restart postgres            # Docker
```

---

## 3. 建扩展与验证

```sql
-- 每个需要审计的数据库都要执行一次
CREATE EXTENSION IF NOT EXISTS pgaudit;

SHOW shared_preload_libraries;              -- 应包含 pgaudit
SELECT extname, extversion FROM pg_extension WHERE extname = 'pgaudit';
SHOW pgaudit.log;
```

---

## 4. 按角色控制日志量（关键）

审计是**按角色**生效的：应用连接设 `none`，直连审计账号单独建。

```sql
-- 1) 应用连接降噪：避免把业务查询全部写进审计日志
--    这里的账号是 DATABASE_URL 里的用户（本项目开发库为 cavan-m4max）
ALTER ROLE "cavan-m4max" SET pgaudit.log = 'none';

-- 2) 直连只读审计账号（示例）：非超级用户，继承 S6 的只读角色 mcbi_rls
CREATE ROLE bi_reader LOGIN PASSWORD '请换成强口令';
GRANT mcbi_rls TO bi_reader;                -- 继承 SELECT + RLS 约束
ALTER ROLE bi_reader SET pgaudit.log = 'read, ddl, role';

-- 3) 如果还有其它 ETL / BI 工具账号，同样按需设置：
--    ALTER ROLE etl_user SET pgaudit.log = 'read, write';
```

说明：
- **超级用户会绕过 RLS**，直连审计账号必须是普通角色（如 `bi_reader`），既能被 RLS 约束，也归 pgaudit 管；
- `mcbi_rls` 是 NOLOGIN 角色，不能直接登录，只能被授权给登录角色继承；
- 应用使用 `application_name=mingcebi-api`（`app/database.py` 已固定），日志/采样都可据此排除应用自身。

---

## 5. 验证「直连也能被记下来」

```bash
# 用审计账号直连并查一张业务表
psql "postgresql://bi_reader:口令@127.0.0.1:5432/mingcebi_dev" \
     -c "SELECT * FROM bi_demo_sku LIMIT 1"

# 查看审计日志（macOS 路径；Linux/Docker 换成对应 log 目录）
grep 'AUDIT:' /opt/homebrew/var/postgresql@16/log/postgresql-*.log | tail -5
```

应看到类似：

```text
AUDIT: SESSION,1,1,READ,SELECT,TABLE,public.bi_demo_sku,"SELECT * FROM bi_demo_sku LIMIT 1",<none>
```

同时应用内的「操作监控 → 安全事件」仍会独立记录匿名/越权/扫描行为；两边互补：
pgaudit 管**数据库会话**，操作监控管**HTTP 请求**。

---

## 6. 日志留存与采集（可选）

- 最少：依赖 PG 自带滚动（`log_rotation_age/size`），保留 7~30 天，定期归档；
- 进阶：`csvlog` 用 Filebeat / Vector / Fluent Bit 采集到 Loki / Elasticsearch，按 `AUDIT:` 建索引；
- 不建议 `pgaudit.log_parameter = on`：SQL 参数里可能有手机号、密钥等敏感数据；
- 若要把 pgaudit 接进现有「操作监控」，需要新增一个日志导入器（解析 csvlog → 写
  `bi_security_event`，`event_type='db_audit'`）。当前未实现，按需再加。

---

## 7. 回滚

```conf
# 去掉 pgaudit 后重启
shared_preload_libraries = ''
```

```sql
DROP EXTENSION IF EXISTS pgaudit;           -- 可选
ALTER ROLE "cavan-m4max" RESET pgaudit.log; -- 恢复默认（若无扩展会报错，忽略即可）
```

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `CREATE EXTENSION pgaudit` 报找不到 | 扩展文件没装到当前 PG 的 `extension/` 目录，或装到了别的 PG 版本 |
| 改完配置没有 AUDIT 行 | 没重启（`shared_preload_libraries` 必须重启）；或当前角色 `pgaudit.log=none` |
| 日志量暴涨 | 把 `pgaudit.log` 收到 `ddl, role`；关闭 `log_catalog`；应用角色设 `none` |
| 日志里看不到表名 | 打开 `pgaudit.log_relation = on` |
| 云上改不了 conf | 用参数组设置并重启实例 |
| 直连账号能看到全量 | 该账号是超级用户或表 owner；用普通角色 + `mcbi_rls` 授权，并保留 `FORCE RLS` |
