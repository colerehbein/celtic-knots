import {
  DEFAULT_SETTINGS,
  MIN_CANVAS_HEIGHT,
  MIN_CANVAS_WIDTH,
  OUTPUT_OFFSET,
  type CutGrid,
  type CutState,
  type KnotNode,
  type KnotSettings,
} from './types';
import {
  applyCut,
  canCut,
  computeCutDimensions,
  isSameNode,
  makeBetterRandomPattern,
  makeEmptyPattern,
  setBorderState,
} from './pattern';
import {
  getClosestNode,
  renderControlNodes,
  renderCuts,
  renderGrid,
  renderKnotwork,
} from './render';

export interface ImageDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A Celtic knot generator + pattern editor bound to one canvas.
 *
 * The pattern is a grid of "cuts" (breaks between strands). Each knot cell is
 * rendered from the two nearest cuts plus row/column parity. Users edit the
 * pattern by clicking control nodes to draw cuts between them.
 */
export class KnotEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private settings: KnotSettings;
  private cuts: CutGrid;
  private cutRows = 0;
  private cutColumns = 0;
  private selectedNode: KnotNode | null = null;
  private hoverNode: KnotNode | null = null;

  constructor(canvas: HTMLCanvasElement, overrides: Partial<KnotSettings> = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = ctx;
    this.settings = { ...DEFAULT_SETTINGS, ...overrides };
    this.cuts = [];

    this.setKnotworkSize(this.settings.rows, this.settings.columns);
    this.bindEvents();
    this.redraw();
  }

  // ---- events ----

  private bindEvents(): void {
    this.canvas.addEventListener('mousemove', (event) => this.onMouseMove(event));
    this.canvas.addEventListener('click', (event) => this.onClick(event));
  }

  private pageToCanvas(pageX: number, pageY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: pageX - rect.left - OUTPUT_OFFSET.x,
      y: pageY - rect.top - OUTPUT_OFFSET.y,
    };
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.settings.showUi) {
      return;
    }

    const position = this.pageToCanvas(event.pageX, event.pageY);
    let closest = getClosestNode(this.settings, position.x, position.y);

    // While a node is selected, only nodes that can actually be cut to are valid targets.
    if (closest !== null && this.selectedNode !== null && !canCut(this.selectedNode, closest)) {
      closest = null;
    }

    if (!isSameNode(closest, this.hoverNode)) {
      this.hoverNode = closest;
      this.redraw();
    }
  }

  private onClick(event: MouseEvent): void {
    if (!this.settings.showUi) {
      return;
    }

    const position = this.pageToCanvas(event.pageX, event.pageY);
    const closest = getClosestNode(this.settings, position.x, position.y);

    if (closest !== null) {
      if (isSameNode(this.selectedNode, closest)) {
        // Clicking the selected node deselects it.
        this.selectedNode = null;
      } else if (this.selectedNode === null) {
        this.selectedNode = closest;
      } else if (canCut(this.selectedNode, closest)) {
        applyCut(this.cuts, this.selectedNode, closest);
        this.selectedNode = null;
        this.hoverNode = null;
      } else {
        // Invalid target: just deselect.
        this.selectedNode = null;
      }
    } else if (this.selectedNode !== null) {
      // Empty space: deselect.
      this.selectedNode = null;
    }

    this.redraw();
  }

  // ---- rendering ----

  redraw(): void {
    const ctx = this.ctx;
    const s = this.settings;

    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(OUTPUT_OFFSET.x, OUTPUT_OFFSET.y);

    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(0, 0, s.cellSize * s.columns, s.cellSize * s.rows);

    if (s.showUi && s.showGrid) {
      renderGrid(ctx, s);
    }

    renderKnotwork(ctx, s, this.cuts);

    if (s.showUi) {
      renderCuts(ctx, s, this.cuts);
      renderControlNodes(ctx, s, this.selectedNode, this.hoverNode, canCut);
    }

    ctx.restore();
  }

  // ---- pattern operations ----

  resetPattern(): void {
    this.cuts = makeEmptyPattern(this.cutRows, this.cutColumns);
    this.selectedNode = null;
    this.hoverNode = null;
    this.redraw();
  }

  randomizePattern(): void {
    this.cuts = makeBetterRandomPattern(this.cutRows, this.cutColumns);
    this.selectedNode = null;
    this.hoverNode = null;
    this.redraw();
  }

  setKnotworkSize(rows: number, columns: number): void {
    // Knotwork dimensions must be even.
    if (rows % 2 === 1) rows++;
    if (columns % 2 === 1) columns++;

    this.settings.rows = rows;
    this.settings.columns = columns;

    const { cutRows, cutColumns } = computeCutDimensions(rows, columns);
    this.cutRows = cutRows;
    this.cutColumns = cutColumns;

    // Resize the canvas to fit, never below the initial 600x500.
    const canvasWidth = Math.max(OUTPUT_OFFSET.x + columns * this.settings.cellSize + 15, MIN_CANVAS_WIDTH);
    const canvasHeight = Math.max(OUTPUT_OFFSET.y + rows * this.settings.cellSize + 15, MIN_CANVAS_HEIGHT);
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    this.resetPattern();
  }

  setBorderState(state: 'open' | 'closed'): void {
    setBorderState(this.cuts, state);
    this.redraw();
  }

  closeBorder(): void {
    this.setBorderState('closed');
  }

  openBorder(): void {
    this.setBorderState('open');
  }

  showUi(show: boolean): void {
    this.settings.showUi = show;
    this.redraw();
  }

  showGrid(show: boolean): void {
    this.settings.showGrid = show;
    this.redraw();
  }

  // ---- sizing ----

  setCellSize(size: number): void {
    this.settings.cellSize = Math.max(size, 12);
    if (this.settings.stringSize > this.settings.cellSize - 2) {
      this.settings.stringSize = this.settings.cellSize - 2;
    }
    if (this.settings.strokeWidth > this.settings.cellSize - 2) {
      this.settings.strokeWidth = this.settings.cellSize - 2;
    }
    this.setKnotworkSize(this.settings.rows, this.settings.columns);
    this.redraw();
  }

  setStringSize(size: number): void {
    this.settings.stringSize = Math.min(Math.max(size, 1), this.settings.cellSize - 2);
    this.redraw();
  }

  setStrokeWidth(width: number): void {
    this.settings.strokeWidth = Math.min(Math.max(width, 1), this.settings.cellSize - 2);
    this.redraw();
  }

  getCellSize(): number {
    return this.settings.cellSize;
  }

  getStringSize(): number {
    return this.settings.stringSize;
  }

  getStrokeWidth(): number {
    return this.settings.strokeWidth;
  }

  // ---- colors ----

  setStringColor(color: string): void {
    this.settings.stringColor = color;
    this.redraw();
  }

  setStrokeColor(color: string): void {
    this.settings.strokeColor = color;
    this.redraw();
  }

  setBackgroundColor(color: string): void {
    this.settings.backgroundColor = color;
    this.redraw();
  }

  getStringColor(): string {
    return this.settings.stringColor;
  }

  getStrokeColor(): string {
    return this.settings.strokeColor;
  }

  getBackgroundColor(): string {
    return this.settings.backgroundColor;
  }

  // ---- grid info ----

  getGridWidth(): number {
    return this.settings.columns;
  }

  getGridHeight(): number {
    return this.settings.rows;
  }

  /** Pixel position and dimensions of the generated knot on the canvas. */
  getImageDimensions(): ImageDimensions {
    return {
      x: OUTPUT_OFFSET.x,
      y: OUTPUT_OFFSET.y,
      width: this.settings.columns * this.settings.cellSize,
      height: this.settings.rows * this.settings.cellSize,
    };
  }

  // ---- export ----

  /** Render the knot alone (no editor UI) to a standalone offscreen canvas. */
  private renderExportCanvas(): HTMLCanvasElement {
    const s = this.settings;
    const out = document.createElement('canvas');
    out.width = s.columns * s.cellSize;
    out.height = s.rows * s.cellSize;
    const ctx = out.getContext('2d');
    if (!ctx) {
      throw new Error('Export canvas 2D context unavailable');
    }

    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
    renderKnotwork(ctx, s, this.cuts);

    return out;
  }

  /** The knot as a PNG blob, without any editor overlay. */
  toPNG(): Promise<Blob> {
    const out = this.renderExportCanvas();
    return new Promise((resolve, reject) => {
      out.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('PNG encoding failed'));
        }
      }, 'image/png');
    });
  }

  /** Trigger a browser download of the knot as a PNG. */
  async downloadPNG(filename = 'celtic-knot.png'): Promise<void> {
    const blob = await this.toPNG();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /** Current cut grid (read-only view for tests/debugging). */
  getCuts(): readonly (readonly CutState[])[] {
    return this.cuts;
  }

  getCutValue(row: number, column: number): CutState {
    return this.cuts[row][column];
  }
}
