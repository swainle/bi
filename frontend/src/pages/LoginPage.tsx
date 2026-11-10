/** 登录页 —— 明策BI（Apple 风：留白、居中卡片、极简文案） */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  InputAdornment,
  IconButton,
  CircularProgress,
  Stack,
} from "@mui/material";
import {
  Visibility,
  VisibilityOff,
  LogoDev as LogoIcon,
} from "@mui/icons-material";
import { useAuth } from "../hooks/useAuth";
import { extractErrorMessage } from "../api/client";

export default function LoginPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user, login } = useAuth();

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const redirect = params.get("redirect") || "/bi";

  useEffect(() => {
    if (user) nav(redirect, { replace: true });
  }, [user, nav, redirect]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account.trim() || !password) {
      setError("请输入账号与密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(account.trim(), password);
      nav(redirect, { replace: true });
    } catch (err: any) {
      setError(extractErrorMessage(err, "登录失败，请检查账号与密码"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
        background:
          "radial-gradient(1200px 600px at 50% -10%, #EEF2FF 0%, #F8FAFC 45%, #FFFFFF 100%)",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: 380,
          p: 4,
          borderRadius: 4,
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 20px 60px -24px rgba(15,23,42,0.18)",
        }}
      >
        <Stack alignItems="center" spacing={1.5} sx={{ mb: 3.5 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: "13px",
              background: "linear-gradient(135deg,#2563EB,#7C3AED)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px -8px rgba(37,99,235,0.55)",
            }}
          >
            <LogoIcon sx={{ fontSize: 26, color: "#fff" }} />
          </Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: 0.3 }}>
            明策BI
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
            数据看板 · 自助分析
          </Typography>
        </Stack>

        <form onSubmit={submit}>
          <Stack spacing={2}>
            <TextField
              label="账号"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              size="medium"
              autoFocus
              autoComplete="username"
              fullWidth
            />
            <TextField
              label="密码"
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              fullWidth
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setShowPwd((v) => !v)}
                      edge="end"
                    >
                      {showPwd ? (
                        <VisibilityOff sx={{ fontSize: 18 }} />
                      ) : (
                        <Visibility sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            {error && (
              <Typography sx={{ fontSize: 12.5, color: "error.main" }}>
                {error}
              </Typography>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              sx={{ height: 44, borderRadius: 2.5, fontSize: 14.5, fontWeight: 600 }}
            >
              {loading ? <CircularProgress size={20} color="inherit" /> : "登录"}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
