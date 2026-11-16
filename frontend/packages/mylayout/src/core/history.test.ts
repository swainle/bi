import { describe, it, expect } from 'vitest';
import { HistoryManager, MoveCommand } from '../core/history';

describe('HistoryManager', () => {
  it('executes and can undo', () => {
    const history = new HistoryManager();
    let x = 0;
    const setPos = (_: string, val: number) => { x = val; };

    const cmd = new MoveCommand(
      'card1',
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      (id, nx) => setPos(id, nx),
    );

    history.execute(cmd);
    expect(x).toBe(5);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    history.undo();
    expect(x).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(x).toBe(5);
  });

  it('new command clears redo stack', () => {
    const history = new HistoryManager();
    let x = 0;
    const cmd1 = new MoveCommand('a', { x: 0, y: 0 }, { x: 1, y: 0 }, (_, nx) => { x = nx; });
    const cmd2 = new MoveCommand('a', { x: 1, y: 0 }, { x: 2, y: 0 }, (_, nx) => { x = nx; });

    history.execute(cmd1);
    history.undo();
    expect(history.canRedo).toBe(true);
    history.execute(cmd2);
    expect(history.canRedo).toBe(false); // redo cleared
  });

  it('trims to maxSize', () => {
    const history = new HistoryManager(3);
    let x = 0;
    for (let i = 0; i < 5; i++) {
      history.execute(new MoveCommand('a', { x: i, y: 0 }, { x: i + 1, y: 0 }, (_, nx) => { x = nx; }));
    }
    expect(history.undoDepth).toBe(3);
  });
});
