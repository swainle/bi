import type { Preview } from "@storybook/react";
import { CssBaseline, ThemeProvider } from "@mui/material";

import { buildTheme } from "../src/theme";

/** 渲染器 stories：统一套应用的浅色主题与看板底色，保证和真实卡片一致 */
const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "看板底色",
      values: [{ name: "看板底色", value: "#F5F7FB" }, { name: "白色", value: "#FFFFFF" }],
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider theme={buildTheme("light")}>
        <CssBaseline />
        <div style={{ minHeight: "100vh", padding: 24, background: "#F5F7FB" }}>
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};

export default preview;
