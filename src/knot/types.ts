/** Cut states: what kind of break sits between two strands. */
export const NO_CUT = 0;
export const HORIZ_CUT = 1;
export const VERT_CUT = 2;

export type CutState = typeof NO_CUT | typeof HORIZ_CUT | typeof VERT_CUT;

/** Parity constants used by the tile matrix. */
export const ODD = 1;
export const EVEN = 0;
export type Parity = typeof ODD | typeof EVEN;

export interface KnotSettings {
  /** Knot dimensions in cells. Always even. */
  rows: number;
  columns: number;

  cellSize: number;
  stringSize: number;
  strokeWidth: number;

  stringColor: string;
  strokeColor: string;
  backgroundColor: string;

  /** Editor UI colors. */
  gridColor: string;
  cutColor: string;
  newCutColor: string;
  controlNodeColor1: string;
  controlNodeColor2: string;

  showGrid: boolean;
  showUi: boolean;

  /**
   * Neon glow around the strands (canvas shadow). Off by default, and with
   * it off the renderers issue no shadow calls at all — so the glow is a
   * pure addition to the canvas call stream, never a change to it.
   */
  glow: boolean;

  controlNodeSize: number;
  selectedControlNodeSize: number;
}

export const DEFAULT_SETTINGS: KnotSettings = {
  rows: 12,
  columns: 12,

  cellSize: 30,
  stringSize: 12,
  strokeWidth: 2,
  stringColor: '#FF9A39',
  strokeColor: '#000000',
  backgroundColor: '#FFFFFF',

  gridColor: 'rgb(180, 180, 180)',
  cutColor: 'rgb(180, 180, 180)',
  newCutColor: 'rgb(0, 255, 0)',
  controlNodeColor1: '#6dcff6',
  controlNodeColor2: '#f66d6d',

  showGrid: true,
  showUi: true,

  glow: false,

  controlNodeSize: 5,
  selectedControlNodeSize: 12,
};

/** A control node position in cut-space. */
export interface KnotNode {
  row: number;
  column: number;
}

/** A 2D grid of cut states, indexed [row][column]. */
export type CutGrid = CutState[][];

/** Pixel offset applied to the whole render so the pattern isn't flush to the canvas edge. */
export const OUTPUT_OFFSET = { x: 15, y: 10 } as const;

/** Canvas never shrinks below these dimensions. */
export const MIN_CANVAS_WIDTH = 600;
export const MIN_CANVAS_HEIGHT = 500;
