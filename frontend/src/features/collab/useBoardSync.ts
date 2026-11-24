/** 画布实时同步：1 秒轮询版本 → 变了才拉当前页 → 交给页面合并.
 *
 * 三条硬约束（写死在这里，避免页面再判断一遍）：
 *   1. 本地有未保存改动 / 正在保存时不合并（先把本地存下去，空闲后补一次）；
 *   2. 自己保存后基线版本由页面更新，绝不会把自己存的内容当成「别人的更新」；
 *   3. 后台标签页不轮询，切回前台立即补一次。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { DocView } from "../components/types";
import { fetchLiveVersion, fetchLiveView } from "./liveApi";

/** 轮询退避：正常按 interval，连续失败 1 次 5s / 2 次 15s / 3 次以上 60s */
export function nextBackoffMs(failures: number, intervalMs = 300): number {
  if (failures <= 0) return intervalMs;
  if (failures === 1) return 5000;
  if (failures === 2) return 15000;
  return 60000;
}

export interface BoardSyncOptions {
  docId: number | null;
  viewKey: string | null;
  /** 我们认为的当前版本（首次加载 / 每次同步成功后由页面更新） */
  baseline: string | null;
  /** 本地有未保存改动或正在保存 → 先别合并，等空闲 */
  blocked: boolean;
  intervalMs?: number;
  enabled?: boolean;
  onRemote: (view: DocView, version: string) => void;
  onSynced: (version: string) => void;
}

export function useBoardSync(options: BoardSyncOptions): { syncing: boolean; refresh: () => Promise<void> } {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const pendingRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const failuresRef = useRef(0);
  const [syncing, setSyncing] = useState(false);

  const flush = useCallback(async () => {
    const current = optionsRef.current;
    const version = pendingRef.current;
    if (!version || busyRef.current || current.blocked) return;
    if (!current.docId || !current.viewKey) return;
    busyRef.current = true;
    setSyncing(true);
    try {
      const data = await fetchLiveView(current.docId, current.viewKey);
      /* 拉取期间用户可能开始拖动 / 开始编辑：这一份已经过时，丢掉等下次（否则松手瞬间会被旧版面盖回去） */
      if (optionsRef.current.blocked) return;
      pendingRef.current = null;
      current.onRemote(data.view, data.version || version);
      current.onSynced(data.version || version);
    } catch {
      // 拉内容失败：保留 pending，下一轮再试（不打断用户当前操作）
    } finally {
      busyRef.current = false;
      setSyncing(false);
    }
  }, []);

  /**
   * 立刻拉一次当前页并合并（切页 / 切平台时用）.
   *
   * 为什么需要它：版本号是**文档级**的 —— 别人改的是 B 页、我正在 A 页时，轮询已经把新版本记成基线，
   * 之后切到 B 页就不会再触发同步了。所以切页必须强制拉一次，不能等版本号变化。
   * 不算本地改动：走 onRemote（页面里是 applyExternal），不进撤销栈、不置 dirty。
   */
  const refresh = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.docId || !current.viewKey || busyRef.current) return;
    busyRef.current = true;
    setSyncing(true);
    try {
      const data = await fetchLiveView(current.docId, current.viewKey);
      /* 拉取期间开始拖动 / 有未保存改动：这份已过时，丢掉（下次轮询或切页再拉） */
      if (optionsRef.current.blocked) return;
      pendingRef.current = null;
      current.onRemote(data.view, data.version || "");
      current.onSynced(data.version || "");
    } catch {
      // 拉失败就维持现状（页面里已有 doc 的那份），下一轮轮询还会再试
    } finally {
      busyRef.current = false;
      setSyncing(false);
    }
  }, []);

  /** 本地编辑结束后（blocked 变 false）把攒下的那次更新补上 */
  useEffect(() => {
    if (!options.blocked && pendingRef.current) void flush();
  }, [options.blocked, flush]);

  useEffect(() => {
    const { docId, enabled = true, intervalMs = 300 } = options;
    if (!docId || !enabled) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      if (cancelled || document.hidden) return;
      const current = optionsRef.current;
      if (!current.viewKey) return;
      try {
        const data = await fetchLiveVersion(docId);
        failuresRef.current = 0;
        if (!data.version || data.version === current.baseline) return;
        pendingRef.current = data.version;
        if (!current.blocked) await flush();
      } catch {
        failuresRef.current += 1;
      }
    };

    const loop = () => {
      if (cancelled) return;
      void tick().finally(() => {
        if (cancelled) return;
        timer = window.setTimeout(loop, nextBackoffMs(failuresRef.current, optionsRef.current.intervalMs ?? intervalMs));
      });
    };
    loop();

    const onVisible = () => {
      if (document.hidden) return;
      failuresRef.current = 0;
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [options.docId, options.enabled, options.intervalMs, flush]);

  return { syncing, refresh };
}
