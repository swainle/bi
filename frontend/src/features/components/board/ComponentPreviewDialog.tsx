/** 组件放大预览 —— 组件库点卡片后弹大图，方便看清细节后再决定用不用 */

import { Box, Dialog, IconButton, Typography } from "@mui/material";
import { Close } from "@mui/icons-material";
import PreviewThumb from "./PreviewThumb";
import { KIND_LABEL } from "../registry";
import { sizeOfKind } from "../sizes";
import type { ComponentItem, RenderPayload } from "../types";

/** 弹窗内容区可用尺寸：宽 = 1120 - 左右内边距，高固定留一点余量 */
const STAGE_W = 1072;
const STAGE_H = 520;

interface Props {
  item: ComponentItem | null;
  payload?: RenderPayload | null;
  onClose: () => void;
}

export default function ComponentPreviewDialog({ item, payload, onClose }: Props) {
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: "min(1120px, 92vw)",
          maxHeight: "90vh",
          borderRadius: "20px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {item && (
        <>
          <Box sx={{ px: 3, pt: 2.25, pb: 1.75, display: "flex", alignItems: "flex-start", gap: 1.5, flexShrink: 0 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 600, color: "#0F172A" }}>{item.name}</Typography>
              <Typography noWrap sx={{ fontSize: 11.5, color: "text.disabled", mt: 0.25 }}>
                {[KIND_LABEL[item.kind], item.category, item.description].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <IconButton
              size="small" onClick={onClose}
              sx={{ color: "text.disabled", "&:hover": { color: "#0F172A" } }}
            >
              <Close sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
          <Box sx={{ px: 3, pb: 3, flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center" }}>
            {(() => {
              const sz = sizeOfKind(item.kind);
              return (
                <Box sx={{ borderRadius: "16px", overflow: "hidden", border: "1px solid #EEF3FB", bgcolor: "#FBFCFE" }}>
                  <PreviewThumb
                    item={item} payload={payload} full
                    fit={{ w: sz.w, h: sz.h, maxW: STAGE_W, maxH: STAGE_H }}
                  />
                </Box>
              );
            })()}
          </Box>
        </>
      )}
    </Dialog>
  );
}
