import { mulberry32 } from '../rng';
import type { EditorHit, EditorUiState, EngineImageSize, KnotEngine } from './types';
import type { KnotSettings } from '../types';

// ---------------------------------------------------------------------------
// Side-state (chip-carving) model
//
// A reimplementation of the geometry in
// docs/reference/celtic-knot-drawing-tool-john-mueller.pde ("Celtic Knot
// Drawing Tool" by John Mueller, CC BY-SA / GPL). The algorithm is restated
// here in our own code; every vertex list below is transcribed from that
// reference and carries the line numbers it came from.
//
// Model: a `columns x rows` grid of squares. Each square carries four side
// states in [up, right, down, left] order:
//
//   0 = boundary (solid edge)  1 = straight connection  2 = crossed connection
//
// A square is drawn as four quarters. Quarter `i` covers the corner between
// side `i` (the primary side) and side `i+1` (the secondary side, clockwise
// from it), and its shape comes from the 3x3 (primary, secondary) table.
// Each quarter is drawn in a frame rotated a further 90 degrees clockwise,
// exactly as the reference does.
// ---------------------------------------------------------------------------

/** Side indices, in the reference's order: up, right, down, left. */
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export type SideIndex = typeof UP | typeof RIGHT | typeof DOWN | typeof LEFT;

/** What one side of a square does. */
export const BOUNDARY = 0;
export const STRAIGHT = 1;
export const CROSSED = 2;
export type SideState = typeof BOUNDARY | typeof STRAIGHT | typeof CROSSED;

/** The four sides of one square, in [up, right, down, left] order. */
export type Square = [SideState, SideState, SideState, SideState];

export interface Point {
  x: number;
  y: number;
}

/**
 * A pointer hit: which lattice edge was clicked.
 *
 * `kind: 'edge'` distinguishes this from any future hit kind. For
 * `orientation: 'h'` (an edge running horizontally, i.e. sitting on a
 * vertical lattice line) `column` is the lattice line index — the edge lies
 * between columns `column - 1` and `column` — and `row` is the row of the two
 * squares it separates. For `orientation: 'v'` the roles swap: `row` is the
 * lattice line index (between rows `row - 1` and `row`) and `column` is the
 * column of the two squares.
 *
 * DEVIATION from `EditorHit` in engines/types.ts: that shape is cut-parity's
 * control-node space (`node: { row, column } | null`), and this engine has no
 * control nodes — its edit affordance is toggling edges. `EdgeHit` therefore
 * extends the committed shape (so it stays assignable to `EditorHit`) while
 * always reporting `node: null` and carrying the edge position in extra
 * fields. `onClick` narrows through `asEdgeHit`, so a cut-parity hit passed in
 * by mistake is ignored rather than corrupting the grid.
 */
export interface EdgeHit extends EditorHit {
  node: null;
  kind: 'edge';
  orientation: 'h' | 'v';
  row: number;
  column: number;
}

/** Narrow an arbitrary `EditorHit` to this engine's edge hit. */
export function asEdgeHit(hit: EditorHit): EdgeHit | null {
  if (typeof hit !== 'object' || hit === null) {
    return null;
  }
  const candidate = hit as Partial<EdgeHit>;
  if (
    candidate.kind !== 'edge' ||
    (candidate.orientation !== 'h' && candidate.orientation !== 'v') ||
    typeof candidate.row !== 'number' ||
    typeof candidate.column !== 'number'
  ) {
    return null;
  }
  return makeEdgeHit(candidate.orientation, candidate.row, candidate.column);
}

/** Build an edge hit (a typed literal, so `EdgeHit`'s extra fields are legal). */
function makeEdgeHit(orientation: 'h' | 'v', row: number, column: number): EdgeHit {
  return { node: null, kind: 'edge', orientation, row, column };
}

/** Snapshot format written by `serialize()` and read by `deserialize()`. */
interface SideStateSnapshot {
  rows: number;
  columns: number;
  sides: SideState[][][];
}

/**
 * Symmetry weights for `randomize`, mirroring Engine A's defaults: a placed
 * side state is mirrored left-to-right, or across all four quadrants, with
 * equal probability.
 */
const BILATERAL_WEIGHT = 50;
const QUADRILATERAL_WEIGHT = 50;

// ---------------------------------------------------------------------------
// Geometry — every list below is transcribed from the reference .pde
// ---------------------------------------------------------------------------

/** `x = s/3*(1-1/sqrt(2))` — reference lines 167, 184, 202. */
function knotX(s: number): number {
  return (s / 3) * (1 - 1 / Math.SQRT2);
}

/** `y = s/15` — reference line 185 (dispFourStraight only). */
function knotY(s: number): number {
  return s / 15;
}

/** `y = s/(15*sqrt(2))` — reference line 203 (dispQuart only). */
function knotY2(s: number): number {
  return s / (15 * Math.SQRT2);
}

function pt(x: number, y: number): Point {
  return { x, y };
}

/**
 * The one-straight special case: a square with exactly one straight side.
 * Reference `dispOneStraight`, lines 166-180. Drawn in the frame of the
 * straight side (side 0 = no rotation).
 */
export function oneStraightPolygon(s: number): Point[] {
  const x = knotX(s);
  return [
    pt(x, 0), // 169
    pt(s / 3, 0), // 170
    pt(s / 3, s / 3), // 171
    pt(s / 2, s / 2), // 172
    pt((2 * s) / 3, s / 3), // 173
    pt((2 * s) / 3, 0), // 174
    pt(s - x, 0), // 175
    pt(s - x, s / 2), // 176
    pt(s / 2, (5 * s) / 6), // 177
    pt(x, s / 2), // 178
  ];
}

/**
 * The four-straight special case: the two polygons of one quarter, with
 * `y = s/15`. Reference `dispFourStraight`, lines 183-198.
 */
export function fourStraightQuarter(s: number): Point[][] {
  const x = knotX(s);
  const y = knotY(s);
  return [
    [ // 186-191
      pt(s / 3 + y, x),
      pt(s, x),
      pt(s, s / 3),
      pt(s / 3 + y, s / 3),
    ],
    [ // 192-197
      pt((2 * s) / 3, 0),
      pt(s - x, 0),
      pt(s - x, x - y),
      pt((2 * s) / 3, x - y),
    ],
  ];
}

/**
 * One quarter of a standard square: the polygon(s) for a given
 * (primary, secondary) pair, with `y = s/(15*sqrt(2))`.
 * Reference `dispQuart`, lines 201-311.
 *
 * A crossed primary side always contributes the corner triangle first
 * (lines 275-279), then the secondary-dependent polygon.
 */
export function quarterPolygons(
  primary: SideState,
  secondary: SideState,
  s: number,
): Point[][] {
  const x = knotX(s);
  const y = knotY2(s);

  if (primary === BOUNDARY) {
    if (secondary === BOUNDARY) {
      return [[ // 212-217
        pt(s / 3, x),
        pt(s - x, x),
        pt(s - x, s / 3),
        pt(s / 3, s / 3),
      ]];
    }
    if (secondary === STRAIGHT) {
      return [[ // 221-226
        pt(s / 3, x),
        pt(s, x),
        pt(s, s / 3),
        pt(s / 3, s / 3),
      ]];
    }
    return [[ // 230-235
      pt(s / 3, x),
      pt((2 * s) / 3 + x, x),
      pt(s, s / 3),
      pt(s / 3, s / 3),
    ]];
  }

  if (primary === STRAIGHT) {
    if (secondary === BOUNDARY) {
      return [[ // 243-248
        pt((2 * s) / 3, 0),
        pt(s - x, 0),
        pt(s - x, s / 3),
        pt((2 * s) / 3, s / 3),
      ]];
    }
    if (secondary === STRAIGHT) {
      return [[ // 252-259
        pt((2 * s) / 3, 0),
        pt(s - x, 0),
        pt(s - x, x),
        pt(s, x),
        pt(s, s / 3),
        pt((2 * s) / 3, s / 3),
      ]];
    }
    return [[ // 263-269
      pt((2 * s) / 3, 0),
      pt(s - x, 0),
      pt(s - x, s / 3 - x),
      pt(s, s / 3),
      pt((2 * s) / 3, s / 3),
    ]];
  }

  // Crossed primary: corner triangle plus the secondary-dependent polygon.
  const triangle: Point[] = [ // 275-279
    pt(s / 3, 0),
    pt((2 * s) / 3, 0),
    pt(s / 3, s / 3),
  ];
  if (secondary === BOUNDARY) {
    return [triangle, [ // 282-288
      pt((2 * s) / 3 + y, y),
      pt(s - x, s / 3 - x),
      pt(s - x, s / 3),
      pt((2 * s) / 3, s / 3),
      pt(s / 2 + y, s / 6 + y),
    ]];
  }
  if (secondary === STRAIGHT) {
    return [triangle, [ // 293-299
      pt((2 * s) / 3 + y, y),
      pt((2 * s) / 3 + x, x),
      pt(s, x),
      pt(s, s / 3),
      pt((2 * s) / 3, s / 3),
      pt(s / 2 + y, s / 6 + y),
    ]];
  }
  return [triangle, [ // 304-308
    pt((2 * s) / 3 + y, y),
    pt(s, s / 3),
    pt((2 * s) / 3, s / 3),
    pt(s / 2 + y, s / 6 + y),
  ]];
}

/** Fill and stroke one closed polygon (Engine A's fill-then-stroke order). */
function drawPolygon(ctx: CanvasRenderingContext2D, vertices: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawPolygons(ctx: CanvasRenderingContext2D, polygons: Point[][]): void {
  for (const polygon of polygons) {
    drawPolygon(ctx, polygon);
  }
}

/** `grid[i][j].bump(side)` — reference lines 105-107: (state + 1) % 3. */
export function bumpSide(state: SideState): SideState {
  return ((state + 1) % 3) as SideState;
}

/** Side index mirrored left-to-right: up/down stay, right/left swap. */
function mirrorSideHorizontally(side: SideIndex): SideIndex {
  const mirror: readonly SideIndex[] = [UP, LEFT, DOWN, RIGHT];
  return mirror[side];
}

/** Side index mirrored top-to-bottom: left/right stay, up/down swap. */
function mirrorSideVertically(side: SideIndex): SideIndex {
  const mirror: readonly SideIndex[] = [DOWN, RIGHT, UP, LEFT];
  return mirror[side];
}

function isSideState(value: unknown): value is SideState {
  return value === BOUNDARY || value === STRAIGHT || value === CROSSED;
}

function makeEmptySides(rows: number, columns: number): Square[][] {
  const sides: Square[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: Square[] = [];
    for (let column = 0; column < columns; column++) {
      line.push([BOUNDARY, BOUNDARY, BOUNDARY, BOUNDARY]);
    }
    sides.push(line);
  }
  return sides;
}

/**
 * The chip-carving engine.
 *
 * Unlike Engine A there are no control nodes to select: the user clicks a
 * lattice edge and both squares beside it bump the side that touches it, so
 * the pattern is carved one edge at a time. `renderOverlay` therefore draws
 * only the lattice (when `showGrid`) — no node dots, no preview line — which
 * is a deliberate simplification, not an oversight.
 */
export class SideStateEngine implements KnotEngine {
  readonly id = 'side-state';
  readonly name = 'Chip carving (side-state)';

  private sides: Square[][] = makeEmptySides(0, 0);
  private rows = 0;
  private columns = 0;

  constructor(rows = 0, columns = 0) {
    this.resize(rows, columns);
  }

  // ---- engine-specific surface (deliberately outside the KnotEngine contract) ----

  /**
   * Rebuild the grid for a new knot size and clear it to all-boundary.
   *
   * Sizing is explicit, as with Engine A: nothing in the `KnotEngine`
   * contract carries the grid dimensions, so the caller resizes when the
   * knot size changes. `render`/`hitTest`/`onClick` deliberately do NOT
   * resize from the settings they are handed — that would silently discard
   * the pattern on any settings change.
   */
  resize(rows: number, columns: number): void {
    this.rows = Math.max(0, Math.floor(rows));
    this.columns = Math.max(0, Math.floor(columns));
    this.sides = makeEmptySides(this.rows, this.columns);
  }

  /** Current knotwork dimensions of the sides grid. */
  getDimensions(): { rows: number; columns: number } {
    return { rows: this.rows, columns: this.columns };
  }

  /**
   * Current sides grid, indexed [row][column][side]. Returns copies, so
   * mutating the result cannot reach into the engine's state.
   */
  getSides(): SideState[][][] {
    return this.sides.map((line) => line.map((square) => [...square]));
  }

  getSide(row: number, column: number, side: SideIndex): SideState {
    return this.sides[row][column][side];
  }

  /** Open or close the knot's borders in place. */
  setBorderState(state: 'open' | 'closed'): void {
    if (this.rows === 0 || this.columns === 0) {
      return;
    }
    const border: SideState = state === 'open' ? STRAIGHT : BOUNDARY;
    for (let column = 0; column < this.columns; column++) {
      this.sides[0][column][UP] = border;
      this.sides[this.rows - 1][column][DOWN] = border;
    }
    for (let row = 0; row < this.rows; row++) {
      this.sides[row][0][LEFT] = border;
      this.sides[row][this.columns - 1][RIGHT] = border;
    }
  }

  /** Cycle one side 0 -> 1 -> 2 -> 0. */
  private bump(row: number, column: number, side: SideIndex): void {
    if (row < 0 || row >= this.rows || column < 0 || column >= this.columns) {
      return;
    }
    this.sides[row][column][side] = bumpSide(this.sides[row][column][side]);
  }

  // ---- KnotEngine ----

  render(ctx: CanvasRenderingContext2D, settings: KnotSettings): void {
    const s = settings.cellSize;

    ctx.lineCap = 'square';
    ctx.lineJoin = 'round';
    ctx.fillStyle = settings.stringColor;
    ctx.strokeStyle = settings.strokeColor;
    ctx.lineWidth = settings.strokeWidth;

    for (let row = 0; row < this.rows; row++) {
      for (let column = 0; column < this.columns; column++) {
        ctx.save();
        ctx.translate(column * s, row * s);
        this.drawSquare(ctx, this.sides[row][column], s);
        ctx.restore();
      }
    }
  }

  /**
   * Draw one square at the current origin. Reference `display`,
   * lines 110-163: the frame is rotated a quarter turn after each quarter, so
   * quarter `i` sees the primary/secondary pair `(side i, side i+1)`.
   */
  private drawSquare(ctx: CanvasRenderingContext2D, square: Square, s: number): void {
    const sum = square[UP] + square[RIGHT] + square[DOWN] + square[LEFT];

    // All boundary: nothing to draw (lines 122-124).
    if (sum === 0) {
      return;
    }

    // Exactly one straight side: the rotated one-straight polygon
    // (lines 125-141).
    if (sum === 1) {
      const straight = square.indexOf(STRAIGHT) as SideIndex;
      for (let i = 0; i < straight; i++) {
        this.rotateQuarter(ctx, s);
      }
      drawPolygon(ctx, oneStraightPolygon(s));
      return;
    }

    // Four straight sides: four straight quarters (lines 142-150).
    if (
      square[UP] === STRAIGHT &&
      square[RIGHT] === STRAIGHT &&
      square[DOWN] === STRAIGHT &&
      square[LEFT] === STRAIGHT
    ) {
      for (let i = 0; i < 4; i++) {
        drawPolygons(ctx, fourStraightQuarter(s));
        this.rotateQuarter(ctx, s);
      }
      return;
    }

    // Standard square: the 3x3 quarter table (lines 151-159).
    for (let i = 0; i < 4; i++) {
      drawPolygons(ctx, quarterPolygons(square[i], square[(i + 1) % 4], s));
      this.rotateQuarter(ctx, s);
    }
  }

  /** `translate(s, 0); rotate(PI/2)` — the reference's per-quarter step. */
  private rotateQuarter(ctx: CanvasRenderingContext2D, s: number): void {
    ctx.translate(s, 0);
    ctx.rotate(Math.PI / 2);
  }

  randomize(seed?: number): void {
    const random = seed === undefined ? Math.random : mulberry32(seed);
    const total = Math.floor(this.rows * this.columns * 4 * 0.3);

    for (let i = 0; i < total; i++) {
      const row = Math.floor(random() * this.rows);
      const column = Math.floor(random() * this.columns);
      const side = Math.floor(random() * 4) as SideIndex;
      const state = Math.floor(random() * 3) as SideState;

      this.sides[row][column][side] = state;

      const mirrorColumn = this.columns - column - 1;
      const mirrorRow = this.rows - row - 1;
      const horizontalSide = mirrorSideHorizontally(side);

      if (random() * (BILATERAL_WEIGHT + QUADRILATERAL_WEIGHT) <= BILATERAL_WEIGHT) {
        this.sides[row][mirrorColumn][horizontalSide] = state;
      } else {
        this.sides[row][mirrorColumn][horizontalSide] = state;
        this.sides[mirrorRow][column][mirrorSideVertically(side)] = state;
        this.sides[mirrorRow][mirrorColumn][mirrorSideVertically(horizontalSide)] = state;
      }
    }
  }

  reset(): void {
    this.sides = makeEmptySides(this.rows, this.columns);
  }

  serialize(): unknown {
    const snapshot: SideStateSnapshot = {
      rows: this.rows,
      columns: this.columns,
      sides: this.sides.map((line) => line.map((square) => [...square])),
    };
    return snapshot;
  }

  deserialize(data: unknown): void {
    if (typeof data !== 'object' || data === null) {
      this.reset();
      return;
    }

    const candidate = data as Partial<SideStateSnapshot>;
    const rows = candidate.sides;
    if (
      typeof candidate.rows !== 'number' ||
      typeof candidate.columns !== 'number' ||
      !Array.isArray(rows) ||
      rows.length !== candidate.rows
    ) {
      this.reset();
      return;
    }

    const restored: Square[][] = [];
    for (let row = 0; row < rows.length; row++) {
      const line = rows[row];
      if (!Array.isArray(line) || line.length !== candidate.columns) {
        this.reset();
        return;
      }
      const squares: Square[] = [];
      for (let column = 0; column < line.length; column++) {
        const square = line[column];
        if (!Array.isArray(square) || square.length !== 4 || !square.every(isSideState)) {
          this.reset();
          return;
        }
        squares.push([...square] as Square);
      }
      restored.push(squares);
    }

    this.rows = candidate.rows;
    this.columns = candidate.columns;
    this.sides = restored;
  }

  imageSize(settings: KnotSettings): EngineImageSize {
    return {
      width: settings.columns * settings.cellSize,
      height: settings.rows * settings.cellSize,
    };
  }

  /**
   * Editor overlay: the lattice only. This engine edits by clicking edges, so
   * there are no control nodes to draw and no selection to preview; the
   * lattice is what tells the user which edge a click will hit.
   */
  renderOverlay(ctx: CanvasRenderingContext2D, settings: KnotSettings, _ui: EditorUiState): void {
    if (!settings.showUi || !settings.showGrid) {
      return;
    }
    const s = settings.cellSize;
    const width = this.columns * s;
    const height = this.rows * s;

    ctx.strokeStyle = settings.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let column = 0; column <= this.columns; column++) {
      ctx.moveTo(column * s, 0);
      ctx.lineTo(column * s, height);
    }
    for (let row = 0; row <= this.rows; row++) {
      ctx.moveTo(0, row * s);
      ctx.lineTo(width, row * s);
    }
    ctx.stroke();
  }

  /**
   * This engine's editing model has no selection concept — clicking an
   * edge applies immediately — so the UI state is a constant empty state
   * and the overlay (lattice only) never reads it.
   */
  get ui(): EditorUiState {
    return { selectedNode: null, hoverNode: null };
  }

  /**
   * Hover drives no rendering in this engine (the overlay is lattice-only
   * and edges are click-applied, not previewed), so this always reports
   * "unchanged" and the shell skips the redraw.
   */
  updateHover(_hit: EditorHit | null): boolean {
    return false;
  }

  /**
   * Nearest-lattice-line rule from the reference's `mousePressed`
   * (lines 45-84): round to the nearest lattice crossing, then whichever
   * axis is nearer decides the edge orientation. Returns null outside the
   * image, where the engine's pointer space has no edge to offer.
   */
  hitTest(x: number, y: number, settings: KnotSettings): EditorHit | null {
    const s = settings.cellSize;
    if (s <= 0 || this.rows === 0 || this.columns === 0) {
      return null;
    }
    if (x < 0 || y < 0 || x > this.columns * s || y > this.rows * s) {
      return null;
    }

    const i = Math.round(x / s);
    const j = Math.round(y / s);

    if (Math.abs(x - i * s) < Math.abs(y - j * s)) {
      // Closer to a vertical lattice line: a horizontal edge at row j,
      // between columns i-1 and i.
      return makeEdgeHit('h', Math.floor(y / s), i);
    }
    // Closer to a horizontal lattice line: a vertical edge at column i,
    // between rows j-1 and j.
    return makeEdgeHit('v', j, Math.floor(x / s));
  }

  /**
   * Bump the sides of both squares beside the clicked edge, cycling each
   * 0 -> 1 -> 2 -> 0. Out-of-bounds edges bump only the side that exists
   * (border edges), matching the reference's `if (i > 0)` / `if (i < w)`
   * guards at lines 56-66 and 72-82.
   */
  onClick(hit: EditorHit | null, _settings: KnotSettings): void {
    if (hit === null) {
      return;
    }
    const edge = asEdgeHit(hit);
    if (edge === null) {
      return;
    }

    if (edge.orientation === 'h') {
      if (edge.row < 0 || edge.row >= this.rows) {
        return;
      }
      if (edge.column > 0) {
        this.bump(edge.row, edge.column - 1, RIGHT);
      }
      if (edge.column < this.columns) {
        this.bump(edge.row, edge.column, LEFT);
      }
      return;
    }

    if (edge.column < 0 || edge.column >= this.columns) {
      return;
    }
    if (edge.row > 0) {
      this.bump(edge.row - 1, edge.column, DOWN);
    }
    if (edge.row < this.rows) {
      this.bump(edge.row, edge.column, UP);
    }
  }
}
