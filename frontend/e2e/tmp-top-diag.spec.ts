// 临时诊断：临时看板页面为什么没有表格（不提交）
import fs from "node:fs";
import { test } from "@playwright/test";

const TOKEN_FILE = process.env.MCBI_TOKEN_FILE || "C:/Users/YD003/AppData/Local/Temp/mcbi_tokens.json";

test.beforeEach(async ({ page }) => {
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  await page.addInitScript(([access, refresh]) => {
    window.localStorage.setItem("access_token", access);
    window.localStorage.setItem("refresh_token", refresh);
  }, [tokens.access_token, tokens.refresh_token] as const);
});

test("临时看板诊断", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 200)); });
  page.on("pageerror", (err) => errors.push("pageerror: " + String(err).slice(0, 200)));
  const responses: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 400) responses.push(res.status() + " " + res.url());
  });
  await page.goto("/bi/dashboards/5");
  await page.waitForTimeout(3000);
  const text = (await page.locator("body").innerText()).slice(0, 500);
  console.log("URL:", page.url());
  console.log("BODY:", text.replace(/\n+/g, " | "));
  console.log("ERRORS:", errors.slice(0, 6).join(" || "));
  console.log("HTTP>=400:", responses.slice(0, 6).join(" || "));
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-21-temp-doc-diag.png" });
});
