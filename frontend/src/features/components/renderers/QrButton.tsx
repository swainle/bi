/** 明细表「链接」列：单元格是一个按钮，点开看这一行的二维码.
 *
 * 二维码用 `qrcode.react` 的 SVG 版本（依赖里本来就有），不引新包、不请求外部服务。
 * 弹窗走 MUI Dialog（portal 到 body），画布缩放不影响显示。
 */

import { useState } from "react";
import { Button, Dialog, DialogContent, Stack, Typography } from "@mui/material";
import { QrCode2 } from "@mui/icons-material";
import { QRCodeSVG } from "qrcode.react";

export default function QrButton({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const value = String(text ?? "").trim();
  if (!value) return <>—</>;
  return (
    <>
      <Button
        size="small"
        variant="text"
        data-qr-button={value}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        sx={{
          minWidth: 0, px: 1, py: 0, height: 22, gap: 0.5, fontSize: 11.5,
          borderRadius: "999px", bgcolor: "#EEF2FF", color: "#4F46E5",
          textTransform: "none", "&:hover": { bgcolor: "#E4E9FF" },
        }}
      >
        <QrCode2 sx={{ fontSize: 14 }} />
        二维码
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        onClick={(event) => event.stopPropagation()}
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogContent sx={{ pt: 3, pb: 2.5, px: 3 }}>
          <Stack spacing={1.5} alignItems="center">
            <QRCodeSVG value={value} size={188} level="M" marginSize={2} data-qr-code={value} />
            <Typography
              title={value}
              sx={{
                fontSize: 11.5, color: "#94A3B8", maxWidth: 260, wordBreak: "break-all",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}
            >
              {value}
            </Typography>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}
