import { createTheme, type Theme } from "@mui/material/styles";

// 扩展 MUI 调色板类型以支持 50 色阶
declare module "@mui/material/styles" {
  interface PaletteColor {
    50?: string;
  }
  interface SimplePaletteColorOptions {
    50?: string;
  }
}

export function buildTheme(mode: "light" | "dark"): Theme {
  const isDark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#2563EB",
        light: "#60A5FA",
        dark: "#1D4ED8",
        50: isDark ? "rgba(37,99,235,0.15)" : "#EFF6FF",
        contrastText: "#FFFFFF",
      },
      secondary: {
        main: "#059669",
        light: "#34D399",
        dark: "#047857",
        50: isDark ? "rgba(5,150,105,0.15)" : "#ECFDF5",
        contrastText: "#FFFFFF",
      },
      background: {
        default: isDark ? "#0F172A" : "#FFFFFF",
        paper: isDark ? "rgba(30,41,59,0.8)" : "rgba(255,255,255,0.55)",
      },
      text: {
        primary: isDark ? "#E2E8F0" : "#1F2937",
        secondary: isDark ? "rgba(255,255,255,0.6)" : "#6B7280",
      },
      divider: isDark ? "rgba(255,255,255,0.1)" : "#E5E7EB",
      action: {
        hover: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
      },
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      h4: { fontWeight: 700, fontSize: "1.5rem" },
      h5: { fontWeight: 600, fontSize: "1.25rem" },
      h6: { fontWeight: 600, fontSize: "1.1rem" },
      body1: { fontSize: "1rem", lineHeight: 1.8 },
      body2: { fontSize: "0.875rem", lineHeight: 1.6 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: {
        styleOverrides: { root: { textTransform: "none", fontWeight: 500 } },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            ...(isDark ? {
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(20px) saturate(120%)",
              WebkitBackdropFilter: "blur(20px) saturate(120%)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
            } : {
              background: "rgba(255,255,255,0.55)",
              border: "1px solid rgba(255,255,255,0.6)",
              backdropFilter: "blur(16px) saturate(150%)",
              WebkitBackdropFilter: "blur(16px) saturate(150%)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 4px 12px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.5)",
            }),
          },
        },
      },
      MuiTooltip: {
        defaultProps: isDark ? {
          slotProps: {
            tooltip: {
              sx: {
                bgcolor: "rgb(45,55,72)",
                color: "rgb(226,232,240)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                border: "1px solid rgba(255,255,255,0.08)",
              },
            },
          },
        } : undefined,
        styleOverrides: {
          tooltip: {
            borderRadius: 6,
            fontSize: 12,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            background: isDark ? "rgba(15,23,42,0.7)" : "rgba(255,255,255,0.55)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            color: isDark ? "#E2E8F0" : "#1F2937",
            borderBottom: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.4)",
            boxShadow: isDark ? "0 1px 8px rgba(0,0,0,0.2)" : "0 1px 8px rgba(0,0,0,0.04)",
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 20,
            background: isDark ? "rgba(30,41,59,0.95)" : "rgba(255,255,255,0.92)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(255,255,255,0.5)",
            boxShadow: isDark
              ? "0 12px 40px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.05)"
              : "0 12px 40px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.5)",
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            background: isDark ? "rgba(30,41,59,0.95)" : "rgba(255,255,255,0.95)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            bgcolor: isDark ? "rgba(30,41,59,0.95)" : undefined,
            backdropFilter: isDark ? "blur(16px) saturate(150%)" : undefined,
            WebkitBackdropFilter: isDark ? "blur(16px) saturate(150%)" : undefined,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: isDark
            ? { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)" }
            : {},
        },
      },
    },
  });
}

// 默认导出浅色主题（向后兼容）
const lightTheme = buildTheme("light");
export default lightTheme;
