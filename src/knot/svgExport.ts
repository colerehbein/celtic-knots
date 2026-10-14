/**
 * Pure SVG export: renders a cut pattern to a standalone SVG document.
 *
 * This is the vector twin of `renderKnotwork` in ./render.ts. It reuses the
 * real tile matrix from ./tiles.ts by driving each tile function through a
 * recorder that implements just enough of the CanvasRenderingContext2D surface
 * to capture the drawing calls as SVG shapes. Geometry therefore cannot drift
 * from the canvas renderer: same coordinates, same quadratic/bezier control
 * points, same over/under outline break in drawCurvedCross.
 *
 * Transforms are recorded as SVG transform lists rather than being baked into
 * the coordinates, which keeps the emitted numbers exactly as tiles.ts wrote
 * them (a 90 degree rotate of an integer grid is exact either way, but baking
 * it in would introduce float noise and a second source of truth).
 *
 * Pure module: string in, string out. No canvas, no DOM.
 */

import { tileFor } from './tiles';
import { NO_CUT, ODD, type CutGrid, type CutState, type KnotSettings, type Parity } from './types';

/** Options for {@link exportSVG}. */
export interface SvgExportOptions {
  /** Multiplies every output dimension — width, height and viewBox (default 1). */
  scale?: number;
}

/** One recorded path segment. `Z` closes the current subpath. */
interface Segment {
  op: 'M' | 'L' | 'Q' | 'C' | 'Z';
  nums: number[];
}

/** A rectangle or path, as tiles.ts painted it. */
interface Shape {
  tag: 'rect' | 'path';
  /** Rect geometry (unused for paths). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** SVG path data (empty for rects). */
  d: string;
  /** Which paint call produced this shape. */
  painted: 'fill' | 'stroke';
  fill: string;
  stroke: string;
  strokeWidth: number;
  lineCap: string;
  lineJoin: string;
  /** SVG transform list in effect when the shape was painted. */
  transform: string;
}

/**
 * Format a number for SVG output: integers stay bare, everything else is
 * rounded to 4 decimal places with trailing zeros dropped, so output is
 * stable and byte-comparable.
 */
function fmt(n: number): string {
  const rounded = Math.round(n * 10000) / 10000;
  // String() is the shortest round-trippable form and never emits "-0" junk.
  return String(rounded);
}

/** Escape a value for use inside a double-quoted XML attribute. */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Serialise recorded segments into SVG path data. */
function buildPathData(segments: readonly Segment[]): string {
  let d = '';
  for (const seg of segments) {
    if (seg.op === 'Z') {
      d += 'Z ';
      continue;
    }
    const parts = seg.nums.map(fmt);
    if (seg.op === 'M' || seg.op === 'L') {
      d += `${seg.op} ${parts[0]} ${parts[1]} `;
    } else {
      const pairs: string[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        pairs.push(`${parts[i]} ${parts[i + 1]}`);
      }
      d += `${seg.op} ${pairs.join(' ')} `;
    }
  }
  return d.trim();
}

/**
 * A CanvasRenderingContext2D-shaped recorder: the tile functions in tiles.ts
 * are unaware they are writing SVG. Mirrors canvas semantics that matter here:
 *
 *  - the current path survives fill()/stroke() until the next beginPath();
 *  - moveTo() starts a new subpath, so drawStraightCross's outline (which
 *    contains two disjoint subpaths) stays two subpaths;
 *  - fill() paints only the fill, stroke() only the stroke, exactly like
 *    canvas — no implicit outline on filled shapes;
 *  - save()/restore() snapshot the whole drawing state, including transforms;
 *  - transforms compose in call order, matching canvas' CTM order.
 */
class SvgContext {
  readonly shapes: Shape[] = [];

  private segments: Segment[] = [];
  private transforms: string[] = [];
  private stateStack: { transforms: string[]; fillStyle: string; strokeStyle: string; lineWidth: number; lineCap: string; lineJoin: string }[] = [];

  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';

  private currentTransform(): string {
    return this.transforms.join(' ');
  }

  private record(painted: 'fill' | 'stroke'): void {
    const d = buildPathData(this.segments);
    if (d === '') return;
    this.shapes.push({
      tag: 'path',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      d,
      painted,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
      strokeWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      transform: this.currentTransform(),
    });
  }

  private recordRect(x: number, y: number, w: number, h: number, painted: 'fill' | 'stroke'): void {
    this.shapes.push({
      tag: 'rect',
      x,
      y,
      w,
      h,
      d: '',
      painted,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
      strokeWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      transform: this.currentTransform(),
    });
  }

  save(): void {
    this.stateStack.push({
      transforms: this.transforms.slice(),
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
    });
  }

  restore(): void {
    const state = this.stateStack.pop();
    if (state === undefined) return;
    this.transforms = state.transforms;
    this.fillStyle = state.fillStyle;
    this.strokeStyle = state.strokeStyle;
    this.lineWidth = state.lineWidth;
    this.lineCap = state.lineCap;
    this.lineJoin = state.lineJoin;
  }

  beginPath(): void {
    this.segments = [];
  }

  closePath(): void {
    this.segments.push({ op: 'Z', nums: [] });
  }

  moveTo(x: number, y: number): void {
    this.segments.push({ op: 'M', nums: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.segments.push({ op: 'L', nums: [x, y] });
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.segments.push({ op: 'Q', nums: [cx, cy, x, y] });
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.segments.push({ op: 'C', nums: [c1x, c1y, c2x, c2y, x, y] });
  }

  fill(): void {
    this.record('fill');
  }

  stroke(): void {
    this.record('stroke');
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.recordRect(x, y, w, h, 'fill');
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.recordRect(x, y, w, h, 'stroke');
  }

  translate(x: number, y: number): void {
    this.transforms.push(`translate(${fmt(x)} ${fmt(y)})`);
  }

  rotate(radians: number): void {
    this.transforms.push(`rotate(${fmt((radians * 180) / Math.PI)})`);
  }

  scale(sx: number, sy: number): void {
    this.transforms.push(`scale(${fmt(sx)} ${fmt(sy)})`);
  }
}

/** Read a cut, tolerating a grid that is smaller than the knot dimensions. */
function cutAt(cuts: CutGrid, row: number, column: number): CutState {
  if (row < 0 || row >= cuts.length) return NO_CUT;
  const line = cuts[row];
  if (column < 0 || column >= line.length) return NO_CUT;
  return line[column];
}

/**
 * The parity rules for one cell, copied from renderKnotwork in ./render.ts:
 * which cuts bound a cell depends on row/column parity. Kept in lockstep with
 * that function; render.ts stays the canvas source of truth.
 */
function cellCuts(
  cuts: CutGrid,
  x: number,
  y: number,
  rowParity: Parity,
  colParity: Parity,
): { firstCut: CutState; secondCut: CutState } {
  if (colParity === ODD) {
    return { firstCut: cutAt(cuts, y + 1, x / 2), secondCut: cutAt(cuts, y, x / 2) };
  }
  if (rowParity === ODD) {
    return { firstCut: cutAt(cuts, y + 1, (x + 1) / 2), secondCut: cutAt(cuts, y, (x - 1) / 2) };
  }
  return { firstCut: cutAt(cuts, y + 1, (x - 1) / 2), secondCut: cutAt(cuts, y, (x + 1) / 2) };
}

/** Render one cell's shapes with the tile matrix, in canvas paint order. */
function recordCell(cuts: CutGrid, s: KnotSettings, x: number, y: number): Shape[] {
  const ctx = new SvgContext();
  // Same drawing state renderKnotwork installs once before its loop.
  ctx.fillStyle = s.stringColor;
  ctx.strokeStyle = s.strokeColor;
  ctx.lineWidth = s.strokeWidth;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'round';

  ctx.translate(x * s.cellSize, y * s.cellSize);

  const rowParity = ((y + 1) % 2) as Parity;
  const colParity = ((x + 1) % 2) as Parity;
  const { firstCut, secondCut } = cellCuts(cuts, x, y, rowParity, colParity);

  tileFor(firstCut, secondCut, rowParity, colParity)(ctx as unknown as CanvasRenderingContext2D, s);

  return ctx.shapes;
}

/** Serialise a rect shape. */
function rectToSvg(shape: Shape): string {
  const transform = shape.transform === '' ? '' : ` transform="${attr(shape.transform)}"`;
  if (shape.painted === 'fill') {
    return `<rect x="${fmt(shape.x)}" y="${fmt(shape.y)}" width="${fmt(shape.w)}" height="${fmt(shape.h)}" fill="${attr(shape.fill)}"${transform}/>`;
  }
  return (
    `<rect x="${fmt(shape.x)}" y="${fmt(shape.y)}" width="${fmt(shape.w)}" height="${fmt(shape.h)}" ` +
    `fill="none" stroke="${attr(shape.stroke)}" stroke-width="${fmt(shape.strokeWidth)}" ` +
    `stroke-linecap="${attr(shape.lineCap)}" stroke-linejoin="${attr(shape.lineJoin)}"${transform}/>`
  );
}

/** Serialise a path shape. */
function pathToSvg(shape: Shape): string {
  const transform = shape.transform === '' ? '' : ` transform="${attr(shape.transform)}"`;
  if (shape.painted === 'fill') {
    return `<path d="${attr(shape.d)}" fill="${attr(shape.fill)}"${transform}/>`;
  }
  return (
    `<path d="${attr(shape.d)}" fill="none" stroke="${attr(shape.stroke)}" ` +
    `stroke-width="${fmt(shape.strokeWidth)}" stroke-linecap="${attr(shape.lineCap)}" ` +
    `stroke-linejoin="${attr(shape.lineJoin)}"${transform}/>`
  );
}

function shapeToSvg(shape: Shape): string {
  return shape.tag === 'rect' ? rectToSvg(shape) : pathToSvg(shape);
}

/**
 * Drop the cell's own translate from a shape's transform list — the enclosing
 * <g> already carries it, so repeating it on every shape is noise. Any
 * remaining transforms (rotate/flip from the tile wrappers) are preserved.
 */
function stripCellTransform(shape: Shape, cellTransform: string): Shape {
  let transform = shape.transform;
  if (transform === cellTransform) {
    transform = '';
  } else if (transform.startsWith(`${cellTransform} `)) {
    transform = transform.slice(cellTransform.length + 1);
  }
  return transform === shape.transform ? shape : { ...shape, transform };
}

/**
 * Render a cut pattern to a standalone SVG document.
 *
 * The document is cropped tight to the knotwork (no editor chrome: no grid,
 * no control nodes, no cut markers) — W x H is exactly
 * columns * cellSize by rows * cellSize, scaled by `opts.scale`.
 *
 * @param cuts    cut grid, indexed [row][column]; see computeCutDimensions
 * @param s       knot settings (dimensions come from s.rows / s.columns)
 * @param opts    { scale } — multiplies every output dimension (default 1)
 */
export function exportSVG(cuts: CutGrid, s: KnotSettings, opts: SvgExportOptions = {}): string {
  const scale = opts.scale ?? 1;
  const w = s.columns * s.cellSize;
  const h = s.rows * s.cellSize;
  const width = w * scale;
  const height = h * scale;

  const body: string[] = [
    `  <rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" fill="${attr(s.backgroundColor)}"/>`,
  ];
  // Same loop order as renderKnotwork: columns outer, rows inner.
  for (let x = 0; x < s.columns; x++) {
    for (let y = 0; y < s.rows; y++) {
      const shapes = recordCell(cuts, s, x, y);
      if (shapes.length === 0) continue;
      const cellTransform = `translate(${fmt(x * s.cellSize)} ${fmt(y * s.cellSize)})`;
      body.push(`  <g transform="${attr(cellTransform)}">`);
      for (const raw of shapes) {
        body.push(`    ${shapeToSvg(stripCellTransform(raw, cellTransform))}`);
      }
      body.push('  </g>');
    }
  }

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" ` +
      `width="${fmt(width)}" height="${fmt(height)}">`,
  ];

  if (scale === 1) {
    for (const line of body) lines.push(line);
  } else {
    // Scaling every output dimension is a single group transform: recorded
    // coordinates stay untouched, so output differs only by width/height/
    // viewBox plus this wrapper.
    lines.push('  <g transform="scale(' + fmt(scale) + ')">');
    for (const line of body) lines.push(`  ${line}`);
    lines.push('  </g>');
  }

  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}
