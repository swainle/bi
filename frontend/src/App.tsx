import { useMemo, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  ThemeProvider,
  CssBaseline,
  Box,
  CircularProgress,
} from "@mui/material";
import { buildTheme } from "./theme";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeModeProvider, useThemeMode } from "./contexts/ThemeContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import { SnackbarProvider } from "./components/common/SnackbarProvider";
import ErrorBoundary from "./components/common/ErrorBoundary";
import TopBar from "./components/layout/TopBar";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const BiDashboardPage = lazy(() => import("./pages/BiDashboardPage"));
const BiViewPage = lazy(() => import("./pages/BiViewPage"));
const BiEditorPage = lazy(() => import("./pages/EditorPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));

function PageLoader() {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "60vh",
      }}
    >
      <CircularProgress size={28} />
    </Box>
  );
}

/** 应用外壳：顶栏 + 内容区（编辑器页面自带深色顶栏，不叠加） */
function Shell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const isEditor = pathname.startsWith("/bi/editor");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {!isEditor && <TopBar />}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: "100%",
          maxWidth: isEditor ? "100%" : 1680,
          mx: "auto",
          px: isEditor ? 0 : 3,
          py: isEditor ? 0 : 2,
        }}
      >
        {children ?? <Outlet />}
      </Box>
    </Box>
  );
}

function ThemedApp() {
  const { mode } = useThemeMode();
  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <SnackbarProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />

                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <Shell />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to="/bi" replace />} />
                    <Route path="bi" element={<BiDashboardPage />} />
                    <Route path="bi/view/:id" element={<BiViewPage />} />
                    <Route path="bi/editor" element={<BiEditorPage />} />
                    <Route path="bi/audit" element={<AuditLogPage />} />
                  </Route>

                  <Route path="*" element={<Navigate to="/bi" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </SnackbarProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ThemeModeProvider>
      <ThemedApp />
    </ThemeModeProvider>
  );
}
