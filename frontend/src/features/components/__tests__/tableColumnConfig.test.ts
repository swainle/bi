/** 明细表「字段」区：一张字段卡的 7 项写回与换绑 / 删除 / 排序.
 *
 * 不渲染 DOM（和原来的 tableHeaderInput.test.ts 同一套做法）：直接调用组件函数拿到元素树，
 * 再从 props 里取 TableColumnCard 的回调触发写入，断言写回的 spec。
 */

import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ComponentSpec, TableColumn } from "../types";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@mui/material", () => ({
  Box: "div", Stack: "div", TextField: "input", MenuItem: "li", Select: "select",
  ToggleButton: "button", ToggleButtonGroup: "div",
  IconButton: "button", Typography: "span", Tooltip: "span",
}));
vi.mock("@mui/icons-material", () => ({ Close: "span", DragIndicator: "span", ExpandMore: "span" }));
vi.mock("../editor/Slot", () => ({ Slot: "section" }));

import { TableFieldsEditor } from "../editor/TableFieldsEditor";
import { TableColumnCard } from "../editor/TableColumnCard";
import { AxisInput } from "../editor/AxisInput";

type Element = ReactElement<Record<string, any>>;

function findAll(node: unknown, hit: (element: Element) => boolean, out: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, hit, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as Element;
  if (hit(element)) out.push(element);
  findAll(element.props.children, hit, out);
  return out;
}

function baseSpec(): ComponentSpec {
  return {
    binding: { dimensions: ["item_id", "daily_deal"] },
    table_view: {
      columns: [
        { key: "item_id", label: "商品编号", type: "text", align: "left", width: 120, color: "#E11D48", rows: 2 },
      ],
    },
  } as unknown as ComponentSpec;
}

function render(spec: ComponentSpec) {
  const tree = TableFieldsEditor({
    spec,
    onChange: (next) => { spec = next; },
    metricOptions: [{ name: "daily_deal", label: "日销量" } as never],
    dimensionOptions: [{ name: "item_id", label: "商品编号" } as never],
    identifierOptions: [],
  });
  return { tree, current: () => spec };
}

/** 取某一列的卡片元素 */
function cardOf(tree: unknown, key: string): Element {
  const wrapper = findAll(tree, (el) => el.props?.["data-field-chip"] === key)[0];
  expect(wrapper, `找不到字段卡 ${key}`).toBeTruthy();
  const card = findAll(wrapper, (el) => el.type === TableColumnCard)[0];
  expect(card, `字段卡 ${key} 没渲染 TableColumnCard`).toBeTruthy();
  return card;
}

describe("字段卡的列头输入", () => {
  it("允许清空再重新输入，且不动颜色/行数/宽度", () => {
    let column: TableColumn = {
      key: "item_id", label: "商品编号", type: "text", align: "left", width: 120, color: "#E11D48", rows: 2,
    };
    const patch = (next: Partial<TableColumn>) => { column = { ...column, ...next }; };
    const input = () => findAll(
      TableColumnCard({
        name: "item_id", column, options: ["daily_deal"],
        onRebind: vi.fn(), onPatch: patch, onRemove: vi.fn(), defaultOpen: true,
      }),
      (el) => el.type === "input" && el.props.placeholder === "列头",
    )[0]!;

    for (const value of ["商品", "商", "", "货号"]) {
      input().props.onChange({ target: { value } });
      expect(column.label).toBe(value);
      expect(column.color).toBe("#E11D48");
      expect(column.rows).toBe(2);
      expect(column.width).toBe(120);
    }
  });
});

describe("字段卡的七项写回", () => {
  it("换类型不动对齐（对齐由「对齐」控件显式决定）；其它设置保留", () => {
    const { tree, current } = render(baseSpec());
    cardOf(tree, "item_id").props.onPatch({ type: "number" });
    const column = current().table_view.columns.find((item) => item.key === "item_id")!;
    expect(column.type).toBe("number");
    expect(column.align).toBe("left");   // 原来就是 left，换类型不再偷偷改成 right
    expect(column.label).toBe("商品编号");
    expect(column.color).toBe("#E11D48");
  });

  it("「对齐」控件把左 / 中 / 右写回该列", () => {
    let column: TableColumn = { key: "item_id", label: "商品编号", type: "text", align: "left", width: 0 };
    const tree = TableColumnCard({
      name: "item_id", column, options: [], onRebind: vi.fn(),
      onPatch: (patch) => { column = { ...column, ...patch }; },
      onRemove: vi.fn(), defaultOpen: true,
    });
    const group = findAll(tree, (el) => el.props?.["data-slot"] === "column-align")[0]!;
    expect(group, "打开字段卡后应有对齐控件").toBeTruthy();
    group.props.onChange(null, "center");
    expect(column.align).toBe("center");
    group.props.onChange(null, "right");
    expect(column.align).toBe("right");
  });

  it("格式 / 颜色 / 行数 / 宽度都按列写回，不影响别的列", () => {
    const { tree, current } = render(baseSpec());
    cardOf(tree, "item_id").props.onPatch({ format: "w", color: "#0F172A", rows: 3, width: 0 });
    const column = current().table_view.columns.find((item) => item.key === "item_id")!;
    expect(column).toMatchObject({ format: "w", color: "#0F172A", rows: 3, width: 0 });
    expect(current().table_view.columns).toHaveLength(1);
    expect(current().binding.dimensions).toEqual(["item_id", "daily_deal"]);
  });

  it("没配过的列也能直接写：自动补一份默认列配置", () => {
    const { tree, current } = render(baseSpec());
    cardOf(tree, "daily_deal").props.onPatch({ label: "日销量", color: "#10B981" });
    const column = current().table_view.columns.find((item) => item.key === "daily_deal")!;
    expect(column.label).toBe("日销量");
    expect(column.color).toBe("#10B981");
    expect(column.width).toBe(0);
  });
});

describe("换绑与删除", () => {
  it("换绑把整块列配置搬到新字段，旧字段从列表里消失", () => {
    const single = {
      binding: { dimensions: ["item_id"] },
      table_view: {
        columns: [
          { key: "item_id", label: "商品编号", type: "text", align: "left", width: 120, color: "#E11D48", rows: 2 },
        ],
      },
    } as unknown as ComponentSpec;
    const { tree, current } = render(single);
    cardOf(tree, "item_id").props.onRebind("daily_deal");
    expect(current().binding.dimensions).toEqual(["daily_deal"]);
    const column = current().table_view.columns.find((item) => item.key === "daily_deal")!;
    expect(column.label).toBe("商品编号");
    expect(column.color).toBe("#E11D48");
    expect(current().table_view.columns.some((item) => item.key === "item_id")).toBe(false);
  });

  it("换绑到已存在的字段不动（不允许一列变两列）", () => {
    const { tree, current } = render(baseSpec());
    cardOf(tree, "item_id").props.onRebind("daily_deal");
    const before = current().binding.dimensions;
    cardOf(tree, "daily_deal").props.onRebind("item_id");
    expect(current().binding.dimensions).toEqual(before);
  });

  it("清除绑定等于删掉这一列，它的列配置也一起清掉", () => {
    const { tree, current } = render(baseSpec());
    cardOf(tree, "item_id").props.onRebind(null);
    expect(current().binding.dimensions).toEqual(["daily_deal"]);
    expect(current().table_view.columns.some((item) => item.key === "item_id")).toBe(false);
  });
});

describe("格式只在数值列可用", () => {
  const formatSelect = (type: TableColumn["type"]) => findAll(
    TableColumnCard({
      name: "a", column: { key: "a", label: "A", type, align: "left", width: 0 },
      options: [], onRebind: vi.fn(), onPatch: vi.fn(), onRemove: vi.fn(), defaultOpen: true,
    }),
    (el) => el.props?.["data-slot"] === "column-format",
  )[0]!;

  it("文本列的格式下拉禁用", () => {
    expect(formatSelect("text").props.disabled).toBe(true);
  });

  it("数值列可用", () => {
    expect(formatSelect("number").props.disabled).toBe(false);
  });
});

describe("折叠卡：标题取列头，字段在内容里", () => {
  const card = (patch: Partial<TableColumn> = {}, defaultOpen = false) => TableColumnCard({
    name: "item_id",
    column: {
      key: "item_id", label: "商品编号", type: "number", align: "right", width: 120, ...patch,
    },
    options: ["daily_deal"], onRebind: vi.fn(), onPatch: vi.fn(), onRemove: vi.fn(), defaultOpen,
  });

  it("默认收起：标题是列头，内容里的控件都不渲染", () => {
    const tree = card();
    const title = findAll(tree, (el) => el.props?.className === "column-title")[0]!;
    expect(title.props.children).toBe("商品编号");
    expect(findAll(tree, (el) => el.type === "input")).toHaveLength(0);
    expect(findAll(tree, (el) => el.type === AxisInput)).toHaveLength(0);
  });

  it("列头为空时标题回退到字段名", () => {
    const tree = card({ label: "" });
    const title = findAll(tree, (el) => el.props?.className === "column-title")[0]!;
    expect(title.props.children).toBe("item_id");
  });

  it("标题右侧摘要显示类型与宽度", () => {
    const tree = card();
    expect(findAll(tree, (el) => el.props?.children === "数值 · 120px")).toHaveLength(1);
    const auto = card({ width: 0 });
    expect(findAll(auto, (el) => el.props?.children === "数值 · 宽度自动")).toHaveLength(1);
  });

  it("展开后「字段」框在内容里，且绑的是当前字段", () => {
    const tree = card({}, true);
    const axis = findAll(tree, (el) => el.type === AxisInput)[0]!;
    expect(axis.props.value).toBe("item_id");
    expect(axis.props.placeholder).toBe("拖到这里");
  });

  it("标题带颜色圆点（设了颜色才有）", () => {
    const withColor = card({ color: "#E11D48" });
    expect(findAll(withColor, (el) => el.props?.sx?.bgcolor === "#E11D48")).toHaveLength(1);
    const without = card();
    expect(findAll(without, (el) => el.props?.sx?.bgcolor === "#E11D48")).toHaveLength(0);
  });
});
