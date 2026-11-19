import { describe, expect, it } from "vitest";
import { sectionPayload } from "../board/sectionPayload";

describe("分节标题实时内容", () => {
  it("当前配置覆盖旧载荷，清空后不会回退到旧内容", () => {
    const spec = {
      title: "新标题", subtitle: "新说明",
      content: { index: "二", icon: "pie", items: [], text: "" },
    };
    const stale = { title: "旧标题", index: "一", icon: "grid", note: "旧说明" };
    expect({ ...stale, ...sectionPayload(spec) }).toEqual({
      title: "新标题", index: "二", icon: "pie", note: "新说明",
    });
    expect({ ...stale, ...sectionPayload({
      ...spec, title: "", subtitle: "", content: { ...spec.content, index: "", icon: "" },
    }) }).toEqual({ title: "", index: "", icon: "", note: "" });
  });
});
