import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes } from "react-router-dom";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it } from "vitest";
import HelpPage, { headingId, helpHref } from "../HelpPage";

describe("Markdown 帮助页", () => {
  it("生成中文和英文标题锚点", () => {
    expect(headingId("NULL 与空字符串")).toBe("null-与空字符串");
    expect(headingId(" 加减乘除 ")).toBe("加减乘除");
  });

  it("文档内相对链接跳转到帮助路由，保留外部链接和锚点", () => {
    expect(helpHref("formula-fields.md#formula-fields")).toBe("/help/formula-fields#formula-fields");
    expect(helpHref("./index.md")).toBe("/help/index");
    expect(helpHref("#加减乘除")).toBe("#加减乘除");
    expect(helpHref("https://example.com/readme.md")).toBe("https://example.com/readme.md");
  });

  function render(path: string) {
    return renderToStaticMarkup(createElement(StaticRouter, { location: path },
      createElement(Routes, null, createElement(Route, { path: "/help/:slug", element: createElement(HelpPage) }))));
  }

  it("从 docs/help 加载并渲染正文、代码、表格和章节定位", () => {
    const html = render("/help/formula-fields#formula-fields");
    expect(html).toContain('id="formula-fields"');
    expect(html).toContain('id="加减乘除"');
    expect(html).toContain('class="language-sql"');
    expect(html).toContain("NULLIF(quantity, 0)");
    expect(html).toContain("<table>");
    expect(html).toContain("公式字段");
  });

  it("不存在的文档给出返回入口", () => {
    expect(render("/help/missing")).toContain("文档不存在");
  });
});
