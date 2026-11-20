import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], setState: vi.fn() }));
vi.mock("react", () => ({
  useState: (value: unknown) => [value, hooks.setState],
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useLayoutEffect: () => {},
}));

import { useCanvasViewport } from "./useCanvasViewport";

afterEach(() => { vi.unstubAllGlobals(); hooks.effects = []; hooks.setState.mockClear(); });

describe("画布平移", () => {
  it.each(["pointerup", "pointercancel", "blur"])("拖动只更新预览，%s 时提交最后的位置", (end) => {
    const root = new EventTarget() as HTMLElement;
    const properties = new Map<string, string>();
    Object.defineProperty(root, "style", { value: {
      setProperty: (key: string, value: string) => properties.set(key, value),
    } });
    class Canvas extends EventTarget {
      dataset = {};
      closest(selector: string) { return selector === "[data-stage-wrap]" ? root : null; }
      setPointerCapture() {}
      hasPointerCapture() { return true; }
      releasePointerCapture() {}
    }
    const canvas = new Canvas();
    const win = new EventTarget();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("window", win);
    vi.stubGlobal("HTMLElement", Canvas);
    vi.stubGlobal("CustomEvent", class extends Event {
      detail: unknown;
      constructor(type: string, init: CustomEventInit) { super(type); this.detail = init.detail; }
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const send = (target: EventTarget, type: string, fields = {}) =>
      target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));

    useCanvasViewport({ current: canvas as unknown as HTMLDivElement }, 1, 1000, 800);
    const cleanup = hooks.effects[0]() as () => void;
    send(win, "keydown", { code: "Space" });
    send(canvas, "pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    send(canvas, "pointermove", { pointerId: 1, clientX: 120, clientY: 130 });
    send(canvas, "pointermove", { pointerId: 1, clientX: 140, clientY: 150 });
    expect(frames.size).toBe(1);
    const callback = frames.get(frameId)!;
    frames.delete(frameId);
    callback(0);
    expect(properties.get("--canvas-pan-x")).toBe("40px");
    expect(properties.get("--canvas-pan-y")).toBe("50px");
    expect(hooks.setState).not.toHaveBeenCalled();

    // 松手前尚未绘制的最后一次移动也必须提交。
    send(canvas, "pointermove", { pointerId: 1, clientX: 160, clientY: 180 });
    send(end === "blur" ? win : canvas, end, { pointerId: 1 });
    expect(hooks.setState).toHaveBeenCalledTimes(1);
    expect(hooks.setState).toHaveBeenCalledWith({ x: 60, y: 80 });
    expect(frames.size).toBe(0);
    cleanup();
    expect(properties.get("--canvas-pan-x")).toBe("0px");
    expect(properties.get("--canvas-pan-y")).toBe("0px");
  });
});
