// 视觉回归（本地）：对关键页面截图，和基线逐像素比对。
//
// 用法（先确保前端 :5300、后端 :8300 都在跑）：
//   backend/.venv/bin/python scripts/visual_tokens.py        # 生成 /tmp/mzbi_tokens.json（不会踢掉浏览器会话）
//   cd frontend && npm run visual                            # 比对（基线不存在时先 update）
//   cd frontend && npm run visual:update                     # 更新基线（确认改动是有意的再执行）
//
// 说明：
//   · 基线按平台存放（*-darwin.png / *-linux.png），CI 暂不跑视觉回归；
//   · 想验证「真的能发现差异」：MZBI_VIEWPORT=1280x900 npm run visual，应当失败。
import { defineConfig } from "@playwright/test";

const viewport = process.env.MZBI_VIEWPORT || "1440x900";
const [width, height] = viewport.split("x").map((value) => Number(value));

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  workers: 1,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: process.env.MZBI_BASE_URL || "http://127.0.0.1:5300",
    // 默认用本机 Chrome（channel=chrome），不依赖 `playwright install` 下载 Chromium；
    // 想用自带 Chromium：MZBI_BROWSER_CHANNEL=chromium 并先执行 npx playwright install chromium
    channel: process.env.MZBI_BROWSER_CHANNEL || "chrome",
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
  },
});
