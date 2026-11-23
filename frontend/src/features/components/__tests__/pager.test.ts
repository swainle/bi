import { describe, expect, it } from "vitest";

import { PAGE_SIZES, pageItems } from "../renderers/pagerItems";

describe("明细表分页条", () => {
  it("页数不超过 7 时全部列出", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("页数多时首末页固定，当前页两侧留一个，中间省略", () => {
    expect(pageItems(1, 10)).toEqual([1, 2, 3, 4, 5, "ellipsis", 10]);
    expect(pageItems(5, 10)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
    expect(pageItems(9, 10)).toEqual([1, "ellipsis", 6, 7, 8, 9, 10]);
  });

  it("当前页越界时收敛到首/末页", () => {
    expect(pageItems(0, 10)).toEqual(pageItems(1, 10));
    expect(pageItems(99, 10)).toEqual(pageItems(10, 10));
    expect(pageItems(1, 0)).toEqual([1]);
  });

  it("每页条数档位是 10 / 20 / 50 / 100", () => {
    expect([...PAGE_SIZES]).toEqual([10, 20, 50, 100]);
  });
});
