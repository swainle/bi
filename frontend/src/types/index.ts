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
