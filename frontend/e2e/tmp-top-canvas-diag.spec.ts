// 临时诊断：画布弹窗里的排序（不提交）
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

test("画布弹窗排序诊断", async ({ page }) => {
  await page.goto(`/bi/canvas?doc=${DOC_ID}`);
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(1500);
  await page.locator('[data-board-key="tt_kpi"]').click({ position: { x: 20, y: 10 } });
  await page.waitForTimeout(800);
  const rowSelect = (label: string) => page.getByText(label, { exact: true }).first().locator("..").locator(".MuiSelect-select");
  console.log("面板：", await rowSelect("排序列").innerText(), "/", await rowSelect("排序").innerText());
  await page.locator('[title^="点开看"]').first().click();
  const dialog = page.locator(".MuiDialog-root");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const headers = await dialog.locator("thead th").allInnerTexts();
  const sortState = await dialog.locator("th[aria-sort]").evaluateAll((els) => els.map((e) => `${(e.textContent || "").trim()}:${e.getAttribute("aria-sort")}`));
  const values = await dialog.evaluate((root) => {
    const table = root.querySelector("table")!;
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent || "").replace(/[↑↓]/g, "").trim());
    const index = heads.indexOf("daily_deal");
    return Array.from(table.querySelectorAll("tbody tr")).map((tr) => (tr.children[index] as HTMLElement)?.innerText.trim() ?? "");
  });
  console.log("headers:", headers.join(","));
  console.log("aria-sort:", sortState.join(","));
  console.log("values:", values.join(" | "));
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-21-kpi-top-sort-canvas-diag.png" });
});
