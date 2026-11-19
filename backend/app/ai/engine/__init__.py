"""B38 AI 引擎板块.

- `core.py`     模型调用链（候选回退）/ 知识库 / SQL 校验 / 看板生成管线
- `phase2.py`   质量分析 / 自动建模 / 会话迭代 / 任务 / 知识库
- `phase3.py`   根因 / 大屏 / 批量生成 / 告警规则
- `agent.py`    Agent 管线
- `models.py`   模型配置解析（库 → 文件 → 环境变量）与连通性测试
- `quota.py`    每日调用 / token 配额

旧的 `app/services/bi_ai_*.py`、`ai_models.py`、`ai_quota.py` 保留为 re-export 垫片。
"""
