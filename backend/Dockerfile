FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl gnupg ca-certificates unixodbc unixodbc-dev \
    chromium fonts-noto-cjk && \
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

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY schema ./schema

RUN mkdir -p uploads data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fs http://127.0.0.1:8000/api/health || exit 1

# WEB_CONCURRENCY 默认 1（与原来完全一致）；多 worker 部署见 docker-compose.prod.yml
ENV WEB_CONCURRENCY=1

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY}"]
