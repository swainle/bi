/** MCP 授权 —— 普通成员：看本部门开放了哪些客户端，生成自己的接入串，管理自己的授权 */

import { useCallback, useEffect, useState } from "react";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Tooltip, Typography,
} from "@mui/material";
import { ContentCopyOutlined, VpnKeyOutlined } from "@mui/icons-material";
import client from "../api/client";
import { buildConnectorText } from "../features/mcp/connector";
import {
  BORDER, ConfirmDialog, EmptyState, INK, LINE, Loading, MUTED, PanelCard, PrimaryButton,
  SectionHead, TD, TH, dialogPaperSx, dialogTitleSx, fmtTime, friendlyError, useToast,
} from "../features/admin/shared";

interface AvailableClient {
  id: number; name: string; description: string; client_id: string;
  dept: string; tools: string[]; granted: boolean; dashboard_count: number;
}
interface MyGrant {
  id: number; client_name: string; client_id: string;
  created_at: string; expires_at: string; revoked_at: string;
  last_used_at: string; device_name: string; active: boolean;
  frozen: boolean; frozen_reason: string;
}

export default function McpAccessPage() {
  const [clients, setClients] = useState<AvailableClient[] | null>(null);
  const [grants, setGrants] = useState<MyGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<AvailableClient | null>(null);
  const [out, setOut] = useState<{ name: string; text: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<MyGrant | null>(null);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [availRes, mineRes] = await Promise.all([
        client.get("/mcp/clients/available"),
        client.get("/mcp/grants/mine"),
      ]);
      setClients(availRes.data?.clients || []);
      setGrants(mineRes.data?.grants || []);
    } catch (e: any) {
      setError(friendlyError(e, "加载 MCP 授权信息失败"));
      setClients([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); show("接入指令已复制"); }
    catch { show("复制失败，请手动选中复制", "error"); }
  };

  const makeConnector = async (row: AvailableClient) => {
    setBusy(true);
    try {
      const res = await client.post("/mcp/grants", { client_id: row.client_id });
      const text = buildConnectorText({
        clientId: row.client_id,
        secret: res.data?.secret || "",
        refreshToken: res.data?.refresh_token || "",
        toolCodes: row.tools || [],
      });
      setOut({ name: row.name, text });
      await copy(text);
      await load();
    } catch (e: any) {
      show(friendlyError(e, "生成接入指令失败"), "error");
    } finally { setBusy(false); }
  };

  const revoke = async (row: MyGrant) => {
    setBusy(true);
    try {
      await client.delete(`/mcp/grants/${row.id}`);
      show("授权已撤销，已签发的令牌立即失效");
      await load();
    } catch (e: any) {
      show(friendlyError(e, "撤销失败"), "error");
    } finally { setBusy(false); }
  };

  return (
    <Box sx={{ maxWidth: 1120, mx: "auto", px: { xs: 2, md: 3 }, py: 3 }}>
      <SectionHead
        title="MCP 授权"
        desc="管理员开放的 MCP 客户端：生成接入指令粘给 Agent，Agent 以你的身份和权限取数；随时可以撤销"
        action={
          <Button size="small" onClick={() => void load()}
            sx={{ textTransform: "none", fontSize: 12.5, color: MUTED }}>刷新</Button>
        }
      />

      {loading ? <Loading /> : error ? <EmptyState text={error} hint="检查后端是否在运行，或刷新重试" /> : (
        <>
          {(clients || []).length === 0 ? (
            <PanelCard><EmptyState text="暂时没有对你开放的 MCP 客户端" hint="联系管理员在「MCP 客户端」里把部门设为你所在的部门" /></PanelCard>
          ) : (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, mb: 3 }}>
              {(clients || []).map((row) => (
                <PanelCard key={row.id} sx={{ p: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: INK }}>{row.name}</Typography>
                    <Chip size="small" label={row.dept} sx={{
                      height: 20, fontSize: 11, borderRadius: "999px",
                      bgcolor: "#EEF2FF", color: "#4F46E5",
                    }} />
                    {row.granted && (
                      <Chip size="small" label="已授权" sx={{
                        height: 20, fontSize: 11, borderRadius: "999px",
                        bgcolor: "#ECFDF5", color: "#047857",
                      }} />
                    )}
                  </Box>
                  <Typography sx={{ fontSize: 12, color: MUTED, mt: 0.75, lineHeight: 1.7, minHeight: 34 }}>
                    {row.description || "未填写说明"}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: "#64748B", mt: 0.5 }}>
                    可用工具 {row.tools.length} 个 · {row.dashboard_count ? `限定 ${row.dashboard_count} 个看板` : "不限看板"}
                  </Typography>
                  <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1.5 }}>
                    <PrimaryButton onClick={() => setTarget(row)} disabled={busy}
                      startIcon={<VpnKeyOutlined sx={{ fontSize: 16 }} />}>
                      生成接入指令
                    </PrimaryButton>
                  </Box>
                </PanelCard>
              ))}
            </Box>
          )}

          <PanelCard sx={{ p: 0, overflow: "hidden" }}>
            <Box sx={{ px: 2, pt: 1.75, pb: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK }}>我的授权</Typography>
              <Typography sx={{ fontSize: 11.5, color: MUTED, mt: 0.25 }}>
                撤销后该授权签发的令牌立即失效；已配好的 Agent 需要重新生成接入指令
              </Typography>
            </Box>
            {grants.length === 0 ? (
              <EmptyState text="还没有授权记录" hint="在上面的客户端卡片里点「生成接入指令」" />
            ) : (
              <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                <Box component="thead">
                  <Box component="tr">
                    <Box component="th" sx={TH}>客户端</Box>
                    <Box component="th" sx={TH}>状态</Box>
                    <Box component="th" sx={TH}>授权时间</Box>
                    <Box component="th" sx={TH}>过期时间</Box>
                    <Box component="th" sx={TH}>最近使用</Box>
                    <Box component="th" sx={{ ...TH, textAlign: "right" }}>操作</Box>
                  </Box>
                </Box>
                <Box component="tbody">
                  {grants.map((row) => (
                    <Box component="tr" key={row.id} sx={{ borderTop: `1px solid ${LINE}` }}>
                      <Box component="td" sx={TD}>{row.client_name}</Box>
                      <Box component="td" sx={TD}>
                        {row.frozen ? (
                          <Tooltip title={row.frozen_reason || "安全策略冻结"}>
                            <Chip size="small" label="已冻结" sx={{
                              height: 20, fontSize: 11, borderRadius: "999px",
                              bgcolor: "#FEF2F2", color: "#B91C1C",
                            }} />
                          </Tooltip>
                        ) : (
                          <Chip size="small" label={row.active ? "有效" : "已撤销"} sx={{
                            height: 20, fontSize: 11, borderRadius: "999px",
                            bgcolor: row.active ? "#ECFDF5" : "#F3F4F6",
                            color: row.active ? "#047857" : "#6B7280",
                          }} />
                        )}
                      </Box>
                      <Box component="td" sx={{ ...TD, color: MUTED }}>{fmtTime(row.created_at)}</Box>
                      <Box component="td" sx={{ ...TD, color: MUTED }}>{fmtTime(row.expires_at)}</Box>
                      <Box component="td" sx={{ ...TD, color: MUTED }}>{fmtTime(row.last_used_at)}</Box>
                      <Box component="td" sx={{ ...TD, textAlign: "right" }}>
                        {row.active && (
                          <Button size="small" disabled={busy} onClick={() => setRevokeTarget(row)}
                            sx={{ textTransform: "none", fontSize: 12, color: "#EF4444", minWidth: 0 }}>
                            撤销
                          </Button>
                        )}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </PanelCard>
        </>
      )}

      <ConfirmDialog
        open={!!target}
        title="生成接入指令"
        desc={`会为「${target?.name || ""}」生成一份属于你账号的凭据（secret + refresh_token），只显示一次；重复生成会让你之前的接入串失效。`}
        confirmText="生成" busy={busy}
        onClose={() => setTarget(null)}
        onConfirm={() => {
          const row = target;
          setTarget(null);
          if (row) void makeConnector(row);
        }}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        title="撤销授权"
        desc={`撤销「${revokeTarget?.client_name || ""}」的授权后，该授权签发的令牌立即失效，Agent 将无法再调用。`}
        confirmText="撤销" danger busy={busy}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          const row = revokeTarget;
          setRevokeTarget(null);
          if (row) void revoke(row);
        }}
      />

      <Dialog open={!!out} onClose={() => setOut(null)} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>接入指令 · {out?.name}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: MUTED, lineHeight: 1.7, mb: 1.5 }}>
            已复制到剪贴板。secret 与 refresh_token 只显示这一次，关掉后只能重新生成。
          </Typography>
          <Box sx={{ p: 1.5, bgcolor: "#F8F9FC", border: `1px solid ${BORDER}`, borderRadius: "8px" }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
              <Typography sx={{ fontSize: 11, color: "#64748B" }}>接入指令</Typography>
              <Tooltip title="再复制一次">
                <ContentCopyOutlined onClick={() => out && void copy(out.text)}
                  sx={{ fontSize: 15, color: "#94A3B8", cursor: "pointer", ml: "auto" }} />
              </Tooltip>
            </Box>
            <Typography component="pre" sx={{
              m: 0, fontSize: 11.5, lineHeight: 1.7, color: INK, whiteSpace: "pre-wrap",
              wordBreak: "break-all", fontFamily: "ui-monospace, Menlo, monospace",
              maxHeight: 320, overflowY: "auto",
            }}>
              {out?.text}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <PrimaryButton onClick={() => setOut(null)}>完成</PrimaryButton>
        </DialogActions>
      </Dialog>

      {toastNode}
    </Box>
  );
}
