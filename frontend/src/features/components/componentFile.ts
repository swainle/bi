/** 组件导出 / 导入：把组件存成 .json 文件，换个环境再导回来.
 *
 * 导出文件由后端组装（含数据集引用），这里只负责落盘 / 读文件 / 调导入接口。
 */

import client from "../../api/client";

export interface ImportResult {
  id: number;
  name: string;
  dataset_matched: boolean;
  dataset_name?: string | null;
}

/** 触发浏览器下载（文件名去掉多余字符，后缀 .mcbi.json 便于识别） */
export function downloadJson(name: string, data: unknown): void {
  const safe = (name || "组件").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safe}.mcbi.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportComponent(id: number, name: string): Promise<void> {
  const res = await client.get(`/bi/components/${id}/export`);
  downloadJson(name, res.data);
}

export async function importComponentFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  const res = await client.post("/bi/components/import", payload);
  return res.data as ImportResult;
}
