import { describe, expect, it, vi } from 'vitest';
import { KnotEditor } from './editor';
import type { SideStateEngine } from './engines/sideState';

// ---- DOM stubs -----------------------------------------------------------

/** Minimal canvas context stub: every method is a spy (undo.test.ts pattern). */
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

/** Stable string form of an engine snapshot, for cross-engine comparison. */
function snap(editor: KnotEditor): string {
  return JSON.stringify(editor.getEngine().serialize());
}

/**
 * The node test environment has no DOM, so `toPNG` needs one installed for
 * the duration of a test: a canvas whose context is the usual spy set and
 * whose `toBlob` resolves with a non-empty blob.
 */
async function withExportDom(run: () => Promise<void>): Promise<void> {
  const previous = (globalThis as { document?: unknown }).document;
  const canvas = makeCanvas() as unknown as {
    toBlob: (callback: (blob: Blob | null) => void) => void;
  };
  canvas.toBlob = (callback) => {
    callback(new Blob(['\x89PNG\r\n\x1a\n'], { type: 'image/png' }));
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => canvas,
  };
  try {
    await run();
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
}

/**
 * The editor hands out `KnotEngine`, but this file needs the chip-carving
 * engine's own surface to prove the *incoming* engine really changed. The id
 * is the discriminator, and `getSides()` is engine-specific state.
 */
function sideStateOf(editor: KnotEditor): SideStateEngine {
  const engine = editor.getEngine();
  if (engine.id !== 'side-state') {
    throw new Error(`expected side-state engine, got ${engine.id}`);
  }
  return engine as SideStateEngine;
}

// ---- engine switching ----------------------------------------------------

describe('KnotEditor engine switching', () => {
  it('defaults to the cut-parity engine', () => {
    const editor = new KnotEditor(makeCanvas());
    expect(editor.getEngineId()).toBe('cut-parity');
    expect(editor.getEngine().id).toBe('cut-parity');
  });

  it('setEngine swaps the active engine', () => {
    const editor = new KnotEditor(makeCanvas());

    editor.setEngine('side-state');

    expect(editor.getEngineId()).toBe('side-state');
    expect(editor.getEngine().id).toBe('side-state');
    // getEngine() must report the same instance, or every delegated operation
    // (render, hitTest, onClick) would silently keep talking to Engine A.
    expect(editor.getEngine()).toBe(sideStateOf(editor));
  });

  it('switching to the already-active engine is a no-op', () => {
    const editor = new KnotEditor(makeCanvas());
    editor.randomizePattern(9);
    const before = editor.getEngine();
    const state = snap(editor);

    editor.setEngine('cut-parity');

    expect(editor.getEngine()).toBe(before);
    expect(snap(editor)).toBe(state);
    expect(editor.canUndo()).toBe(true);
  });

  it('randomize after a switch mutates the side-state engine', () => {
    const editor = new KnotEditor(makeCanvas());
    editor.setEngine('side-state');

    const before = snap(editor);
    editor.randomizePattern(42);

    const after = snap(editor);
    expect(after).not.toBe(before);
    // The change must live in the side-state grid, not in the idle Engine A.
    const sides = sideStateOf(editor).getSides();
    expect(sides).toHaveLength(editor.getGridHeight());
    expect(sides[0]).toHaveLength(editor.getGridWidth());
    expect(after).toContain('"sides"');
  });

  it('the newly switched engine is sized to the current grid', () => {
    const editor = new KnotEditor(makeCanvas(), { rows: 8, columns: 6 });

    editor.setEngine('side-state');

    const sides = sideStateOf(editor).getSides();
    expect(sides).toHaveLength(8);
    expect(sides[0]).toHaveLength(6);
  });

  it('keeps each engine its own pattern across a round trip', () => {
    const editor = new KnotEditor(makeCanvas());

    editor.randomizePattern(1);
    const cutParityState = snap(editor);

    editor.setEngine('side-state');
    const sideStateBefore = snap(editor);
    editor.randomizePattern(2);
    const sideStateAfter = snap(editor);
    expect(sideStateAfter).not.toBe(sideStateBefore);

    editor.setEngine('cut-parity');

    // Engine A is exactly where it was left, and Engine B kept its own edit.
    expect(editor.getEngineId()).toBe('cut-parity');
    expect(snap(editor)).toBe(cutParityState);

    editor.setEngine('side-state');
    expect(snap(editor)).toBe(sideStateAfter);
  });

  it('the two engines hold independent state, not a shared grid', () => {
    const editor = new KnotEditor(makeCanvas());

    editor.randomizePattern(3);
    const cutParityState = snap(editor);
    editor.setEngine('side-state');
    editor.randomizePattern(3);
    const sideStateState = snap(editor);

    // Same seed, different engines: the serialized shapes must differ outright.
    expect(sideStateState).not.toBe(cutParityState);
    expect(sideStateState).toContain('"sides"');
    expect(cutParityState).toContain('"cuts"');
  });
});

// ---- undo boundary -------------------------------------------------------

describe('engine switching clears the undo stack', () => {
  it('a switch leaves nothing to undo', () => {
    const editor = new KnotEditor(makeCanvas());
    editor.randomizePattern(5);
    expect(editor.canUndo()).toBe(true);

    editor.setEngine('side-state');

    // Snapshots are engine-specific JSON; undoing across the switch would
    // deserialize Engine A's shape into Engine B.
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
  });

  it('undo works normally again after a switch', () => {
    const editor = new KnotEditor(makeCanvas());

    editor.setEngine('side-state');
    editor.randomizePattern(6);
    const randomized = snap(editor);

    expect(editor.canUndo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(snap(editor)).not.toBe(randomized);
    expect(editor.redo()).toBe(true);
    expect(snap(editor)).toBe(randomized);
  });
});

// ---- resize propagation --------------------------------------------------

describe('resize propagation across engines', () => {
  it('setKnotworkSize after a switch sizes the active engine', () => {
    const editor = new KnotEditor(makeCanvas());
    editor.setEngine('side-state');

    editor.setKnotworkSize(10, 8);

    expect(editor.getGridHeight()).toBe(10);
    expect(editor.getGridWidth()).toBe(8);
    const sides = sideStateOf(editor).getSides();
    expect(sides).toHaveLength(10);
    expect(sides[0]).toHaveLength(8);

    const size = editor.getImageDimensions();
    expect(size.width).toBe(8 * editor.getCellSize());
    expect(size.height).toBe(10 * editor.getCellSize());
  });

  it('a switch back after a resize re-sizes the idle engine to the new grid', () => {
    const editor = new KnotEditor(makeCanvas());

    editor.setEngine('side-state');
    editor.setKnotworkSize(10, 8);
    editor.setEngine('cut-parity');
    editor.setKnotworkSize(6, 4);
    editor.setEngine('side-state');

    const sides = sideStateOf(editor).getSides();
    expect(sides).toHaveLength(6);
    expect(sides[0]).toHaveLength(4);
    expect(editor.getImageDimensions().width).toBe(4 * editor.getCellSize());
  });

  it('odd dimensions are still rounded up to an even grid', () => {
    const editor = new KnotEditor(makeCanvas());

    editor.setKnotworkSize(7, 5);

    expect(editor.getGridHeight()).toBe(8);
    expect(editor.getGridWidth()).toBe(6);
  });
});

// ---- regression: the whole surface still works after a switch ------------

describe('editor operations after switching engines', () => {
  it('randomize, reset, border and export all work on the side-state engine', async () => {
    await withExportDom(async () => {
      const editor = new KnotEditor(makeCanvas());
      editor.setEngine('side-state');

      editor.randomizePattern(11);
      const randomized = snap(editor);
      expect(randomized).not.toBe('');

      editor.resetPattern();
      expect(snap(editor)).not.toBe(randomized);
      expect(editor.canUndo()).toBe(true);
      editor.undo();
      expect(snap(editor)).toBe(randomized);

      // Border buttons stay enabled for both engines: closed boundary sides are
      // 0, open straight sides are 1.
      const before = snap(editor);
      editor.closeBorder();
      expect(snap(editor)).not.toBe(before);
      editor.openBorder();
      expect(snap(editor)).not.toBe(before);

      const blob = await editor.toPNG(2);
      expect(blob.size).toBeGreaterThan(0);
    });
  });

  it('the same operations still work after switching back to cut-parity', async () => {
    await withExportDom(async () => {
      const editor = new KnotEditor(makeCanvas());
      editor.setEngine('side-state');
      editor.randomizePattern(12);
      editor.setEngine('cut-parity');

      editor.randomizePattern(13);
      expect(snap(editor)).not.toBe('');
      editor.resetPattern();
      editor.closeBorder();
      editor.openBorder();

      const blob = await editor.toPNG();
      expect(blob.size).toBeGreaterThan(0);
      expect(editor.getEngineId()).toBe('cut-parity');
    });
  });

  it('selection/hover plumbing does not leak the outgoing engine state', () => {
    const editor = new KnotEditor(makeCanvas());

    editor.setEngine('side-state');
    editor.setEngine('cut-parity');

    // Hover and selection are engine-owned; after a switch they must come from
    // the new engine (its `ui`), and deselecting must not resurrect an undo
    // step belonging to the engine we left.
    editor.deselect();
    expect(editor.getEngineId()).toBe('cut-parity');
    expect(editor.getEngine().ui.selectedNode).toBeNull();
    expect(editor.canUndo()).toBe(false);
  });
});
