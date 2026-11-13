FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    chromium fonts-noto-cjk && \
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
