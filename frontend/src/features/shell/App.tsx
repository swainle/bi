import BiEntryLayout from "./BiEntryLayout";
import { useMemo, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  ThemeProvider,
  CssBaseline,
  Box,
  CircularProgress,
} from "@mui/material";
import { buildTheme } from "../../theme";
import { AuthProvider } from "../auth/AuthContext";
import { ThemeModeProvider, useThemeMode } from "./ThemeContext";
import ProtectedRoute from "./ProtectedRoute";
import { SnackbarProvider } from "../../components/common/SnackbarProvider";
import ErrorBoundary from "../../components/common/ErrorBoundary";
import TopBar from "./TopBar";

const LoginPage = lazy(() => import("../../pages/LoginPage"));
const BiDashboardPage = lazy(() => import("../../pages/BiDashboardPage"));
const BiViewPage = lazy(() => import("../viewer/BiViewPage"));
const AuditLogPage = lazy(() => import("../../pages/AuditLogPage"));
const ComponentLibraryPage = lazy(() => import("../components/pages/ComponentLibraryPage"));
const ComponentEditorPage = lazy(() => import("../components/pages/ComponentEditorPage"));
const CanvasBoardPage = lazy(() => import("../../pages/CanvasBoardPage"));
const ProjectsPage = lazy(() => import("../../pages/ProjectsPage"));
const DashboardPage = lazy(() => import("../viewer/DashboardPage"));
const AdminPage = lazy(() => import("../../pages/AdminPage"));
const McpAccessPage = lazy(() => import("../mcp/McpAccessPage"));

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

/** 应用外壳：顶栏 + 内容区 */
function Shell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const hasSideNav = ["/bi", "/bi/components", "/bi/projects", "/bi/admin"].includes(pathname);
  // 满宽页：编辑画布 / 组件库 / 卡片编辑 / 主页看板 / 看板查看（大屏观感）
  const fullBleed =
    pathname.startsWith("/bi/components") ||
    pathname.startsWith("/bi/canvas") ||
    pathname.startsWith("/bi/projects") ||
    pathname.startsWith("/bi/dashboards") ||
    pathname.startsWith("/bi/admin") ||
    pathname === "/bi" ||
    pathname.startsWith("/bi/view");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {!hasSideNav && <TopBar />}
      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: fullBleed ? "100%" : 1680,
          mx: "auto",
          px: fullBleed ? 0 : 3,
          py: fullBleed ? 0 : 2,
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
                    <Route path="help" element={<HelpPage />} />
                    <Route path="help/:slug" element={<HelpPage />} />
                    <Route path="bi" element={<BiDashboardPage />} />
                    <Route path="bi/view/:id" element={<BiViewPage />} />
                    <Route path="bi/editor" element={<Navigate to="/bi/canvas" replace />} />
                    <Route path="bi/audit" element={<AuditLogPage />} />
                    <Route path="bi/admin" element={<AdminPage />} />
                    <Route
                      path="bi/mcp"
                      element={
                        <ProtectedRoute permKey="bi:mcp:use">
                          <McpAccessPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="bi/components"
                      element={
                        <ProtectedRoute permKey="bi:nav:components">
                          <BiEntryLayout activeKey="components"><ComponentLibraryPage /></BiEntryLayout>
                        </ProtectedRoute>
                      }
                    />
                    <Route path="bi/test-data" element={<Navigate to="/bi?view=test-data" replace />} />
                    <Route
                      path="bi/components/:id/edit"
                      element={
                        <ProtectedRoute permKey="bi:nav:components">
                          <ComponentEditorPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="bi/projects"
                      element={
                        <ProtectedRoute permKey="bi:nav:editor">
                          <BiEntryLayout activeKey="editor"><ProjectsPage /></BiEntryLayout>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="bi/canvas"
                      element={
                        <ProtectedRoute permKey="bi:nav:editor">
                          <CanvasBoardPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="bi/dashboards" element={<Navigate to="/bi" replace />} />
                    <Route path="bi/dashboards/:id" element={<DashboardPage />} />
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


const HelpPage = lazy(() => import("../../pages/HelpPage"));