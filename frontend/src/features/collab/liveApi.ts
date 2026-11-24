/** 实时同步的两个轻接口：版本号（1 秒轮询）与按页取内容（版本变了才拉） */

import client from "../../api/client";
import type { DocView } from "../components/types";

export interface LiveVersion {
  id: number;
  version: string;
  updated_at: string;
}

export interface LiveView {
  id: number;
  view: DocView;
  version: string;
}

export async function fetchLiveVersion(docId: number): Promise<LiveVersion> {
  const res = await client.get(`/live/version/${docId}`, { timeout: 8000 });
  return res.data as LiveVersion;
}

export async function fetchLiveView(docId: number, viewKey: string): Promise<LiveView> {
  const res = await client.get(`/live/views/${docId}/${encodeURIComponent(viewKey)}`, { timeout: 15000 });
  return res.data as LiveView;
}
