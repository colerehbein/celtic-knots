import {
  HORIZ_CUT,
  NO_CUT,
  VERT_CUT,
  type CutGrid,
  type CutState,
} from './types';

/** Cut-grid dimensions derived from the knotwork size. */
export function computeCutDimensions(rows: number, columns: number): { cutRows: number; cutColumns: number } {
  return {
    cutRows: rows + 1,
    cutColumns: columns / 2 + 1,
  };
}

/** An empty pattern: every cut position is NO_CUT. */
export function makeEmptyPattern(cutRows: number, cutColumns: number): CutGrid {
  const cuts: CutGrid = [];
  for (let row = 0; row < cutRows; row++) {
    cuts[row] = new Array<CutState>(cutColumns).fill(NO_CUT);
  }
  return cuts;
}

/**
 * A random pattern that looks noticeably better than pure noise: cuts are
 * mirrored left-to-right (bilateral) or across all four quadrants
 * (quadrilateral), controlled by the symmetry weights.
 *
 * @param totalCuts        how many random cuts to place (default 30% of cells)
 * @param bilateral        weight for left-right mirroring (default 50)
 * @param quadrilateral    weight for four-quadrant mirroring (default 50)
 */
export function makeBetterRandomPattern(
  cutRows: number,
  cutColumns: number,
  totalCuts = Math.floor(cutRows * cutColumns * 0.3),
  bilateral = 50,
  quadrilateral = 50,
): CutGrid {
  const states: CutState[] = [NO_CUT, VERT_CUT, HORIZ_CUT];
  const randomCuts = makeEmptyPattern(cutRows, cutColumns);

  for (let i = 0; i < totalCuts; i++) {
    const row = Math.floor(Math.random() * cutRows);
    const maxColumns = row % 2 ? cutColumns : cutColumns - 1;
    const column = Math.floor(Math.random() * maxColumns);

    // Border rows can't hold vertical cuts; border columns can't hold horizontal ones.
    let possibleStates = states;
    if (row === 0 || row === cutRows - 1) {
      possibleStates = [NO_CUT, HORIZ_CUT];
    } else if (column === 0 || column === maxColumns - 1) {
      possibleStates = [NO_CUT, VERT_CUT];
    }

    const newState = possibleStates[Math.floor(Math.random() * possibleStates.length)];
    randomCuts[row][column] = newState;

    const mirrorColumn = maxColumns - column - 1;
    if (Math.random() * (bilateral + quadrilateral) <= bilateral) {
      randomCuts[row][mirrorColumn] = newState;
    } else {
      randomCuts[row][mirrorColumn] = newState;
      randomCuts[cutRows - row - 1][column] = newState;
      randomCuts[cutRows - row - 1][mirrorColumn] = newState;
    }
  }

  return randomCuts;
}

/**
 * Open or close the knot's borders. A closed border has no loose strings
 * at the fringes: horizontal cuts along the top/bottom rows, vertical cuts
 * down the odd-row side columns.
 */
export function setBorderState(cuts: CutGrid, state: 'open' | 'closed'): CutGrid {
  const cutRows = cuts.length;
  const cutColumns = cuts[0].length;

  const horizontalBorderState: CutState = state === 'open' ? NO_CUT : HORIZ_CUT;
  for (let column = 0; column < cutColumns - 1; column++) {
    cuts[0][column] = horizontalBorderState;
    cuts[cutRows - 1][column] = horizontalBorderState;
  }

  const verticalBorderState: CutState = state === 'open' ? NO_CUT : VERT_CUT;
  for (let row = 1; row < cutRows; row += 2) {
    cuts[row][0] = verticalBorderState;
    cuts[row][cutColumns - 1] = verticalBorderState;
  }

  return cuts;
}

/** True if two nodes describe the same position. Two nulls count as equal. */
export function isSameNode(a: { row: number; column: number } | null, b: { row: number; column: number } | null): boolean {
  if (a !== null && b !== null) {
    return a.row === b.row && a.column === b.column;
  }
  return a === b;
}

/**
 * A cut is allowed between two distinct nodes that share a row, or share a
 * column with matching parity (even rows are offset half a cell).
 */
export function canCut(from: { row: number; column: number }, to: { row: number; column: number }): boolean {
  if (isSameNode(from, to)) {
    return false;
  }
  const sameRow = from.row === to.row;
  const sameColumn = from.column === to.column && from.row % 2 === to.row % 2;
  return sameRow || sameColumn;
}

/**
 * Apply (or toggle off) a cut between two nodes. Returns the mutated grid.
 *
 * A cut runs along a row of cut cells between the two nodes. If the cells
 * already hold that cut type, the cut is removed instead.
 */
export function applyCut(cuts: CutGrid, from: { row: number; column: number }, to: { row: number; column: number }): CutGrid {
  // Normalise so we always cut left-to-right or top-to-bottom.
  let start = from;
  let end = to;
  if (to.row < from.row || to.column < from.column) {
    start = to;
    end = from;
  }

  let newCut: CutState = start.row === end.row ? HORIZ_CUT : VERT_CUT;

  if (start.row === end.row) {
    const startColumn = start.column + (start.row % 2);
    const endColumn = end.column + (start.row % 2);

    if (cuts[start.row][startColumn] === newCut) {
      newCut = NO_CUT;
    }
    for (let column = startColumn; column < endColumn; column++) {
      cuts[start.row][column] = newCut;
    }
  } else {
    if (cuts[start.row + 1][start.column] === newCut) {
      newCut = NO_CUT;
    }
    for (let row = start.row + 1; row < end.row; row += 2) {
      cuts[row][start.column] = newCut;
    }
  }

  return cuts;
}
