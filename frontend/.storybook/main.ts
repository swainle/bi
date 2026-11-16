import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  // 只收渲染器的 stories：把一个图表 / 卡片单独拎出来调，不依赖后端与看板数据
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
};

export default config;
