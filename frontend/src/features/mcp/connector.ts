/** 拼接「可直接粘给 Agent」的接入指令 —— 管理后台与「MCP 授权」页共用 */

export interface ConnectorParts {
  clientId: string;
  secret: string;
  refreshToken: string;
  toolCodes: string[];
}

export function buildConnectorText({ clientId, secret, refreshToken, toolCodes }: ConnectorParts): string {
  const base = window.location.origin;
  return [
    "帮我连接「明策BI」远程 MCP，让我可以直接查询数据和看板。",
    "",
    `连接地址：${base}/api/mcp/rpc`,
    `品牌 ID（client_id）：${clientId}`,
    `客户端密钥（client_secret）：${secret}`,
    `刷新令牌（refresh_token）：${refreshToken}`,
    "",
    `换取访问令牌：POST ${base}/api/mcp/token`,
    `调用入口：POST ${base}/api/mcp/rpc（JSON-RPC 2.0：initialize → notifications/initialized → tools/list → tools/call）`,
    "令牌：access_token 30 分钟有效、refresh_token 7 天；停用客户端或撤销授权后立即失效。",
    "",
    `已开启工具（${toolCodes.length} 个）：${toolCodes.join("、") || "无"}`,
    "权限继承授权用户的角色与数据范围（部门隔离、行级规则照常生效），高危工具默认关闭。",
  ].join("\n");
}
