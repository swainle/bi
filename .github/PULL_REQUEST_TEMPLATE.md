## 改了什么

<!-- 一句话说清这次改动；涉及界面的附前后对比截图 -->

## 影响面

- [ ] 前端页面
- [ ] 后端接口 / 查询链路
- [ ] 数据结构 / 迁移
- [ ] 安全（权限 / 脱敏 / SQL 网关）
- [ ] 仅文档

涉及页面：<!-- /bi/canvas、/bi/dashboards/:id … -->

## 怎么验证的

<!-- 贴命令与结果，不要只写"本地测过" -->

```bash
# 后端
cd backend && ./.venv/bin/python -m pytest

# 前端
cd frontend && npm run build
```

界面改动：逐屏截图自检完成 / 未涉及界面

## 风险与回滚

- 风险：
- 回滚：

## 检查项

- [ ] 界面改动已追加 `docs/更新日志.md`
- [ ] 沿用了既有设计令牌，没有临时造新样式
- [ ] 没有把 `.env` / 密钥 / 业务数据带进提交
- [ ] 一次提交只做一件事

---

## 组件改动（仅改渲染器 `features/components/renderers/` 时填写，其它改动删掉本节）

- kind：
- 规范与数据契约：`docs/组件开发规范.md` · `docs/组件数据契约.md`

四档尺寸截图（缺一不可，224×104 单独一张）：

| 尺寸 | 截图 |
| --- | --- |
| 224×104（一排 6 张） | |
| 344×220（一排 4 张） | |
| 464×260（一排 3 张） | |
| 712×340（一排 2 张） | |

边界状态：

- [ ] 空数据
- [ ] 只有 1 条
- [ ] 数值跨度极大
- [ ] 超长文本
- [ ] 超窄容器
- [ ] `compact` 缩略图模式

自检：

- [ ] `npm run typecheck` 通过
- [ ] `npm run build-storybook` 通过
- [ ] story 用的是 `__fixtures__` 里的真实 payload（不是手敲假数据）
- [ ] 没有新增硬编码颜色 / 字号 / 圆角（`grep -n "#[0-9A-Fa-f]\{6\}"` 命中为 0，或只来自色板常量）
- [ ] 没有改 `types.ts` 里的公共类型

需要我方做的事（新增 kind 时勾选）：

- [ ] `backend/app/components/spec.py` 的 `KINDS` / `ROLES` 注册
- [ ] `frontend/src/features/components/types.ts` 的 `ComponentKind` 加类型
- [ ] `bi_component` 种子行

