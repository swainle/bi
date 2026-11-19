import { test, expect } from "@playwright/test";

test("指标自定义 SQL：编辑、错误反馈、保存恢复及切回普通汇总", async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem("access_token", "ui-test"));
  let doc = { title: "自定义汇总验收", width: 1440, views: [{ key: "main", title: "页面一", items: [{
    key: "kpi", type: "chart", component: "base.kpi", title: "销售额",
    layout: { x: 24, y: 24, w: 320, h: 150 },
    spec: { title: "销售额", ui: { animate: false }, binding: { dataset_id: 7, metric: "销售额", agg: "SUM" } },
  }] }] };
  let lastBinding: { agg?: string; agg_expression?: string } = {};
  let saved = false;
  const dataset = { id: 7, name: "订单", fields: [
    { name: "销售额", role: "measure" }, { name: "订单数", role: "measure" },
  ], metrics: [] };
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me") body = { data: { id: 1, username: "验收", role: "admin" } };
    else if (path === "/api/bi/semantic/datasets") body = { datasets: [dataset] };
    else if (path === "/api/bi/semantic/datasets/7") body = dataset;
    else if (path === "/api/bi/components") body = { components: [] };
    else if (path === "/api/bi/dashboards") body = { dashboards: [{ id: 77, name: doc.title }] };
    else if (path === "/api/bi/dashboards/77") {
      if (route.request().method() === "PUT") {
        doc = route.request().postDataJSON().doc;
        saved = true;
      }
      body = { id: 77, name: doc.title, doc };
    } else if (path === "/api/bi/dashboards/77/render") {
      lastBinding = route.request().postDataJSON().items[0].spec.binding;
      body = { cards: { kpi: { kind: "kpi", title: "销售额", value: "3",
        ...(lastBinding.agg_expression?.includes("不存在") && lastBinding.agg === "CUSTOM"
          ? { error: "未知字段：不存在（请使用数据集字段名）" } : {}),
      } }, params: {}, param_defs: [] };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/bi/canvas?doc=77");
  const agg = page.getByRole("combobox", { name: /^聚合 / });
  await expect(agg).toBeVisible();
  await agg.click();
  await page.getByRole("option", { name: "自定义 SQL", exact: true }).click();
  const expression = page.getByRole("textbox", { name: "聚合表达式", exact: true });
  await expect(expression).toHaveValue('SUM("销售额")');
  await expression.fill('MEDIAN("销售额")');
  await expect.poll(() => lastBinding.agg_expression).toBe('MEDIAN("销售额")');
  expect(lastBinding.agg).toBe("CUSTOM");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved).toBe(true);
  await page.reload();
  await expect(expression).toHaveValue('MEDIAN("销售额")');
  await expect(page.getByText("3", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../docs/_selfcheck/2026-11-19-custom-aggregate.png" });
  await page.evaluate(() => localStorage.setItem("mzbi.editor.midW", "280"));
  await page.reload();
  await expect(expression).toHaveValue('MEDIAN("销售额")');
  const pane = page.locator('[data-pane="mid"]');
  await expect.poll(() => pane.evaluate((el) => el.clientWidth)).toBe(280);
  expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expression.fill('SUM("不存在")');
  await expect(page.getByText("未知字段：不存在（请使用数据集字段名）", { exact: true }).first()).toBeVisible();
  await expect(expression).toHaveAttribute("aria-invalid", "true");
  await agg.click();
  await page.getByRole("option", { name: "SUM", exact: true }).click();
  await expect(expression).toHaveCount(0);
  await expect.poll(() => lastBinding.agg).toBe("SUM");
});
