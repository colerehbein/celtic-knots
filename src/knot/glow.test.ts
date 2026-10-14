import { describe, expect, it, vi } from 'vitest';
import { KnotEditor } from './editor';
import { CutParityEngine } from './engines/cutParity';
import { SideStateEngine } from './engines/sideState';
import { GLOW_OFF_BLUR, GLOW_OFF_COLOR, renderKnotwork } from './render';
import { DEFAULT_SETTINGS, type CutGrid } from './types';
import { computeCutDimensions, makeEmptyPattern } from './pattern';

// ---- recording canvas -----------------------------------------------------

/**
 * Canvas stub that records *property writes* as events, not just method
 * calls: the whole feature lives in `shadowColor` / `shadowBlur` writes, and
 * a plain writable property would swallow those silently.
 */
interface RecordingCtx {
  ctx: CanvasRenderingContext2D;
  /** Ordered log, e.g. `call:fill` or `shadowBlur:6`. */
  events: string[];
}

function makeRecordingCtx(): RecordingCtx {
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'fillRect',
    'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'arc',
  ];

  const target: Record<string, unknown> = {};
  const events: string[] = [];

  for (const m of methods) {
    target[m] = vi.fn(() => {
      events.push(`call:${m}`);
    });
  }
  Object.defineProperty(target, 'shadowColor', {
    get: () => '(unset)',
    set: (value: string) => {
      events.push(`shadowColor:${value}`);
    },
    configurable: true,
  });
  Object.defineProperty(target, 'shadowBlur', {
    get: () => -1,
    set: (value: number) => {
      events.push(`shadowBlur:${value}`);
    },
    configurable: true,
  });

  return { ctx: target as unknown as CanvasRenderingContext2D, events };
}

function shadowEvents(events: string[]): string[] {
  return events.filter((e) => e.startsWith('shadowColor:') || e.startsWith('shadowBlur:'));
}

/** The method-call stream only — the glow must not change this at all. */
function callEvents(events: string[]): string[] {
  return events.filter((e) => e.startsWith('call:'));
}

/** Index of the last element matching `predicate`, or -1 (lib is pre-ES2023). */
function lastIndexOfWhere(events: string[], predicate: (e: string) => boolean): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (predicate(events[i])) {
      return i;
    }
  }
  return -1;
}

function makeCanvas(recording: () => RecordingCtx): HTMLCanvasElement {
  const target: Record<string, unknown> = {
    width: 600,
    height: 500,
    getContext: () => recording().ctx,
    addEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }),
  };
  return target as unknown as HTMLCanvasElement;
}

/** The two engines with a real (non-empty) pattern, so strands get drawn. */
function withEngines(run: (cutParity: CutParityEngine, sideState: SideStateEngine) => void): void {
  const cutParity = new CutParityEngine();
  cutParity.resize(ROWS, COLUMNS);
  cutParity.randomize(1);

  const sideState = new SideStateEngine(ROWS, COLUMNS);
  sideState.randomize(1);

  run(cutParity, sideState);
}

const ROWS = 4;
const COLUMNS = 4;

function glowSettings(glow: boolean) {
  return { ...DEFAULT_SETTINGS, rows: ROWS, columns: COLUMNS, glow, stringColor: '#FF9A39', stringSize: 12 };
}

// ---- the default ----------------------------------------------------------

describe('glow setting default', () => {
  it('is off in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.glow).toBe(false);
  });

  it('is off on a freshly constructed editor', () => {
    const editor = new KnotEditor(makeCanvas(makeRecordingCtx));
    expect(editor.isGlowEnabled()).toBe(false);
  });
});

// ---- glow off: nothing changes -------------------------------------------

describe('glow off leaves rendering untouched', () => {
  it('renderKnotwork writes no shadow state at all', () => {
    const { ctx, events } = makeRecordingCtx();
    const { cutRows, cutColumns } = computeCutDimensions(ROWS, COLUMNS);
    const cuts: CutGrid = makeEmptyPattern(cutRows, cutColumns);

    renderKnotwork(ctx, glowSettings(false), cuts);

    expect(events.length).toBeGreaterThan(0); // it really drew
    expect(shadowEvents(events)).toEqual([]);
  });

  it('cut-parity render writes no shadow state at all', () => {
    withEngines((cutParity) => {
      const { ctx, events } = makeRecordingCtx();
      cutParity.render(ctx, glowSettings(false));
      expect(events.length).toBeGreaterThan(0);
      expect(shadowEvents(events)).toEqual([]);
    });
  });

  it('side-state render writes no shadow state at all', () => {
    withEngines((_cutParity, sideState) => {
      const { ctx, events } = makeRecordingCtx();
      sideState.render(ctx, glowSettings(false));
      expect(events.length).toBeGreaterThan(0);
      expect(shadowEvents(events)).toEqual([]);
    });
  });

  it('both engines issue exactly the same draw calls with glow on and off', () => {
    withEngines((cutParity, sideState) => {
      for (const engine of [cutParity, sideState]) {
        const off = makeRecordingCtx();
        engine.render(off.ctx, glowSettings(false));

        const on = makeRecordingCtx();
        engine.render(on.ctx, glowSettings(true));

        // The glow adds shadow state and nothing else: strip it and the two
        // call streams must be identical, so glow-off output is unchanged.
        expect(callEvents(on.events)).toEqual(callEvents(off.events));
      }
    });
  });
});

// ---- glow on --------------------------------------------------------------

describe('glow on brackets the strands', () => {
  it('sets the string colour and half the string size as blur', () => {
    withEngines((cutParity, sideState) => {
      for (const engine of [cutParity, sideState]) {
        const { ctx, events } = makeRecordingCtx();
        engine.render(ctx, glowSettings(true));

        const shadow = shadowEvents(events);
        expect(shadow[0]).toBe('shadowColor:#FF9A39');
        expect(shadow[1]).toBe('shadowBlur:6'); // stringSize 12 / 2
      }
    });
  });

  it('resets to transparent / zero blur at the end of the strand draw', () => {
    withEngines((cutParity, sideState) => {
      for (const engine of [cutParity, sideState]) {
        const { ctx, events } = makeRecordingCtx();
        engine.render(ctx, glowSettings(true));

        const shadow = shadowEvents(events);
        expect(shadow.slice(-2)).toEqual([
          `shadowColor:${GLOW_OFF_COLOR}`,
          `shadowBlur:${GLOW_OFF_BLUR}`,
        ]);
        // Exactly one open and one close — no half-open bracket.
        expect(shadow.filter((e) => e === `shadowColor:${GLOW_OFF_COLOR}`)).toHaveLength(1);
      }
    });
  });

  it('sets the glow before any drawing and clears it after the last draw', () => {
    withEngines((cutParity, sideState) => {
      for (const engine of [cutParity, sideState]) {
        const { ctx, events } = makeRecordingCtx();
        engine.render(ctx, glowSettings(true));

        const firstShadow = events.findIndex((e) => e.startsWith('shadow'));
        const lastDraw = lastIndexOfWhere(events, (e) => e.startsWith('call:'));
        const resetIndex = events.lastIndexOf(`shadowColor:${GLOW_OFF_COLOR}`);

        expect(firstShadow).toBeLessThan(lastDraw);
        expect(resetIndex).toBeGreaterThan(lastDraw);
      }
    });
  });

  it('does not leak into the overlay: the overlay itself writes no shadow', () => {
    withEngines((cutParity, sideState) => {
      for (const engine of [cutParity, sideState]) {
        const { ctx, events } = makeRecordingCtx();
        engine.render(ctx, glowSettings(true));
        engine.renderOverlay(ctx, glowSettings(true), engine.ui);

        // render() already closed the bracket, so the only shadow writes in
        // the whole render+overlay pass are the one open/close pair.
        const shadow = shadowEvents(events);
        expect(shadow).toEqual([
          'shadowColor:#FF9A39',
          'shadowBlur:6',
          `shadowColor:${GLOW_OFF_COLOR}`,
          `shadowBlur:${GLOW_OFF_BLUR}`,
        ]);
        expect(events.lastIndexOf(`shadowColor:${GLOW_OFF_COLOR}`)).toBeLessThan(
          lastIndexOfWhere(events, (e) => e.startsWith('call:')),
        );
      }
    });
  });
});

// ---- editor wiring --------------------------------------------------------

describe('KnotEditor.showGlow', () => {
  it('records the shadow bracket on a stub-canvas render', () => {
    const { ctx, events } = makeRecordingCtx();
    const editor = new KnotEditor(makeCanvas(() => ({ ctx, events })));
    events.length = 0;

    editor.showGlow(true);
    expect(editor.isGlowEnabled()).toBe(true);

    const shadow = shadowEvents(events);
    expect(shadow[0]).toBe('shadowColor:#FF9A39');
    expect(shadow[1]).toBe('shadowBlur:6');
    expect(shadow.slice(-2)).toEqual([
      `shadowColor:${GLOW_OFF_COLOR}`,
      `shadowBlur:${GLOW_OFF_BLUR}`,
    ]);
  });

  it('records no shadow state once toggled back off', () => {
    const { ctx, events } = makeRecordingCtx();
    const editor = new KnotEditor(makeCanvas(() => ({ ctx, events })));
    events.length = 0;

    editor.showGlow(true);
    editor.showGlow(false);
    expect(editor.isGlowEnabled()).toBe(false);

    // Look at the glow-off frame on its own: the toggle back issued a
    // redraw, and that frame must be silent about shadows.
    events.length = 0;
    editor.redraw();
    expect(shadowEvents(events)).toEqual([]);
  });

  it('leaves no live shadow behind after a full redraw with glow on', () => {
    const { ctx, events } = makeRecordingCtx();
    const editor = new KnotEditor(makeCanvas(() => ({ ctx, events })));
    events.length = 0;

    editor.showGlow(true);
    // redraw() paints background, grid, strands, overlay in that order. The
    // reset must land before the overlay's strokes, so the closing pair is
    // the last shadow write of the frame.
    expect(shadowEvents(events).slice(-2)).toEqual([
      `shadowColor:${GLOW_OFF_COLOR}`,
      `shadowBlur:${GLOW_OFF_BLUR}`,
    ]);
    expect(events.lastIndexOf(`shadowColor:${GLOW_OFF_COLOR}`)).toBeLessThan(
      lastIndexOfWhere(events, (e) => e.startsWith('call:')),
    );
  });
});