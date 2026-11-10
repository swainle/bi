/** 认证 API 调用 */

import type { ApiResponse, AuthData, User } from "../types";
import client from "./client";

/** 用户注册 — 邮箱和手机号至少一个 */
export async function register(
  username: string,
  email?: string,
  phone?: string,
  password?: string,
): Promise<AuthData> {
  const body: Record<string, string> = { username, password: password || "" };
  if (email) body.email = email;
  if (phone) body.phone = phone;
  const res = await client.post<ApiResponse<AuthData>>("/auth/register", body);
  return res.data.data;
}

/** 用户登录 — 支持邮箱/手机号/用户名 */
export async function login(
  account: string,
  password: string
): Promise<AuthData> {
  const res = await client.post<ApiResponse<AuthData>>("/auth/login", {
    account,
    password,
  });
  return res.data.data;
}

/** 刷新 access token */
export async function refreshToken(refresh_token: string): Promise<{ access_token: string; refresh_token: string }> {
  const res = await client.post<ApiResponse<{ access_token: string; refresh_token: string }>>("/auth/refresh", {
    refresh_token,
  });
  return res.data.data;
}

/** 获取当前用户信息 */
export async function getMe(): Promise<User> {
  const res = await client.get<ApiResponse<User>>("/auth/me");
  return res.data.data;
}

/** 更新个人资料 */
export async function updateProfile(data: {
  username?: string;
  email?: string;
}): Promise<User> {
  const res = await client.put<ApiResponse<User>>("/auth/profile", data);
  return res.data.data;
}

/** 修改密码 */
export async function changePassword(data: {
  old_password: string;
  new_password: string;
}): Promise<void> {
  await client.put<ApiResponse<any>>("/auth/password", data);
}
