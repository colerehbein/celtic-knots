import { describe, expect, it, vi } from 'vitest';
import { flipHorizontally, rotate, tileFor, tiles } from './tiles';
import { EVEN, HORIZ_CUT, NO_CUT, ODD, VERT_CUT, type CutState, type Parity } from './types';
import { DEFAULT_SETTINGS } from './types';

/** Minimal canvas context stub: every method is a spy, properties are writable. */
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

const CUTS: CutState[] = [NO_CUT, HORIZ_CUT, VERT_CUT];
const PARITIES: Parity[] = [ODD, EVEN];

describe('tile matrix', () => {
  it('defines a real tile for all 36 states (no drawError leaks)', () => {
    // drawError is identifiable by behaviour: it is the only tile that
    // calls strokeRect (all assigned tiles only fill and stroke paths).
    for (const first of CUTS) {
      for (const second of CUTS) {
        for (const row of PARITIES) {
          for (const col of PARITIES) {
            const fn = tiles[first][second][row][col];
            expect(fn, `tiles[${first}][${second}][${row}][${col}]`).toBeTypeOf('function');
            const ctx = makeCtx();
            fn(ctx, DEFAULT_SETTINGS);
            // Every assigned tile draws at least one path or rect.
            const drew =
              (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length > 0 ||
              (ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length > 0;
            expect(drew, `tiles[${first}][${second}][${row}][${col}] drew nothing`).toBe(true);
            // drawError fills a full red rect at (0,0,cellSize,cellSize) AND
            // strokes a rect; assigned tiles never call strokeRect.
            expect(
              (ctx.strokeRect as ReturnType<typeof vi.fn>).mock.calls.length,
              `tiles[${first}][${second}][${row}][${col}] is drawError`,
            ).toBe(0);
          }
        }
      }
    }
  });

  it('tileFor resolves through the matrix', () => {
    expect(tileFor(NO_CUT, NO_CUT, ODD, ODD)).toBe(tiles[NO_CUT][NO_CUT][ODD][ODD]);
    expect(tileFor(HORIZ_CUT, VERT_CUT, EVEN, EVEN)).toBe(tiles[HORIZ_CUT][VERT_CUT][EVEN][EVEN]);
  });
});

describe('rotate / flipHorizontally', () => {
  it('rotate wraps the fn in save/translate/rotate/restore', () => {
    const inner = vi.fn();
    const ctx = makeCtx();
    rotate(inner, 90)(ctx, DEFAULT_SETTINGS);

    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((ctx.translate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect((ctx.rotate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((ctx.restore as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(inner).toHaveBeenCalledOnce();
    // 90 degrees = PI/2 radians.
    expect((ctx.rotate as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeCloseTo(Math.PI / 2);
  });

  it('flipHorizontally wraps the fn in save/scale/translate/restore', () => {
    const inner = vi.fn();
    const ctx = makeCtx();
    flipHorizontally(inner)(ctx, DEFAULT_SETTINGS);

    expect((ctx.save as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((ctx.scale as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((ctx.restore as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(inner).toHaveBeenCalledOnce();
    expect((ctx.scale as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([-1, 1]);
  });
});
