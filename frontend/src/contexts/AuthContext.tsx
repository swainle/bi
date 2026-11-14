/** 认证上下文 —— 登录态 / 用户信息 / token 刷新（明策BI 精简版） */

import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { User } from "../types";
import * as authApi from "../api/auth";

const TOKEN_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  hasPerm: (key: string) => boolean;
  login: (account: string, password: string) => Promise<void>;
  register: (
    username: string, email: string, phone: string, password: string, departmentId: number,
  ) => Promise<{ status: string; message: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  hasPerm: () => false,
  login: async () => {},
  register: async () => ({ status: "pending", message: "" }),
  logout: () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastRefresh = useRef(0);

  /**
   * 权限判断：管理员直通；其余看后端下发的 effective_permissions。
   * 之前这里恒为 true（等于没有判断），管理后台入口会漏给普通成员 —— 别再改回去。
   */
  const hasPerm = useCallback(
    (key: string) => {
      if (!user) return false;
      if (user.role === "admin" || user.role === "super_admin") return true;
      if (!key) return false;
      return (user.effective_permissions || []).includes(key);
    },
    [user],
  );

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await authApi.getMe();
      setUser(me);
    } catch {
      // access token 过期 → 尝试 refresh
      const refresh = localStorage.getItem(REFRESH_KEY);
      if (refresh) {
        try {
          const next = await authApi.refreshToken(refresh);
          localStorage.setItem(TOKEN_KEY, next.access_token);
          localStorage.setItem(REFRESH_KEY, next.refresh_token);
          const me = await authApi.getMe();
          setUser(me);
          return;
        } catch {
          /* fallthrough */
        }
      }
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refreshUser();
      setLoading(false);
    })();
  }, [refreshUser]);

  /** 回到窗口时轻量刷新一次身份（60s 内不重复）：
   * 权限/部门负责人被管理员改过、或账号被停用时，不用退出重登也能及时反映。 */
  useEffect(() => {
    const onFocus = () => {
      if (!localStorage.getItem(TOKEN_KEY)) return;
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastRefresh.current < 60000) return;
      lastRefresh.current = now;
      void refreshUser();
    };
    const onVisible = () => { if (!document.hidden) onFocus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshUser]);

  const login = useCallback(async (account: string, password: string) => {
    const data = await authApi.login(account, password);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token);
    const me = await authApi.getMe();
    setUser(me);
  }, []);

  /** 注册 = 提交申请：后端不签发 token，审批通过前不能登录 */
  const register = useCallback(async (
    username: string, email: string, phone: string, password: string, departmentId: number,
  ) => {
    const result = await authApi.register(
      username, email || undefined, phone || undefined, password, departmentId,
    );
    return { status: result.status, message: result.message };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setUser(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, hasPerm, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
