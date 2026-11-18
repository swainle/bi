import { expect, it } from "vitest";
import { formatChinaTime } from "./time";

it.each([
  "2026-11-18 20:30:00", "2026-11-18T20:30:00Z",
  "2026-11-19T04:30:00+08:00", "2026-11-18T15:30:00-05:00",
  new Date("2026-11-18T20:30:00Z"), Date.parse("2026-11-18T20:30:00Z"),
])("formats %s in Beijing time across midnight", (value) => {
  expect(formatChinaTime(value)).toBe("2026-11-19 04:30:00");
});

it.each([undefined, null, "", "bad-date", new Date(NaN)])("handles missing or invalid time", (value) => {
  expect(formatChinaTime(value)).toBe("");
});
