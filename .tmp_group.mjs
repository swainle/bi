// 临时验证：预览页码只显示对应分组张数。验完即删。
import { createRequire } from "node:module";
const require = createRequire("D:/repo/MingceBI/frontend/package.json");
const { chromium } = require("@playwright/test");

const API = "http://127.0.0.1:9202";
const WEB = "http://127.0.0.1:9201";
const OUT = "D:/repo/MingceBI/docs/_selfcheck";

const lr = await fetch(`${API}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ account: "admin", password: "123456" }),
});
const token = (await lr.json())?.data?.access_token;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.addInitScript(([t]) => { window.localStorage.setItem("access_token", t); }, [token]);

await page.goto(`${WEB}/bi/dashboards/1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.locator("table:visible tbody tr").first().click();
await page.waitForTimeout(3500);

const drawer = page.locator('[class*="MuiDrawer-paper"]').first();
await drawer.locator('[aria-label="查看商品图片"]').click();
await page.waitForTimeout(1200);
await drawer.locator("img").nth(2).click();
await page.waitForTimeout(800);

const text = await page.locator(".MuiDialog-root").innerText();
console.log("page:", (text.match(/\d+\/\d+/) || [""])[0]);

await page.screenshot({ path: `${OUT}/drawer-page-group.png` });
console.log("saved");
await browser.close();
