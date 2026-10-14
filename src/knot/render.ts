import {
  EVEN,
  HORIZ_CUT,
  NO_CUT,
  ODD,
  VERT_CUT,
  type CutState,
  type CutGrid,
  type KnotNode,
  type KnotSettings,
  type Parity,
} from './types';
import { tileFor } from './tiles';

/** Visual centre of a cut marker (in canvas pixels). */
export function getVisualCutCenter(s: KnotSettings, cutRow: number, cutColumn: number): { x: number; y: number } {
  let x = cutColumn * s.cellSize * 2;
  const y = cutRow * s.cellSize;
  if (cutRow % 2 === 0) {
    x += s.cellSize;
  }
  return { x, y };
}

/** Visual centre of a control node (in canvas pixels). Even rows are offset. */
export function getVisualNodeCenter(s: KnotSettings, row: number, column: number): { x: number; y: number } {
  let x = column * s.cellSize * 2;
  const y = row * s.cellSize;
  if (row % 2 === 1) {
    x += s.cellSize;
  }
  return { x, y };
}

/** Draw the knotwork itself: one tile per cell, selected by cuts + parity. */
export function renderKnotwork(ctx: CanvasRenderingContext2D, s: KnotSettings, cuts: CutGrid): void {
  ctx.lineCap = 'square';
  ctx.lineJoin = 'round';
  ctx.fillStyle = s.stringColor;
  ctx.strokeStyle = s.strokeColor;
  ctx.lineWidth = s.strokeWidth;

  for (let x = 0; x < s.columns; x++) {
    for (let y = 0; y < s.rows; y++) {
      ctx.save();
      ctx.translate(x * s.cellSize, y * s.cellSize);

      const rowParity = ((y + 1) % 2) as Parity;
      const colParity = ((x + 1) % 2) as Parity;

      // Which cuts bound this cell depends on row/column parity.
      let firstCut: CutState = NO_CUT;
      let secondCut: CutState = NO_CUT;

      if (colParity === ODD) {
        firstCut = cuts[y + 1][x / 2];
        secondCut = cuts[y][x / 2];
      } else if (rowParity === ODD) {
        firstCut = cuts[y + 1][(x + 1) / 2];
        secondCut = cuts[y][(x - 1) / 2];
      } else {
        firstCut = cuts[y + 1][(x - 1) / 2];
        secondCut = cuts[y][(x + 1) / 2];
      }

      tileFor(firstCut, secondCut, rowParity, colParity)(ctx, s);

      ctx.restore();
    }
  }
}

/** Canvas state that clears a strand glow: no shadow colour, no blur. */
export const GLOW_OFF_COLOR = 'transparent';
export const GLOW_OFF_BLUR = 0;

/**
 * Turn on the neon glow for the strands about to be drawn.
 *
 * A no-op unless `s.glow` — with the flag off nothing is written at all, so
 * the canvas call stream is byte-for-byte what it was before the glow
 * existed. The bracket's other half is `endGlow`.
 */
export function beginGlow(ctx: CanvasRenderingContext2D, s: KnotSettings): void {
  if (!s.glow) {
    return;
  }
  ctx.shadowColor = s.stringColor;
  ctx.shadowBlur = s.stringSize / 2;
}

/**
 * Close a `beginGlow` bracket. Always called by its owner (glow on or off),
 * but only writes when the glow was actually on — so an engine rendering
 * with glow off stays silent.
 *
 * The reset must happen before anything else draws (grid, overlay): a live
 * shadow would put a halo on every later stroke, not just the strands.
 */
export function endGlow(ctx: CanvasRenderingContext2D, s: KnotSettings): void {
  if (!s.glow) {
    return;
  }
  ctx.shadowColor = GLOW_OFF_COLOR;
  ctx.shadowBlur = GLOW_OFF_BLUR;
}

/** Faint cell grid shown behind the knot while editing. */
export function renderGrid(ctx: CanvasRenderingContext2D, s: KnotSettings): void {
  ctx.strokeStyle = s.gridColor;
  ctx.lineWidth = 2;
  for (let x = 0; x < s.columns; x++) {
    for (let y = 0; y < s.rows; y++) {
      ctx.strokeRect(x * s.cellSize, y * s.cellSize, s.cellSize, s.cellSize);
    }
  }
}

/** Draw the cut lines (the breaks between strands) as editor overlay. */
export function renderCuts(ctx: CanvasRenderingContext2D, s: KnotSettings, cuts: CutGrid): void {
  for (let row = 0; row < cuts.length; row++) {
    for (let column = 0; column < cuts[row].length; column++) {
      // Even rows carry one unused trailing entry.
      if (row % 2 === EVEN && column === cuts[row].length - 1) {
        continue;
      }

      const cutType = cuts[row][column];
      if (cutType === NO_CUT) {
        continue;
      }

      ctx.save();
      const center = getVisualCutCenter(s, row, column);
      ctx.translate(center.x, center.y);

      ctx.beginPath();
      if (cutType === VERT_CUT) {
        ctx.moveTo(0, -s.cellSize);
        ctx.lineTo(0, s.cellSize);
      } else if (cutType === HORIZ_CUT) {
        ctx.moveTo(-s.cellSize, 0);
        ctx.lineTo(s.cellSize, 0);
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = s.cutColor;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function renderNode(ctx: CanvasRenderingContext2D, s: KnotSettings, row: number, column: number, selected = false): void {
  const nodeSize = selected ? s.selectedControlNodeSize : s.controlNodeSize;

  ctx.fillStyle = row % 2 === 1 ? s.controlNodeColor1 : s.controlNodeColor2;
  ctx.save();
  const center = getVisualNodeCenter(s, row, column);
  ctx.translate(center.x, center.y);
  ctx.fillRect(-nodeSize / 2, -nodeSize / 2, nodeSize, nodeSize);
  ctx.restore();
}

/**
 * Draw the control-node lattice. Nodes alternate colors by row parity; the
 * selected/hovered pair is highlighted, and a green preview line shows the
 * cut that a click would make.
 */
export function renderControlNodes(
  ctx: CanvasRenderingContext2D,
  s: KnotSettings,
  selectedNode: KnotNode | null,
  hoverNode: KnotNode | null,
  canCutBetween: (a: KnotNode, b: KnotNode) => boolean,
): void {
  const lastColumn = s.columns / 2;

  for (let row = 0; row < s.rows + 1; row++) {
    for (let column = 0; column < lastColumn + 1; column++) {
      if (row % 2 === 1 && column === lastColumn) {
        continue;
      }
      renderNode(ctx, s, row, column);
    }
  }

  if (selectedNode !== null && hoverNode !== null && canCutBetween(selectedNode, hoverNode)) {
    const start = getVisualNodeCenter(s, selectedNode.row, selectedNode.column);
    const end = getVisualNodeCenter(s, hoverNode.row, hoverNode.column);

    ctx.lineWidth = 4;
    ctx.strokeStyle = s.newCutColor;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  if (selectedNode !== null) {
    renderNode(ctx, s, selectedNode.row, selectedNode.column, true);
  }
  if (hoverNode !== null) {
    renderNode(ctx, s, hoverNode.row, hoverNode.column, true);
  }
}

/**
 * Find the control node nearest a point (in canvas coordinates, offset
 * already subtracted), or null if nothing is within half a cell.
 */
export function getClosestNode(s: KnotSettings, offsetX: number, offsetY: number, selectionDistance = s.cellSize / 2): KnotNode | null {
  const closestRow = Math.round(offsetY / s.cellSize);

  let adjustedOffsetX = offsetX;
  if (closestRow % 2 === 1) {
    adjustedOffsetX -= s.cellSize;
  }
  const closestColumn = Math.round(adjustedOffsetX / s.cellSize / 2);

  const center = getVisualNodeCenter(s, closestRow, closestColumn);
  const isClose =
    Math.abs(offsetX - center.x) <= selectionDistance &&
    Math.abs(offsetY - center.y) <= selectionDistance;

  let isValid =
    isClose && closestRow >= 0 && closestRow <= s.rows && closestColumn >= 0 && closestColumn <= s.columns / 2;

  if (closestRow % 2 === 1) {
    isValid = isValid && closestColumn < s.columns / 2;
  }

  return isValid ? { row: closestRow, column: closestColumn } : null;
}
