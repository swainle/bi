/** 认证上下文 —— 登录态 / 用户信息 / token 刷新（明策BI 精简版） */

import {
  createContext,
  useState,
  useEffect,
  useCallback,
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
  register: (username: string, email: string, phone: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  hasPerm: () => false,
  login: async () => {},
  register: async () => {},
  logout: () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /** 权限：BI 后台只有 admin / 普通用户两档 */
  const hasPerm = useCallback(
    (_key: string) => {
      if (!user) return false;
      return user.role === "admin" || user.role === "super_admin" || true;
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

  const login = useCallback(async (account: string, password: string) => {
    const data = await authApi.login(account, password);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token);
    const me = await authApi.getMe();
    setUser(me);
  }, []);

  const register = useCallback(async (username: string, email: string, phone: string, password: string) => {
    const data = await authApi.register(username, email || undefined, phone || undefined, password);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token);
    const me = await authApi.getMe();
    setUser(me);
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
