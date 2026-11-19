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
      ctx.font = '13px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.055)';
      ctx.rotate(-20 * Math.PI / 180);

      // 斜向平铺：一行身份信息，截图裁切后仍能捞到完整文本
      for (let y = -260; y < canvas.height + 420; y += 150) {
        for (let x = -300; x < canvas.width + 420; x += 380) {
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
