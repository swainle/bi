/** 数据大屏编辑器 — 全屏模式、自动轮播、动画装饰 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Typography, IconButton, Chip, Paper } from "@mui/material";
import { Fullscreen, FullscreenExit, PlayArrow, Pause } from "@mui/icons-material";
import ReactEChartsCore from "echarts-for-react";
import type { DataRow, ChartPanel } from "./constants";

const COLORS = ["#6366F1", "#F59E0B", "#10B981", "#EC4899", "#8B5CF6", "#0EA5E9"];

function fmt(v: number): string {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + "亿";
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + "万";
  return v.toLocaleString();
}

interface BigScreenProps {
  rows: DataRow[];
  panels: ChartPanel[];
  title: string;
  onClose: () => void;
}

export default function BigScreen({ rows, panels, title, onClose }: BigScreenProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [timeStr, setTimeStr] = useState("");

  // 实时时钟
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      setTimeStr(now.toLocaleString("zh-CN", { hour12: false }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // 自动轮播
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!autoPlay) return;
    timerRef.current = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % panels.length);
    }, 8000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoPlay, panels.length]);

  // ECharts option 构建
  const getOption = useCallback((panel: ChartPanel) => {
    const xData = rows.map(r => String(r[panel.xField] || ""));
    const yData = rows.map(r => Number(r[panel.yField]) || 0);

    if (panel.type === "number") {
      const val = yData.reduce((a, b) => a + b, 0);
      return {
        graphic: { type: "text", left: "center", top: "center",
          style: { text: fmt(val), fontSize: 64, fontWeight: 700, fill: "#FFFFFF", textShadowColor: "rgba(99,102,241,0.3)", textShadowBlur: 20 } },
      };
    }
    if (panel.type === "pie") {
      return {
        backgroundColor: "transparent",
        series: [{ type: "pie", radius: ["40%", "70%"],
          data: rows.map((r, i) => ({ name: String(r[panel.xField] || ""), value: Number(r[panel.yField]) || 0, itemStyle: { color: COLORS[i % COLORS.length] } })),
          label: { color: "#E5E7EB", fontSize: 12 },
        }],
      };
    }
    return {
      backgroundColor: "transparent",
      grid: { left: 60, right: 20, top: 20, bottom: 40 },
      toolbox: { feature: { brush: { type: ["rect", "clear"] } }, right: 20, top: 10 },
      brush: { toolbox: ["rect", "clear"], xAxisIndex: 0 },
      xAxis: { type: "category", data: xData, axisLabel: { color: "#9CA3AF", fontSize: 12 }, axisLine: { lineStyle: { color: "#374151" } } },
      yAxis: { type: "value", axisLabel: { color: "#9CA3AF" }, splitLine: { lineStyle: { color: "#1F2937" } } },
      series: [{ data: yData, type: panel.type, smooth: true, symbolSize: 8, itemStyle: { color: COLORS[currentSlide % COLORS.length] }, areaStyle: panel.type === "line" ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "#6366F140" }, { offset: 1, color: "#6366F105" }] } } : undefined }],
    };
  }, [rows]);

  const panel = panels[currentSlide];
  if (!panel) return null;

  return (
    <Box sx={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "linear-gradient(135deg, #0F172A 0%, #1E293B 40%, #0F172A 100%)",
      display: "flex", flexDirection: "column",
    }}>
      {/* 顶部栏 */}
      <Box sx={{
        display: "flex", alignItems: "center", px: 4, py: 2,
        background: "linear-gradient(180deg, rgba(0,0,0,0.4), transparent)",
      }}>
        <Typography variant="h5" fontWeight={700} color="#FFFFFF" letterSpacing={2} sx={{ textShadow: "0 0 30px rgba(99,102,241,0.4)" }}>
          {title}
        </Typography>
        <Chip label={timeStr} size="small" sx={{ ml: 2, color: "#E5E7EB", bgcolor: "rgba(255,255,255,0.08)", fontSize: 13, fontFamily: "monospace" }} />
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => setAutoPlay(!autoPlay)} sx={{ color: "#E5E7EB", mr: 1 }}>
          {autoPlay ? <Pause /> : <PlayArrow />}
        </IconButton>
        <Typography color="#9CA3AF" fontSize={12} sx={{ mr: 2 }}>{currentSlide + 1} / {panels.length}</Typography>
        <IconButton onClick={onClose} sx={{ color: "#E5E7EB" }}><FullscreenExit /></IconButton>
      </Box>

      {/* 图表区域 */}
      <Box sx={{ flex: 1, p: 4, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      {/* 装饰粒子背景 */}
      {[...Array(30)].map((_, i) => (
        <Box key={i} sx={{
          position: "absolute",
          width: i % 5 === 0 ? 2 : 3, height: i % 5 === 0 ? 2 : 3,
          borderRadius: "50%",
          background: COLORS[i % COLORS.length],
          top: `${Math.sin(i * 1.7) * 40 + 50}%`, left: `${Math.cos(i * 1.3) * 40 + 50}%`,
          opacity: 0.15 + (i % 3) * 0.1,
          animation: `pulse${i % 3} ${2 + Math.random() * 2}s infinite alternate`,
        }} />
      ))}
      {/* 边框流光 */}
      <Box sx={{ position: "absolute", inset: 20, border: "1px solid rgba(99,102,241,0.15)", borderRadius: 3, pointerEvents: "none" }} />
      <Box sx={{ position: "absolute", inset: 30, border: "1px solid rgba(99,102,241,0.08)", borderRadius: 3, pointerEvents: "none" }} />
        <Box sx={{ width: "85%", height: "80%", animation: "fadeIn 0.5s ease", "@keyframes fadeIn": { from: { opacity: 0, transform: "translateY(20px)" }, to: { opacity: 1, transform: "translateY(0)" } } }}>
          <Typography variant="h6" color="#9CA3AF" textAlign="center" mb={2} fontWeight={600}>{panel.title}</Typography>
          <ReactEChartsCore key={currentSlide} option={getOption(panel)} style={{ height: "100%" }} />
        </Box>
      </Box>

      {/* 底部缩略导航 */}
      <Box sx={{ display: "flex", justifyContent: "center", gap: 1, pb: 3 }}>
        {panels.map((p, i) => (
          <Box key={p.id} onClick={() => { setCurrentSlide(i); setAutoPlay(false); }}
            sx={{
              width: 40, height: 3, borderRadius: 2, cursor: "pointer",
              bgcolor: i === currentSlide ? "#6366F1" : "#374151",
              transition: "all 0.3s",
              "&:hover": { bgcolor: "#818CF8" },
            }} />
        ))}
      </Box>
    </Box>
  );
}
