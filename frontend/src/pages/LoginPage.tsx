/** 登录页 —— 左侧品牌区 + 右侧登录卡片（主题色 #4F46E5） */

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
  MenuItem,
} from "@mui/material";
import {
  Visibility,
  VisibilityOff,
  LogoDev as LogoIcon,
} from "@mui/icons-material";
import { useAuth } from "../hooks/useAuth";
import { extractErrorMessage } from "../api/client";
import { getDepartments, type DepartmentOption } from "../api/auth";

const BRAND = "#4F46E5";
const BRAND_DEEP = "#4338CA";
const MUTED = "#86868B";

export default function LoginPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user, login, register } = useAuth();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regContact, setRegContact] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regDept, setRegDept] = useState("");
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 注册提交成功后的提示（待审批，不自动登录）
  const [notice, setNotice] = useState("");

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
    setNotice("");
    try {
      await login(account.trim(), password);
      nav(redirect, { replace: true });
    } catch (err: any) {
      setError(extractErrorMessage(err, "登录失败，请检查账号与密码"));
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = regName.trim();
    const contact = regContact.trim();
    if (username.length < 2) {
      setError("用户名至少 2 个字符");
      return;
    }
    if (!contact) {
      setError("请填写邮箱或手机号");
      return;
    }
    const isEmail = contact.includes("@");
    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    if (!isEmail && !/^\d{11,20}$/.test(contact)) {
      setError("手机号需为 11-20 位数字");
      return;
    }
    if (regPassword.length < 6 || !/[a-z]/.test(regPassword) || !/[A-Z]/.test(regPassword) || !/\d/.test(regPassword)) {
      setError("密码至少 6 位，且包含大小写字母和数字");
      return;
    }
    if (regPassword !== regConfirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (!regDept) {
      setError("请选择所在部门");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await register(
        username,
        isEmail ? contact : "",
        isEmail ? "" : contact,
        regPassword,
        Number(regDept),
      );
      // 注册只是提交申请：不登录、不签发 token，等审批通过后再登录
      setRegName("");
      setRegContact("");
      setRegPassword("");
      setRegConfirm("");
      setRegDept("");
      setMode("login");
      setError("");
      setNotice(result.message || "注册申请已提交，待部门负责人或管理员审批通过后即可登录");
    } catch (err: any) {
      setError(extractErrorMessage(err, "注册失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError("");
    setNotice("");
    setShowPwd(false);
  };

  // 注册页的部门选项：只在进入注册时拉一次，拿不到就提示「联系管理员」
  useEffect(() => {
    if (mode !== "register" || departments.length > 0 || deptLoading) return;
    setDeptLoading(true);
    getDepartments()
      .then((list) => setDepartments(list))
      .catch(() => setError("部门清单读取失败，请稍后重试或联系管理员"))
      .finally(() => setDeptLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const fieldSx = {
    "& .MuiOutlinedInput-root": {
      bgcolor: "#F5F7FB",
      borderRadius: "8px",
      fontSize: 13.5,
      height: 42,
      "& fieldset": { borderColor: "transparent" },
      "&:hover fieldset": { borderColor: "#D8E2F5" },
      "&.Mui-focused fieldset": { borderColor: BRAND, borderWidth: 1.5 },
    },
    "& input::placeholder": { color: "#9AA5B5", opacity: 1 },
  } as const;

  const pwdToggle = (
    <InputAdornment position="end">
      <IconButton
        size="small"
        onClick={() => setShowPwd((v) => !v)}
        edge="end"
        sx={{ color: "#9AA5B5" }}
      >
        {showPwd ? <VisibilityOff sx={{ fontSize: 17 }} /> : <Visibility sx={{ fontSize: 17 }} />}
      </IconButton>
    </InputAdornment>
  );

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", bgcolor: "#FAFBFC" }}>
      {/* ── 左侧品牌区 ── */}
      <Box
        sx={{
          width: "34%",
          minWidth: 360,
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          px: { md: 5, lg: 7 },
          py: 4,
          color: "#fff",
          background: `linear-gradient(160deg, ${BRAND_DEEP} 0%, ${BRAND} 52%, ${BRAND_DEEP} 100%)`,
        }}
      >
        <Box sx={{
          position: "absolute", top: -110, right: -90, width: 340, height: 340,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 66%)",
          pointerEvents: "none",
        }} />
        <Box sx={{
          position: "absolute", bottom: -160, left: -110, width: 380, height: 380,
          borderRadius: "50%", border: "1px solid rgba(255,255,255,0.10)",
          pointerEvents: "none",
        }} />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, position: "relative", zIndex: 1 }}>
          <Box sx={{
            width: 28, height: 28, borderRadius: "8px", bgcolor: "rgba(255,255,255,0.16)",
            display: "grid", placeItems: "center",
          }}>
            <LogoIcon sx={{ fontSize: 17, color: "#fff" }} />
          </Box>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, letterSpacing: 0.2 }}>
            明策BI
          </Typography>
        </Box>

        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 380, position: "relative", zIndex: 1 }}>
          <Typography sx={{
            fontSize: { md: 32, lg: 38 },
            fontWeight: 800,
            lineHeight: 1.42,
            letterSpacing: "-0.02em",
          }}>
            让经营分析
            <br />
            像有一位 AI 搭档
          </Typography>
          <Box sx={{ width: 36, height: 3, borderRadius: 2, bgcolor: "rgba(255,255,255,0.35)", mt: 3, mb: 2 }} />
          <Typography sx={{ fontSize: 12.5, lineHeight: 2, color: "rgba(255,255,255,0.66)" }}>
            电商老板的 BI 工作台
            <br />
            数据看板 · 自助分析 · 团队协同
          </Typography>
        </Box>
      </Box>

      {/* ── 右侧登录区 ── */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          px: 3,
          py: 6,
          position: "relative",
          background: "radial-gradient(1000px 520px at 75% -10%, #F0F3FF 0%, #FAFBFC 55%, #FFFFFF 100%)",
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: "100%",
            maxWidth: 348,
            p: "32px 30px 28px",
            borderRadius: "12px",
            border: "1px solid #EDF0F5",
            bgcolor: "#fff",
            boxShadow: "0 22px 60px -32px rgba(15,23,42,0.22)",
          }}
        >
          <Typography sx={{ fontSize: 20, fontWeight: 800, color: "#1D1D1F", letterSpacing: -0.2 }}>
            明策BI
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: 12.5, color: MUTED }}>
            {mode === "login" ? "登录你的数据工作台" : "创建你的明策BI账号"}
          </Typography>

          {notice && (
            <Box sx={{
              mt: 2, px: 1.5, py: 1, borderRadius: "8px",
              bgcolor: "#ECFDF5", border: "1px solid #BBF7D0",
            }}>
              <Typography sx={{ fontSize: 12, color: "#047857", lineHeight: 1.6 }}>
                {notice}
              </Typography>
            </Box>
          )}

          <Box sx={{ display: "flex", gap: 2.5, mt: 2.5, mb: 2.5, borderBottom: "1px solid #EEF0F5" }}>
            {(["login", "register"] as const).map((key) => (
              <Box key={key} onClick={() => switchMode(key)}
                sx={{
                  pb: 1, marginBottom: "-1px", cursor: "pointer",
                  borderBottom: `2px solid ${mode === key ? BRAND : "transparent"}`,
                }}>
                <Typography sx={{
                  fontSize: 12.5, fontWeight: 600,
                  color: mode === key ? BRAND : "#8A94A6",
                }}>
                  {key === "login" ? "登录" : "注册"}
                </Typography>
              </Box>
            ))}
          </Box>

          {mode === "login" ? (
            <form onSubmit={submit}>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
                <TextField
                  placeholder="账号"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  size="small"
                  autoFocus
                  autoComplete="username"
                  fullWidth
                  inputProps={{ "aria-label": "账号" }}
                  sx={fieldSx}
                />
                <TextField
                  placeholder="密码"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  size="small"
                  fullWidth
                  inputProps={{ "aria-label": "密码" }}
                  sx={fieldSx}
                  InputProps={{ endAdornment: pwdToggle }}
                />

                {error && (
                  <Typography sx={{ fontSize: 12, color: "error.main" }}>
                    {error}
                  </Typography>
                )}

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading}
                  sx={{
                    mt: 0.25,
                    height: 42,
                    borderRadius: "8px",
                    bgcolor: BRAND,
                    fontSize: 13.5,
                    fontWeight: 600,
                    textTransform: "none",
                    boxShadow: "0 10px 24px -14px rgba(79,70,229,0.9)",
                    "&:hover": { bgcolor: BRAND_DEEP },
                  }}
                >
                  {loading ? <CircularProgress size={18} color="inherit" /> : "登录"}
                </Button>
              </Box>
            </form>
          ) : (
            <form onSubmit={submitRegister}>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <TextField
                  placeholder="用户名"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  size="small"
                  autoFocus
                  autoComplete="username"
                  fullWidth
                  inputProps={{ "aria-label": "用户名" }}
                  sx={fieldSx}
                />
                <TextField
                  placeholder="邮箱或手机号"
                  value={regContact}
                  onChange={(e) => setRegContact(e.target.value)}
                  autoComplete="username"
                  size="small"
                  fullWidth
                  inputProps={{ "aria-label": "邮箱或手机号" }}
                  sx={fieldSx}
                />
                <Box>
                  <TextField
                    placeholder="密码"
                    type={showPwd ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    autoComplete="new-password"
                    size="small"
                    fullWidth
                    inputProps={{ "aria-label": "密码" }}
                    sx={fieldSx}
                    InputProps={{ endAdornment: pwdToggle }}
                  />
                  <Typography sx={{ mt: 0.75, fontSize: 10.5, color: "#A8B7CC" }}>
                    密码至少 6 位，包含大小写字母和数字
                  </Typography>
                </Box>
                <TextField
                  placeholder="确认密码"
                  type={showPwd ? "text" : "password"}
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  autoComplete="new-password"
                  size="small"
                  fullWidth
                  inputProps={{ "aria-label": "确认密码" }}
                  sx={fieldSx}
                />
                <TextField
                  select
                  value={regDept}
                  onChange={(e) => setRegDept(e.target.value)}
                  size="small"
                  fullWidth
                  sx={fieldSx}
                  SelectProps={{
                    displayEmpty: true,
                    inputProps: { "aria-label": "所在部门" },
                    renderValue: (value) => {
                      const hit = departments.find((d) => String(d.id) === value);
                      return (
                        <Typography
                          component="span"
                          sx={{ fontSize: 13.5, color: hit ? "#1D1D1F" : "#9AA5B5" }}
                        >
                          {hit ? hit.name : deptLoading ? "部门读取中…" : "选择所在部门"}
                        </Typography>
                      );
                    },
                  }}
                >
                  {departments.map((dept) => (
                    <MenuItem key={dept.id} value={String(dept.id)} sx={{ fontSize: 13 }}>
                      {dept.name}
                    </MenuItem>
                  ))}
                </TextField>
                {!deptLoading && departments.length === 0 && (
                  <Typography sx={{ fontSize: 10.5, color: "#B45309" }}>
                    还没有可选部门，请联系管理员在「用户管理 · 部门管理」里添加
                  </Typography>
                )}

                {error && (
                  <Typography sx={{ fontSize: 12, color: "error.main" }}>
                    {error}
                  </Typography>
                )}

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading || (!deptLoading && departments.length === 0)}
                  sx={{
                    mt: 0.25,
                    height: 42,
                    borderRadius: "8px",
                    bgcolor: BRAND,
                    fontSize: 13.5,
                    fontWeight: 600,
                    textTransform: "none",
                    boxShadow: "0 10px 24px -14px rgba(79,70,229,0.9)",
                    "&:hover": { bgcolor: BRAND_DEEP },
                  }}
                >
                  {loading ? <CircularProgress size={18} color="inherit" /> : "提交注册申请"}
                </Button>
                <Typography sx={{ fontSize: 10.5, color: "#A8B7CC", textAlign: "center", lineHeight: 1.6 }}>
                  提交后需所在部门负责人或管理员审批，通过后才能登录
                </Typography>
              </Box>
            </form>
          )}

          <Typography sx={{ mt: 2.5, textAlign: "center", fontSize: 11, color: "#A8B7CC" }}>
            数据看板 · 自助分析 · 团队协同
          </Typography>
        </Paper>

        <Typography sx={{
          position: "absolute", bottom: 24, right: 28,
          fontSize: 10.5, color: "#B5BFCC",
        }}>
          © 2026 明策BI · 让数据更好用
        </Typography>
      </Box>
    </Box>
  );
}
