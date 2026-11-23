/// <reference types="vite/client" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", ["FRONTEND_", "VITE_API_TARGET"]);
  const host = env.FRONTEND_HOST || "0.0.0.0";
  const port = Number(env.FRONTEND_PORT || "5300");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("FRONTEND_PORT 必须是 1–65535 之间的整数");
  }
  const apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:8300";

  return {
  plugins: [react()],
  server: {
    fs: { allow: [".", "../docs/help"] },
    // 0.0.0.0 = 局域网可访问（手机/其他电脑用 http://<本机IP>:5300 打开）
    host,
    port,
    strictPort: true,
    // Windows 下写文件工具会先建 xxx.tmpdir/xxx.tmp 再原子替换；
    // chokidar 监听到这些临时文件会 EBUSY 崩溃，这里直接忽略掉
    watch: {
      ignored: ["**/*.tmpdir/**", "**/*.tmp", "**/.tmp-*"],
    },
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/uploads": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5301,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/uploads": { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          mui: ["@mui/material", "@mui/icons-material", "@emotion/react", "@emotion/styled"],
          echarts: ["echarts", "echarts-for-react"],
        },
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    chunkSizeWarningLimit: 900,
  },
  };
});
