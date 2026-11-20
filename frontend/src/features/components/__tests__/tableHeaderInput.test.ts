import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ComponentSpec } from "../types";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@mui/material", () => ({
  Box: "div", Stack: "div", TextField: "input", Menu: "menu", MenuItem: "li", Typography: "span",
}));
vi.mock("@mui/icons-material", () => ({ Check: "span", Close: "span" }));
vi.mock("../editor/Slot", () => ({ Slot: "section" }));

import { TableFieldsEditor } from "../editor/TableFieldsEditor";

function findInput(node: unknown): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(findInput).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<Record<string, any>>;
  return element.type === "input" && element.props.label === "item_id"
    ? element : findInput(element.props.children);
}

describe("明细表列头输入", () => {
  it("允许清空再重新输入，不回填字段名，并保留其他列设置", () => {
    let spec = {
      binding: { dimensions: ["item_id"] },
      table_view: { columns: [{ key: "item_id", label: "商品编号", type: "text", align: "left", width: 120 }] },
    } as ComponentSpec;
    const input = () => findInput(TableFieldsEditor({
      spec, onChange: (next) => { spec = next; },
      metricOptions: [], dimensionOptions: [], identifierOptions: [],
    }))!;
    for (const value of ["商品", "商", "", "货", "货号"]) {
      input().props.onChange({ target: { value } });
      expect(input().props.value).toBe(value);
      expect(spec.table_view.columns[0].width).toBe(120);
    }
  });
});
