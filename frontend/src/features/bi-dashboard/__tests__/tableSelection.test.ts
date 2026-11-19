import { describe, expect, it } from "vitest";
import { groupRemoteTables, toggleTableSelection } from "../DataSources";

const tables = [
  { table: "dm.orders", schema: "dm", columns: [] },
  { table: "dm.products", schema: "dm", columns: [] },
  { table: "users", schema: "public", columns: [] },
  { table: "standalone", columns: [] },
];

describe("选表接入", () => {
  it("按返回的 schema 分组，无 schema 的表保留平铺", () => {
    expect(groupRemoteTables(tables, "").map(([schema, group]) => [schema, group.length]))
      .toEqual([["dm", 2], ["public", 1], ["", 1]]);
  });

  it("按完整名称实时包含匹配，保留原接入标识", () => {
    expect(groupRemoteTables(tables, " PUBLIC.US ")).toEqual([["public", [tables[2]]]]);
    expect(groupRemoteTables(tables, "orders")).toEqual([["dm", [tables[0]]]]);
    expect(groupRemoteTables(tables, "missing")).toEqual([]);
  });

  it("部分选中时全选当前分组，再次操作取消，保留隐藏选项", () => {
    const original = { "dm.orders": true, users: true };
    const group = tables.slice(0, 2);
    const selected = toggleTableSelection(original, group);
    expect(selected).toEqual({ "dm.orders": true, "dm.products": true, users: true });
    expect(toggleTableSelection(selected, group))
      .toEqual({ "dm.orders": false, "dm.products": false, users: true });
    expect(original).toEqual({ "dm.orders": true, users: true });
    expect(toggleTableSelection(original, [])).toEqual(original);
  });
});
