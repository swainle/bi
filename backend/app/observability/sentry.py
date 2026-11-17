"""错误上报（Sentry / 自建 GlitchTip），`SENTRY_DSN` 为空时完全不启用.

为什么做成开关：DSN 是外部服务给的地址，没有它时不该有任何额外开销，
也不能因为 DSN 写错就起不来。所以：
    · 没配 DSN → 直接 return False，不导入 SDK、不发任何请求；
    · DSN 写错 / SDK 没装 → 打印一行原因并 return False，应用照常启动；
    · 配对了 → 初始化，FastAPI 异常与 SQLAlchemy 错误自动上报。

前端浏览器错误仍走站内 `/api/report`（已有 `bi_error_log`），
需要同时进 Sentry 时用 `VITE_SENTRY_DSN`，见 `frontend/src/observability/sentry.ts`。
"""

from __future__ import annotations

import os

_initialized = False


def dsn_host(dsn: str) -> str:
    """只回 host 部分（日志里别把整串 DSN 打出来）."""
    try:
        return dsn.split("@", 1)[1].split("/", 1)[0]
    except IndexError:
        return "?"


def init_sentry(
    dsn: str | None = None,
    environment: str | None = None,
    traces_sample_rate: float | None = None,
) -> bool:
    """初始化；参数优先（来自 Settings，可读 `.env`），没传就退回环境变量.

    返回是否真的启用。
    """
    global _initialized
    raw_dsn = dsn if dsn is not None else os.getenv("SENTRY_DSN")
    raw_dsn = (raw_dsn or "").strip()
    if not raw_dsn:
        print("[sentry] 未配置 SENTRY_DSN，错误只记录到站内错误日志")
        return False
    if _initialized:
        return True
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        env_name = environment if environment is not None else os.getenv("SENTRY_ENVIRONMENT")
        rate = traces_sample_rate
        if rate is None:
            rate = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE") or "0")

        sentry_sdk.init(
            dsn=raw_dsn,
            environment=(env_name or "production").strip(),
            release=(os.getenv("SENTRY_RELEASE") or "").strip() or None,
            # 默认只上报错误，不采样性能（要开就设 0.01~0.2，开销按比例涨）
            traces_sample_rate=rate,
            send_default_pii=False,
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        )
    except ImportError:
        print("[sentry] 未安装 sentry-sdk，跳过（pip install 'sentry-sdk[fastapi]'）")
        return False
    except Exception as exc:  # DSN 不合法等：不能连带应用起不来
        print(f"[sentry] 初始化失败（DSN 可能写错）：{str(exc)[:120]}")
        return False
    _initialized = True
    print(f"[sentry] 已启用 → {dsn_host(raw_dsn)}")
    return True


def enabled() -> bool:
    return _initialized


__all__ = ["init_sentry", "enabled", "dsn_host"]
