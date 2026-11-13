// 主链路 E2E（本地门禁）：登录跳转 → 我的看板 → 成品看板 → 筛选 → 导出菜单 → 组件库地图 → 模板分享 → 团队协同。
//
// 用法（先确保前端 :5300、后端 :8300 都在跑）：
//   backend/.venv/bin/python scripts/visual_tokens.py   # 生成 /tmp/mzbi_tokens.json（不会踢掉浏览器会话）
//   cd frontend && npm run e2e
//
// 说明：
//   · token 直接注入 localStorage，不走登录接口（见 AGENTS §7.4）；
//   · 看板 id 可用环境变量覆盖：MZBI_DASHBOARD_ID（渲染）/ MZBI_FILTER_DASHBOARD_ID（筛选）/ MZBI_SHARE_DASHBOARD_ID（分享）；
//   · 团队协同用例会先分享再「取消协同」恢复原状；如果本来就已分享，只断言不取消。
import fs from "node:fs";
import type { Page } from "@playwright/test";

import { expect, test } from "@playwright/test";

const TOKEN_FILE = process.env.MZBI_TOKEN_FILE || "/tmp/mzbi_tokens.json";
const DASHBOARD_ID = process.env.MZBI_DASHBOARD_ID || "57";
const FILTER_DASHBOARD_ID = process.env.MZBI_FILTER_DASHBOARD_ID || "58";
const SHARE_DASHBOARD_ID = process.env.MZBI_SHARE_DASHBOARD_ID || "58";

function readTokens(): { access_token: string; refresh_token: string } {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`缺少 ${TOKEN_FILE}：先运行 backend/.venv/bin/python scripts/visual_tokens.py`);
  }
  return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
}

async function boardName(page: Page, boardId: string | number): Promise<string> {
  const res = await page.request.get(`/api/bi/dashboards/${boardId}`, {
    headers: { Authorization: `Bearer ${readTokens().access_token}` },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  return String(data.name || "");
}

/** 我的看板：hover 卡片 → 点右上角「⋯」→ 返回菜单已打开 */
async function openBoardMenu(page: Page, name: string): Promise<void> {
  const title = page.getByText(name, { exact: true }).first();
  await title.scrollIntoViewIfNeeded();
  const card = title.locator("..");
  await card.hover();
  await card.locator(".more-btn").click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
}

test("未登录访问看板 → 跳登录页", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/bi");
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /登录/ }).first()).toBeVisible();
});

test.describe("登录后主链路", () => {
  test.beforeEach(async ({ page }) => {
    const tokens = readTokens();
    await page.addInitScript(([access, refresh]) => {
      window.localStorage.setItem("access_token", access);
      window.localStorage.setItem("refresh_token", refresh);
    }, [tokens.access_token, tokens.refresh_token] as const);
  });

  test("我的看板：列表能打开", async ({ page }) => {
    await page.goto("/bi");
    await expect(page.getByText("我的看板").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.locator(".more-btn").count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test("成品看板：图表渲染 + 导出菜单齐全", async ({ page }) => {
    await page.goto(`/bi/dashboards/${DASHBOARD_ID}`);
    await expect(page.getByText("看板渲染失败")).toHaveCount(0);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    const exportBtn = page.getByRole("button", { name: /^导出$/ }).first();
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });
    await exportBtn.click();
    await expect(page.getByRole("menuitem", { name: /Excel/ }).first()).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /PDF/ }).first()).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /PNG/ }).first()).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /HTML/ }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: /PDF/ })).toHaveCount(0);
  });

  test("看板筛选：切平台 → 地址栏与筛选值同步", async ({ page }) => {
    await page.goto(`/bi/dashboards/${FILTER_DASHBOARD_ID}`);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    const platform = page.locator('[data-filter-select="platform"]');
    await expect(platform).toBeVisible({ timeout: 15_000 });
    await platform.click();
    await page.getByRole("menuitem", { name: "拼多多", exact: true }).click();

    await expect(platform).toContainText("拼多多");
    await expect(page).toHaveURL(/p_platform=/);
    await expect(page.getByText("看板渲染失败")).toHaveCount(0);
  });

  test("组件库：23 类含地图，点开放大能渲染", async ({ page }) => {
    await page.goto("/bi/components");
    await expect(page.getByText(/个卡片/).first()).toBeVisible({ timeout: 20_000 });
    const mapTitle = page.getByText("中国地图", { exact: true }).first();
    await mapTitle.scrollIntoViewIfNeeded();
    await expect(mapTitle).toBeVisible();
    await mapTitle.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("模板分享：弹窗字段齐全 + 名称为空不可提交", async ({ page }) => {
    const name = await boardName(page, SHARE_DASHBOARD_ID);
    await page.goto("/bi");
    await expect(page.getByText("我的看板").first()).toBeVisible({ timeout: 20_000 });
    await openBoardMenu(page, name);
    await page.getByRole("menuitem", { name: "分享到模板库" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("分享到模板库").first()).toBeVisible();
    await expect(dialog.getByLabel("模板名称")).toHaveValue(name);
    await expect(dialog.getByLabel("模板说明")).toBeVisible();
    await expect(dialog.getByText("所有人可见")).toBeVisible();

    // 校验真实生效：名称清空 → 「分享」按钮置灰
    await dialog.getByLabel("模板名称").fill("");
    await expect(dialog.getByRole("button", { name: "分享", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("团队协同：分享 → 我的团队可见 → 取消协同恢复", async ({ page }) => {
    const name = await boardName(page, SHARE_DASHBOARD_ID);
    await page.goto("/bi");
    await expect(page.getByText("我的看板").first()).toBeVisible({ timeout: 20_000 });
    await openBoardMenu(page, name);
    await page.getByRole("menuitem", { name: "分享到我的团队" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("分享到我的团队").first()).toBeVisible();
    const alreadyShared = (await dialog.getByRole("button", { name: "取消协同" }).count()) > 0;
    if (!alreadyShared) {
      await dialog.getByRole("button", { name: "分享到我的团队" }).click();
      await expect(dialog.getByRole("button", { name: "取消协同" })).toBeVisible({ timeout: 15_000 });
    }
    await dialog.getByRole("button", { name: "关闭" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/bi?view=team");
    await expect(page.getByText("我分享的").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    if (!alreadyShared) {
      // 恢复原状：取消协同后团队页不再出现
      await page.goto("/bi");
      await openBoardMenu(page, name);
      await page.getByRole("menuitem", { name: "分享到我的团队" }).click();
      const again = page.getByRole("dialog");
      await again.getByRole("button", { name: "取消协同" }).click();
      await expect(again.getByRole("button", { name: "分享到我的团队" })).toBeVisible({ timeout: 15_000 });
      await again.getByRole("button", { name: "关闭" }).click();

      await page.goto("/bi?view=team");
      await expect(page.getByText("我分享的").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });
});
