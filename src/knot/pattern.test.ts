import { describe, expect, it } from 'vitest';
import {
  applyCut,
  canCut,
  computeCutDimensions,
  isSameNode,
  makeBetterRandomPattern,
  makeEmptyPattern,
  setBorderState,
} from './pattern';
import { HORIZ_CUT, NO_CUT, VERT_CUT, type CutState } from './types';

describe('computeCutDimensions', () => {
  it('derives cut rows and columns from knotwork size', () => {
    expect(computeCutDimensions(12, 12)).toEqual({ cutRows: 13, cutColumns: 7 });
    expect(computeCutDimensions(10, 8)).toEqual({ cutRows: 11, cutColumns: 5 });
  });
});

describe('makeEmptyPattern', () => {
  it('creates a grid of the requested shape filled with NO_CUT', () => {
    const cuts = makeEmptyPattern(13, 7);
    expect(cuts).toHaveLength(13);
    for (const row of cuts) {
      expect(row).toHaveLength(7);
      expect(row.every((c) => c === NO_CUT)).toBe(true);
    }
  });
});

describe('makeBetterRandomPattern', () => {
  it('produces the right shape and only valid cut values', () => {
    const cuts = makeBetterRandomPattern(13, 7, 100);
    expect(cuts).toHaveLength(13);
    const valid: CutState[] = [NO_CUT, HORIZ_CUT, VERT_CUT];
    for (const row of cuts) {
      expect(row).toHaveLength(7);
      for (const cell of row) {
        expect(valid).toContain(cell);
      }
    }
  });

  it('never places vertical cuts on border rows or horizontal cuts on border columns', () => {
    // Many iterations to exercise the random placement.
    for (let trial = 0; trial < 50; trial++) {
      const cutRows = 13;
      const cutColumns = 7;
      const cuts = makeBetterRandomPattern(cutRows, cutColumns, 200);
      for (let column = 0; column < cutColumns - 1; column++) {
        expect(cuts[0][column]).not.toBe(VERT_CUT);
        expect(cuts[cutRows - 1][column]).not.toBe(VERT_CUT);
      }
      for (let row = 1; row < cutRows - 1; row++) {
        // Interior rows only — border rows (0, cutRows-1) may hold HORIZ at column 0.
        const maxColumns = row % 2 ? cutColumns : cutColumns - 1;
        expect(cuts[row][0]).not.toBe(HORIZ_CUT);
        expect(cuts[row][maxColumns - 1]).not.toBe(HORIZ_CUT);
      }
    }
  });

  it('runs with default arguments and produces a valid pattern', () => {
    // Default totalCuts is 30% of cells; with quadrant mirroring one
    // iteration can place up to 4 distinct cells, so the observable
    // invariant is validity, not an exact count.
    const cuts = makeBetterRandomPattern(13, 7);
    const valid: CutState[] = [NO_CUT, HORIZ_CUT, VERT_CUT];
    for (const row of cuts) {
      for (const cell of row) {
        expect(valid).toContain(cell);
      }
    }
  });
});

describe('setBorderState', () => {
  it('closed border: horizontal cuts top/bottom, vertical cuts on odd-row sides', () => {
    const cutRows = 13;
    const cutColumns = 7;
    const cuts = setBorderState(makeEmptyPattern(cutRows, cutColumns), 'closed');

    for (let column = 0; column < cutColumns - 1; column++) {
      expect(cuts[0][column]).toBe(HORIZ_CUT);
      expect(cuts[cutRows - 1][column]).toBe(HORIZ_CUT);
    }
    for (let row = 1; row < cutRows; row += 2) {
      expect(cuts[row][0]).toBe(VERT_CUT);
      expect(cuts[row][cutColumns - 1]).toBe(VERT_CUT);
    }
  });

  it('open border: clears all border cuts', () => {
    const cutRows = 13;
    const cutColumns = 7;
    let cuts = setBorderState(makeEmptyPattern(cutRows, cutColumns), 'closed');
    cuts = setBorderState(cuts, 'open');

    for (let column = 0; column < cutColumns - 1; column++) {
      expect(cuts[0][column]).toBe(NO_CUT);
      expect(cuts[cutRows - 1][column]).toBe(NO_CUT);
    }
    for (let row = 1; row < cutRows; row += 2) {
      expect(cuts[row][0]).toBe(NO_CUT);
      expect(cuts[row][cutColumns - 1]).toBe(NO_CUT);
    }
  });
});

describe('isSameNode', () => {
  it('matches by position', () => {
    expect(isSameNode({ row: 1, column: 2 }, { row: 1, column: 2 })).toBe(true);
    expect(isSameNode({ row: 1, column: 2 }, { row: 1, column: 3 })).toBe(false);
  });

  it('treats two nulls as equal, null vs node as different', () => {
    expect(isSameNode(null, null)).toBe(true);
    expect(isSameNode(null, { row: 0, column: 0 })).toBe(false);
  });
});

describe('canCut', () => {
  it('allows cuts along a shared row', () => {
    expect(canCut({ row: 2, column: 1 }, { row: 2, column: 3 })).toBe(true);
  });

  it('allows cuts down a shared column with matching parity', () => {
    expect(canCut({ row: 0, column: 2 }, { row: 2, column: 2 })).toBe(true);
    expect(canCut({ row: 1, column: 2 }, { row: 3, column: 2 })).toBe(true);
  });

  it('rejects same node and mismatched-parity columns', () => {
    expect(canCut({ row: 2, column: 1 }, { row: 2, column: 1 })).toBe(false);
    expect(canCut({ row: 0, column: 2 }, { row: 1, column: 2 })).toBe(false);
  });
});

describe('applyCut', () => {
  it('cuts horizontally along a row between two nodes', () => {
    const cuts = makeEmptyPattern(13, 7);
    applyCut(cuts, { row: 2, column: 1 }, { row: 2, column: 3 });
    // Even row: cut columns are offset by 0.
    expect(cuts[2][1]).toBe(HORIZ_CUT);
    expect(cuts[2][2]).toBe(HORIZ_CUT);
    expect(cuts[2][3]).toBe(NO_CUT); // end column exclusive
  });

  it('cuts vertically down a column between two nodes', () => {
    const cuts = makeEmptyPattern(13, 7);
    applyCut(cuts, { row: 0, column: 2 }, { row: 2, column: 2 });
    expect(cuts[1][2]).toBe(VERT_CUT);
    expect(cuts[2][2]).toBe(NO_CUT); // end row exclusive
  });

  it('toggles the cut off when re-applying the same cut', () => {
    const cuts = makeEmptyPattern(13, 7);
    applyCut(cuts, { row: 2, column: 1 }, { row: 2, column: 3 });
    applyCut(cuts, { row: 2, column: 1 }, { row: 2, column: 3 });
    expect(cuts[2][1]).toBe(NO_CUT);
    expect(cuts[2][2]).toBe(NO_CUT);
  });

  it('works regardless of click order', () => {
    const a = makeEmptyPattern(13, 7);
    const b = makeEmptyPattern(13, 7);
    applyCut(a, { row: 2, column: 1 }, { row: 2, column: 3 });
    applyCut(b, { row: 2, column: 3 }, { row: 2, column: 1 });
    expect(a).toEqual(b);
  });
});
