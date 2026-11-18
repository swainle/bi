/** 系统时间统一按北京时间显示；无时区的旧接口时间按 UTC 解释。 */
export function formatChinaTime(value?: string | number | Date | null): string {
  if (value == null || value === "") return "";
  let input = value;
  if (typeof input === "string") {
    input = input.trim().replace(" ", "T");
    if (!/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(input)) input += "Z";
  }
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
