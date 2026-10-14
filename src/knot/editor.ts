import {
  DEFAULT_SETTINGS,
  MIN_CANVAS_HEIGHT,
  MIN_CANVAS_WIDTH,
  OUTPUT_OFFSET,
  type KnotSettings,
} from './types';
import { renderGrid } from './render';
import { CutParityEngine } from './engines/cutParity';
import { SideStateEngine } from './engines/sideState';
import { UndoStack } from './undo';
import { downloadBlob } from './download';
import type { EditorHit, EngineImageSize, KnotEngine } from './engines/types';

export interface ImageDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whole-number pixel multiples the export UI offers. 1x is the default. */
export type ExportScale = 1 | 2 | 4;

/**
 * Every pluggable engine the editor knows about. Kept as a literal union
 * (not `KnotEngine['id']`) so `setEngine` can be driven by a `<select>` value
 * while still being checked at compile time.
 */
export type EngineId = 'cut-parity' | 'side-state';

/**
 * A named grid + cell-size combination sized to hit an exact pixel target.
 *
 * Every preset uses an integer cell size (no fractional scaling, so the
 * knot renders crisply at 1x) and even grid dimensions — `setKnotworkSize`
 * silently rounds odd ones up, which would break the pixel math below.
 *
 * `a4-300dpi` is the one approximate target: A4 at 300dpi is 2480x3508, and
 * 2480 = 62 * 40 exactly while 3508 / 40 = 87.7. Rounding the height up to
 * the nearest even grid (88 rows) yields 3520px, 12px taller than true A4
 * (+0.34%) with the width dead on. 31px cells would have fit the height more
 * closely (113 rows -> 3503) but 113 is odd, so the even-grid rule pushes it
 * to 114 rows -> 3534, a worse miss.
 */
export interface SizePreset {
  id: string;
  label: string;
  rows: number;
  columns: number;
  cellSize: number;
}

/** Presets offered by the "Size presets" buttons; ids double as element ids. */
export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: 'icon-512', label: 'Icon 512', rows: 16, columns: 16, cellSize: 32 },
  { id: 'banner-1400x300', label: 'Banner', rows: 6, columns: 28, cellSize: 50 },
  { id: 'a4-300dpi', label: 'A4 300dpi', rows: 88, columns: 62, cellSize: 40 },
];

/**
 * Pixels of pointer travel that still count as a plain click rather than a
 * drag. Real hands jitter a few pixels between press and release; without a
 * threshold that noise would turn every click into a spurious drag-cut.
 */
const DRAG_THRESHOLD = 4;

/**
 * A Celtic knot generator + pattern editor bound to one canvas.
 *
 * The editor owns the canvas, the `KnotSettings` and the export plumbing; the
 * pattern itself lives behind a `KnotEngine`. There are two engines —
 * `cut-parity` (a grid of cuts between strands, edited through control nodes)
 * and `side-state` (chip carving, clicked one lattice edge at a time) — and
 * the editor keeps a live instance of each so switching engines preserves the
 * pattern that engine had.
 *
 * The undo stack is engine-agnostic in code but engine-specific in data: a
 * snapshot is opaque JSON for whichever engine produced it, so `setEngine`
 * clears it rather than let a cross-engine undo deserialize the wrong shape.
 */
export class KnotEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private settings: KnotSettings;

  /**
   * Engine instances, created on first use (see `setEngine`) and kept alive
   * for the editor's lifetime so each retains its own pattern.
   */
  private readonly engines = new Map<EngineId, KnotEngine>();

  /**
   * Grid dimensions each known engine was last sized to.
   *
   * `resize()` rebuilds the pattern from scratch, so it must not be called on
   * a merely inactive engine — that would throw away the pattern the user left
   * there. Only an engine whose recorded size differs from `settings` (a
   * brand-new one, or one that sat out a grid resize) gets resized.
   */
  private readonly engineSizes = new Map<EngineId, { rows: number; columns: number }>();

  private engine: KnotEngine;
  private readonly undoStack = new UndoStack<unknown>();

  /**
   * Active pointer gesture, or null when no button is held. `hit` is the hit
   * the pointer went down on; `pageX/pageY` are the press coordinates, used to
   * tell a plain click from a drag.
   */
  private gesture: { pointerId: number; hit: EditorHit | null; pageX: number; pageY: number } | null = null;

  constructor(canvas: HTMLCanvasElement, overrides: Partial<KnotSettings> = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = ctx;
    this.settings = { ...DEFAULT_SETTINGS, ...overrides };

    // cut-parity is the default: a fresh load must behave exactly like 1.0,
    // so it is the one engine constructed eagerly.
    this.engine = new CutParityEngine();
    this.engines.set('cut-parity', this.engine);

    this.setKnotworkSize(this.settings.rows, this.settings.columns);
    this.bindEvents();
    this.redraw();
  }

  /** The active engine. */
  getEngine(): KnotEngine {
    return this.engine;
  }

  /** Id of the active engine. `cut-parity` until something switches it. */
  getEngineId(): EngineId {
    return this.engine.id;
  }

  /**
   * The active engine's pattern, as an opaque snapshot. This is what a share
   * link carries; `loadPattern` is its inverse.
   */
  getPattern(): unknown {
    return this.engine.serialize();
  }

  /**
   * Restore a pattern captured by `getPattern()` onto the named engine.
   *
   * Used by share-link loading, so `engineId` arrives as an untrusted string
   * and is validated here: an unknown id is a no-op rather than a crash. The
   * engine switch happens before the deserialize, so a bad pattern lands on
   * the right engine and — since `deserialize` resets on malformed input —
   * worst case shows that engine's empty grid rather than breaking the page.
   *
   * A pattern carries its own grid size, and the renderer reads the grid
   * through `settings`, so the editor's dimensions follow the loaded pattern.
   * Without this a link from a 4x8 knot would render a 12x12 grid against a
   * 4x8 set of cuts and index past the end of it.
   */
  loadPattern(engineId: string, pattern: unknown): void {
    if (engineId !== 'cut-parity' && engineId !== 'side-state') {
      return;
    }
    if (engineId !== this.engine.id) {
      this.setEngine(engineId);
    }
    this.engine.deserialize(pattern);

    const { rows, columns } = this.engine.getDimensions();
    if (rows !== this.settings.rows || columns !== this.settings.columns) {
      this.settings.rows = rows;
      this.settings.columns = columns;
      this.engineSizes.set(this.engine.id, { rows, columns });
      this.resizeCanvas();
    }

    this.redraw();
  }

  /**
   * Switch the active engine.
   *
   * Each engine is instantiated once and kept in `engines`, so the pattern the
   * incoming engine had is untouched — switching back restores it exactly.
   * The new engine is resized only when its grid does not match the current
   * dimensions (a lazily created engine, or one that sat out a grid resize);
   * resizing an already-correct engine would blank its pattern. The undo stack
   * is cleared (its snapshots belong to the outgoing engine and would
   * deserialize into the wrong shape) and the canvas is redrawn. Selecting the
   * already-active engine is a no-op.
   */
  setEngine(id: EngineId): void {
    if (id === this.engine.id) {
      return;
    }

    let next = this.engines.get(id);
    if (next === undefined) {
      next = id === 'side-state' ? new SideStateEngine() : new CutParityEngine();
      this.engines.set(id, next);
    }

    const size = this.engineSizes.get(id);
    if (size === undefined || size.rows !== this.settings.rows || size.columns !== this.settings.columns) {
      next.resize(this.settings.rows, this.settings.columns);
      this.engineSizes.set(id, { rows: this.settings.rows, columns: this.settings.columns });
    }

    this.engine = next;
    this.undoStack.clear();
    this.gesture = null;
    this.redraw();
  }

  // ---- events ----

  /**
   * Pointer Events replace mouse events wholesale: `pointerdown` fires the
   * engine's click state machine once (1.0 semantics), `pointermove` drives
   * hover preview, and `pointerup` completes a drag only when it landed on a
   * *different* hit — a same-hit release is already handled by the down, so
   * running the state machine again would select-then-deselect a plain click.
   */
  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.canvas.addEventListener('pointercancel', () => this.onPointerCancel());
  }

  private pageToCanvas(pageX: number, pageY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: pageX - rect.left - OUTPUT_OFFSET.x,
      y: pageY - rect.top - OUTPUT_OFFSET.y,
    };
  }

  /**
   * Hover preview. Runs with no button held exactly like the old mousemove,
   * and mid-drag so the preview line tracks the target node.
   */
  private onPointerMove(event: PointerEvent): void {
    if (!this.settings.showUi) {
      return;
    }

    const position = this.pageToCanvas(event.pageX, event.pageY);
    const hit = this.engine.hitTest(position.x, position.y, this.settings);

    if (this.engine.updateHover(hit)) {
      this.redraw();
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.settings.showUi) {
      return;
    }

    const position = this.pageToCanvas(event.pageX, event.pageY);
    const hit = this.engine.hitTest(position.x, position.y, this.settings);

    // The down IS the click: select / deselect / apply-cut / immediate bump.
    this.applyEngineClick(hit);
    this.gesture = { pointerId: event.pointerId, hit, pageX: event.pageX, pageY: event.pageY };

    // Keep tracking this pointer after it leaves the canvas, so a drag that
    // runs off the edge still reports its release.
    if (typeof this.canvas.setPointerCapture === 'function') {
      this.canvas.setPointerCapture(event.pointerId);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    this.gesture = null;

    const distance = Math.hypot(
      event.pageX - gesture.pageX,
      event.pageY - gesture.pageY,
    );

    // A press and release within DRAG_THRESHOLD is a plain click, and
    // pointerdown already ran the engine's state machine for it — firing
    // again would select-then-deselect (or bump a side twice). Only a real
    // drag completes on release.
    //
    // Movement, not hit equality, is the discriminator: `hitTest` is
    // stateful (once a node is selected, the same position re-tests as
    // "not a valid target"), so comparing up/down hits would flag every
    // ordinary click as a change.
    if (distance <= DRAG_THRESHOLD) {
      return;
    }

    const position = this.pageToCanvas(event.pageX, event.pageY);
    const upHit = this.engine.hitTest(position.x, position.y, this.settings);
    this.applyEngineClick(upHit);
  }

  private onPointerCancel(): void {
    // The OS reclaimed the gesture (e.g. a touch became a scroll): drop the
    // drag without applying anything. The pointerdown's cut stays.
    this.gesture = null;
  }

  /**
   * Run the engine's click state machine and record an undo step when the
   * pattern actually changed. Only clicks that cut/erased a strand are
   * undoable — a pure select/deselect is transient UI state. Comparing
   * serialized state keeps this engine-agnostic.
   */
  private applyEngineClick(hit: EditorHit | null): void {
    const snapshot = this.engine.serialize();
    this.engine.onClick(hit, this.settings);
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
    // Only the active engine is resized; the idle ones keep their patterns
    // and are recorded as stale, so the next switch to one resizes it to the
    // new grid.
    this.engineSizes.set(this.engine.id, { rows, columns });

    this.resizeCanvas();
    this.redraw();
  }

  /**
   * Apply a named size preset (`SIZE_PRESETS`): grid dimensions plus cell
   * size in one shot. Cell size is applied first so `setKnotworkSize`'s
   * canvas resize inside `setCellSize` happens at the preset's scale.
   * Returns false for an unknown id, leaving the editor untouched.
   */
  applySizePreset(id: string): boolean {
    const preset = SIZE_PRESETS.find((candidate) => candidate.id === id);
    if (preset === undefined) {
      return false;
    }
    this.setCellSize(preset.cellSize);
    this.setKnotworkSize(preset.rows, preset.columns);
    return true;
  }

  /** Size the canvas to fit the current grid, never below the initial 600x500. */
  private resizeCanvas(): void {
    const canvasWidth = Math.max(OUTPUT_OFFSET.x + this.settings.columns * this.settings.cellSize + 15, MIN_CANVAS_WIDTH);
    const canvasHeight = Math.max(OUTPUT_OFFSET.y + this.settings.rows * this.settings.cellSize + 15, MIN_CANVAS_HEIGHT);
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;
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

  isOverlayVisible(): boolean {
    return this.settings.showUi;
  }

  isGridVisible(): boolean {
    return this.settings.showGrid;
  }

  /**
   * Drop the engine's selection — the keyboard equivalent of clicking empty
   * space. Selection is engine-owned state, so the editor cannot clear it
   * directly; it asks the engine through the same `onClick` door the pointer
   * path uses, which every engine already implements (engines without a
   * selection concept treat it as a no-op).
   */
  deselect(): void {
    this.engine.onClick({ node: null }, this.settings);
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
  private renderExportCanvas(scale: ExportScale): HTMLCanvasElement {
    const s = this.settings;
    const out = document.createElement('canvas');
    const size: EngineImageSize = this.engine.imageSize(s);
    out.width = size.width * scale;
    out.height = size.height * scale;
    const ctx = out.getContext('2d');
    if (!ctx) {
      throw new Error('Export canvas 2D context unavailable');
    }

    // Background covers the whole (scaled) bitmap, so paint it unscaled.
    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
    // Scale the coordinate system so the engine's 1x geometry lands crisply
    // at every pixel multiple.
    ctx.scale(scale, scale);
    this.engine.render(ctx, s);

    return out;
  }

  /** The knot as a PNG blob, without any editor overlay. Defaults to 1x. */
  toPNG(scale: ExportScale = 1): Promise<Blob> {
    const out = this.renderExportCanvas(scale);
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

  /** Trigger a browser download of the knot as a PNG. Defaults to 1x. */
  async downloadPNG(filename = 'celtic-knot.png', scale: ExportScale = 1): Promise<void> {
    const blob = await this.toPNG(scale);
    downloadBlob(blob, filename);
  }
}
