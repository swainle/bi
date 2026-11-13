/** 浏览器错误上报（Sentry / 自建 GlitchTip）.
 *
 * 只有配置了 `VITE_SENTRY_DSN` 才会被动态加载 —— 没配时这段代码不会进主包、
 * 也不会发任何请求；上报失败（GlitchTip 挂了 / 断网）不能影响页面渲染。
 *
 * 站内已有的 `/api/report`（ErrorBoundary + 全局 JS 错误 → `bi_error_log`）保持不变，
 * 两者可以同时开：站内给业务看，Sentry 给开发看堆栈。
 */
export async function initSentry(dsn: string): Promise<void> {
  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: (import.meta.env.VITE_APP_VERSION as string | undefined) || undefined,
      // 只收错误，不采样性能（要开再调大，按比例增加请求量）
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
  } catch {
    // 上报初始化失败不阻塞页面
  }
}
