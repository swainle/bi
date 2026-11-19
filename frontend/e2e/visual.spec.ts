// 关键页面视觉回归：登录页 / 我的看板 / 成品看板 / 组件库。
//
// token 从 /tmp/mcbi_tokens.json 读取（由 scripts/visual_tokens.py 生成），
// 直接注入 localStorage —— 不走登录接口，避免把正在用的浏览器会话踢下线。
import fs from "node:fs";

import { expect, test } from "@playwright/test";

const TOKEN_FILE = process.env.MCBI_TOKEN_FILE || "/tmp/mcbi_tokens.json";
const DASHBOARD_ID = process.env.MCBI_DASHBOARD_ID || "57";

function readTokens(): { access_token: string; refresh_token: string } {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(
      `缺少 ${TOKEN_FILE}：先运行 backend/.venv/bin/python scripts/visual_tokens.py`,
    );
  }
  return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
}

test("登录页", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/login");
  await page.waitForTimeout(600);
  await expect(page).toHaveScreenshot("login.png");
});

test.describe("登录后页面", () => {
  test.beforeEach(async ({ page }) => {
    const tokens = readTokens();
    await page.addInitScript(([access, refresh]) => {
      window.localStorage.setItem("access_token", access);
      window.localStorage.setItem("refresh_token", refresh);
    }, [tokens.access_token, tokens.refresh_token] as const);
  });

  test("我的看板", async ({ page }) => {
    await page.goto("/bi");
    await page.waitForTimeout(2500);
    await expect(page).toHaveScreenshot("my-boards.png");
  });

  test("成品看板", async ({ page }) => {
    await page.goto(`/bi/dashboards/${DASHBOARD_ID}`);
    // 等图表动画走完（ECharts 是 canvas 动画，screenshot 的 animations 关不掉）
    await page.waitForTimeout(4000);
    await expect(page).toHaveScreenshot("dashboard-view.png");
  });

  test("组件库", async ({ page }) => {
    await page.goto("/bi/components");
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot("components.png");
  });
});
