/**
 * 全类型 · 四尺寸验收页 —— 组件开发的最后一道自检。
 *
 * 为什么要有这一页：
 *   组件在 712×340 下画得好看，缩到 224×104 就塌，是最常见的返工原因。
 *   这里把每种 kind 的真实 payload 按四个验收尺寸并排摆出来，一眼就能看出问题。
 *
 * 数据用的是 __fixtures__ 里的真实 payload（来自脱敏的测试数据集），不是手敲的假数据。
 * 重新抓取：backend/.venv/bin/python scripts/capture_component_fixtures.py
 *
 * 用法：npm run storybook → 侧栏「组件验收」
 */
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";

import { RENDERERS, type RendererProps } from "../registry";
import type { RenderPayload, UiSpec } from "../types";
import { fixtureKinds, fixtures } from "./__fixtures__";

const meta = {
  title: "组件验收/全类型",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** 版面算式：1440 宽、间距 16，一排 N 张 */
const SIZES = [
  { label: "一排 6 张", w: 224, h: 104 },
  { label: "一排 4 张", w: 344, h: 220 },
  { label: "一排 3 张", w: 464, h: 260 },
  { label: "一排 2 张", w: 712, h: 340 },
] as const;

const FALLBACK_UI: UiSpec = {
  accent: "indigo", radius: 14, min_height: 96, show_unit: true,
  animate: false, align: "left", columns: 1,
};

/** 需要后端配合的 kind：Storybook 里没有后端，状态必然是失败的，标注出来避免误判为 bug */
const NEEDS_BACKEND: Record<string, string> = {
  map: "地图要后端 GeoJSON（GET /api/bi/maps/china），Storybook 里必然显示加载失败",
};

function Card({ kind, size, compact }: {
  kind: string;
  size: { w: number; h: number };
  compact?: boolean;
}) {
  const payload = fixtures[kind] as RenderPayload | undefined;
  const Renderer = RENDERERS[kind as keyof typeof RENDERERS] as
    | ((props: RendererProps) => JSX.Element)
    | undefined;
  if (!payload || !Renderer) {
    return <div style={{ color: "#94A3B8", fontSize: 12 }}>没有 {kind} 的 fixture</div>;
  }
  return (
    <div style={{ width: size.w, height: size.h }}>
      <Renderer
        payload={payload}
        ui={(payload.ui ?? FALLBACK_UI) as UiSpec}
        compact={compact}
      />
    </div>
  );
}

function Row({ title, hint, children }: {
  title: string; hint?: string; children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#64748B", marginBottom: 10 }}>
        {title}
        {hint ? <span style={{ fontWeight: 400, color: "#94A3B8", marginLeft: 8 }}>{hint}</span> : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        {children}
      </div>
    </section>
  );
}

function KindBlock({ kind }: { kind: string }) {
  return (
    <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: "1px solid #EEF3FB" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 12 }}>
        {kind}
        <span style={{ fontWeight: 400, color: "#94A3B8", marginLeft: 8 }}>
          维度 {String((fixtures[kind] as RenderPayload)?.dimension_label ?? "—")} ·
          指标 {String((fixtures[kind] as RenderPayload)?.metric_label ?? "—")}
        </span>
      </div>
      {NEEDS_BACKEND[kind] ? (
        <div style={{ fontSize: 11.5, color: "#B45309", marginBottom: 10 }}>
          {NEEDS_BACKEND[kind]}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        {SIZES.map((size) => (
          <div key={size.label}>
            <div style={{ fontSize: 11.5, color: "#94A3B8", marginBottom: 6 }}>
              {size.label} · {size.w}×{size.h}
            </div>
            <div style={{ outline: "1px dashed #E2E8F0" }}>
              <Card kind={kind} size={size} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const AllKinds: Story = {
  name: "全部类型 · 四尺寸",
  render: () => (
    <div style={{ padding: 24 }}>
      {fixtureKinds.map((kind) => <KindBlock key={kind} kind={kind} />)}
    </div>
  ),
};

export const Tightest: Story = {
  name: "最挤尺寸 · 224×104 总览",
  render: () => (
    <div style={{ padding: 24 }}>
      <Row title="全部类型在 224×104 下的表现" hint="这一段最常塌，重点看文字折行与溢出；map 需后端 GeoJSON，此页必然失败">
        {fixtureKinds.map((kind) => (
          <div key={kind}>
            <div style={{ fontSize: 11.5, color: "#94A3B8", marginBottom: 6 }}>{kind}</div>
            <div style={{ outline: "1px dashed #E2E8F0" }}>
              <Card kind={kind} size={SIZES[0]} />
            </div>
          </div>
        ))}
      </Row>
    </div>
  ),
};

export const Compact: Story = {
  name: "缩略图模式 · compact",
  render: () => (
    <div style={{ padding: 24 }}>
      <Row title="compact = true（组件库卡片墙 / 拖拽浮层）" hint="不画标题与坐标轴，仍要能认出是什么图">
        {fixtureKinds.map((kind) => (
          <div key={kind}>
            <div style={{ fontSize: 11.5, color: "#94A3B8", marginBottom: 6 }}>{kind}</div>
            <div style={{ outline: "1px dashed #E2E8F0" }}>
              <Card kind={kind} size={{ w: 224, h: 140 }} compact />
            </div>
          </div>
        ))}
      </Row>
    </div>
  ),
};
