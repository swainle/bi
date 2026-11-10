// @mylayout/core — 核心模块入口
export { GridSystem } from './grid';
export { HistoryManager, MoveCommand, BatchMoveCommand } from './history';
export { SpatialHash, rectIntersection, rectContains } from '../utils/collision';
export { computeSnap } from '../utils/snap';
export type { Command } from '../types';
