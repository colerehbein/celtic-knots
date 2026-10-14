import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KnotEditor, SIZE_PRESETS, type SizePreset } from './editor';

// ---- DOM stubs -----------------------------------------------------------
//
// The UI-wiring half of these tests boots main.ts the way shortcuts.test.ts
// does: main.ts is a script that runs at import time and reaches into the
// page by id, and the vitest environment is `node` (no DOM), so the globals
// below fake the little surface it touches. A plain element is only an
// HTMLElement; an input stub must also be an HTMLInputElement so
// `isTypingTarget`'s instanceof guards behave.

/** Minimal canvas context stub: every method is a spy (tiles.test.ts pattern). */
function makeCtx(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'fillRect',
    'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'arc',
  ];
  for (const m of methods) {
    target[m] = vi.fn();
  }
  return target as unknown as CanvasRenderingContext2D;
}

class StubElement {
  value = '';
  checked = false;
  textContent = '';
  isContentEditable = false;

  readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      this.listeners.set(type, [fn]);
    } else {
      existing.push(fn);
    }
  }

  /** Dispatch every listener bound for `type`, mimicking the real DOM. */
  fire(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return { left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 };
  }
}

class StubCanvas extends StubElement {
  width = 600;
  height = 500;
  getContext(): CanvasRenderingContext2D {
    return makeCtx();
  }
}

/** Stands in for HTMLInputElement / HTMLTextAreaElement. */
class StubInput extends StubElement {}

const globals = globalThis as unknown as Record<string, unknown>;

const canvas = new StubCanvas();
const elements = new Map<string, StubElement>();

function el(id: string): StubElement {
  let element = elements.get(id);
  if (element === undefined) {
    element = new StubElement();
    elements.set(id, element);
  }
  return element;
}

let mainEditor!: KnotEditor;

beforeAll(async () => {
  globals.HTMLElement = StubElement;
  globals.HTMLInputElement = StubInput;
  globals.HTMLTextAreaElement = StubInput;
  globals.document = {
    getElementById: (id: string) => (id === 'knot-canvas' ? canvas : el(id)),
    addEventListener: vi.fn(),
    body: new StubElement(),
    createElement: () => new StubElement(),
  };

  // main.ts's editor instance is module-private; `randomizePattern()` is its
  // last line, so `this` inside the call identifies the wired-up editor.
  const capture = vi.spyOn(KnotEditor.prototype, 'randomizePattern').mockImplementation(
    function captureEditor(this: KnotEditor): void {
      mainEditor = this;
    },
  );
  await import('../main');
  capture.mockRestore();
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'document']) {
    delete globals[name];
  }
});

/** Click a preset button the way the page does, then read the editor state. */
function clickPreset(id: string): boolean {
  const button = el(`preset-${id}`);
  button.fire('click', {});
  return button.listeners.has('click');
}

// ---- pixel math ----------------------------------------------------------
//
// imageSize = { width: columns * cellSize, height: rows * cellSize }, so each
// expected pair below is the preset's own arithmetic spelled out.

describe('size presets produce their documented pixel size', () => {
  it('Icon 512: 16x16 cells at 32px -> 512x512', () => {
    const editor = new KnotEditor(makeCanvasForEditor());
    expect(editor.applySizePreset('icon-512')).toBe(true);
    // 16 columns * 32 = 512, 16 rows * 32 = 512.
    const size = editor.getImageDimensions();
    expect(size.width).toBe(512);
    expect(size.height).toBe(512);
    expect(editor.getCellSize()).toBe(32);
  });

  it('Banner: 6 rows x 28 columns at 50px -> 1400x300', () => {
    const editor = new KnotEditor(makeCanvasForEditor());
    expect(editor.applySizePreset('banner-1400x300')).toBe(true);
    // 28 columns * 50 = 1400 wide, 6 rows * 50 = 300 tall.
    const size = editor.getImageDimensions();
    expect(size.width).toBe(1400);
    expect(size.height).toBe(300);
    expect(editor.getGridWidth()).toBe(28);
    expect(editor.getGridHeight()).toBe(6);
  });

  it('A4 300dpi: 62x88 cells at 40px -> 2480x3520 (width exact, height +12px)', () => {
    const editor = new KnotEditor(makeCanvasForEditor());
    expect(editor.applySizePreset('a4-300dpi')).toBe(true);
    // 62 columns * 40 = 2480 (A4 300dpi width, exact). A4 300dpi height is
    // 3508; 3508 / 40 = 87.7 rows, and the even-grid rule rounds 88 * 40 =
    // 3520 — 12px (+0.34%) tall. Documented on SizePreset above.
    const size = editor.getImageDimensions();
    expect(size.width).toBe(2480);
    expect(size.height).toBe(3520);
    expect(size.height - 3508).toBe(12);
  });

  it('every preset lands on even dimensions, so no preset is silently altered', () => {
    // setKnotworkSize rounds odd rows/columns up, which would break each
    // preset's arithmetic without changing its id — guard the inputs instead.
    for (const preset of SIZE_PRESETS) {
      expect(preset.rows % 2).toBe(0);
      expect(preset.columns % 2).toBe(0);
      expect(Number.isInteger(preset.cellSize)).toBe(true);
      expect(preset.cellSize).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('applySizePreset rejects an unknown id', () => {
  it('returns false and changes nothing', () => {
    const editor = new KnotEditor(makeCanvasForEditor());
    editor.applySizePreset('icon-512');

    const before = editor.getImageDimensions();
    const beforeCell = editor.getCellSize();

    expect(editor.applySizePreset('no-such-preset')).toBe(false);

    expect(editor.getImageDimensions()).toEqual(before);
    expect(editor.getCellSize()).toBe(beforeCell);
    expect(editor.getGridWidth()).toBe(16);
    expect(editor.getGridHeight()).toBe(16);
  });
});

describe('default startup is unchanged', () => {
  it('is still 12x12 cells at 30px -> 360x360', () => {
    const editor = new KnotEditor(makeCanvasForEditor());
    expect(editor.getGridWidth()).toBe(12);
    expect(editor.getGridHeight()).toBe(12);
    expect(editor.getCellSize()).toBe(30);
    // 12 * 30 = 360 on both axes.
    expect(editor.getImageDimensions().width).toBe(360);
    expect(editor.getImageDimensions().height).toBe(360);
  });

  it('main.ts starts the page at the default size and does not apply a preset', () => {
    // main.ts's last line is the fresh-startup randomize, so the editor it
    // captured above never went through applySizePreset.
    expect(mainEditor.getGridWidth()).toBe(12);
    expect(mainEditor.getGridHeight()).toBe(12);
    expect(mainEditor.getCellSize()).toBe(30);
  });
});

describe('preset buttons drive the editor and sync the controls', () => {
  it('wires one button per entry of SIZE_PRESETS', () => {
    for (const preset of SIZE_PRESETS) {
      expect(clickPreset(preset.id)).toBe(true);
    }
  });

  it('clicking a button applies the preset and syncs the size controls', () => {
    for (const preset of SIZE_PRESETS as readonly SizePreset[]) {
      el(`preset-${preset.id}`).fire('click', {});

      expect(mainEditor.getGridWidth()).toBe(preset.columns);
      expect(mainEditor.getGridHeight()).toBe(preset.rows);
      expect(mainEditor.getCellSize()).toBe(preset.cellSize);

      // The inputs syncControls writes must show the preset's numbers.
      expect(el('grid-width').value).toBe(String(preset.columns));
      expect(el('grid-height').value).toBe(String(preset.rows));
      expect(el('cell-size').value).toBe(String(preset.cellSize));
      expect(el('cell-size-num').textContent).toBe(String(preset.cellSize));

      const size = mainEditor.getImageDimensions();
      expect(size.width).toBe(preset.columns * preset.cellSize);
      expect(size.height).toBe(preset.rows * preset.cellSize);
    }
  });

  it('leaves the controls in sync after the manual grid size is used', () => {
    // Regression for the interaction between the preset path and the
    // pre-existing Apply button: whichever ran last must be what shows.
    el('preset-a4-300dpi').fire('click', {});
    expect(el('grid-width').value).toBe('62');

    el('grid-width').value = '8';
    el('grid-height').value = '10';
    el('set-grid-size').fire('click', {});

    expect(mainEditor.getGridWidth()).toBe(8);
    expect(mainEditor.getGridHeight()).toBe(10);
    expect(el('grid-width').value).toBe('8');
    expect(el('grid-height').value).toBe('10');

    el('preset-icon-512').fire('click', {});
    expect(el('grid-width').value).toBe('16');
    expect(el('grid-height').value).toBe('16');
    expect(el('cell-size').value).toBe('32');
  });
});

/**
 * A canvas the editor constructor can bind. Only `getContext` is needed —
 * these tests never dispatch pointer events — and `addEventListener` is a
 * no-op so the bound handlers have nothing to do.
 */
function makeCanvasForEditor(): HTMLCanvasElement {
  const target: Record<string, unknown> = {
    width: 600,
    height: 500,
    getContext: () => makeCtx(),
    addEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }),
  };
  return target as unknown as HTMLCanvasElement;
}
