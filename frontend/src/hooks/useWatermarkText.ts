// hooks/useWatermarkText.ts — 页面水印身份文本（用户 + 部门 + 时间 + 请求号）

import { useEffect, useState } from "react";
import { getLastRequestId } from "../api/client";
import { useAuth } from "./useAuth";

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 水印文本：用户名 · 部门 · 时间 · 请求号。
 * 时间每分钟刷新；请求号跟随最近一次 API 响应（后端 X-Request-Id），
 * 截图里能同时定位到「谁、哪个部门、哪个请求」。
 */
export function useWatermarkText(): string {
  const { user } = useAuth();
  const [now, setNow] = useState(stamp);
  const [rid, setRid] = useState(getLastRequestId);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(stamp());
      setRid(getLastRequestId());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = [user?.username, user?.department_name || "未分配部门", now];
  if (rid) parts.push(`#${rid.slice(0, 12)}`);
  return parts.filter(Boolean).join(" · ");
}

export default useWatermarkText;
