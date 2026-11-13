/**
 * 明策BI · 看板并发压测（k6）
 *
 * 测什么：N 个并发用户反复打开看板（POST render），也就是真实使用里最重、最集中的那条链路。
 *
 * 用法（先装 k6：brew install k6）：
 *   单账号（用现成 token，跳过登录）：
 *     BASE_URL=http://127.0.0.1:8300 TOKEN=<access_token> DASHBOARD_ID=126 THINK=1 \
 *     k6 run backend/tests/load/k6_dashboard.js
 *
 *   多账号 × 多看板（线上口径：不同用户看不同看板，各自独立缓存）：
 *     BASE_URL=http://127.0.0.1:8300 \
 *     ACCOUNTS="loadtest1:Loadtest2026,loadtest2:Loadtest2026,loadtest3:Loadtest2026" \
 *     DASHBOARD_IDS="57,58,107" THINK=1 k6 run backend/tests/load/k6_dashboard.js
 *
 * 说明：
 *   · 推荐传 TOKEN，跳过登录：本项目的登录会递增 token_version（单设备登录），
 *     用账号密码登录会把浏览器里的会话踢掉；也可以用专用的压测账号（临时账号测完删掉）；
 *   · 不传 TOKEN 时才用 USERNAME / PASSWORD 登录（账号字段名是 account）；
 *   · DASHBOARD_IDS 不填时按「卡片最多」自动挑 3 张（多账号模式）；
 *   · VIEW 不填时走后端默认视图（views[0]）；
 *   · 限流默认 300 次/分钟/IP，200 并发压测会被 429 挡掉 —— 压测时把后端
 *     RATE_LIMIT_DEFAULT 调大（例：RATE_LIMIT_DEFAULT=1000000）再启动；
 *   · 同一个 TOKEN = 同一个用户，会共用「每用户并发查询」配额（BI_USER_MAX_CONCURRENT，
 *     默认 16）：测「缓存关掉」时大量请求会排队，这是治理在保护数据库，不是脚本问题；
 *   · 整页缓存 key 含用户，所以多账号压测时缓存不共享 —— 更接近真实（每个用户各自一套）。
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8300';
const TOKEN = __ENV.TOKEN || '';
const ACCOUNTS = (__ENV.ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DASHBOARD_ID = __ENV.DASHBOARD_ID || '';
const DASHBOARD_IDS = (__ENV.DASHBOARD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const VIEW = __ENV.VIEW || '';
const THINK = Number(__ENV.THINK || 1);

const renderMs = new Trend('dashboard_render_ms', true);
const renderFail = new Rate('dashboard_render_fail');

export const options = {
  scenarios: {
    open_dashboard: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '60s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '60s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '60s', target: 200 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    dashboard_render_ms: ['p(95)<1500'],
    dashboard_render_fail: ['rate<0.001'],
    http_req_failed: ['rate<0.01'],
  },
};

function login(csrf, account) {
  const [username, password] = account.split(':');
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ account: username, password }),
    { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `csrf_token=${csrf}` } },
  );
  const body = res.json();
  const access = body && body.data ? body.data.access_token : '';
  if (!access) throw new Error(`登录失败（${username} / ${res.status}）：${res.body}`);
  return access;
}

export function setup() {
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf-token`);
  const csrf = csrfRes.json('csrf_token');

  let tokens = [];
  if (ACCOUNTS.length) {
    tokens = ACCOUNTS.map((account) => login(csrf, account));
  } else if (TOKEN) {
    tokens = [TOKEN];
  } else {
    tokens = [login(csrf, `${__ENV.USERNAME || 'admin'}:${__ENV.PASSWORD || 'Admin@123456'}`)];
  }

  let dashboardIds = DASHBOARD_IDS;
  if (!dashboardIds.length && DASHBOARD_ID) dashboardIds = [DASHBOARD_ID];
  if (!dashboardIds.length) {
    const listRes = http.get(`${BASE_URL}/api/bi/dashboards`, {
      headers: { Authorization: `Bearer ${tokens[0]}` },
    });
    const rows = (listRes.json('dashboards') || []).slice().sort((a, b) => (b.charts || 0) - (a.charts || 0));
    if (!rows.length) throw new Error('这个账号下没有看板，请先建一张或显式传 DASHBOARD_IDS');
    dashboardIds = rows.slice(0, 3).map((r) => String(r.id));
  }

  return { tokens, csrf, dashboardIds, view: VIEW };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const dashboardId = data.dashboardIds[(__VU + __ITER) % data.dashboardIds.length];
  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-CSRF-Token': data.csrf,
      Cookie: `csrf_token=${data.csrf}`,
    },
    tags: { name: 'render', dashboard: dashboardId },
  };
  const body = data.view ? JSON.stringify({ view: data.view }) : '{}';
  const res = http.post(`${BASE_URL}/api/bi/dashboards/${dashboardId}/render`, body, params);

  renderMs.add(res.timings.duration);
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has cards': (r) => r.status !== 200 || r.json('cards') !== null,
    // 200 也可能是「整页都在报错卡」：逐张确认没有 error 才算真的可用
    'no card errors': (r) => {
      if (r.status !== 200) return true;
      const cards = r.json('cards') || {};
      return Object.values(cards).every((card) => !card || !card.error);
    },
  });
  renderFail.add(!ok);

  sleep(THINK);
}
