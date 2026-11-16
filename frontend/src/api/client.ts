/** Axios 实例 —— baseURL、JWT 拦截器、CSRF 防护、401 自动处理、token 刷新 */

import axios from "axios";

const TOKEN_KEY = "access_token";
const REFRESH_KEY = "refresh_token";
const DEVICE_KEY = "mcbi.device.id";

/** 稳定的浏览器设备号（安全指纹的一部分；不含个人信息，清缓存会重新生成） */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

const client = axios.create({
  baseURL: "/api",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ── 最近一次请求号（页面水印展示用，与后端 X-Request-Id 同值）──────
let lastRequestId = "";

/** 读取最近一次 API 请求的请求号；没有就返回空串 */
export function getLastRequestId(): string {
  return lastRequestId;
}

function rememberRequestId(headers: Record<string, any> | undefined) {
  const rid = headers?.["x-request-id"];
  if (rid) lastRequestId = String(rid);
}

// ── CSRF Token 管理（Double Submit Cookie）─────────────
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "X-CSRF-Token";

/** 从 document.cookie 读取指定 cookie 值 */
function getCookieValue(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** 确保 CSRF token cookie 存在（不存在则先请求一次） */
let csrfFetched = false;
async function ensureCsrfToken(): Promise<void> {
  if (csrfFetched && getCookieValue(CSRF_COOKIE_NAME)) return;
  try {
    await axios.get("/api/auth/csrf-token");
    csrfFetched = true;
  } catch {
    // CSRF 获取失败不阻塞，中间件会拦截
  }
}

// 请求拦截器：自动附加 Authorization header + CSRF token
client.interceptors.request.use(
  async (config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // 设备指纹：后端用它把「同一个人换了设备 / 脚本调用」区分开
    config.headers["X-Device-Id"] = deviceId();

    // POST/PUT/DELETE/PATCH 请求附加 CSRF token
    const method = (config.method || "get").toLowerCase();
    if (["post", "put", "delete", "patch"].includes(method)) {
      // 确保 cookie 存在
      if (!getCookieValue(CSRF_COOKIE_NAME)) {
        await ensureCsrfToken();
      }
      const csrfToken = getCookieValue(CSRF_COOKIE_NAME);
      if (csrfToken) {
        config.headers[CSRF_HEADER_NAME] = csrfToken;
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// 防并发刷新的锁
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

// 响应拦截器：自动刷新 token + 友好错误消息
client.interceptors.response.use(
  (response) => {
    rememberRequestId(response.headers as Record<string, any> | undefined);
    return response;
  },
  async (error) => {
    rememberRequestId(error.response?.headers as Record<string, any> | undefined);
    const originalRequest = error.config;

    // 401 且未重试过 → 尝试刷新 token
    if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes("/auth/")) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem(REFRESH_KEY);

      if (refreshToken) {
        if (!isRefreshing) {
          isRefreshing = true;
          try {
            const res = await axios.post("/api/auth/refresh", { refresh_token: refreshToken });
            const { access_token, refresh_token } = res.data.data;
            localStorage.setItem(TOKEN_KEY, access_token);
            localStorage.setItem(REFRESH_KEY, refresh_token);

            // 重放队列中的请求
            refreshQueue.forEach((cb) => cb(access_token));
            refreshQueue = [];

            originalRequest.headers.Authorization = `Bearer ${access_token}`;
            return client(originalRequest);
          } catch {
            // 刷新失败，清除并跳转登录
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(REFRESH_KEY);
            if (window.location.pathname !== "/login") {
              window.location.href = `/login?reason=kicked&redirect=${encodeURIComponent(window.location.pathname)}`;
            }
          } finally {
            isRefreshing = false;
          }
        } else {
          // 等待正在进行的刷新
          return new Promise((resolve) => {
            refreshQueue.push((token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(client(originalRequest));
            });
          });
        }
      } else {
        // 无 refresh token，直接清除
        localStorage.removeItem(TOKEN_KEY);
        if (window.location.pathname !== "/login") {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
        }
      }
    }

    return Promise.reject(error);
  }
);

/**
 * 从 axios 错误中提取可读的错误消息.
 * 处理 FastAPI 422 验证错误、统一 API 错误、网络错误等.
 */
export function extractErrorMessage(err: any, fallback = "操作失败"): string {
  const data = err?.response?.data;
  if (!data) return err?.message || fallback;

  // FastAPI 422 验证错误: { detail: [{msg, loc, type}, ...] }
  if (Array.isArray(data.detail)) {
    return data.detail.map((d: any) => d.msg || String(d)).join("; ");
  }

  // 统一 API 错误: { detail: "..." } 或 { message: "..." }
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.message === "string") return data.message;

  return fallback;
}

// ── 网络状态全局提示 ──────────────────────────────
let offlineBanner: HTMLDivElement | null = null;

function showOfflineBanner() {
  if (offlineBanner) return;
  offlineBanner = document.createElement("div");
  offlineBanner.id = "mingcebi-offline-banner";
  offlineBanner.textContent = "网络连接已断开，请检查网络后刷新页面";
  Object.assign(offlineBanner.style, {
    position: "fixed", top: "0", left: "0", right: "0",
    background: "#d32f2f", color: "#fff", textAlign: "center",
    padding: "8px 16px", fontSize: "13px", fontWeight: "500",
    zIndex: "99999", transition: "opacity 0.3s",
  });
  document.body.prepend(offlineBanner);
}

function hideOfflineBanner() {
  if (!offlineBanner) return;
  offlineBanner.style.opacity = "0";
  const el = offlineBanner;
  offlineBanner = null;
  setTimeout(() => el.remove(), 300);
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", showOfflineBanner);
  window.addEventListener("online", hideOfflineBanner);
  if (!navigator.onLine) showOfflineBanner();
}

// ── 指数退避重试（5xx + 网络错误）────────────────
const MAX_RETRIES = 2;
const BASE_DELAY = 1000;

client.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  if (!config || config._retryCount >= MAX_RETRIES) return Promise.reject(error);

  const status = error.response?.status;
  const isRetryable = !status || status >= 500; // network error or 5xx
  if (!isRetryable) return Promise.reject(error);

  // Don't retry POST/PUT/DELETE by default (idempotency)
  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "delete", "patch"].includes(method)) return Promise.reject(error);

  config._retryCount = (config._retryCount || 0) + 1;
  const delay = BASE_DELAY * Math.pow(2, config._retryCount - 1) + Math.random() * 200;

  await new Promise((r) => setTimeout(r, delay));
  return client(config);
});

export default client;
