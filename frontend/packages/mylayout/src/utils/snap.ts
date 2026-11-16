// @mylayout/core — 吸附计算模块
import type { SnapGuide, Rect, LayoutConfig } from '../types';
import { SpatialHash } from './collision';
import { DEFAULT_CONFIG } from './constants';

interface AdCard {
  id: string;
  rect: Rect;
}

/**
 * 6向吸附计算
 *
 * 吸附方向：
 * - 左对齐 (left):  移动卡片的左边对齐目标卡片的左边
 * - 右对齐 (right): 移动卡片的右边对齐目标卡片的右边
 * - 上对齐 (top):   移动卡片的顶边对齐目标卡片的顶边
 * - 下对齐 (bottom): 移动卡片的底边对齐目标卡片的底边
 * - 垂直居中 (vcenter): 移动卡片的垂直中心对齐目标卡片的垂直中心
 * - 水平居中 (hcenter): 移动卡片的水平中心对齐目标卡片的水平中心
 *
 * 优先级：边吸附 > 中心对齐 > 等间距标注
 */
export function computeSnap(
  movingCard: AdCard,
  allCards: AdCard[],
  hash: SpatialHash,
  config: Partial<LayoutConfig> = {},
): SnapGuide[] {
  const c = { ...DEFAULT_CONFIG, ...config };
  const threshold = c.snapThreshold;
  const guides: SnapGuide[] = [];
  const candidates = hash.query(movingCard.rect);

  const m = movingCard.rect;
  const mcx = m.x + m.w / 2;
  const mcy = m.y + m.h / 2;

  // 收集所有候选卡片的边界值
  const lefts: number[] = [];
  const rights: number[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];
  const hcenters: number[] = [];
  const vcenters: number[] = [];

  for (const id of candidates) {
    if (id === movingCard.id) continue;
    const card = allCards.find(d => d.id === id);
    if (!card) continue;

    const r = card.rect;
    lefts.push(r.x);
    rights.push(r.x + r.w);
    tops.push(r.y);
    bottoms.push(r.y + r.h);
    hcenters.push(r.x + r.w / 2);
    vcenters.push(r.y + r.h / 2);
  }

  // 1. 左对齐吸附
  const leftSnap = nearestWithin(m.x, lefts, threshold);
  if (leftSnap !== null) {
    guides.push(createLine('x', leftSnap, m.y, m.y + m.h));
  }

  // 2. 右对齐吸附
  const rightSnap = nearestWithin(m.x + m.w, rights, threshold);
  if (rightSnap !== null) {
    guides.push(createLine('x', rightSnap, m.y, m.y + m.h));
  }

  // 3. 顶对齐吸附
  const topSnap = nearestWithin(m.y, tops, threshold);
  if (topSnap !== null) {
    guides.push(createLine('y', topSnap, m.x, m.x + m.w));
  }

  // 4. 底对齐吸附
  const bottomSnap = nearestWithin(m.y + m.h, bottoms, threshold);
  if (bottomSnap !== null) {
    guides.push(createLine('y', bottomSnap, m.x, m.x + m.w));
  }

  // 5. 垂直中心对齐
  const hcenterSnap = nearestWithin(mcx, hcenters, threshold);
  if (hcenterSnap !== null) {
    guides.push(createLine('x', hcenterSnap, m.y, m.y + m.h));
  }

  // 6. 水平中心对齐
  const vcenterSnap = nearestWithin(mcy, vcenters, threshold);
  if (vcenterSnap !== null) {
    guides.push(createLine('y', vcenterSnap, m.x, m.x + m.w));
  }

  // 7. 等间距标注（标记相邻卡片间距）
    const hGapSnap = detectEqualGap(movingCard, allCards, 'h', threshold);
  guides.push(...hGapSnap);
  const vGapSnap = detectEqualGap(movingCard, allCards, 'v', threshold);
  guides.push(...vGapSnap);

  return deduplicateGuides(guides);
}

/** 在阈值范围内找最近值 */
function nearestWithin(value: number, targets: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const dist = Math.abs(value - t);
    if (dist <= threshold && dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }
  return best;
}

/** 检测等间距 */
function detectEqualGap(
  moving: AdCard,
  allCards: AdCard[],
  direction: 'h' | 'v',
  threshold: number,
): SnapGuide[] {
  const guides: SnapGuide[] = [];
  const isH = direction === 'h';

  for (const a of allCards) {
    for (const b of allCards) {
      if (a.id === b.id || a.id === moving.id || b.id === moving.id) continue;

      const aEdge = isH ? a.rect.x : a.rect.y;
      const bEdge = isH ? b.rect.x : b.rect.y;
      const abGap = Math.abs(aEdge - bEdge);

      const mAEdge = isH ? a.rect.x : a.rect.y;
      const mMEdge = isH ? moving.rect.x : moving.rect.y;
      const amGap = Math.abs(mAEdge - mMEdge);

      if (Math.abs(abGap - amGap) <= threshold && abGap > threshold) {
        // 标记交点位置（取中间值）
        const pos = (mAEdge + mMEdge) / 2;
        guides.push(createLine(isH ? 'x' : 'y', pos, 0, 0));
      }
    }
  }

  return guides;
}

function createLine(type: 'x' | 'y', pos: number, from: number, to: number): SnapGuide {
  return { type, pos, from, to };
}

/** 去重 + 合并重叠引导线 */
function deduplicateGuides(guides: SnapGuide[]): SnapGuide[] {
  const seen = new Map<string, SnapGuide>();
  for (const g of guides) {
    const key = `${g.type}:${Math.round(g.pos)}`;
    const existing = seen.get(key);
    if (existing) {
      existing.from = Math.min(existing.from, g.from);
      existing.to = Math.max(existing.to, g.to);
    } else {
      seen.set(key, { ...g });
    }
  }
  return Array.from(seen.values());
}
