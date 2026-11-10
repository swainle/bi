// @mylayout/core — Command Pattern 历史管理器
import type { Command } from '../types';

/**
 * Unix diff 风格的撤销/重做管理器
 *
 * 特性：
 * - 最大历史长度 50（可配置）
 * - 新操作自动清空 redo 栈
 * - execute/undo/redo 返回值表示是否成功
 */
export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  /** 执行一个命令并推入历史 */
  execute(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // 清空 redo
    this.trim();
  }

  /** 撤销 */
  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.trim();
    return true;
  }

  /** 重做 */
  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    this.trim();
    return true;
  }

  /** 能否撤销 */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 能否重做 */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 历史深度 */
  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** 清空历史 */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private trim(): void {
    while (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    while (this.redoStack.length > this.maxSize) {
      this.redoStack.shift();
    }
  }
}

/**
 * 移动命令
 */
export class MoveCommand implements Command {
  label = '移动';

  constructor(
    private cardId: string,
    private from: { x: number; y: number },
    private to: { x: number; y: number },
    private setPosition: (id: string, x: number, y: number) => void,
  ) {}

  execute(): void {
    this.setPosition(this.cardId, this.to.x, this.to.y);
  }

  undo(): void {
    this.setPosition(this.cardId, this.from.x, this.from.y);
  }
}

/**
 * 批量位置变更命令（用于自动排版等批量操作）
 */
export class BatchMoveCommand implements Command {
  label = '批量移动';

  constructor(
    private from: Map<string, { x: number; y: number }>,
    private to: Map<string, { x: number; y: number }>,
    private setPosition: (id: string, x: number, y: number) => void,
  ) {}

  execute(): void {
    for (const [id, pos] of this.to) {
      this.setPosition(id, pos.x, pos.y);
    }
  }

  undo(): void {
    for (const [id, pos] of this.from) {
      this.setPosition(id, pos.x, pos.y);
    }
  }
}
