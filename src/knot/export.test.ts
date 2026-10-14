import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnotEditor } from './editor';

// ---- stubs (undo.test.ts pattern) ----

/** Minimal 2D context stub: every method is a spy so calls are recorded. */
function makeCtx(): { ctx: CanvasRenderingContext2D; scale: ReturnType<typeof vi.fn> } {
  const target: Record<string, unknown> = {};
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'fillRect',
    'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'arc',
  ];
  for (const m of methods) {
    target[m] = vi.fn();
  }
  const ctx = target as unknown as CanvasRenderingContext2D;
  return { ctx, scale: target.scale as ReturnType<typeof vi.fn> };
}

interface FakeCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scale: ReturnType<typeof vi.fn>;
  blobs: unknown[];
}

/**
 * Export-canvas stub. `width`/`height` are plain fields the editor assigns, so
 * reading them after the call is exactly the dimension the export used.
 */
function makeExportCanvas(): FakeCanvas {
  const { ctx, scale } = makeCtx();
  const blobs: unknown[] = [];
  const fakeBlob = { type: 'image/png', size: 1 };
  const target: Record<string, unknown> = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (blob: unknown) => void) => cb(fakeBlob),
  };
  blobs.push(fakeBlob);
  return { canvas: target as unknown as HTMLCanvasElement, ctx, scale, blobs };
}

/** The canvas handed to the KnotEditor constructor (never used by export). */
function makeEditorCanvas(): HTMLCanvasElement {
  const { ctx } = makeCtx();
  const target: Record<string, unknown> = {
    width: 600,
    height: 500,
    getContext: () => ctx,
    addEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }),
  };
  return target as unknown as HTMLCanvasElement;
}

/** Defaults are 12x12 cells at cellSize 30 -> 360x360 at 1x. */
const BASE_WIDTH = 360;
const BASE_HEIGHT = 360;

let exportCanvas: FakeCanvas;
let anchor: Record<string, unknown>;

beforeEach(() => {
  exportCanvas = makeExportCanvas();
  anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };

  vi.stubGlobal('document', {
    createElement: (tag: string) => (tag === 'canvas' ? exportCanvas.canvas : anchor),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function editorWithSpiedRender() {
  const editor = new KnotEditor(makeEditorCanvas());
  const engine = editor.getEngine();
  const render = vi.spyOn(engine, 'render');
  return { editor, render };
}

// ---- toPNG ----

describe('KnotEditor.toPNG export scale', () => {
  it('1x (default) exports at imageSize and scales by 1', async () => {
    const { editor, render } = editorWithSpiedRender();

    const blob = await editor.toPNG(1);

    expect(blob).toBe(exportCanvas.blobs[0]);
    expect(exportCanvas.canvas.width).toBe(BASE_WIDTH);
    expect(exportCanvas.canvas.height).toBe(BASE_HEIGHT);
    expect(exportCanvas.scale).toHaveBeenCalledWith(1, 1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('omitting the scale argument defaults to 1x', async () => {
    const editor = new KnotEditor(makeEditorCanvas());

    await editor.toPNG();

    expect(exportCanvas.canvas.width).toBe(BASE_WIDTH);
    expect(exportCanvas.canvas.height).toBe(BASE_HEIGHT);
    expect(exportCanvas.scale).toHaveBeenCalledWith(1, 1);
  });

  it('2x doubles the export canvas and scales the context by 2', async () => {
    const { editor, render } = editorWithSpiedRender();

    await editor.toPNG(2);

    expect(exportCanvas.canvas.width).toBe(BASE_WIDTH * 2);
    expect(exportCanvas.canvas.height).toBe(BASE_HEIGHT * 2);
    expect(exportCanvas.scale).toHaveBeenCalledWith(2, 2);
    // scale must happen before the engine paints.
    expect(exportCanvas.scale.mock.invocationCallOrder[0])
      .toBeLessThan(render.mock.invocationCallOrder[0]);
  });

  it('4x quadruples the export canvas and scales the context by 4', async () => {
    const { editor, render } = editorWithSpiedRender();

    await editor.toPNG(4);

    expect(exportCanvas.canvas.width).toBe(BASE_WIDTH * 4);
    expect(exportCanvas.canvas.height).toBe(BASE_HEIGHT * 4);
    expect(exportCanvas.scale).toHaveBeenCalledWith(4, 4);
    expect(exportCanvas.scale.mock.invocationCallOrder[0])
      .toBeLessThan(render.mock.invocationCallOrder[0]);
  });

  it('the background fill covers the scaled bitmap', async () => {
    const editor = new KnotEditor(makeEditorCanvas());
    const fillRect = vi.mocked(exportCanvas.ctx.fillRect);

    await editor.toPNG(2);

    expect(fillRect).toHaveBeenCalledWith(0, 0, BASE_WIDTH * 2, BASE_HEIGHT * 2);
  });
});

// ---- downloadPNG ----

describe('KnotEditor.downloadPNG', () => {
  it('defaults to 1x with the default filename', async () => {
    const editor = new KnotEditor(makeEditorCanvas());

    await editor.downloadPNG();

    expect(exportCanvas.canvas.width).toBe(BASE_WIDTH);
    expect(exportCanvas.canvas.height).toBe(BASE_HEIGHT);
    expect(anchor.download).toBe('celtic-knot.png');
    expect(anchor.href).toBe('blob:fake');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith('blob:fake');
  });

  it('passes the scale through to the export canvas', async () => {
    const editor = new KnotEditor(makeEditorCanvas());

    await editor.downloadPNG('knot.png', 4);

    expect(exportCanvas.canvas.width).toBe(BASE_WIDTH * 4);
    expect(exportCanvas.canvas.height).toBe(BASE_HEIGHT * 4);
    expect(exportCanvas.scale).toHaveBeenCalledWith(4, 4);
    expect(anchor.download).toBe('knot.png');
  });
});
