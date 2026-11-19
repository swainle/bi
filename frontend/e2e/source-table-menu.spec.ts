import { test, expect } from "@playwright/test";

test("已接入表操作菜单、注释同步、文件禁用及移除确认", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("access_token", "ui-test"));
  const tables = [
    { id: 1, kind: "db", source_id: 2, source_name: "订单库", source_table: "dm.orders", local_table: "bi_src_orders", row_count: 2, dataset_count: 0 },
    { id: 2, kind: "file", source_id: null, source_name: "", source_table: "file.csv", local_table: "bi_imp_file", row_count: 1, dataset_count: 0 },
  ];
  let metadataCalls = 0, dataCalls = 0, deleteCalls = 0, failMetadata = false;
  page.on("dialog", () => { throw new Error("不应出现原生确认框"); });
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {}, status = 200;
    if (path === "/api/auth/me") body = { data: { id: 1, username: "菜单验收", role: "admin" } };
    else if (path === "/api/bi/sources") body = { sources: [] };
    else if (path === "/api/bi/sources/files") body = { tables };
    else if (path === "/api/bi/sources/files/1/sync-metadata") {
      metadataCalls++;
      status = failMetadata ? 400 : 200;
      body = failMetadata ? { detail: "读取源库表和字段注释失败，未修改本地注释" }
        : { columns_synced: 2, missing_columns: [] };
    } else if (path === "/api/bi/sources/files/1/resync") { dataCalls++; body = { synced: { rows: 2 } }; }
    else if (path === "/api/bi/sources/files/2" && route.request().method() === "DELETE") { deleteCalls++; body = { deleted: true }; }
    await route.fulfill({ status, json: body });
  });
  await page.goto("/bi?view=datasource");
  await expect(page.getByRole("button", { name: "创建数据集", exact: true })).toHaveCount(2);
  const databaseMenu = page.getByRole("button", { name: "bi_src_orders 更多操作", exact: true });
  await databaseMenu.click();
  await expect(page.getByRole("menuitem")).toHaveText(["同步本地表", "同步本地表元数据", "移除本地表"]);
  await page.getByRole("menuitem", { name: "同步本地表元数据", exact: true }).click();
  const metadataDialog = page.getByRole("dialog", { name: "同步本地表元数据", exact: true });
  await expect(metadataDialog).toContainText("不会修改字段结构或业务数据");
  expect(metadataCalls).toBe(0);
  await metadataDialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(metadataCalls).toBe(0);
  await databaseMenu.click();
  await page.getByRole("menuitem", { name: "同步本地表元数据", exact: true }).click();
  await metadataDialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("已同步表注释及 2 个字段注释", { exact: true })).toBeVisible();
  expect(metadataCalls).toBe(1); expect(dataCalls).toBe(0);
  await databaseMenu.click();
  await page.getByRole("menuitem", { name: "同步本地表", exact: true }).click();
  const syncDialog = page.getByRole("dialog", { name: "同步本地表", exact: true });
  expect(dataCalls).toBe(0);
  await syncDialog.getByRole("button", { name: "取消", exact: true }).click();
  await databaseMenu.click();
  await page.getByRole("menuitem", { name: "同步本地表", exact: true }).click();
  await syncDialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => dataCalls).toBe(1);
  failMetadata = true;
  await databaseMenu.click();
  await page.getByRole("menuitem", { name: "同步本地表元数据", exact: true }).click();
  await metadataDialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("读取源库表和字段注释失败，未修改本地注释", { exact: true })).toBeVisible();
  const fileMenu = page.getByRole("button", { name: "bi_imp_file 更多操作", exact: true });
  await fileMenu.click();
  await expect(page.getByRole("menuitem", { name: "同步本地表", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "同步本地表元数据", exact: true })).toBeDisabled();
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-19-source-table-menu.png", animations: "disabled" });
  await page.getByRole("menuitem", { name: "移除本地表", exact: true }).click();
  const removeDialog = page.getByRole("dialog", { name: "移除本地表", exact: true });
  await expect(removeDialog).toContainText("将删除本地副本，不影响源库");
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-19-source-table-confirm.png", animations: "disabled" });
  await removeDialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(deleteCalls).toBe(0);
  await fileMenu.click();
  await page.getByRole("menuitem", { name: "移除本地表", exact: true }).click();
  await removeDialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => deleteCalls).toBe(1);
});
