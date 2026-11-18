import { formatChinaTime } from "../utils/time";
// components/WatermarkOverlay.tsx — 数据水印叠加层
import { useEffect, useRef } from 'react';

interface Props {
  text?: string;
  /** 是否显示水印 */
  visible?: boolean;
}

/**
 * 数据水印叠加层
 * Canvas 绘制半透明重复文本，覆盖整个页面
 * pointer-events: none 不阻挡交互
 * 自适应窗口大小变化
 */
export default function WatermarkOverlay({ text, visible = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const watermarkText = text || `${formatChinaTime(new Date()).slice(0, 10)}`;

  useEffect(() => {
    if (!visible) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '14px -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
      ctx.rotate(-20 * Math.PI / 180);

      for (let y = -200; y < canvas.height + 400; y += 120) {
        for (let x = -200; x < canvas.width + 400; x += 250) {
          ctx.fillText(watermarkText, x, y);
        }
      }
    };

    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [watermarkText, visible]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
