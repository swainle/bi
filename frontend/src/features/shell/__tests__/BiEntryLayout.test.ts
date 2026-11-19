import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import BiSideNav from "../BiSideNav";
import BiEntryLayout from "../BiEntryLayout";

const state = vi.hoisted(() => ({ nav: vi.fn(), props: null as unknown }));
vi.mock("../TopBar", () => ({ default: ({ hideLogo }: { hideLogo: boolean }) =>
  createElement("header", { "data-hide-logo": hideLogo }, "顶部导航") }));
vi.mock("react-router-dom", () => ({ useNavigate: () => state.nav }));
vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ hasPerm: (perm: string) => perm === "bi:nav:components" }),
}));
vi.mock("../BiSideNav", async (importOriginal) => {
  const original = await importOriginal<typeof import("../BiSideNav")>();
  return { ...original, default: (props: unknown) => { state.props = props; return null; } };
});

beforeEach(() => state.nav.mockClear());

it.each(["components", "editor"])("keeps navigation beside %s content", (activeKey) => {
  const html = renderToStaticMarkup(createElement(BiEntryLayout, { activeKey, children: "页面内容" }));
  const props = state.props as ComponentProps<typeof BiSideNav>;
  expect(html).toContain("页面内容");
  expect(html).toContain('data-hide-logo="true"');
  expect(html).toContain("顶部导航");
  expect(props.activeKey).toBe(activeKey);
  expect(props.items.some((item) => item.key === "components")).toBe(true);
  expect(props.items.some((item) => item.key === "editor")).toBe(false);
  props.onSelect(props.items.find((item) => item.key === "components")!);
  expect(state.nav).toHaveBeenLastCalledWith("/bi/components");
  props.onSelect(props.items.find((item) => item.key === "dashboards")!);
  expect(state.nav).toHaveBeenLastCalledWith("/bi?view=dashboards");
});
