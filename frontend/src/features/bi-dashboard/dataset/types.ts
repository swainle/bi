/** 数据集面板 · 共享类型与常量 */

export const ROLES = [
  { v: "dimension", l: "维度" },
  { v: "time", l: "时间" },
  { v: "measure", l: "度量" },
  { v: "id", l: "标识" },
];
export const TYPES = ["text", "integer", "numeric", "date", "datetime", "bool"];
export const FORMATS = [
  { v: "number", l: "数值" },
  { v: "percent", l: "百分比" },
  { v: "currency", l: "金额" },
];

export interface Field {
  id: number; name: string; source_column: string; role: string;
  data_type: string; is_filterable: boolean; is_groupable: boolean;
  default_grain: string | null; description: string;
}
export interface Metric {
  id: number; name: string; expression: string; format: string; description: string;
  certified?: boolean; certified_at?: string; version?: number;
}
export interface MetricVersion {
  version: number; name: string; expression: string; format: string;
  changed_by_name: string; changed_at: string; note: string;
}
export interface MetricUsage {
  dashboard_id: number; dashboard_name: string; view_key: string;
  item_key: string; item_kind: string; item_type: string; role: string;
}
export interface Dataset {
  id: number; name: string; physical_table: string; description: string;
  updated_at: string; field_count: number; metric_count: number;
  owner_id?: number | null;
  sql_text?: string;
  is_virtual?: boolean;
  conn_mode?: string;
  source_id?: number | null;
  /** 模板库复制出来的数据集：只出现在「测试数据集」页 */
  template_id?: number;
  template_name?: string;
  /** 「测试数据集」页自建的公共测试数据集：同样不进「数据集」页 */
  is_sandbox?: boolean;
  /** 归属部门；null / 未返回 = 全局 */
  dept_id?: number | null;
}
export interface PhysTable {
  table: string; rows: number; columns: { name: string; type: string }[];
  origin?: string;
}
export interface RemoteTable {
  table: string; kind?: string; columns: string[];
  column_types?: Record<string, string>;
}
export interface SourceBrief {
  id: number; name: string; ds_type: string;
  dept_id?: number | null;
}

/* 源库列类型 → 字段角色 / 类型 */
export function remoteField(name: string, rawType?: string) {
  const t = (rawType || "").toLowerCase();
  if (/date|timestamp|time/.test(t)) return { name, source_column: name, role: "time", data_type: "date" };
  if (/int|numeric|decimal|double|float|real|money|serial/.test(t)) {
    return { name, source_column: name, role: "measure", data_type: "numeric" };
  }
  return { name, source_column: name, role: "dimension", data_type: "text" };
}

export const td = { fontSize: 12, py: 0.7, borderColor: "#F1F5F9" } as const;
export const th = { fontSize: 11.5, fontWeight: 600, color: "#64748B", py: 0.85, bgcolor: "#F8F9FC", borderColor: "#EEF3FB" } as const;
/** 测试数据集只属于「测试数据集」页面：按物理表判定，改过名也不会漏进这张列表 */
export const DEMO_TABLE = "bi_demo_sku";

export const _NUM = ["integer", "bigint", "smallint", "numeric", "double precision", "real", "decimal", "money"];

export function inferType(pgType: string): string {
  const t = (pgType || "").toLowerCase();
  if (t.startsWith("timestamp")) return "datetime";
  if (t === "date") return "date";
  if (["integer", "bigint", "smallint"].includes(t)) return "integer";
  if (_NUM.includes(t)) return "numeric";
  if (t === "boolean") return "bool";
  return "text";
}

export function inferRole(dataType: string): string {
  if (dataType === "date" || dataType === "datetime") return "time";
  if (dataType === "integer" || dataType === "numeric") return "measure";
  return "dimension";
}


export interface RowRule {
  id: number; user_id: number | null; username: string;
  role_name: string; filter_rule: string; note: string;
}
export interface ColumnMask {
  id: number; column_name: string; mask_type: string; mask_pattern: string;
}
export interface DeptScopeRule {
  dataset_id: number; column_name: string; mode: "department" | "self" | "all";
}

export const DEPT_MODES = [
  { v: "department", l: "按部门（含下级）" },
  { v: "self", l: "只看自己（列存用户 id）" },
  { v: "all", l: "不隔离" },
];

export const RULE_ROLES = [
  { v: "", l: "所有人" },
  { v: "member", l: "成员" },
  { v: "admin", l: "管理员" },
];
export const MASK_OPTIONS = [
  { v: "phone", l: "手机号" },
  { v: "id_card", l: "身份证" },
  { v: "email", l: "邮箱" },
  { v: "custom", l: "自定义" },
];


export const FIELD_ROLE_LABEL: Record<string, string> = {
  dimension: "维度",
  metric: "指标",
};

