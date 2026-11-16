/** 画布顶栏 —— 返回 / 标题 / 卡片数 / 未保存 / 发布 / 保存 */

import { Box, Button, Typography } from "@mui/material";

interface Props {
  name: string;
  cards: number;
  dirty: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
  onPublish: () => void;
}

export default function BoardHeader({
  name, cards, dirty, saving, onBack, onSave, onPublish,
}: Props) {
  return (
    <Box sx={{
      px: 2.5, py: 1.25, display: "flex", alignItems: "center", gap: 2,
      bgcolor: "#fff", borderBottom: "1px solid #EEF3FB",
    }}>
      <Typography
        onClick={onBack}
        sx={{ fontSize: 12.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600 }}
      >
        ← 组件库
      </Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{name}</Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.disabled" }}>
        {cards} 张卡 · 从右侧拖图表类型进来
      </Typography>
      <Box sx={{ flex: 1 }} />
      {dirty && <Typography sx={{ fontSize: 11.5, color: "#F59E0B" }}>未保存</Typography>}
      <Button
        size="small" variant="outlined" disabled={saving || cards === 0} onClick={onPublish}
        sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2 }}
      >
        发布到我的看板
      </Button>
      <Button
        size="small" variant="contained" disabled={!dirty || saving} onClick={onSave}
        sx={{ bgcolor: "#4F46E5", textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2.5 }}
      >
        {saving ? "保存中..." : "保存"}
      </Button>
    </Box>
  );
}
