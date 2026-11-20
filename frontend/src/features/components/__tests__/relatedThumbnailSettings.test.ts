import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ComponentSpec, RelatedThumbnailSpec } from "../types";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => {}, useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("@mui/material", () => ({
  Alert: "aside", Box: "div", Stack: "div", Switch: "switch", TextField: "input", MenuItem: "option", Typography: "span",
}));
vi.mock("@mui/icons-material", () => ({ Add: "span", Check: "span", Close: "span", ExpandMore: "span" }));
vi.mock("../../../api/client", () => ({ default: { get: vi.fn() } }));

import RelatedThumbnailSettings from "../editor/RelatedThumbnailSettings";
import { TableThumbSettings } from "../editor/TableThumbSettings";

function find(node: unknown, type: string): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as ReactElement<Record<string, any>>;
  return element.type === type ? element : find(element.props.children, type);
}

describe("关联缩略图设置", () => {
  it("开启关联缩略图时关闭本表缩略图，保留原图片字段", () => {
    let spec = { binding: { dataset_id: 1 }, table_view: { thumb: true, thumb_key: "url" } } as ComponentSpec;
    const tree = RelatedThumbnailSettings({ spec, fields: [], onChange: (next) => { spec = next; } });
    find(tree, "switch")!.props.onChange({ target: { checked: true } });
    expect(spec.table_view.related_thumb?.enabled).toBe(true);
    expect(spec.table_view.thumb).toBe(false);
    expect(spec.table_view.thumb_key).toBe("url");
  });

  it("开启本表缩略图时关闭关联缩略图，保留关联配置", () => {
    let spec = {
      binding: { dimensions: ["商品"] },
      table_view: { thumb: false, thumb_key: "url", related_thumb: { enabled: true, dataset_id: 2 } as RelatedThumbnailSpec },
    } as ComponentSpec;
    const tree = TableThumbSettings({ spec, dimensionOptions: [{ name: "url", role: "dimension" }],
      identifierOptions: [], metricOptions: [], onChange: (next) => { spec = next; } });
    find(tree, "switch")!.props.onChange({ target: { checked: true } });
    expect(spec.table_view.thumb).toBe(true);
    expect(spec.table_view.related_thumb?.enabled).toBe(false);
    expect(spec.table_view.related_thumb?.dataset_id).toBe(2);
  });
});
