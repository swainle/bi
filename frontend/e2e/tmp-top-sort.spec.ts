// 临时验证：指标卡徽标弹窗的「排序列 / 排序」只在弹窗内生效，关闭恢复（不提交）
import fs from "node:fs";
import { expect, test } from "@playwright/test";

const TOKEN_FILE = process.env.MCBI_TOKEN_FILE || "C:/Users/YD003/AppData/Local/Temp/mcbi_tokens.json";
const DOC_ID = process.env.MCBI_DOC_ID || "5";

test.beforeEach(async ({ page }) => {
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  await page.addInitScript(([access, refresh]) => {
    window.localStorage.setItem("access_token", access);
    window.localStorage.setItem("refresh_token", refresh);
  }, [tokens.access_token, tokens.refresh_token] as const);
});

async function columnValues(scope: import("@playwright/test").Locator, label: string) {
  return scope.evaluate((root, name) => {
    const table = root.querySelector("table");
    if (!table) return null;
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent || "").replace(/[↑↓]/g, "").trim());
    const index = heads.indexOf(name);
    if (index < 0) return null;
    return Array.from(table.querySelectorAll("tbody tr")).map((tr) => (tr.children[index] as HTMLElement)?.innerText.trim() ?? "");
  }, label);
}

const toNums = (values: string[] | null) => (values ?? [])
  .map((v) => Number(v.replace(/[^\d.-]/g, "")))
  .filter((n) => Number.isFinite(n));

test("徽标弹窗按配置排序，关闭后页面表恢复原顺序", async ({ page }) => {
  await page.goto(`/bi/dashboards/${DOC_ID}`);
  await expect(page.locator("table").first()).toBeVisible({ timeout: 40_000 });
  const before = await columnValues(page.locator("body"), "daily_deal");
  console.log("页面表 daily_deal（前5）:", before?.slice(0, 5).join(","));

  await page.locator('[title^="点开看"]').first().click();
  const dialog = page.locator(".MuiDialog-root");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const nums = toNums(await columnValues(dialog, "daily_deal"));
  console.log("弹窗 daily_deal（前5）:", nums.slice(0, 5).join(","));
  expect(nums).toEqual([...nums].sort((a, b) => b - a));
  await expect(dialog.locator("th", { hasText: "daily_deal" }).first()).toHaveAttribute("aria-sort", "descending");
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-21-kpi-top-sort.png" });

  await page.keyboard.press("Escape");
  await expect(page.locator(".MuiDialog-root")).toHaveCount(0);
  const after = await columnValues(page.locator("body"), "daily_deal");
  console.log("关闭后页面表（前5）:", after?.slice(0, 5).join(","));
  expect(after).toEqual(before);
});

test("编辑器面板：排序列 / 排序，改升序保存后弹窗跟着变", async ({ page }) => {
  await page.goto(`/bi/canvas?doc=${DOC_ID}`);
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 40_000 });
  await page.locator('[data-board-key="tt_kpi"]').click({ position: { x: 20, y: 10 } });
  await expect(page.getByText("排序列", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-21-kpi-top-sort-panel.png" });

  const rowSelect = (label: string) => page.getByText(label, { exact: true }).first().locator("..").locator(".MuiSelect-select");
  await rowSelect("排序列").click();
  await page.getByRole("option", { name: "daily_deal" }).click();
  await rowSelect("排序").click();
  await page.getByRole("option", { name: "升序" }).click();
  await page.getByRole("button", { name: "保存" }).click();

  // 等保存真正落库（GET 到 top.sort = asc）
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  await expect.poll(async () => {
    const res = await page.request.get(`/api/bi/dashboards/${DOC_ID}`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const doc = await res.json();
    const kpi = doc.doc.views[0].items.find((i: { key: string }) => i.key === "tt_kpi");
    return kpi?.spec?.top?.sort;
  }, { timeout: 15_000 }).toBe("asc");

  await page.waitForTimeout(1500); // 等画布渲染（防抖）把新配置写进卡片 payload
  await page.locator('[title^="点开看"]').first().click();
  const dialog = page.locator(".MuiDialog-root");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const values = toNums(await columnValues(dialog, "daily_deal"));
  console.log("升序弹窗（前5）:", values.slice(0, 5).join(","));
  expect(values).toEqual([...values].sort((a, b) => a - b));
  await expect(dialog.locator("th", { hasText: "daily_deal" }).first()).toHaveAttribute("aria-sort", "ascending");
});
