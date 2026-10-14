import { describe, expect, it, vi } from 'vitest';
import { REVEAL_PER_CELL_MS, prefersReducedMotion, revealSchedule } from './reveal';
import { KnotEditor } from './editor';
import { CutParityEngine } from './engines/cutParity';
import { SideStateEngine } from './engines/sideState';
import { DEFAULT_SETTINGS } from './types';

// ---- canvas stub (tiles.test.ts / undo.test.ts pattern) --------------------

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

const ROWS = 12;
const COLUMNS = 12;
const TOTAL_CELLS = ROWS * COLUMNS;
const REVEAL_CELLS = 5;

function revealSettings() {
  return { ...DEFAULT_SETTINGS, rows: ROWS, columns: COLUMNS, animate: false };
}

// ---- the schedule ----------------------------------------------------------

describe('revealSchedule', () => {
  it('shows one cell at time zero', () => {
    expect(revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, 0)).toBe(1);
  });

  it('reveals one more cell per perCellMs', () => {
    expect(revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, 0)).toBe(1);
    expect(revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, REVEAL_PER_CELL_MS)).toBe(2);
    expect(revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, REVEAL_PER_CELL_MS * 3)).toBe(4);
    expect(revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, REVEAL_PER_CELL_MS * 41)).toBe(42);
  });

  it('holds a boundary count until the next tick', () => {
    // 16ms with an 8ms pace is exactly two intervals: the third cell shows.
    expect(revealSchedule(TOTAL_CELLS, 8, 16)).toBe(3);
    expect(revealSchedule(TOTAL_CELLS, 8, 15)).toBe(2);
    expect(revealSchedule(TOTAL_CELLS, 8, 17)).toBe(3);
  });

  it('clamps at the total once elapsed runs past the full reveal', () => {
    const fullDuration = REVEAL_PER_CELL_MS * TOTAL_CELLS;
    expect(revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, fullDuration)).toBe(TOTAL_CELLS);
    expect(revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, fullDuration * 10)).toBe(TOTAL_CELLS);
  });

  it('reveals nothing for an empty grid', () => {
    expect(revealSchedule(0, REVEAL_PER_CELL_MS, 0)).toBe(0);
    expect(revealSchedule(0, REVEAL_PER_CELL_MS, 10_000)).toBe(0);
  });

  it('is monotonic in elapsed time', () => {
    let previous = 0;
    for (let elapsed = 0; elapsed <= REVEAL_PER_CELL_MS * TOTAL_CELLS; elapsed += REVEAL_PER_CELL_MS / 2) {
      const count = revealSchedule(TOTAL_CELLS, REVEAL_PER_CELL_MS, elapsed);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
    expect(previous).toBe(TOTAL_CELLS);
  });
});

// ---- reduced motion --------------------------------------------------------

describe('prefersReducedMotion', () => {
  it('is false in Node, where there is no matchMedia', () => {
    // The contract: this is a browser-only question, and the node default
    // is "no reduced motion", so tests never take the animation path.
    expect(typeof window).toBe('undefined');
    expect(prefersReducedMotion()).toBe(false);
  });
});

// ---- engine revealCells ----------------------------------------------------

/**
 * A recording context: the ordered log of every method call. The reveal is
 * a prefix property — drawing only the first N cells must reproduce the
 * full call stream exactly up to the cut-off and nothing after it — so an
 * ordered log proves both "fewer draws" and "same draws, same order"
 * without counting through the tile wrappers' own save/translate calls.
 */
function makeRecordingCtx(): { ctx: CanvasRenderingContext2D; events: string[] } {
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'fillRect',
    'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'arc',
  ];
  const target: Record<string, unknown> = {};
  const events: string[] = [];
  for (const m of methods) {
    target[m] = vi.fn(() => {
      events.push(m);
    });
  }
  return { ctx: target as unknown as CanvasRenderingContext2D, events };
}

function renderLog(
  engine: CutParityEngine | SideStateEngine,
  revealCells?: number,
): string[] {
  const { ctx, events } = makeRecordingCtx();
  engine.render(ctx, revealSettings(), revealCells);
  return events;
}

describe('engine render revealCells', () => {
  it('cut-parity draws a strict prefix of the full stream', () => {
    const engine = new CutParityEngine();
    engine.resize(ROWS, COLUMNS);
    engine.randomize(1);

    const full = renderLog(engine);
    const partial = renderLog(engine, REVEAL_CELLS);
    const whole = renderLog(engine, TOTAL_CELLS);
    const first = renderLog(engine, 1);

    expect(full.length).toBeGreaterThan(0); // it really drew
    expect(partial.length).toBeLessThan(full.length);
    expect(full.slice(0, partial.length)).toEqual(partial);
    expect(first.length).toBeLessThan(partial.length);
    // The budget is a cell count, so "all cells" is exactly the old render.
    expect(whole).toEqual(full);
  });

  it('side-state draws a strict prefix of the full stream', () => {
    const engine = new SideStateEngine(ROWS, COLUMNS);
    engine.randomize(1);

    const full = renderLog(engine);
    const partial = renderLog(engine, REVEAL_CELLS);
    const whole = renderLog(engine, TOTAL_CELLS);
    const first = renderLog(engine, 1);

    expect(full.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(full.length);
    expect(full.slice(0, partial.length)).toEqual(partial);
    expect(first.length).toBeLessThan(partial.length);
    expect(whole).toEqual(full);
  });

  it('an omitted revealCells draws every cell (the old behaviour)', () => {
    const engine = new CutParityEngine();
    engine.resize(ROWS, COLUMNS);
    engine.randomize(1);

    expect(renderLog(engine)).toEqual(renderLog(engine, TOTAL_CELLS));
  });
});

// ---- the editor ------------------------------------------------------------

describe('animate setting', () => {
  it('is off in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.animate).toBe(false);
  });

  it('is off on a freshly constructed editor', () => {
    const editor = new KnotEditor(makeCanvas());
    expect(editor.isAnimatingEnabled()).toBe(false);
  });

  it('toggles through showAnimation', () => {
    const editor = new KnotEditor(makeCanvas());
    editor.showAnimation(true);
    expect(editor.isAnimatingEnabled()).toBe(true);
    editor.showAnimation(false);
    expect(editor.isAnimatingEnabled()).toBe(false);
  });

  it('reports the grid cell count', () => {
    const editor = new KnotEditor(makeCanvas());
    expect(editor.getTotalCells()).toBe(TOTAL_CELLS);
    editor.setKnotworkSize(8, 6);
    expect(editor.getTotalCells()).toBe(48);
  });
});

describe('randomizePattern with animation off', () => {
  it('produces the same pattern as any other randomize (no behaviour change)', () => {
    const a = new KnotEditor(makeCanvas());
    const b = new KnotEditor(makeCanvas());

    a.randomizePattern(42);
    b.randomizePattern(42);

    expect(JSON.stringify(a.getPattern())).toBe(JSON.stringify(b.getPattern()));
    expect(a.canUndo()).toBe(true);
  });

  it('never enters the animation path in Node, even with the toggle on', () => {
    // requestAnimationFrame does not exist here, so `shouldAnimateRandomize`
    // must bail out and randomize must stay a synchronous full render.
    expect(typeof requestAnimationFrame).toBe('undefined');

    const animated = new KnotEditor(makeCanvas());
    animated.showAnimation(true);
    animated.randomizePattern(42);

    const instant = new KnotEditor(makeCanvas());
    instant.randomizePattern(42);

    expect(JSON.stringify(animated.getPattern())).toBe(JSON.stringify(instant.getPattern()));
  });
});
