/** 认证 API 调用 */

import type { ApiResponse, AuthData, User } from "../types";
import client from "./client";

/** 部门选项（注册页必选） */
export interface DepartmentOption {
  id: number;
  name: string;
}

/** 注册页的部门清单（公开接口） */
export async function getDepartments(): Promise<DepartmentOption[]> {
  const res = await client.get<{ items: DepartmentOption[] }>("/auth/departments");
  return res.data?.items || [];
}

/** 注册结果 —— 只是「已提交申请」，不签发 token（待审批） */
export interface RegisterResult {
  id: number;
  username: string;
  email: string;
  status: string;
  message: string;
}

/** 用户注册 — 邮箱和手机号至少一个；部门必选；注册后进入待审批，不自动登录 */
export async function register(
  username: string,
  email?: string,
  phone?: string,
  password?: string,
  departmentId?: number,
): Promise<RegisterResult> {
  const body: Record<string, string | number> = { username, password: password || "" };
  if (email) body.email = email;
  if (phone) body.phone = phone;
  if (departmentId) body.department_id = departmentId;
  const res = await client.post<ApiResponse<RegisterResult>>("/auth/register", body);
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
