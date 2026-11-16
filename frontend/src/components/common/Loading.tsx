/** 加载状态组件 */

import { Box, CircularProgress, Typography } from "@mui/material";

interface Props {
  fullPage?: boolean;
  message?: string;
}

export default function Loading({ fullPage = false, message = "加载中..." }: Props) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: fullPage ? "100vh" : 200,
        gap: 2,
      }}
    >
      <CircularProgress size={fullPage ? 48 : 32} />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
