import type { KnotNode, KnotSettings } from '../types';

/** Pixel dimensions of the image an engine draws. */
export interface EngineImageSize {
  width: number;
  height: number;
}

/**
 * Transient editor interaction state owned by an engine.
 *
 * Both node slots are `{ row, column }` positions in the engine's own
 * control-node space, or null when nothing is selected/hovered.
 */
export interface EditorUiState {
  selectedNode: KnotNode | null;
  hoverNode: KnotNode | null;
}

/**
 * What a pointer position resolves to for a given engine.
 *
 * `node` is null when the pointer sits over empty space rather than on a
 * control node, which is a meaningful outcome (it deselects).
 */
export interface EditorHit {
  node: KnotNode | null;
}

/**
 * A pluggable knot engine.
 *
 * An engine owns its pattern state (here: the cut grid) plus the transient
 * selection state, and knows how to draw itself, answer pointer queries and
 * mutate itself in response to clicks. The editor owns the canvas, the
 * `KnotSettings` and everything that is not engine-specific (grid backdrop,
 * background fill, export plumbing).
 */
export interface KnotEngine {
  readonly id: 'cut-parity' | 'side-state';
  readonly name: string;

  /**
   * Draw the knot itself, with no editor overlay.
   *
   * `revealCells` is the self-drawing animation's reveal budget: when given,
   * the engine draws only the first `revealCells` cells of its own natural
   * iteration order (cut-parity: columns outer, rows inner; side-state: its
   * own row/column order). Omitted or undefined draws every cell — the
   * behaviour this interface had before the parameter existed.
   */
  render(ctx: CanvasRenderingContext2D, settings: KnotSettings, revealCells?: number): void;

  /** Replace the pattern with a fresh random one. `seed` makes it repeatable. */
  randomize(seed?: number): void;

  /** Replace the pattern with the empty one and clear selection state. */
  reset(): void;

  /** Opaque snapshot of the engine's state, for save/restore. */
  serialize(): unknown;

  /** Restore state produced by `serialize()`. Bad input resets instead. */
  deserialize(data: unknown): void;

  /** Size of the rendered image in pixels for the given settings. */
  imageSize(settings: KnotSettings): EngineImageSize;

  /** Draw the editor overlay (cut markers, control nodes, preview line). */
  renderOverlay(ctx: CanvasRenderingContext2D, settings: KnotSettings, ui: EditorUiState): void;

  /**
   * Engine-owned editor UI state (selection/hover), read by the shell for
   * overlay rendering. Engines whose editing model has no selection
   * concept may report a constant empty state.
   */
  readonly ui: EditorUiState;

  /**
   * Push a hover hit into the engine. Returns true when the visible hover
   * state changed and the caller should redraw.
   */
  updateHover(hit: EditorHit | null): boolean;

  /** Change the knot dimensions (must keep settings.rows/columns in sync). */
  resize(rows: number, columns: number): void;

  /**
   * The knotwork dimensions this engine's pattern currently occupies.
   *
   * A restored pattern carries its own grid size, so whoever deserializes it
   * needs to learn what that size is in order to resize anything that renders
   * or lays out through `settings` (the canvas above all).
   */
  getDimensions(): { rows: number; columns: number };

  /** Open or close the knot's borders. */
  setBorderState(state: 'open' | 'closed'): void;

  /**
   * Resolve a canvas point (OUTPUT_OFFSET already subtracted) to a hit.
   * Returns null when the engine's pointer space has no notion of a hit here.
   */
  hitTest(x: number, y: number, settings: KnotSettings): EditorHit | null;

  /** Apply a click on `hit` to the engine's state machine. */
  onClick(hit: EditorHit | null, settings: KnotSettings): void;
}
