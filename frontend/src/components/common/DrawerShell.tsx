/** 右侧抽屉壳子 —— 看板弹窗的通用容器。
 *  标题栏（标题/副标题 + 关闭）+ 遮罩 + 滑入滑出动画 + 独立滚动的内容区 + 可选 loading。
 *  用法：调用方保持本组件挂载、只切换 `open`；MUI Drawer 会在 open=false 时播放退出动画，
 *  因此不要写成 `open ? <DrawerShell/> : null` 把整棵组件卸载掉，否则没有滑出动画。 */

import type { ReactNode } from "react";
import { Box, CircularProgress, Drawer, IconButton, Typography } from "@mui/material";
import { Close } from "@mui/icons-material";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** 抽屉宽度，默认 780（数字视为 px，也可传 "40vw" 等字符串） */
  width?: number | string;
  /** 为 true 时内容区居中显示 loading，暂不渲染 children */
  loading?: boolean;
  /** 为 true 时不渲染标题栏（内容区自己画头部，比如商品详情） */
  hideHeader?: boolean;
  /** 标题右侧的操作按钮（排在关闭按钮左边） */
  action?: ReactNode;
  children?: ReactNode;
}

export default function DrawerShell({
  open, onClose, title = "", subtitle = "", width = 780, loading = false, hideHeader = false, action, children,
}: Props) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      aria-label={title || "抽屉"}
      BackdropProps={{ sx: { backgroundColor: "rgba(15,23,42,0.5)" } }}
      ModalProps={{ sx: { zIndex: 1500 } }}
      PaperProps={{
        sx: {
          width,
          maxWidth: "96vw",
          bgcolor: "#F5F7FB",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 40px rgba(15,23,42,0.16)",
        },
      }}
    >
      {!hideHeader && (
        <Box sx={{
          flexShrink: 0,
          px: 2,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          borderBottom: "1px solid #EEF3FB",
        }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            {title && (
              <Typography sx={{ fontSize: 13, fontWeight: 400, color: "#0F172A", lineHeight: 1.4 }} noWrap>
                {title}
              </Typography>
            )}
            {action}
            {subtitle && (
              <Typography sx={{ fontSize: 11.5, color: "#94A3B8", lineHeight: 1.3, ml: 0.5 }} noWrap>
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="关闭"
            sx={{ color: "#64748B", flexShrink: 0, "&:hover": { color: "#0F172A", bgcolor: "rgba(15,23,42,0.06)" } }}
          >
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      )}

      <Box sx={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        p: 2,
        ...(loading ? { display: "flex", alignItems: "center", justifyContent: "center" } : {}),
      }}>
        {loading ? <CircularProgress size={28} /> : children}
      </Box>
    </Drawer>
  );
}
