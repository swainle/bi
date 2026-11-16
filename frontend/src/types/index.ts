/** 全局类型定义 */

export interface User {
  id: number;
  username: string;
  email: string;
  role?: string;
  is_active?: boolean;
  department_id?: number;
  role_ids?: number[];
  avatar_url?: string | null;
  created_at: string;
  /** 有效权限码（后端由「角色 → 权限」现算；管理员为全部） */
  effective_permissions?: string[];
  /** 注册审批状态：pending / approved / rejected */
  approval_status?: string;
  /** 本人是负责人的部门 id（部门负责人可审批本部门注册） */
  led_department_ids?: number[];
  /** 管理员范围：global 全后台 / department 只管本部门 / 空 = 普通账号 */
  admin_scope?: "" | "global" | "department";
  /** 注册审批范围：all 全部部门 / department 本部门 / 空 = 不能审批 */
  approval_scope?: "" | "all" | "department";
  /** 数据范围：all / dept_and_children / dept / self */
  data_scope?: "all" | "dept_and_children" | "dept" | "self";
  /** 权限（账号类型）：admin / user */
  account_type?: "admin" | "user";
  /** 职位：member / supervisor / manager / director */
  position?: "member" | "supervisor" | "manager" | "director";
  /** 所属部门名称（头标卡展示） */
  department_name?: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string;
  description: string;
  sort_order: number;
  type: "article" | "note" | "file";
  user_id?: number;       // 分类所属用户（用于前端判断是否为共享分类）
  article_count?: number;
  note_count?: number;
  file_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  content_md: string;
  content_html: string;
  category_id: number;
  category?: Category;
  tags: string;
  author_id: number;
  files?: FileInfo[];
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: number;
  title: string;
  content_md: string;
  content_html: string;
  tags: string;
  category_id?: number | null;
  category?: { id: number; name: string; slug: string; icon: string; type: string } | null;
  author_id: number;
  files?: FileInfo[];
  created_at: string;
  updated_at: string;
}

export interface FileInfo {
  id: number;
  filename: string;
  original_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  stored_name?: string;
  category_id?: number | null;
  kb_id?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ApiResponse<T> {
  code: number;
  data: T;
  message?: string;
}

export interface AuthData {
  id: number;
  username: string;
  email: string;
  role?: string;
  avatar_url?: string | null;
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface SearchResult {
  articles: { items: Article[]; total: number };
  notes: { items: Note[]; total: number };
}
