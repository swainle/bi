import { test, expect } from "@playwright/test";

test.setTimeout(60_000);

test("创建后台导入任务、禁用重复表和失败重试", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("access_token", "ui-test"));
  const source = { id: 1, name: "导入验收源", ds_type: "postgresql", host: "localhost", db_name: "test", table_count: 1 };
  const files = [{ id: 1, source_id: 1, source_table: "dm.done", local_table: "bi_src_done", kind: "db", row_count: 5, dataset_count: 0 }];
  const active: { source_id: number; source_table: string; state: string }[] = [
    { source_id: 1, source_table: "dm.queued", state: "queued" },
    { source_id: 1, source_table: "dm.reading", state: "reading" },
    { source_id: 1, source_table: "dm.writing", state: "writing" },
  ];
  const jobs: any[] = [{ id: "existing", source_id: 1, source_name: source.name, tables: active.map((t) => ({ ...t, rows_read: 10, rows_written: 3, error: "" })) }];
  let submitted: string[] = [];
  let unavailable = false;
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {}, status = 200;
    if (path === "/api/auth/me") body = { data: { id: 1, username: "验收", role: "admin", effective_permissions: [] } };
    else if (path === "/api/bi/sources/types") body = { types: [{ id: "postgresql", label: "PostgreSQL", available: true }] };
    else if (path === "/api/bi/sources") body = { sources: [source] };
    else if (path === "/api/bi/sources/files") body = { tables: files };
    else if (path === "/api/bi/sources/1/tables") body = { tables: ["done", "queued", "reading", "writing", "failed", "new"].map((name) => ({ table: `dm.${name}`, schema: "dm", columns: ["id"] })) };
    else if (path === "/api/bi/sources/import-jobs") {
      status = unavailable ? 503 : 200;
      body = unavailable ? { detail: "任务服务暂不可用" } : { jobs, active_tables: active };
    } else if (path === "/api/bi/sources/1/import-jobs") {
      submitted = route.request().postDataJSON().tables;
      status = 202; body = { job_id: "created" };
      const tables = submitted.map((source_table) => ({ source_table, state: "queued", rows_read: 0, rows_written: 0, error: "" }));
      jobs.unshift({ id: "created", source_id: 1, source_name: source.name, tables });
      active.push(...submitted.map((source_table) => ({ source_id: 1, source_table, state: "queued" })));
    }
    await route.fulfill({ status, json: body });
  });
  await page.goto("/bi?view=datasource");
  const tasksButton = page.getByRole("button", { name: "后台任务", exact: true });
  await expect(tasksButton).toBeVisible();
  await page.getByRole("button", { name: "选表接入", exact: true }).click();
  const picker = page.getByRole("dialog").filter({ hasText: "选表接入" });
  for (const name of ["done", "queued", "reading", "writing"]) {
    const checkbox = picker.getByRole("checkbox", { name, exact: true });
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeDisabled();
  }
  await expect(picker.getByRole("checkbox", { name: "failed", exact: true })).toBeEnabled();
  await picker.getByRole("checkbox", { name: /当前全选/ }).click();
  await picker.getByRole("button", { name: "创建导入任务（2 张）", exact: true }).click();
  await expect.poll(() => submitted.sort()).toEqual(["dm.failed", "dm.new"]);
  const tasks = page.getByRole("dialog").filter({ hasText: "后台任务" });
  await expect(tasks).toBeVisible();
  await expect(tasks.getByText("dm.new", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../docs/_selfcheck/source-import-tasks.png", animations: "disabled" });
  await tasks.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "选表接入", exact: true }).click();
  await expect(picker.getByRole("checkbox", { name: "new", exact: true })).toBeDisabled();
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  jobs[0].tables[0].state = "failed";
  jobs[0].tables[0].error = "测试读取失败";
  const failedName = jobs[0].tables[0].source_table;
  active.splice(active.findIndex((t) => t.source_table === failedName), 1);
  await tasksButton.click();
  await expect(tasks.getByText("测试读取失败", { exact: true })).toBeVisible();
  await tasks.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "选表接入", exact: true }).click();
  await expect(picker.getByRole("checkbox", { name: failedName.slice(3), exact: true })).toBeEnabled();
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  unavailable = true;
  await tasksButton.click();
  await expect(tasks.getByRole("alert")).toContainText("任务服务暂不可用");
});
