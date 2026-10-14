import {
  applyCut,
  canCut,
  computeCutDimensions,
  isSameNode,
  makeBetterRandomPattern,
  makeEmptyPattern,
  setBorderState,
} from '../pattern';
import {
  getClosestNode,
  renderControlNodes,
  renderCuts,
  renderKnotwork,
} from '../render';
import type { CutGrid, CutState, KnotNode, KnotSettings } from '../types';
import type { EditorHit, EditorUiState, EngineImageSize, KnotEngine } from './types';

/** Snapshot format written by `serialize()` and read by `deserialize()`. */
interface CutParitySnapshot {
  cutRows: number;
  cutColumns: number;
  cuts: CutState[][];
  selectedNode: KnotNode | null;
  hoverNode: KnotNode | null;
}

/** Deterministic PRNG so `randomize(seed)` is repeatable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isNode(value: unknown): value is KnotNode {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<KnotNode>;
  return typeof candidate.row === 'number' && typeof candidate.column === 'number';
}

function isCutState(value: unknown): value is CutState {
  return value === 0 || value === 1 || value === 2;
}

/**
 * The original cut/parity engine.
 *
 * State: a grid of cuts (breaks between strands) plus the control-node
 * selection. Each knot cell is drawn from the two cuts that bound it plus
 * row/column parity; users edit the pattern by clicking control nodes to
 * draw or erase cuts between them.
 */
export class CutParityEngine implements KnotEngine {
  readonly id = 'cut-parity';
  readonly name = 'Cut & parity';

  private cuts: CutGrid = [];
  private cutRows = 0;
  private cutColumns = 0;
  private selectedNode: KnotNode | null = null;
  private hoverNode: KnotNode | null = null;

  // ---- engine-specific surface (deliberately outside the KnotEngine contract) ----

  /** Current UI state, to hand to `renderOverlay`. */
  get ui(): EditorUiState {
    return { selectedNode: this.selectedNode, hoverNode: this.hoverNode };
  }

  /** Rebuild the cut grid for a new knotwork size and clear selection. */
  resize(rows: number, columns: number): void {
    const { cutRows, cutColumns } = computeCutDimensions(rows, columns);
    this.cutRows = cutRows;
    this.cutColumns = cutColumns;
    this.cuts = makeEmptyPattern(cutRows, cutColumns);
    this.selectedNode = null;
    this.hoverNode = null;
  }

  /** Open or close the knot's borders in place. */
  setBorderState(state: 'open' | 'closed'): void {
    setBorderState(this.cuts, state);
  }

  /** Current cut grid (read-only view). */
  getCuts(): readonly (readonly CutState[])[] {
    return this.cuts;
  }

  getCutValue(row: number, column: number): CutState {
    return this.cuts[row][column];
  }

  /**
   * Record a hover target. Returns true when the hover state actually
   * changed, so the caller knows a redraw is needed.
   */
  updateHover(hit: EditorHit | null): boolean {
    const next = hit === null ? null : hit.node;
    if (isSameNode(next, this.hoverNode)) {
      return false;
    }
    this.hoverNode = next;
    return true;
  }

  // ---- KnotEngine ----

  render(ctx: CanvasRenderingContext2D, settings: KnotSettings): void {
    renderKnotwork(ctx, settings, this.cuts);
  }

  randomize(seed?: number): void {
    const random = seed === undefined ? undefined : mulberry32(seed);
    this.cuts = makeBetterRandomPattern(this.cutRows, this.cutColumns, undefined, undefined, undefined, random);
    this.selectedNode = null;
    this.hoverNode = null;
  }

  reset(): void {
    this.cuts = makeEmptyPattern(this.cutRows, this.cutColumns);
    this.selectedNode = null;
    this.hoverNode = null;
  }

  serialize(): unknown {
    const snapshot: CutParitySnapshot = {
      cutRows: this.cutRows,
      cutColumns: this.cutColumns,
      cuts: this.cuts.map((row) => [...row]),
      selectedNode: this.selectedNode === null ? null : { ...this.selectedNode },
      hoverNode: this.hoverNode === null ? null : { ...this.hoverNode },
    };
    return snapshot;
  }

  deserialize(data: unknown): void {
    if (typeof data !== 'object' || data === null) {
      this.reset();
      return;
    }

    const candidate = data as Partial<CutParitySnapshot>;
    const rows = candidate.cuts;
    if (
      typeof candidate.cutRows !== 'number' ||
      typeof candidate.cutColumns !== 'number' ||
      !Array.isArray(rows) ||
      rows.length !== candidate.cutRows
    ) {
      this.reset();
      return;
    }

    const restored: CutGrid = [];
    for (let row = 0; row < rows.length; row++) {
      const source = rows[row];
      if (!Array.isArray(source) || source.length !== candidate.cutColumns) {
        this.reset();
        return;
      }
      if (!source.every(isCutState)) {
        this.reset();
        return;
      }
      restored.push([...source] as CutState[]);
    }

    this.cutRows = candidate.cutRows;
    this.cutColumns = candidate.cutColumns;
    this.cuts = restored;
    this.selectedNode = isNode(candidate.selectedNode) ? { ...candidate.selectedNode } : null;
    this.hoverNode = isNode(candidate.hoverNode) ? { ...candidate.hoverNode } : null;
  }

  imageSize(settings: KnotSettings): EngineImageSize {
    return {
      width: settings.columns * settings.cellSize,
      height: settings.rows * settings.cellSize,
    };
  }

  renderOverlay(ctx: CanvasRenderingContext2D, settings: KnotSettings, ui: EditorUiState): void {
    if (!settings.showUi) {
      return;
    }
    renderCuts(ctx, settings, this.cuts);
    renderControlNodes(ctx, settings, ui.selectedNode, ui.hoverNode, canCut);
  }

  /**
   * Resolve a canvas point (OUTPUT_OFFSET already subtracted) to the control
   * node under it. Empty space is a real hit — `node: null` — because clicking
   * it deselects; while a node is selected, only nodes a cut can reach count.
   */
  hitTest(x: number, y: number, settings: KnotSettings): EditorHit {
    const node = getClosestNode(settings, x, y);
    if (node === null) {
      return { node: null };
    }
    if (this.selectedNode !== null && !canCut(this.selectedNode, node)) {
      return { node: null };
    }
    return { node };
  }

  /** Select / deselect / apply-cut state machine, driven by one click. */
  onClick(hit: EditorHit, _settings: KnotSettings): void {
    const closest = hit.node;

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
  }
}
