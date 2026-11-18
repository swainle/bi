import { test, expect } from "@playwright/test";
test.setTimeout(60_000);

test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem("access_token", "ui-test"));
  const dataset = {
    id: 1, name: "公式字段验收", physical_table: "orders", description: "", conn_mode: "extract",
    fields: [{ id: 1, name: "销售额", source_column: "revenue", role: "measure", data_type: "numeric" }],
    metrics: [], field_count: 1, metric_count: 0,
  };
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path === "/api/auth/me") body = { data: { id: 1, username: "验收", role: "admin", effective_permissions: [] } };
    else if (path.endsWith("/datasets")) body = { datasets: [dataset] };
    else if (path.endsWith("/semantic/tables")) body = { tables: [{ table: "orders", rows: 2, columns: [{ name: "revenue", type: "numeric" }] }] };
    else if (path.endsWith("/datasets/1")) body = dataset;
    else if (path.endsWith("/formula-columns")) body = { columns: [{ name: "revenue", identifier: "revenue" }, { name: "order", identifier: '"order"' }] };
    else if (path.endsWith("/formula-test")) {
      const expression = route.request().postDataJSON().expression;
      status = expression === "missing + 1" ? 400 : 200;
      body = status === 200 ? { valid: true, message: "语法、引用列和函数检查通过" } : { detail: "公式引用的源列不存在：missing" };
    }
    await route.fulfill({ status, json: body });
  });
});

test("公式弹窗测试、插入列和说明链接", async ({ page }, testInfo) => {
  await page.goto("/bi?view=datasets");
  const docsLink = page.getByRole("link", { name: "使用文档", exact: true });
  await expect(docsLink).toHaveAttribute("href", "/help");
  await expect(docsLink).toHaveAttribute("target", "_blank");
  const row = page.getByRole("row").filter({ hasText: "公式字段验收" });
  await row.getByText("公式字段验收", { exact: true }).click();
  await page.getByRole("button", { name: "添加公式字段", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "添加公式字段" });
  const expression = dialog.getByLabel("SQL 表达式");
  await dialog.getByRole("button", { name: "revenue", exact: true }).click();
  await expect(expression).toHaveValue("revenue");
  await dialog.getByRole("button", { name: "测试", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("语法、引用列和函数检查通过");
  await expression.fill("missing + 1");
  await expect(dialog.getByText("语法、引用列和函数检查通过")).toHaveCount(0);
  await dialog.getByRole("button", { name: "测试", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("源列不存在");
  await expression.fill("");
  await dialog.getByRole("button", { name: "order", exact: true }).click();
  await expect(expression).toHaveValue('"order"');
  await expect(dialog.getByText("逐行计算，只填写表达式", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: "../docs/_selfcheck/formula-dialog.png" });
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "公式字段使用说明" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/help\/formula-fields#formula-fields$/);
  await expect(popup.getByRole("heading", { name: "公式字段", exact: true })).toBeVisible();
  await expect(expression).toHaveValue('"order"');
  await popup.screenshot({ path: "../docs/_selfcheck/formula-help-desktop.png" });
  await popup.setViewportSize({ width: 390, height: 844 });
  await expect(popup.getByRole("heading", { name: "公式字段", exact: true })).toBeVisible();
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await popup.screenshot({ path: "../docs/_selfcheck/formula-help-mobile.png" });
  await testInfo.attach("说明文档", { path: "../docs/_selfcheck/formula-help-desktop.png", contentType: "image/png" });
});

test("顶栏文档按钮打开帮助首页", async ({ page }) => {
  await page.goto("/bi?view=datasets");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "使用文档", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/help$/);
  await expect(popup.getByRole("heading", { name: "使用说明", exact: true })).toBeVisible();
  await expect(popup.getByRole("link", { name: "公式字段", exact: false }).first()).toBeVisible();
});
