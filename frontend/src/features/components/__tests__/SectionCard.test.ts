import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SectionCard from "../renderers/SectionCard";

describe("分节标题", () => {
  const payload = { title: "分节标题", index: "一", note: "说明", icon: "grid" };

  it("已选择图标时，编号底块仍随当前外观颜色更新", () => {
    const rose = renderToStaticMarkup(createElement(SectionCard, { payload, ui: { accent: "rose" } }));
    const teal = renderToStaticMarkup(createElement(SectionCard, { payload, ui: { accent: "teal" } }));
    expect(rose).toContain("#F43F5E");
    expect(teal).toContain("#10B981");
    expect(teal).not.toContain("#F43F5E");
    expect(rose).not.toContain("#6366F1");
  });

  it("整组内容居左且垂直居中，保留标题和说明", () => {
    const html = renderToStaticMarkup(createElement(SectionCard, { payload, ui: { accent: "indigo" } }));
    expect(html).toContain("justify-content:flex-start");
    expect(html).toContain("align-items:center");
    expect(html).toContain("分节标题");
    expect(html).toContain("说明");
  });
});
