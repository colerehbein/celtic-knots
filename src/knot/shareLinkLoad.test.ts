import { afterAll, describe, expect, it, vi } from 'vitest';
import type { KnotEditor } from './editor';
import { composeShareLink, parseShareLink } from './shareLink';

// ---- DOM stubs -----------------------------------------------------------
//
// main.ts is a script: it runs at import time, reads `location.hash` once at
// startup and binds a click listener to #share-link. The vitest environment is
// `node`, so `location` does not exist at all and the globals below fake the
// little surface main.ts touches — the same stub pattern as shortcuts.test.ts.

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

/** Fresh per boot, so listeners from an earlier run can never fire. */
let elements = new Map<string, StubElement>();

function el(id: string): StubElement {
  let element = elements.get(id);
  if (element === undefined) {
    element = new StubElement();
    elements.set(id, element);
  }
  return element;
}

/** `navigator` is a getter-only global on modern Node, so it needs defining. */
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function teardownDom(): void {
  vi.restoreAllMocks();
  elements = new Map();
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'location', 'navigator']) {
    delete globals[name];
  }
}

/**
 * Prepare one startup run: reset the module registry (so the script body runs
 * again with the new `location` in place), install the DOM-ish globals, and
 * return the editor module *as main.ts will see it* — a reset would otherwise
 * leave two unrelated `KnotEditor` prototypes to spy on.
 *
 * Callers install their spies on the returned class before `runStartup`.
 */
async function prepare(hash: string, clipboard: unknown): Promise<typeof import('./editor')> {
  vi.resetModules();
  defineGlobal('HTMLElement', StubElement);
  defineGlobal('HTMLInputElement', StubInput);
  defineGlobal('HTMLTextAreaElement', StubInput);
  defineGlobal('location', { hash, href: `https://example.com/knots/${hash}` });
  defineGlobal('navigator', { clipboard });
  defineGlobal('document', {
    getElementById: (id: string) => (id === 'knot-canvas' ? canvas : el(id)),
    addEventListener: vi.fn(),
    body: new StubElement(),
    createElement: () => new StubElement(),
  });
  return import('./editor');
}

/** Execute main.ts's startup sequence. Must follow a `prepare` in the same test. */
async function runStartup(): Promise<void> {
  await import('../main');
}

// ---- load -----------------------------------------------------------------

describe('share-link load', () => {
  afterAll(teardownDom);

  const PATTERN = {
    cutRows: 5,
    cutColumns: 5,
    cuts: [
      [1, 0, 2, 0, 1],
      [0, 1, 1, 2, 0],
      [2, 0, 0, 1, 1],
      [0, 2, 1, 0, 0],
      [1, 1, 0, 2, 0],
    ],
  };

  /** The fragment of a share link for `PATTERN` on the cut-parity engine. */
  function hashFor(pattern: unknown = PATTERN): string {
    return composeShareLink('https://example.com/knots/', 'cut-parity', pattern).slice(
      'https://example.com/knots/'.length,
    );
  }

  it('loads the engine and pattern a valid hash names', async () => {
    const captured: { engine: KnotEditor | null; pattern: unknown } = { engine: null, pattern: null };
    const { KnotEditor } = await prepare(hashFor(), { writeText: vi.fn() });

    // The editor main.ts wired up is module-private; `loadPattern` is the one
    // door it opens at startup, so `this` inside it identifies the instance.
    const original = KnotEditor.prototype.loadPattern;
    vi.spyOn(KnotEditor.prototype, 'loadPattern').mockImplementation(
      function capture(this: KnotEditor, engineId: string, data: unknown): void {
        captured.engine = this;
        captured.pattern = data;
        original.call(this, engineId, data);
      },
    );
    const randomize = vi.spyOn(KnotEditor.prototype, 'randomizePattern');

    await runStartup();

    expect(captured.engine).not.toBeNull();
    expect(captured.engine?.getEngineId()).toBe('cut-parity');
    expect(captured.pattern).toEqual(PATTERN);
    // The loaded pattern is the live one, not something randomize overwrote.
    expect(captured.engine?.getPattern()).toEqual(PATTERN);
    // A valid hash replaces the fresh-startup randomize; it does not add to it.
    expect(randomize).not.toHaveBeenCalled();
  });

  it("adopts the loaded pattern's grid size rather than the default", async () => {
    const { KnotEditor } = await prepare(hashFor(), { writeText: vi.fn() });
    const loaded: { engine: KnotEditor | null } = { engine: null };
    const original = KnotEditor.prototype.loadPattern;
    vi.spyOn(KnotEditor.prototype, 'loadPattern').mockImplementation(
      function capture(this: KnotEditor, engineId: string, data: unknown): void {
        loaded.engine = this;
        original.call(this, engineId, data);
      },
    );

    await runStartup();

    // The default grid is 12x12; this pattern is a 4x8 knot. The renderer
    // reads the cut grid through settings, so a stale size would index past
    // the end of the grid and throw.
    expect(loaded.engine?.getGridWidth()).toBe(8);
    expect(loaded.engine?.getGridHeight()).toBe(4);
  });

  it('ignores a malformed hash and randomizes as on a fresh load', async () => {
    const { KnotEditor } = await prepare('#e=cut-parity&p=!!!', { writeText: vi.fn() });
    const randomize = vi.spyOn(KnotEditor.prototype, 'randomizePattern');
    const load = vi.spyOn(KnotEditor.prototype, 'loadPattern');

    await runStartup();

    expect(load).not.toHaveBeenCalled();
    expect(randomize).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty hash and randomizes as on a fresh load', async () => {
    const { KnotEditor } = await prepare('', { writeText: vi.fn() });
    const randomize = vi.spyOn(KnotEditor.prototype, 'randomizePattern');
    const load = vi.spyOn(KnotEditor.prototype, 'loadPattern');

    await runStartup();

    expect(load).not.toHaveBeenCalled();
    expect(randomize).toHaveBeenCalledTimes(1);
  });
});

// ---- copy -----------------------------------------------------------------

describe('share-link button', () => {
  afterAll(teardownDom);

  it('copies a link that parses back to the live pattern', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const captured: { engine: KnotEditor | null } = { engine: null };
    const { KnotEditor } = await prepare('', { writeText });

    // main.ts randomizes as its last startup step, which is how the live
    // editor instance is reachable from a test at all.
    const originalRandomize = KnotEditor.prototype.randomizePattern;
    vi.spyOn(KnotEditor.prototype, 'randomizePattern').mockImplementation(
      function capture(this: KnotEditor, seed?: number): void {
        captured.engine = this;
        originalRandomize.call(this, seed);
      },
    );

    await runStartup();

    const editor = captured.engine;
    expect(editor).not.toBeNull();
    editor?.randomizePattern(99);
    const pattern = editor?.getPattern();

    el('share-link').fire('click', {});

    expect(writeText).toHaveBeenCalledTimes(1);
    const link = writeText.mock.calls[0][0] as string;
    expect(link.startsWith('https://example.com/knots/#e=cut-parity&p=')).toBe(true);
    // A copied link must round-trip: parse it back and the pattern is identical.
    expect(parseShareLink(link)).toEqual({ engineId: 'cut-parity', pattern });
  });

  it('does not throw when the clipboard API is unavailable', async () => {
    await prepare('', undefined);

    expect(() => el('share-link').fire('click', {})).not.toThrow();
  });
});
