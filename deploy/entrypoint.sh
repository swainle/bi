#!/bin/sh
set -eu

case "${1:-app}" in
  frontend)
    export BACKEND_URL="${BACKEND_URL:-http://backend:8000}"
    export NGINX_RESOLVER="${NGINX_RESOLVER:-$(awk '$1 == "nameserver" {print $2; exit}' /etc/resolv.conf)}"
    envsubst '$BACKEND_URL $NGINX_RESOLVER' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
    exec nginx -g 'daemon off;'
    ;;
  app|backend)
    if [ "$1" = backend ]; then
      export BI_SERVE_FRONTEND=0
    else
      export BI_SERVE_FRONTEND=1
    fi
    exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${WEB_CONCURRENCY:-1}"
    ;;
  worker)
    exec python -m app.query.async_jobs.worker
    ;;
  dev)
    shift
    exec uv run --locked dev --host 0.0.0.0 --port 8000 "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
