/** 链接二维码弹窗 —— 明细表里「打开」按钮点开后，把网址转成二维码方便手机扫 */

import { useEffect, useState } from "react";
import { Box, Dialog, Typography } from "@mui/material";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  url: string | null;
  onClose: () => void;
}

export default function QrCodeDialog({ url, onClose }: Props) {
  /* 关闭时 url 先变 null：内容不能立刻卸载，否则关闭动画里只剩一个透明白框。
     这里保留最后一次的地址，等 Dialog 退出动画结束再清空。 */
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (url) setShown(url);
  }, [url]);

  return (
    <Dialog
      open={!!url}
      onClose={onClose}
      maxWidth={false}
      TransitionProps={{ onExited: () => setShown(null) }}
      PaperProps={{ sx: { borderRadius: "20px", p: 3, width: 360, maxWidth: "92vw" } }}
    >
      {shown && (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
          <Box sx={{
            p: 1.75, borderRadius: "16px", bgcolor: "#fff", border: "1px solid #EEF3FB",
            boxShadow: "0 10px 28px -18px rgba(15,23,42,0.25)",
          }}>
            <QRCodeSVG value={shown} size={232} level="M" marginSize={0} />
          </Box>
          <Typography sx={{ fontSize: 12.5, color: "#94A3B8", mt: 0.5 }}>
            用手机扫一扫，打开链接
          </Typography>
          <Typography sx={{
            fontSize: 11.5, color: "#64748B", wordBreak: "break-all", textAlign: "center",
            bgcolor: "#F6F8FC", borderRadius: "8px", px: 1.5, py: 1, width: "100%",
            maxHeight: 72, overflow: "hidden",
          }}>
            {shown}
          </Typography>
        </Box>
      )}
    </Dialog>
  );
}
