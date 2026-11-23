/**
 * 右侧抽屉壳子 —— 看板弹窗通用容器。
 * 用法：npm run storybook → 侧栏「通用 / DrawerShell」，点按钮看滑入/滑出、遮罩、ESC、滚动。
 */
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button, Stack } from "@mui/material";
import DrawerShell from "./DrawerShell";

const meta = {
  title: "Common/DrawerShell",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ loading = false }: { loading?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Stack direction="row" spacing={2}>
        <Button variant="contained" onClick={() => setOpen(true)}>打开抽屉</Button>
      </Stack>
      <DrawerShell
        open={open}
        onClose={() => setOpen(false)}
        title="商品详情"
        subtitle="按链接ID过滤 · 单商品"
        loading={loading}
      >
        {/* 占位内容：壳子阶段先放空壳，后续接具体内容 */}
        <Stack spacing={1.5}>
          {Array.from({ length: 40 }, (_, i) => (
            <div key={i} style={{
              height: 44, borderRadius: "8px", background: "#FFFFFF",
              border: "1px solid #EEF3FB", display: "flex", alignItems: "center",
              padding: "0 12px", fontSize: 12.5, color: "#64748B",
            }}>
              占位行 {i + 1}（滚动测试）
            </div>
          ))}
        </Stack>
      </DrawerShell>
    </>
  );
}

export const Default: Story = {
  render: () => <Demo />,
};

export const Loading: Story = {
  render: () => <Demo loading />,
};
