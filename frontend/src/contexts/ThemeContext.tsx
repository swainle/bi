/** 主题上下文 + 壁纸联动 — 全部内联，零项目依赖，彻底消除循环 import */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

// ── 类型 ──
export type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
}

// ── Context ──
const ThemeCtx = createContext<ThemeContextValue>({
  mode: "light",
  toggle: () => {},
  setMode: () => {},
  isDark: false,
});

// ── 壁纸工具（内联，不 import 任何文件） ──
const WALLPAPER_KEY = "mingzebi_wallpaper";

const WALLPAPER_CSS: Record<string, { css: string; isDark?: boolean }> = {
  pure:     { css: "#ffffff" },
  default:  { css: "linear-gradient(135deg, #fbfaff 0%, #fefafd 25%, #fafcff 50%, #fafefb 75%, #fefdf8 100%)" },
  night:    { css: "linear-gradient(135deg, #f2f6f9 0%, #eaf1f7 30%, #e0eaf3 60%, #d5e2ee 100%)" },
  ocean:    { css: "linear-gradient(135deg, #e8f5e9 0%, #dff0e0 30%, #d3ebd5 60%, #c8e6c9 100%)" },
  sunset:   { css: "linear-gradient(135deg, #fdf8f0 0%, #fbf3e4 30%, #f8edd8 60%, #f5e7cc 100%)" },
  forest:   { css: "linear-gradient(135deg, #ecf7f0 0%, #e2f3e8 30%, #d5eedd 60%, #c8e8d2 100%)" },
  lavender: { css: "linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #1a1a2e 100%)", isDark: true },
};

function applyWallpaper(id: string) {
  const wp = WALLPAPER_CSS[id] || WALLPAPER_CSS["pure"];
  document.body.style.background = wp.css;
  document.body.style.backgroundAttachment = "fixed";
  if (wp.isDark) document.documentElement.setAttribute("data-wallpaper", "dark");
  else document.documentElement.removeAttribute("data-wallpaper");
}

function setWallpaper(id: string) {
  localStorage.setItem(WALLPAPER_KEY, id);
  applyWallpaper(id);
}

// ── Hook ──
export function useThemeMode() {
  return useContext(ThemeCtx);
}

// ── Provider ──
const THEME_KEY = "mingzebi_theme_mode";

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    let initial: ThemeMode = "light";
    if (stored === "dark" || stored === "light") initial = stored;
    else if (document.documentElement.getAttribute("data-wallpaper") === "dark") initial = "dark";

    if (initial === "dark") setWallpaper("lavender");
    else setWallpaper("pure");

    return initial;
  });

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem(THEME_KEY, m);
    if (m === "dark") setWallpaper("lavender");
    else setWallpaper("pure");
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === "light" ? "dark" : "light");
  }, [mode, setMode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    const styleId = "dark-tooltip-override";
    if (mode === "dark") {
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `.MuiTooltip-tooltip{background-color:rgb(45,55,72)!important;color:rgb(226,232,240)!important;box-shadow:0 2px 12px rgba(0,0,0,0.5)!important;border:1px solid rgba(255,255,255,0.08)!important}`;
        document.head.appendChild(style);
      }
    } else {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    }
  }, [mode]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (detail === "dark") setMode("dark");
      else if (detail === "light") setMode("light");
    };
    window.addEventListener("wallpaper-theme-sync", handler);
    return () => window.removeEventListener("wallpaper-theme-sync", handler);
  }, [setMode]);

  return (
    <ThemeCtx.Provider value={{ mode, toggle, setMode, isDark: mode === "dark" }}>
      {children}
    </ThemeCtx.Provider>
  );
}
