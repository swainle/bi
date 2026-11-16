import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// 配了 VITE_SENTRY_DSN 才懒加载上报 SDK（没配时这段代码不会进主包、不发请求）
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  import("./observability/sentry").then((m) => m.initSentry(sentryDsn)).catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
