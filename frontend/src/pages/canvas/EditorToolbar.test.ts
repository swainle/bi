import { describe, expect, it, vi } from "vitest";
import { previewDashboard } from "./EditorToolbar";

describe("预览前自动保存", () => {
  it("保存完成前不跳转，成功后保留筛选条件并打开预览", async () => {
    let complete!: (saved: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>((resolve) => { complete = resolve; }));
    const navigate = vi.fn();
    const pending = previewDashboard(save, navigate, 1, { platform: "天猫", tags: ["A", "B"], empty: [], omitted: "all", zero: 0 });
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    complete(true);
    await pending;
    const target = new URL(navigate.mock.calls[0][0], "http://localhost");
    expect(target.pathname).toBe("/bi/dashboards/1");
    expect(Object.fromEntries(target.searchParams)).toEqual({ p_platform: "天猫", p_tags: "A,B", p_zero: "0" });
  });

  it("保存失败或正在保存时留在设计器", async () => {
    const navigate = vi.fn();
    await previewDashboard(async () => false, navigate, 1, {});
    expect(navigate).not.toHaveBeenCalled();
  });
});
