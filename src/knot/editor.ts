import {
  DEFAULT_SETTINGS,
  MIN_CANVAS_HEIGHT,
  MIN_CANVAS_WIDTH,
  OUTPUT_OFFSET,
  type KnotSettings,
} from './types';
import { renderGrid } from './render';
import { CutParityEngine } from './engines/cutParity';
import { UndoStack } from './undo';
import type { EditorHit, EngineImageSize, KnotEngine } from './engines/types';

export interface ImageDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A Celtic knot generator + pattern editor bound to one canvas.
 *
 * The editor owns the canvas, the `KnotSettings` and the export plumbing; the
 * pattern itself lives behind a `KnotEngine`. Today there is exactly one
 * engine (`cut-parity`: a grid of cuts between strands, edited through control
 * nodes) but the seam is the point — a second engine plugs in without touching
 * this class.
 */
export class KnotEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private settings: KnotSettings;
  private engine: KnotEngine;
  private readonly undoStack = new UndoStack<unknown>();

  constructor(canvas: HTMLCanvasElement, overrides: Partial<KnotSettings> = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = ctx;
    this.settings = { ...DEFAULT_SETTINGS, ...overrides };
    this.engine = new CutParityEngine();

    this.setKnotworkSize(this.settings.rows, this.settings.columns);
    this.bindEvents();
    this.redraw();
  }

  /** The active engine. */
  getEngine(): KnotEngine {
    return this.engine;
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
    const hit = this.engine.hitTest(position.x, position.y, this.settings);

    if (this.engine.updateHover(hit)) {
      this.redraw();
    }
  }

  private onClick(event: MouseEvent): void {
    if (!this.settings.showUi) {
      return;
    }

    const position = this.pageToCanvas(event.pageX, event.pageY);
    const hit: EditorHit | null = this.engine.hitTest(position.x, position.y, this.settings);
    const snapshot = this.engine.serialize();
    this.engine.onClick(hit, this.settings);
    // Only clicks that actually cut/erased a strand are undoable — a pure
    // select/deselect is transient UI state, not a pattern mutation.
    // Compare serialized state so this works for any engine.
    if (JSON.stringify(this.engine.serialize()) !== JSON.stringify(snapshot)) {
      this.undoStack.record(snapshot);
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

    this.engine.render(ctx, s);
    this.engine.renderOverlay(ctx, s, this.engine.ui);

    ctx.restore();
  }

  // ---- pattern operations ----

  resetPattern(): void {
    this.undoStack.record(this.engine.serialize());
    this.engine.reset();
    this.redraw();
  }

  randomizePattern(seed?: number): void {
    this.undoStack.record(this.engine.serialize());
    this.engine.randomize(seed);
    this.redraw();
  }

  setKnotworkSize(rows: number, columns: number): void {
    // Knotwork dimensions must be even.
    if (rows % 2 === 1) rows++;
    if (columns % 2 === 1) columns++;

    this.settings.rows = rows;
    this.settings.columns = columns;

    this.engine.resize(rows, columns);

    // Resize the canvas to fit, never below the initial 600x500.
    const canvasWidth = Math.max(OUTPUT_OFFSET.x + columns * this.settings.cellSize + 15, MIN_CANVAS_WIDTH);
    const canvasHeight = Math.max(OUTPUT_OFFSET.y + rows * this.settings.cellSize + 15, MIN_CANVAS_HEIGHT);
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    this.redraw();
  }

  setBorderState(state: 'open' | 'closed'): void {
    this.undoStack.record(this.engine.serialize());
    this.engine.setBorderState(state);
    this.redraw();
  }

  closeBorder(): void {
    this.setBorderState('closed');
  }

  openBorder(): void {
    this.setBorderState('open');
  }

  // ---- undo / redo ----

  /** Step the pattern back one state. Returns false when there is nothing to undo. */
  undo(): boolean {
    const previous = this.undoStack.undo(this.engine.serialize());
    if (previous === null) {
      return false;
    }
    this.engine.deserialize(previous);
    this.redraw();
    return true;
  }

  /** Step the pattern forward one state. Returns false when there is nothing to redo. */
  redo(): boolean {
    const next = this.undoStack.redo(this.engine.serialize());
    if (next === null) {
      return false;
    }
    this.engine.deserialize(next);
    this.redraw();
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.canUndo();
  }

  canRedo(): boolean {
    return this.undoStack.canRedo();
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
    const size = this.engine.imageSize(this.settings);
    return {
      x: OUTPUT_OFFSET.x,
      y: OUTPUT_OFFSET.y,
      width: size.width,
      height: size.height,
    };
  }

  // ---- export ----

  /** Render the knot alone (no editor UI) to a standalone offscreen canvas. */
  private renderExportCanvas(): HTMLCanvasElement {
    const s = this.settings;
    const out = document.createElement('canvas');
    const size: EngineImageSize = this.engine.imageSize(s);
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext('2d');
    if (!ctx) {
      throw new Error('Export canvas 2D context unavailable');
    }

    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
    this.engine.render(ctx, s);

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
}
