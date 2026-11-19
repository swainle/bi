// 首屏性能预算（本地门禁，跑在 `vite preview` 的生产构建上）：
//   · 登录页：FCP / LCP 预算
//   · 成品看板：LCP + 「图表什么时候真的画出来」（第一块 canvas 出现的时间）
//
// 用法：npm run perf（会先构建、起 preview、跑本用例、再关掉）
// 说明：数值受机器影响，预算按「本机常见波动」留了余量；不是替代 Lighthouse 的绝对指标。
import fs from "node:fs";

import { expect, test } from "@playwright/test";

const TOKEN_FILE = process.env.MCBI_TOKEN_FILE || "/tmp/mcbi_tokens.json";
const DASHBOARD_ID = process.env.MCBI_DASHBOARD_ID || "57";

// 预算可用环境变量覆盖（慢机器 / 临时验证「门禁真的会失败」）
const LOGIN_LCP_MAX_MS = Number(process.env.MCBI_LOGIN_LCP_MAX_MS || 3000);
const DASHBOARD_LCP_MAX_MS = Number(process.env.MCBI_DASHBOARD_LCP_MAX_MS || 4500);
const CHART_MAX_MS = Number(process.env.MCBI_CHART_MAX_MS || 8000);

function readTokens(): { access_token: string; refresh_token: string } | null {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
}

const collectPaint = `
  window.__perf = { fcp: 0, lcp: 0 };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === "first-contentful-paint") window.__perf.fcp = entry.startTime;
    }
  }).observe({ type: "paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__perf.lcp = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
`;

test("登录页首屏预算", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.addInitScript(collectPaint);
  await page.goto("/login");
  await page.waitForTimeout(1200);
  const perf = await page.evaluate(() => (window as unknown as { __perf: { fcp: number; lcp: number } }).__perf);
  console.log(`[perf] 登录页 FCP=${perf.fcp.toFixed(0)}ms LCP=${perf.lcp.toFixed(0)}ms`);
  expect(perf.fcp).toBeLessThan(2000);
  expect(perf.lcp).toBeLessThan(LOGIN_LCP_MAX_MS);
});

test("成品看板首屏预算", async ({ page }) => {
  const tokens = readTokens();
  if (!tokens) {
    throw new Error(`缺少 ${TOKEN_FILE}：先运行 backend/.venv/bin/python scripts/visual_tokens.py`);
  }
  await page.addInitScript(([access, refresh]) => {
    window.localStorage.setItem("access_token", access);
    window.localStorage.setItem("refresh_token", refresh);
  }, [tokens.access_token, tokens.refresh_token] as const);
  await page.addInitScript(collectPaint);

  const started = Date.now();
  await page.goto(`/bi/dashboards/${DASHBOARD_ID}`);
  // 第一块图表 canvas 出现 = 用户真正看到数据的时间
  await page.waitForSelector("canvas", { timeout: 30_000 });
  const chartVisibleMs = Date.now() - started;
  await page.waitForTimeout(1500);
  const perf = await page.evaluate(() => (window as unknown as { __perf: { fcp: number; lcp: number } }).__perf);

  console.log(
    `[perf] 看板 LCP=${perf.lcp.toFixed(0)}ms 图表出现=${chartVisibleMs}ms`,
  );
  expect(chartVisibleMs).toBeLessThan(CHART_MAX_MS);
  expect(perf.lcp).toBeLessThan(DASHBOARD_LCP_MAX_MS);
});
