import { test, expect, type BrowserContext } from "@playwright/test";

async function mockApi(context: BrowserContext, canSave = true) {
  await context.addInitScript(() => localStorage.setItem("access_token", "ui-test"));
  const calls: { sql?: string; saved?: Record<string, unknown>; metadataWithoutCounts?: boolean } = {};
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = {}, status = 200;
    if (url.pathname === "/api/auth/me") body = { data: {
      id: 1, username: "SQL测试", role: "user",
      effective_permissions: ["bi:nav:sql", ...(canSave ? ["bi:nav:datasets"] : [])],
    } };
    else if (url.pathname === "/api/bi/semantic/tables") {
      calls.metadataWithoutCounts = url.searchParams.get("include_counts") === "false";
      body = { tables: [{ table: "orders_new", origin: "本地数据库", columns: [
        { name: "id", type: "integer" }, { name: "amount", type: "numeric" },
      ] }] };
    } else if (url.pathname === "/api/bi/engine/query") {
      calls.sql = request.postDataJSON().sql;
      if (calls.sql?.includes("broken")) { status = 400; body = { detail: "SQL 错误：字段不存在" }; }
      else body = { columns: ["id", "amount"], rows: calls.sql?.includes("WHERE 1=0") ? [] : [{ id: 1, amount: 25 }],
        count: calls.sql?.includes("WHERE 1=0") ? 0 : 1, truncated: true, limit: 500, elapsed_ms: 2.5 };
    } else if (url.pathname === "/api/bi/semantic/datasets" && request.method() === "POST") {
      calls.saved = request.postDataJSON(); body = { id: 7 };
    } else if (url.pathname === "/api/bi/semantic/datasets") body = { datasets: [] };
    else if (url.pathname === "/api/bi/semantic/datasets/7") body = {
      id: 7, name: "销售虚拟集", physical_table: "custom_sql", is_virtual: true,
      conn_mode: "extract", sql_text: calls.saved?.sql, fields: [], metrics: [],
    };
    await route.fulfill({ status, json: body });
  });
  return calls;
}

test("工作台查询、修改失效、保存虚拟集并进入配置", async ({ page, context }) => {
  const calls = await mockApi(context);
  await page.goto("/bi?view=sql");
  const editor = page.getByRole("textbox", { name: "SQL 编辑器" });
  const save = page.getByRole("button", { name: "保存为虚拟数据集", exact: true });
  await expect(editor).toBeVisible();
  await expect(save).toBeDisabled();
  await expect.poll(() => calls.metadataWithoutCounts).toBe(true);
  await editor.fill("SELECT * FROM ord");
  await editor.press("Control+Space");
  await expect(page.getByRole("option").filter({ hasText: "orders_new" })).toBeVisible();
  await editor.press("Escape");
  await page.getByRole("button", { name: "orders_new", exact: true }).click();
  await page.getByRole("button", { name: "生成预览 SQL", exact: true }).click();
  await expect(editor).toHaveText('SELECT * FROM "orders_new"');
  await editor.press("Control+Enter");
  await expect(save).toBeEnabled();
  await expect(page.getByText("仅返回前 500 行", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "amount", exact: true })).toBeVisible();
  const separator = page.getByRole("separator", { name: "调整编辑器高度" });
  await separator.focus(); await separator.press("ArrowDown");
  await expect(separator).toHaveAttribute("aria-valuenow", "260");
  await editor.fill('SELECT amount FROM "orders_new"');
  await expect(save).toBeDisabled();
  await expect(page.getByText("SQL 已修改，请重新执行后再保存。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await page.getByRole("textbox", { name: "数据集名称" }).fill("销售虚拟集");
  await page.getByRole("button", { name: "创建数据集", exact: true }).click();
  await expect(page.getByText("虚拟数据集已创建。", { exact: true })).toBeVisible();
  expect(calls.saved?.sql).toBe('SELECT amount FROM "orders_new"');
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-18-sql-lab-workbench.png", animations: "disabled" });
  await page.getByRole("button", { name: "配置数据集", exact: true }).click();
  await expect(page).toHaveURL(/view=datasets&edit=7/);
  await expect(page.getByRole("tab", { name: "字段 0", exact: true })).toBeVisible();
  await expect(page.getByText("销售虚拟集", { exact: true })).toBeVisible();
});

test("只有 SQL 权限时可查询，不能创建数据集", async ({ page, context }) => {
  await mockApi(context, false);
  await page.goto("/bi?view=sql");
  await page.getByRole("textbox", { name: "SQL 编辑器" }).fill("SELECT * FROM orders_new");
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "amount", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存为虚拟数据集", exact: true })).toBeDisabled();
});

test("空结果保留字段，失败后禁止保存", async ({ page, context }) => {
  await mockApi(context);
  await page.goto("/bi?view=sql");
  const editor = page.getByRole("textbox", { name: "SQL 编辑器" });
  await editor.fill("SELECT * FROM orders_new WHERE 1=0");
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "amount", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存为虚拟数据集", exact: true })).toBeEnabled();
  await editor.fill("SELECT broken FROM orders_new");
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect(page.getByText("SQL 错误：字段不存在", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存为虚拟数据集", exact: true })).toBeDisabled();
});

test("表字段树可拖动、键盘调整并记住宽度", async ({ page, context }) => {
  await mockApi(context);
  await page.goto("/bi?view=sql");
  const splitter = page.getByRole("separator", { name: "调整表字段树宽度" });
  await expect(splitter).toHaveAttribute("aria-valuenow", "280");
  const box = await splitter.boundingBox();
  if (!box) throw new Error("分隔线不可见");
  await page.mouse.move(box.x + 3, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 103, box.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect(splitter).toHaveAttribute("aria-valuenow", "380");
  await page.reload();
  await expect(splitter).toHaveAttribute("aria-valuenow", "380");
  await splitter.focus(); await splitter.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", "360");
  await page.reload();
  await expect(splitter).toHaveAttribute("aria-valuenow", "360");
});
