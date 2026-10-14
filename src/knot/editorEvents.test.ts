import { describe, expect, it, vi } from 'vitest';
import { KnotEditor } from './editor';
import { CutParityEngine } from './engines/cutParity';
import type { EditorHit, KnotEngine } from './engines/types';

// ---- stub canvas -----------------------------------------------------------

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

/**
 * A canvas that records the listeners bound to it instead of using the real
 * DOM, so tests can drive the editor's state machine directly. The rect sits
 * at the page origin, so page coordinates equal canvas coordinates plus
 * OUTPUT_OFFSET ({ x: 15, y: 10 }).
 */
function makeCanvas(): {
  canvas: HTMLCanvasElement;
  listeners: Map<string, (event: unknown) => void>;
  setPointerCapture: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, (event: unknown) => void>();
  const setPointerCapture = vi.fn();
  const target: Record<string, unknown> = {
    width: 600,
    height: 500,
    getContext: () => makeCtx(),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, fn);
    },
    setPointerCapture,
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500,
    }),
  };
  return { canvas: target as unknown as HTMLCanvasElement, listeners, setPointerCapture };
}

/** Dispatch a synthetic PointerEvent-ish object at a page position. */
function fire(
  listeners: Map<string, (event: unknown) => void>,
  type: string,
  pageX?: number,
  pageY?: number,
  pointerId = 1,
): void {
  const listener = listeners.get(type);
  if (listener === undefined) {
    throw new Error(`no listener bound for "${type}"`);
  }
  listener({ pageX, pageY, pointerId });
}

/**
 * A deep snapshot of the cut grid. `getCuts()` hands back the engine's live
 * array, so callers comparing before/after state must copy it themselves —
 * comparing the live array against itself would always pass.
 */
function cutsOf(engine: KnotEngine): number[][] {
  return (engine as CutParityEngine).getCuts().map((row) => [...row]);
}

// ---- node positions (page coordinates) -------------------------------------
//
// getVisualNodeCenter(s, row, column) = { x: column * 60 + (row % 2) * 30,
// y: row * 30 } for the default cellSize of 30; page = canvas + OUTPUT_OFFSET.

const NODE_A = { row: 0, column: 0, pageX: 15, pageY: 10 };
const NODE_B = { row: 0, column: 2, pageX: 135, pageY: 10 };
/** Inside the canvas but outside the knotwork: hitTest resolves it to null. */
const EMPTY = { pageX: 515, pageY: 410 };

describe('KnotEditor pointer events', () => {
  it('binds pointer events, not mouse events', () => {
    const { canvas, listeners } = makeCanvas();
    new KnotEditor(canvas);

    expect([...listeners.keys()].sort()).toEqual([
      'pointercancel', 'pointerdown', 'pointermove', 'pointerup',
    ]);
    expect(listeners.has('mousemove')).toBe(false);
    expect(listeners.has('click')).toBe(false);
  });

  it('captures the pointer on press so drags track outside the canvas', () => {
    const { canvas, listeners, setPointerCapture } = makeCanvas();
    new KnotEditor(canvas);

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY, 7);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('a plain click selects the node instead of toggling it off', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointerup', NODE_A.pageX, NODE_A.pageY);

    // The whole point of the same-hit skip: down selects, up does not undo it.
    expect(editor.getEngine().ui.selectedNode).toEqual({ row: NODE_A.row, column: NODE_A.column });
  });

  it('fires engine.onClick exactly once for a plain click', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const engine = editor.getEngine();
    const onClick = vi.spyOn(engine, 'onClick');

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointerup', NODE_A.pageX, NODE_A.pageY);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(
      { node: { row: NODE_A.row, column: NODE_A.column } },
      expect.objectContaining({ cellSize: 30 }),
    );
  });

  it('clicking a second node applies the cut between them', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const before = cutsOf(editor.getEngine());

    // First click selects A; second click on B cuts A-B.
    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointerup', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointerdown', NODE_B.pageX, NODE_B.pageY);
    fire(listeners, 'pointerup', NODE_B.pageX, NODE_B.pageY);

    expect(cutsOf(editor.getEngine())).not.toEqual(before);
    expect(editor.getEngine().ui.selectedNode).toBeNull();
    expect(editor.canUndo()).toBe(true);
  });

  it('a drag from one node to another applies the cut on release', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const before = cutsOf(editor.getEngine());

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointermove', NODE_B.pageX, NODE_B.pageY);
    fire(listeners, 'pointerup', NODE_B.pageX, NODE_B.pageY);

    expect(cutsOf(editor.getEngine())).not.toEqual(before);
  });

  it('a drag to empty space deselects, matching a click on empty space', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    expect(editor.getEngine().ui.selectedNode).not.toBeNull();

    fire(listeners, 'pointerup', EMPTY.pageX, EMPTY.pageY);
    expect(editor.getEngine().ui.selectedNode).toBeNull();
  });

  it('pointer travel under the drag threshold is still a plain click', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const engine = editor.getEngine();
    const onClick = vi.spyOn(engine, 'onClick');

    // A hand jittering by a pixel or two must not turn a click into a drag.
    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointerup', NODE_A.pageX + 2, NODE_A.pageY + 1);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(engine.ui.selectedNode).toEqual({ row: NODE_A.row, column: NODE_A.column });
  });

  it('clicking empty space selects nothing, on down and on up', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);

    fire(listeners, 'pointerdown', EMPTY.pageX, EMPTY.pageY);
    fire(listeners, 'pointerup', EMPTY.pageX, EMPTY.pageY);

    expect(editor.getEngine().ui.selectedNode).toBeNull();
  });

  it('updates hover on pointermove with no button held', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const engine = editor.getEngine();
    const updateHover = vi.spyOn(engine, 'updateHover');

    fire(listeners, 'pointermove', NODE_B.pageX, NODE_B.pageY);

    expect(updateHover).toHaveBeenCalledTimes(1);
    const hit = updateHover.mock.calls[0][0] as EditorHit | null;
    expect(hit).toEqual({ node: { row: NODE_B.row, column: NODE_B.column } });
    expect(engine.ui.hoverNode).toEqual({ row: NODE_B.row, column: NODE_B.column });
  });

  it('keeps previewing hover across a drag, so the target node is highlighted', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const engine = editor.getEngine();

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointermove', NODE_B.pageX, NODE_B.pageY);

    expect(engine.ui.selectedNode).toEqual({ row: NODE_A.row, column: NODE_A.column });
    expect(engine.ui.hoverNode).toEqual({ row: NODE_B.row, column: NODE_B.column });
  });

  it('pointercancel mid-drag applies no cut and clears the gesture', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const engine = editor.getEngine();
    const before = cutsOf(engine);

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointermove', NODE_B.pageX, NODE_B.pageY);
    fire(listeners, 'pointercancel');

    expect(cutsOf(engine)).toEqual(before);

    // The cancelled gesture is fully dropped: a stray release does nothing.
    fire(listeners, 'pointerup', NODE_B.pageX, NODE_B.pageY);
    expect(cutsOf(engine)).toEqual(before);
    expect(engine.ui.selectedNode).toEqual({ row: NODE_A.row, column: NODE_A.column });
  });

  it('ignores a release from a pointer that never pressed on this canvas', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const engine = editor.getEngine();
    const onClick = vi.spyOn(engine, 'onClick');

    fire(listeners, 'pointerup', NODE_B.pageX, NODE_B.pageY, 99);

    expect(onClick).not.toHaveBeenCalled();
    expect(engine.ui.selectedNode).toBeNull();
  });

  it('tracks only the pointer that pressed, ignoring other pointer ids', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const engine = editor.getEngine();
    const onClick = vi.spyOn(engine, 'onClick');

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY, 1);
    // A second finger releasing must not complete the first finger's drag.
    fire(listeners, 'pointerup', NODE_B.pageX, NODE_B.pageY, 2);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(engine.ui.selectedNode).toEqual({ row: NODE_A.row, column: NODE_A.column });
  });

  it('records an undo step for a drag-cut, and unwinds it', () => {
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const before = cutsOf(editor.getEngine());

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointerup', NODE_B.pageX, NODE_B.pageY);
    expect(editor.canUndo()).toBe(true);

    expect(editor.undo()).toBe(true);
    expect(cutsOf(editor.getEngine())).toEqual(before);
  });
});

// ---- Engine B safety -------------------------------------------------------

describe('side-state engine double-application safety', () => {
  it('a down/up on the same edge bumps exactly once through the editor', () => {
    // The editor constructs CutParityEngine internally, so prove the guard at
    // the editor level: engine.onClick must fire once for a same-spot
    // press/release, whatever engine sits behind it.
    const { canvas, listeners } = makeCanvas();
    const editor = new KnotEditor(canvas);
    const onClick = vi.spyOn(editor.getEngine(), 'onClick');

    fire(listeners, 'pointerdown', NODE_A.pageX, NODE_A.pageY);
    fire(listeners, 'pointerup', NODE_A.pageX, NODE_A.pageY);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
