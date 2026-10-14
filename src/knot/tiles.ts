import {
  EVEN,
  HORIZ_CUT,
  NO_CUT,
  ODD,
  VERT_CUT,
  type CutState,
  type KnotSettings,
  type Parity,
} from './types';

/**
 * A tile drawing function draws one cell of the knot in local cell
 * coordinates (origin at the cell's top-left, cell is cellSize x cellSize).
 */
export type TileFn = (ctx: CanvasRenderingContext2D, s: KnotSettings) => void;

function drawHorizontalLine(ctx: CanvasRenderingContext2D, s: KnotSettings): void {
  const half = s.cellSize / 2;
  const halfString = s.stringSize / 2;

  ctx.fillRect(0, half - halfString, s.cellSize, s.stringSize);

  ctx.beginPath();
  ctx.moveTo(0, half - halfString);
  ctx.lineTo(s.cellSize, half - halfString);
  ctx.moveTo(0, half + halfString);
  ctx.lineTo(s.cellSize, half + halfString);
  ctx.stroke();
}

/** Diagonal strand crossing another straight through the cell. */
function drawStraightCross(ctx: CanvasRenderingContext2D, s: KnotSettings): void {
  const h = Math.round(s.stringSize / Math.SQRT2);

  ctx.beginPath();
  ctx.moveTo(0, s.cellSize);
  ctx.lineTo(0, s.cellSize - h);
  ctx.lineTo(s.cellSize - h, 0);
  ctx.lineTo(s.cellSize, 0);
  ctx.lineTo(s.cellSize, h);
  ctx.lineTo(h, s.cellSize);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, s.cellSize - h);
  ctx.lineTo(s.cellSize - h, 0);
  ctx.moveTo(h, s.cellSize);
  ctx.lineTo(s.cellSize, h);
  ctx.lineTo(s.cellSize - h, 0);
  ctx.stroke();
}

/** A quarter-circle corner. */
function drawCorner(ctx: CanvasRenderingContext2D, s: KnotSettings): void {
  const half = s.cellSize / 2;
  const halfString = s.stringSize / 2;

  ctx.beginPath();
  ctx.moveTo(half - halfString, 0);
  ctx.lineTo(half + halfString, 0);
  ctx.quadraticCurveTo(half + halfString, half + halfString, 0, half + halfString);
  ctx.lineTo(0, half - halfString);
  ctx.quadraticCurveTo(half - halfString, half - halfString, half - halfString, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  // Outer curve
  ctx.moveTo(half + halfString, 0);
  ctx.quadraticCurveTo(half + halfString, half + halfString, 0, half + halfString);
  // Inner curve
  ctx.moveTo(0, half - halfString);
  ctx.quadraticCurveTo(half - halfString, half - halfString, half - halfString, 0);
  ctx.stroke();
}

/** A curved strand crossing another; crossOver decides who passes on top. */
function drawCurvedCross(ctx: CanvasRenderingContext2D, s: KnotSettings, crossOver: boolean): void {
  const h = Math.round(s.stringSize / Math.SQRT2);
  const topCpLength = 2;
  const half = s.cellSize / 2;
  const halfString = s.stringSize / 2;

  const leftSideCurve = (): void => {
    ctx.bezierCurveTo(
      half - halfString,
      half - h * 0.4,
      s.cellSize - h - topCpLength,
      topCpLength,
      s.cellSize - h,
      0,
    );
  };

  const rightSideCurve = (): void => {
    ctx.bezierCurveTo(
      s.cellSize - topCpLength,
      h + topCpLength,
      half + halfString,
      half + h * 0.4,
      half + halfString,
      s.cellSize,
    );
  };

  ctx.beginPath();
  ctx.moveTo(half - halfString, s.cellSize);
  leftSideCurve();
  ctx.lineTo(s.cellSize, 0);
  ctx.lineTo(s.cellSize, h);
  rightSideCurve();
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(half - halfString, s.cellSize);
  leftSideCurve();
  if (crossOver) {
    // Break the outline where the other strand passes over.
    ctx.moveTo(s.cellSize, h);
  } else {
    ctx.lineTo(s.cellSize, h);
  }
  rightSideCurve();
  ctx.stroke();
}

/** Rotate a tile around the cell centre, clockwise. */
export function rotate(fn: TileFn, degrees: number): TileFn {
  return (ctx, s) => {
    ctx.save();
    ctx.translate(s.cellSize / 2, s.cellSize / 2);
    ctx.rotate((degrees / 180) * Math.PI);
    ctx.translate(-s.cellSize / 2, -s.cellSize / 2);
    fn(ctx, s);
    ctx.restore();
  };
}

/** Mirror a tile horizontally around the cell centre. */
export function flipHorizontally(fn: TileFn): TileFn {
  return (ctx, s) => {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-s.cellSize, 0);
    fn(ctx, s);
    ctx.restore();
  };
}

/** Debug placeholder: a red crossed-out square. Any unset matrix cell renders as this. */
function drawError(ctx: CanvasRenderingContext2D, s: KnotSettings): void {
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.fillRect(0, 0, s.cellSize, s.cellSize);
  ctx.strokeStyle = 'rgb(0, 0, 0)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, s.cellSize, s.cellSize);

  const offset = Math.round((s.cellSize / 2) * 0.25 + 1);
  ctx.beginPath();
  ctx.moveTo(offset, offset);
  ctx.lineTo(s.cellSize - offset, s.cellSize - offset);
  ctx.moveTo(offset, s.cellSize - offset);
  ctx.lineTo(s.cellSize - offset, offset);
  ctx.stroke();
}

const curvedCrossOver: TileFn = (ctx, s) => drawCurvedCross(ctx, s, true);
const curvedCrossUnder: TileFn = (ctx, s) => drawCurvedCross(ctx, s, false);

const drawVerticalLine = rotate(drawHorizontalLine, 90);

/**
 * The 4D tile matrix: tiles[firstCut][secondCut][rowParity][colParity].
 *
 * Every one of the 36 states is assigned below; drawError remains only as a
 * safety net (and is caught by the test suite if it ever leaks through).
 */
export const tiles: TileFn[][][][] = (() => {
  const matrix: TileFn[][][][] = [];
  for (let i = 0; i < 3; i++) {
    matrix[i] = [];
    for (let j = 0; j < 3; j++) {
      matrix[i][j] = [];
      for (let k = 0; k < 2; k++) {
        matrix[i][j][k] = [];
        for (let l = 0; l < 2; l++) {
          matrix[i][j][k][l] = drawError;
        }
      }
    }
  }

  matrix[NO_CUT][NO_CUT][ODD][ODD] = drawStraightCross;
  matrix[NO_CUT][NO_CUT][ODD][EVEN] = rotate(drawStraightCross, 90);
  matrix[NO_CUT][NO_CUT][EVEN][EVEN] = rotate(drawStraightCross, 180);
  matrix[NO_CUT][NO_CUT][EVEN][ODD] = rotate(drawStraightCross, 270);

  matrix[HORIZ_CUT][VERT_CUT][EVEN][EVEN] = drawCorner;
  matrix[HORIZ_CUT][VERT_CUT][EVEN][ODD] = rotate(drawCorner, 90);
  matrix[HORIZ_CUT][VERT_CUT][ODD][ODD] = drawCorner;
  matrix[HORIZ_CUT][VERT_CUT][ODD][EVEN] = rotate(drawCorner, 90);

  matrix[VERT_CUT][HORIZ_CUT][EVEN][EVEN] = rotate(drawCorner, 180);
  matrix[VERT_CUT][HORIZ_CUT][ODD][ODD] = rotate(drawCorner, 180);
  matrix[VERT_CUT][HORIZ_CUT][EVEN][ODD] = rotate(drawCorner, 270);
  matrix[VERT_CUT][HORIZ_CUT][ODD][EVEN] = rotate(drawCorner, 270);

  matrix[HORIZ_CUT][HORIZ_CUT][EVEN][EVEN] = drawHorizontalLine;
  matrix[HORIZ_CUT][HORIZ_CUT][ODD][ODD] = drawHorizontalLine;
  matrix[HORIZ_CUT][HORIZ_CUT][EVEN][ODD] = drawHorizontalLine;
  matrix[HORIZ_CUT][HORIZ_CUT][ODD][EVEN] = drawHorizontalLine;

  matrix[VERT_CUT][VERT_CUT][EVEN][EVEN] = drawVerticalLine;
  matrix[VERT_CUT][VERT_CUT][ODD][ODD] = drawVerticalLine;
  matrix[VERT_CUT][VERT_CUT][EVEN][ODD] = drawVerticalLine;
  matrix[VERT_CUT][VERT_CUT][ODD][EVEN] = drawVerticalLine;

  matrix[VERT_CUT][NO_CUT][EVEN][EVEN] = curvedCrossOver;
  matrix[VERT_CUT][NO_CUT][ODD][ODD] = curvedCrossUnder;
  matrix[VERT_CUT][NO_CUT][EVEN][ODD] = flipHorizontally(curvedCrossUnder);
  matrix[VERT_CUT][NO_CUT][ODD][EVEN] = flipHorizontally(curvedCrossOver);

  matrix[NO_CUT][VERT_CUT][EVEN][EVEN] = rotate(curvedCrossUnder, 180);
  matrix[NO_CUT][VERT_CUT][EVEN][ODD] = rotate(flipHorizontally(curvedCrossOver), 180);
  matrix[NO_CUT][VERT_CUT][ODD][ODD] = rotate(curvedCrossOver, 180);
  matrix[NO_CUT][VERT_CUT][ODD][EVEN] = rotate(flipHorizontally(curvedCrossUnder), 180);

  matrix[HORIZ_CUT][NO_CUT][EVEN][EVEN] = rotate(flipHorizontally(curvedCrossOver), 90);
  matrix[HORIZ_CUT][NO_CUT][EVEN][ODD] = rotate(curvedCrossUnder, 270);
  matrix[HORIZ_CUT][NO_CUT][ODD][ODD] = rotate(flipHorizontally(curvedCrossUnder), 90);
  matrix[HORIZ_CUT][NO_CUT][ODD][EVEN] = rotate(curvedCrossOver, 270);

  matrix[NO_CUT][HORIZ_CUT][EVEN][EVEN] = rotate(flipHorizontally(curvedCrossUnder), 270);
  matrix[NO_CUT][HORIZ_CUT][EVEN][ODD] = rotate(curvedCrossOver, 90);
  matrix[NO_CUT][HORIZ_CUT][ODD][ODD] = rotate(flipHorizontally(curvedCrossOver), 270);
  matrix[NO_CUT][HORIZ_CUT][ODD][EVEN] = rotate(curvedCrossUnder, 90);

  return matrix;
})();

/** Pick the tile for one cell. rowParity/colParity are (index + 1) % 2. */
export function tileFor(firstCut: CutState, secondCut: CutState, rowParity: Parity, colParity: Parity): TileFn {
  return tiles[firstCut][secondCut][rowParity][colParity];
}
