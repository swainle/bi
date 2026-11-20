import { describe, expect, it, vi } from "vitest";

vi.mock("@mui/icons-material", () => ({
  Check: null, ChevronLeft: null, ChevronRight: null, Event: null, KeyboardArrowDown: null,
}));
import { dateShortcutRange } from "../renderers/FilterBar";

describe("日期快捷选项", () => {
  it.each([
    [1, "2026-11-09", "2026-11-15"],
    [2, "2026-11-02", "2026-11-08"],
    [3, "2026-10-26", "2026-11-01"],
  ])("此前第 %i 周取独立自然周，支持跨月", (weeks, start, end) => {
    expect(dateShortcutRange("2026-11-20", `week${weeks}`, 7, weeks)).toEqual({ start, end });
  });

  it.each(["2027-01-04", "2027-01-10"])("%s 从周一至周日均取同一个上周，支持跨年", (today) => {
    expect(dateShortcutRange(today, "week1", 7, 1)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("保留今日、昨日和近7日的计算口径", () => {
    expect(dateShortcutRange("2026-11-20", "today", 1)).toEqual({ start: "2026-11-20", end: "2026-11-20" });
    expect(dateShortcutRange("2026-11-20", "yesterday", 1)).toEqual({ start: "2026-11-19", end: "2026-11-19" });
    expect(dateShortcutRange("2026-11-20", "7", 7)).toEqual({ start: "2026-11-14", end: "2026-11-20" });
  });
});
