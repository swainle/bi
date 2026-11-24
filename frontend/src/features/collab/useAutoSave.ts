/** 自动保存：有未保存改动时静默落库（防抖），关页面前尽量冲一次.
 *
 * 失败重试是「静默」的：2s / 5s / 15s 各一次，仍失败才回调 onFailure 提示一次，
 * 避免断网时每两秒弹一个红框。重试由调用方的 save 返回 false 触发（persist 已吞异常）。
 */

import { useEffect, useRef, useState } from "react";

const RETRY_DELAYS = [2000, 5000, 15000];
/** 文档脏了多久还没存上，才认为「可能没存住」（避免自动保存期间标记一直在闪） */
const STALE_AFTER_MS = 1500;

export interface AutoSaveOptions {
  /** 有未保存改动（dirty || docDirty） */
  pending: boolean;
  /** 正在保存中 / 正在改名等不适合保存的状态 */
  blocked: boolean;
  delay?: number;
  /** 返回 false 表示这次没存成功（会进入静默重试） */
  save: () => Promise<boolean> | boolean | void;
  /** 重试仍失败时回调一次（用于提示用户，别在每次重试都弹） */
  onFailure?: () => void;
}

export function useAutoSave({ pending, blocked, delay = 500, save, onFailure }: AutoSaveOptions): { stale: boolean } {
  const saveRef = useRef(save);
  saveRef.current = save;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;
  /** 只有「脏了很久没存上」才算 stale：正常自动保存（500ms）不会让顶栏标记闪一下 */
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!pending) {
      setStale(false);
      return;
    }
    const timer = window.setTimeout(() => setStale(true), STALE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!pending || blocked) return;
    let cancelled = false;
    let timer: number | undefined;
    let tries = 0;

    const run = async () => {
      if (cancelled) return;
      const ok = await saveRef.current();
      if (cancelled || ok !== false) return;
      if (!pendingRef.current || blockedRef.current) return;
      if (tries >= RETRY_DELAYS.length) {
        failureRef.current?.();
        return;
      }
      const wait = RETRY_DELAYS[tries];
      tries += 1;
      timer = window.setTimeout(() => void run(), wait);
    };

    timer = window.setTimeout(() => void run(), delay);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pending, blocked, delay]);

  /* 关标签页 / 切到后台：尽量再冲一版（失败由下一轮重试兜底） */
  useEffect(() => {
    const flush = () => {
      if (pendingRef.current && !blockedRef.current) void saveRef.current();
    };
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { stale };
}
