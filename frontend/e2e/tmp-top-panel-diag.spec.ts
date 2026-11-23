// 临时诊断：指标卡面板「排序列/排序」改动是否落库（不提交）
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

test("面板改动落库诊断", async ({ page }) => {
  await page.goto(`/bi/canvas?doc=${DOC_ID}`);
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 40_000 });
  await page.locator('[data-board-key="tt_kpi"]').click({ position: { x: 20, y: 10 } });
  await expect(page.getByText("排序列", { exact: true })).toBeVisible({ timeout: 10_000 });

  const rowSelect = (label: string) => page.getByText(label, { exact: true }).first().locator("..").locator(".MuiSelect-select");
  const dump = async (tag: string) => {
    const out: Record<string, string> = {};
    for (const label of ["弹出明细表", "排序列", "排序"]) {
      out[label] = await rowSelect(label).innerText().catch(() => "ERR");
    }
    console.log(tag, JSON.stringify(out));
  };
  await dump("before");

  await rowSelect("排序").click();
  await page.waitForTimeout(300);
  const options = await page.getByRole("option").allInnerTexts();
  console.log("options:", options.join(","));
  await page.getByRole("option", { name: "升序" }).click();
  await page.waitForTimeout(500);
  await dump("after");

  await page.waitForTimeout(3000);
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  const res = await page.request.get(`/api/bi/dashboards/${DOC_ID}`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const doc = await res.json();
  const kpi = doc.doc.views[0].items.find((i: { key: string }) => i.key === "tt_kpi");
  console.log("API top:", JSON.stringify(kpi?.spec?.top));
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-21-kpi-top-panel-diag.png" });
});
