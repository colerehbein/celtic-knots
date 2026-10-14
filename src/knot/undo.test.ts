import { describe, expect, it, vi } from 'vitest';
import { KnotEditor } from './editor';
import { UndoStack } from './undo';

describe('UndoStack', () => {
  it('record/undo round-trips back to the recorded state', () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    expect(stack.undo('b')).toBe('a');
  });

  it('redo returns to the state undo left behind', () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    stack.undo('b');
    expect(stack.redo('a')).toBe('b');
  });

  it('canUndo/canRedo transition through the full cycle', () => {
    const stack = new UndoStack<string>();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);

    stack.record('a');
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);

    stack.undo('b');
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);

    stack.redo('a');
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it('a new record clears the redo stack', () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    stack.undo('b');
    expect(stack.canRedo()).toBe(true);

    stack.record('b2');
    expect(stack.canRedo()).toBe(false);
    expect(stack.undo('c')).toBe('b2');
  });

  it('undo on an empty stack returns null and records nothing to redo', () => {
    const stack = new UndoStack<string>();
    expect(stack.undo('b')).toBeNull();
    expect(stack.canRedo()).toBe(false);
  });

  it('redo on an empty redo stack returns null and records nothing to undo', () => {
    const stack = new UndoStack<string>();
    expect(stack.redo('a')).toBeNull();
    expect(stack.canUndo()).toBe(false);
  });

  it('clear() empties both stacks', () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    stack.undo('b');
    expect(stack.canRedo()).toBe(true);

    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.undo('x')).toBeNull();
  });

  it('capacity drops the oldest entry when exceeded', () => {
    const stack = new UndoStack<number>(3);
    stack.record(1);
    stack.record(2);
    stack.record(3);
    stack.record(4); // 1 is dropped

    expect(stack.undo(4)).toBe(4);
    expect(stack.undo(4)).toBe(3);
    expect(stack.undo(3)).toBe(2);
    expect(stack.undo(2)).toBeNull();
  });

  it('capacity defaults to 50', () => {
    const stack = new UndoStack<number>();
    for (let i = 0; i < 60; i++) {
      stack.record(i);
    }
    // Only the newest 50 (10..59) are undoable; the oldest kept is 10.
    for (let expected = 59; expected >= 10; expected--) {
      expect(stack.undo(expected)).toBe(expected);
    }
    expect(stack.canUndo()).toBe(false);
  });

  it('undo shuttles each current state onto the redo stack in order', () => {
    const stack = new UndoStack<string>();
    stack.record('v1');
    stack.record('v2');
    expect(stack.undo('v3')).toBe('v2');
    expect(stack.redo('v2')).toBe('v3');
    expect(stack.undo('v3')).toBe('v2');
    expect(stack.undo('v2')).toBe('v1');
    expect(stack.canUndo()).toBe(false);
  });
});

// ---- editor integration ----

/** Minimal canvas context stub: every method is a spy (tiles.test.ts pattern). */
function makeCtx(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'fillRect',
    'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'arc',
  ];
  for (const m of methods) {
    target[m] = vi.fn();
  }
  return target as unknown as CanvasRenderingContext2D;
}

function makeCanvas(): HTMLCanvasElement {
  const target: Record<string, unknown> = {
    width: 600,
    height: 500,
    getContext: () => makeCtx(),
    addEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }),
  };
  return target as unknown as HTMLCanvasElement;
}

describe('KnotEditor undo/redo', () => {
  it('undo with an empty stack returns false', () => {
    const editor = new KnotEditor(makeCanvas());
    expect(editor.canUndo()).toBe(false);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
  });

  it('randomize then undo/redo restores the exact engine states', () => {
    const editor = new KnotEditor(makeCanvas());
    const before = editor.getEngine().serialize();

    editor.randomizePattern(42);
    const randomized = editor.getEngine().serialize();
    expect(JSON.stringify(randomized)).not.toBe(JSON.stringify(before));

    expect(editor.canUndo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getEngine().serialize()).toEqual(before);

    expect(editor.canRedo()).toBe(true);
    expect(editor.redo()).toBe(true);
    expect(editor.getEngine().serialize()).toEqual(randomized);

    // After redo there is nothing further to redo.
    expect(editor.redo()).toBe(false);
  });

  it('undo unwinds multiple randomizations in order', () => {
    const editor = new KnotEditor(makeCanvas());
    const first = editor.getEngine().serialize();

    editor.randomizePattern(1);
    const second = editor.getEngine().serialize();
    editor.randomizePattern(2);
    const third = editor.getEngine().serialize();

    expect(editor.undo()).toBe(true);
    expect(editor.getEngine().serialize()).toEqual(second);
    expect(editor.undo()).toBe(true);
    expect(editor.getEngine().serialize()).toEqual(first);
    expect(editor.undo()).toBe(false);
    expect(editor.getEngine().serialize()).toEqual(first);

    expect(editor.redo()).toBe(true);
    expect(editor.getEngine().serialize()).toEqual(second);
    expect(editor.redo()).toBe(true);
    expect(editor.getEngine().serialize()).toEqual(third);
    expect(editor.redo()).toBe(false);
  });

  it('border changes are undoable and a new mutation clears the redo stack', () => {
    const editor = new KnotEditor(makeCanvas());
    const before = editor.getEngine().serialize();

    editor.closeBorder();
    const closed = editor.getEngine().serialize();
    expect(JSON.stringify(closed)).not.toBe(JSON.stringify(before));

    editor.undo();
    expect(editor.getEngine().serialize()).toEqual(before);
    expect(editor.canRedo()).toBe(true);

    // A fresh mutation invalidates redo.
    editor.openBorder();
    expect(editor.canRedo()).toBe(false);
    editor.undo();
    expect(editor.getEngine().serialize()).toEqual(before);
  });

  it('resetPattern is undoable', () => {
    const editor = new KnotEditor(makeCanvas());
    editor.randomizePattern(7);
    const randomized = editor.getEngine().serialize();

    editor.resetPattern();
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(editor.getEngine().serialize()).toEqual(randomized);
  });
});
