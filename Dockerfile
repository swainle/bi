FROM node:22-alpine AS frontend-dev
WORKDIR /frontend
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
COPY frontend/packages ./packages
RUN npm ci
COPY frontend/ ./
FROM frontend-dev AS frontend-build
RUN npm run build && npm run budget

FROM python:3.11-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl gnupg ca-certificates unixodbc unixodbc-dev \
    chromium fonts-noto-cjk nginx gettext-base && \
    rm -rf /var/lib/apt/lists/*

# SQL Server 连接器走 pyodbc，需要系统 ODBC 驱动；MS 源不可达时跳过，其它数据源不受影响
RUN set -eux; \
    . /etc/os-release; \
    if curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
         | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
       && echo "deb [signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/${ID}/${VERSION_ID}/prod ${VERSION_CODENAME} main" \
            > /etc/apt/sources.list.d/mssql-release.list \
       && apt-get update \
       && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18; then \
      echo "msodbcsql18 installed"; \
    else \
      echo "warn: msodbcsql18 未安装，该镜像内 SQL Server 数据源不可用"; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# 定时报表 PDF / PNG 由无头 Chromium 渲染（app/reports/browser.py）；CJK 字体保证中文不出现方块
ENV BI_PDF_CHROME=/usr/bin/chromium

COPY --from=ghcr.io/astral-sh/uv:0.13.3 /uv /uvx /usr/local/bin/
ENV PATH="/app/.venv/bin:$PATH" UV_PYTHON_DOWNLOADS=never
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY backend/app ./app
COPY backend/schema ./schema
COPY --from=frontend-build /frontend/dist ./frontend

RUN uv sync --locked --no-dev
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY deploy/entrypoint.sh /usr/local/bin/mingzebi-entrypoint
RUN rm -f /etc/nginx/sites-enabled/default && chmod +x /usr/local/bin/mingzebi-entrypoint && mkdir -p uploads data var/reports

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://127.0.0.1:8000/api/livez || exit 1

ENV WEB_CONCURRENCY=1
ENTRYPOINT ["mingzebi-entrypoint"]
CMD ["app"]

FROM runtime AS development
RUN uv sync --locked
CMD ["dev"]

FROM runtime AS production
