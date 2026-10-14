import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KnotEditor } from './editor';

// ---- DOM stubs -----------------------------------------------------------
//
// main.ts is a script: it runs at import time, binds document-level
// listeners and reaches into the page by id. The vitest environment is
// `node`, so there is no DOM at all — the globals below are installed before
// main.ts is imported and fake the little surface it touches. Because the
// `instanceof HTMLInputElement` guards run against whatever these globals
// hold, the stub classes have to stay in sync with the real class hierarchy:
// an input stub must be an instance of the input/textarea/HTMLElement globals,
// while a plain element is only an HTMLElement.

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

interface KeydownInit {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: StubElement;
}

const globals = globalThis as unknown as Record<string, unknown>;

const canvas = new StubCanvas();
const elements = new Map<string, StubElement>();
const documentListeners: ((event: unknown) => void)[] = [];

function el(id: string): StubElement {
  let element = elements.get(id);
  if (element === undefined) {
    element = new StubElement();
    elements.set(id, element);
  }
  return element;
}

function keydown(init: KeydownInit): void {
  const event = {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    target: init.target ?? new StubElement(),
    preventDefault: vi.fn(),
  };
  for (const fn of documentListeners) {
    fn(event);
  }
}

let mainEditor!: KnotEditor;
let captureSpy!: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  globals.HTMLElement = StubElement;
  globals.HTMLInputElement = StubInput;
  globals.HTMLTextAreaElement = StubInput;
  globals.document = {
    getElementById: (id: string) => {
      if (id === 'knot-canvas') {
        return canvas;
      }
      return el(id);
    },
    addEventListener: (_type: string, fn: (event: unknown) => void) => {
      documentListeners.push(fn);
    },
    body: new StubElement(),
    createElement: () => new StubElement(),
  };

  // Captured via the `randomizePattern()` call main.ts makes as its last
  // line: the instance the script wired up is otherwise module-private.
  captureSpy = vi.spyOn(KnotEditor.prototype, 'randomizePattern').mockImplementation(
    function captureEditor(this: KnotEditor): void {
      mainEditor = this;
    },
  );

  await import('../main');
  captureSpy.mockRestore();
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'document']) {
    delete globals[name];
  }
});

// ---- tests ---------------------------------------------------------------

describe('keyboard shortcuts', () => {
  it("'r' randomizes the pattern", () => {
    const randomize = vi.spyOn(KnotEditor.prototype, 'randomizePattern');
    keydown({ key: 'r' });
    expect(randomize).toHaveBeenCalledTimes(1);
  });

  it("'Escape' drops the engine selection", () => {
    // Select a node the way the pointer path does: page (15, 10) is control
    // node (0, 0) for the default cell size, with OUTPUT_OFFSET subtracted.
    canvas.fire('pointerdown', { pageX: 15, pageY: 10, pointerId: 1 });
    expect(mainEditor.getEngine().ui.selectedNode).toEqual({ row: 0, column: 0 });

    keydown({ key: 'Escape' });
    expect(mainEditor.getEngine().ui.selectedNode).toBeNull();
  });

  it("'g' toggles the grid and keeps the #show-grid checkbox in sync", () => {
    const gridBox = el('show-grid');
    gridBox.checked = mainEditor.isGridVisible();

    keydown({ key: 'g' });
    expect(mainEditor.isGridVisible()).toBe(false);
    expect(gridBox.checked).toBe(false);

    keydown({ key: 'g' });
    expect(mainEditor.isGridVisible()).toBe(true);
    expect(gridBox.checked).toBe(true);
  });

  it("'u' toggles the editor overlay and keeps the #show-overlay checkbox in sync", () => {
    const overlayBox = el('show-overlay');
    overlayBox.checked = mainEditor.isOverlayVisible();

    keydown({ key: 'u' });
    expect(mainEditor.isOverlayVisible()).toBe(false);
    expect(overlayBox.checked).toBe(false);

    keydown({ key: 'u' });
    expect(mainEditor.isOverlayVisible()).toBe(true);
    expect(overlayBox.checked).toBe(true);
  });

  it("typing 'r' in a text field does nothing", () => {
    const randomize = vi.spyOn(KnotEditor.prototype, 'randomizePattern');
    keydown({ key: 'r', target: new StubInput() });
    expect(randomize).not.toHaveBeenCalled();
  });

  it('ignores shortcuts while a modifier key is held', () => {
    const randomize = vi.spyOn(KnotEditor.prototype, 'randomizePattern');
    keydown({ key: 'r', metaKey: true });
    keydown({ key: 'r', ctrlKey: true });
    keydown({ key: 'r', altKey: true });
    expect(randomize).not.toHaveBeenCalled();
  });

  it('ignores unrelated keys', () => {
    const randomize = vi.spyOn(KnotEditor.prototype, 'randomizePattern');
    const deselect = vi.spyOn(KnotEditor.prototype, 'deselect');
    keydown({ key: 'q' });
    expect(randomize).not.toHaveBeenCalled();
    expect(deselect).not.toHaveBeenCalled();
  });

  it('undo/redo shortcuts still work (regression guard)', () => {
    const undo = vi.spyOn(KnotEditor.prototype, 'undo');
    const redo = vi.spyOn(KnotEditor.prototype, 'redo');

    keydown({ key: 'z', metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);

    keydown({ key: 'z', metaKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);

    keydown({ key: 'y', ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(2);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('undo/redo stay out of text fields too', () => {
    const undo = vi.spyOn(KnotEditor.prototype, 'undo');
    keydown({ key: 'z', metaKey: true, target: new StubInput() });
    expect(undo).not.toHaveBeenCalled();
  });
});
