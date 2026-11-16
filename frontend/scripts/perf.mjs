#!/usr/bin/env node
/**
 * 首屏性能门禁：构建 → 起 `vite preview`（生产包 + 本地代理）→ 跑 e2e/perf.spec.ts → 关掉 preview。
 *
 * 用法：npm run perf
 * 依赖：后端 :8300 在跑（看板数据与接口要从这里取），token 文件由 scripts/visual_tokens.py 生成。
 */

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const PORT = Number(process.env.MCBI_PREVIEW_PORT || 5301);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  return result.status ?? 1;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

const buildCode = run("npx", ["vite", "build"]);
if (buildCode !== 0) {
  console.error("✗ 构建失败，性能门禁中止");
  process.exit(buildCode);
}

console.log(`\n启动 preview：${BASE_URL}`);
const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  detached: true,
});

let exitCode = 1;
try {
  const ok = await waitForServer(BASE_URL);
  if (!ok) {
    console.error("✗ preview 启动超时（端口被占用？）");
  } else {
    exitCode = run("npx", ["playwright", "test", "e2e/perf.spec.ts", "--reporter=list"], {
      env: { ...process.env, MCBI_BASE_URL: BASE_URL },
    });
  }
} finally {
  try {
    process.kill(-preview.pid, "SIGTERM"); // detached：杀掉整个进程组
  } catch {
    preview.kill("SIGTERM");
  }
}

process.exit(exitCode);
