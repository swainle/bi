import { test, expect } from "@playwright/test";

test("字段注释映射、空态样式及列宽拖动持久化", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("access_token", "ui-test"));
  const dataset = { id: 7, name: "注释验收", physical_table: "orders", conn_mode: "extract", is_virtual: false,
    field_count: 3, metric_count: 0, metrics: [], fields: [
      { id: 1, name: "销售额", source_column: "amount", role: "measure", data_type: "numeric", description: "手工描述", is_filterable: true, is_groupable: true },
      { id: 2, name: "无注释字段", source_column: "id", role: "id", data_type: "integer", is_filterable: true, is_groupable: false },
      { id: 3, name: "利润", source_column: "profit", expression: "amount - 1", role: "measure", data_type: "numeric", is_filterable: true, is_groupable: true },
    ] };
  let nameSyncCalls = 0;
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me") body = { data: { id: 1, username: "字段测试", role: "admin" } };
    else if (path === "/api/bi/semantic/datasets") body = { datasets: [dataset] };
    else if (path === "/api/bi/semantic/datasets/7") body = dataset;
    else if (path === "/api/bi/semantic/datasets/7/sync-comment-names") {
      nameSyncCalls++;
      dataset.fields[0].name = "销售收入（含税）";
      body = { renamed: 1, unchanged: 0, skipped: [
        { name: "无注释字段", reason: "没有非空数据库注释" },
        { name: "利润", reason: "没有非空数据库注释" },
      ] };
    }
    else if (path === "/api/bi/semantic/datasets/7/columns") body = { columns: [
      { name: "amount", type: "numeric", comment: "销售收入（含税）" },
      { name: "id", type: "integer", comment: "" },
      { name: "profit", type: "numeric", comment: "公式不应显示的注释" },
    ] };
    await route.fulfill({ json: body });
  });
  await page.goto("/bi?view=datasets&edit=7");
  const table = page.getByRole("table").filter({ has: page.getByRole("separator", { name: "调整注释列宽" }) });
  await expect(table).toBeVisible();
  await expect.poll(() => page.locator(".MuiDrawer-paper").evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(1128);
  const headers = await table.getByRole("columnheader").allTextContents();
  expect(headers.slice(0, 3)).toEqual(["字段名", "注释", "来源列 / 公式"]);
  await expect(table.getByText("销售收入（含税）", { exact: true })).toBeVisible();
  await expect(table.getByText("手工描述", { exact: true })).toHaveCount(0);
  await expect(table.getByText("公式不应显示的注释", { exact: true })).toHaveCount(0);
  const empty = table.getByText("(空)", { exact: true });
  await expect(empty).toHaveCount(2);
  await expect(empty.first()).toHaveCSS("font-style", "italic");
  await expect(empty.first()).toHaveCSS("color", "rgb(148, 163, 184)");
  const splitter = table.getByRole("separator", { name: "调整注释列宽" });
  await expect(splitter).toHaveAttribute("aria-valuenow", "220");
  const box = await splitter.boundingBox();
  if (!box) throw new Error("列宽分隔线不可见");
  await page.mouse.move(box.x + 3, box.y + 8);
  await page.mouse.down(); await page.mouse.move(box.x + 83, box.y + 8, { steps: 5 }); await page.mouse.up();
  await expect(splitter).toHaveAttribute("aria-valuenow", "300");
  await page.reload();
  await expect(splitter).toHaveAttribute("aria-valuenow", "300");
  await splitter.focus(); await splitter.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", "280");
  const syncNames = page.getByRole("button", { name: "同步注释名称", exact: true });
  const syncColumns = page.getByRole("button", { name: "同步物理列", exact: true });
  expect((await syncNames.boundingBox())!.x).toBeLessThan((await syncColumns.boundingBox())!.x);
  await syncNames.click();
  const result = page.getByRole("dialog", { name: "同步注释名称结果", exact: true });
  await expect(result).toContainText("已更新 1 个字段名");
  await expect(result).toContainText("跳过 2 个");
  await expect(result.getByText("没有非空数据库注释")).toHaveCount(2);
  await result.getByRole("button", { name: "关闭", exact: true }).click();
  expect(nameSyncCalls).toBe(1);
  const renamedRow = table.getByRole("row").filter({ hasText: "销售收入（含税）" });
  await expect(renamedRow.getByRole("cell").first()).toHaveText("销售收入（含税）");
  await expect(renamedRow).toContainText("amount");
  await expect(table.getByText("无注释字段", { exact: true })).toBeVisible();
  await expect(table.getByText("利润", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-19-dataset-column-comments.png", animations: "disabled" });
});
