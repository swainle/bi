/** 明细表「链接」列：按钮 + 二维码弹窗（不渲染 DOM，直接检查元素树） */

import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("@mui/material", () => ({
  Button: "button", Dialog: "div", DialogContent: "div", Stack: "div", Typography: "span",
}));
vi.mock("@mui/icons-material", () => ({ QrCode2: "span" }));
vi.mock("qrcode.react", () => ({ QRCodeSVG: "svg" }));

import QrButton from "../QrButton";

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

const render = (text: string) => QrButton({ text }) as unknown as Element;

describe("链接列：二维码按钮", () => {
  it("有值时才出按钮，按钮带原始文本", () => {
    const tree = render("https://item.jd.com/100331771516.html");
    const button = findAll(tree, (el) => el.type === "button")[0]!;
    expect(button.props["data-qr-button"]).toBe("https://item.jd.com/100331771516.html");
    expect([button.props.children].flat(2)).toContain("二维码");
  });

  it("弹窗里是编码同一段文本的 SVG 二维码", () => {
    const tree = render("https://item.jd.com/1.html");
    const qr = findAll(tree, (el) => el.type === "svg")[0]!;
    expect(qr.props.value).toBe("https://item.jd.com/1.html");
    expect(qr.props.size).toBe(188);
    expect(findAll(tree, (el) => el.type === "div" && "open" in el.props)[0]!.props.open).toBe(false);
  });

  it("空值只显示破折号，不渲染按钮", () => {
    const tree = render("   ");
    expect(findAll(tree, (el) => el.type === "button")).toHaveLength(0);
    expect(findAll(tree, (el) => el.props?.children === "—")).toHaveLength(1);
  });
});
