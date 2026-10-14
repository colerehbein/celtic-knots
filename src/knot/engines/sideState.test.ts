import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type KnotSettings } from '../types';
import {
  BOUNDARY,
  CROSSED,
  DOWN,
  LEFT,
  RIGHT,
  STRAIGHT,
  UP,
  SideStateEngine,
  type EdgeHit,
  type Point,
  type SideIndex,
  type SideState,
} from './sideState';

// ---------------------------------------------------------------------------
// Canvas stub (the tiles.test.ts pattern), extended to record the vertices of
// every path so the drawn geometry can be compared against the reference.
// ---------------------------------------------------------------------------

interface RecordedPath {
  points: Point[];
}

interface Stub {
  ctx: CanvasRenderingContext2D;
  paths: RecordedPath[];
  calls: { name: string; args: number[] }[];
}

function makeStub(): Stub {
  const paths: RecordedPath[] = [];
  const calls: { name: string; args: number[] }[] = [];
  let current: RecordedPath | null = null;

  const target: Record<string, unknown> = {};
  const noop = (name: string) =>
    vi.fn((...args: number[]) => {
      calls.push({ name, args });
    });

  for (const m of ['save', 'restore', 'translate', 'rotate', 'scale', 'closePath', 'fill', 'stroke']) {
    target[m] = noop(m);
  }
  target.beginPath = vi.fn(() => {
    calls.push({ name: 'beginPath', args: [] });
    current = { points: [] };
    paths.push(current);
  });
  target.moveTo = vi.fn((x: number, y: number) => {
    calls.push({ name: 'moveTo', args: [x, y] });
    current?.points.push({ x, y });
  });
  target.lineTo = vi.fn((x: number, y: number) => {
    calls.push({ name: 'lineTo', args: [x, y] });
    current?.points.push({ x, y });
  });
  target.fillStyle = '';
  target.strokeStyle = '';
  target.lineWidth = 1;
  target.lineCap = 'butt';
  target.lineJoin = 'miter';

  return { ctx: target as unknown as CanvasRenderingContext2D, paths, calls };
}

/** The three geometry constants of the reference sketch, for s = cellSize. */
const S = DEFAULT_SETTINGS.cellSize;
/** `x = s/3*(1-1/sqrt(2))` — .pde lines 167/184/202. */
const X = (S / 3) * (1 - 1 / Math.SQRT2);
/** `y = s/15` — .pde line 185 (dispFourStraight). */
const Y = S / 15;
/** `y = s/(15*sqrt(2))` — .pde line 203 (dispQuart). */
const Y2 = S / (15 * Math.SQRT2);

function p(x: number, y: number): Point {
  return { x, y };
}

function settings(overrides: Partial<KnotSettings> = {}): KnotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** A 1x1 engine whose single square holds `sides`, set through deserialize. */
function engineWithSquare(sides: SideState[]): SideStateEngine {
  const engine = new SideStateEngine(1, 1);
  engine.deserialize({ rows: 1, columns: 1, sides: [[[...sides] as SideState[]]] });
  return engine;
}

/** An edge hit literal, typed so it satisfies `onClick` without excess-property noise. */
function edgeHit(orientation: 'h' | 'v', row: number, column: number): EdgeHit {
  return { node: null, kind: 'edge', orientation, row, column };
}

/** Render one square and return the paths it drew, in order. */
function renderSquare(sides: SideState[]): RecordedPath[] {
  const engine = engineWithSquare(sides);
  const stub = makeStub();
  engine.render(stub.ctx, settings());
  return stub.paths;
}

function expectPoints(path: RecordedPath, expected: Point[], label: string): void {
  expect(path.points.length, `${label}: vertex count`).toBe(expected.length);
  expected.forEach((vertex, i) => {
    expect(path.points[i].x, `${label}: vertex ${i}.x`).toBeCloseTo(vertex.x, 9);
    expect(path.points[i].y, `${label}: vertex ${i}.y`).toBeCloseTo(vertex.y, 9);
  });
}

// ---------------------------------------------------------------------------
// 1. The 3x3 quarter table — every vertex list transcribed from dispQuart
//    (.pde lines 201-311). Quarter 0 is drawn first, in the untransformed
//    frame, so its vertices appear verbatim in the recorded paths.
// ---------------------------------------------------------------------------

describe('quarter geometry (dispQuart, .pde 201-311)', () => {
  // Each case is reached through a square whose sides[0] = primary and
  // sides[1] = secondary, with a crossed third side to keep the square out of
  // the sum==1 and all-four-straight special cases.
  const cases: {
    name: string;
    primary: SideState;
    secondary: SideState;
    sides: SideState[];
    expected: Point[][];
  }[] = [
    {
      name: '(boundary, boundary)',
      primary: BOUNDARY,
      secondary: BOUNDARY,
      sides: [BOUNDARY, BOUNDARY, CROSSED, BOUNDARY],
      // .pde 212-217
      expected: [[p(S / 3, X), p(S - X, X), p(S - X, S / 3), p(S / 3, S / 3)]],
    },
    {
      name: '(boundary, straight)',
      primary: BOUNDARY,
      secondary: STRAIGHT,
      sides: [BOUNDARY, STRAIGHT, CROSSED, BOUNDARY],
      // .pde 221-226
      expected: [[p(S / 3, X), p(S, X), p(S, S / 3), p(S / 3, S / 3)]],
    },
    {
      name: '(boundary, crossed)',
      primary: BOUNDARY,
      secondary: CROSSED,
      sides: [BOUNDARY, CROSSED, BOUNDARY, BOUNDARY],
      // .pde 230-235
      expected: [[p(S / 3, X), p((2 * S) / 3 + X, X), p(S, S / 3), p(S / 3, S / 3)]],
    },
    {
      name: '(straight, boundary)',
      primary: STRAIGHT,
      secondary: BOUNDARY,
      sides: [STRAIGHT, BOUNDARY, CROSSED, BOUNDARY],
      // .pde 243-248
      expected: [[p((2 * S) / 3, 0), p(S - X, 0), p(S - X, S / 3), p((2 * S) / 3, S / 3)]],
    },
    {
      name: '(straight, straight)',
      primary: STRAIGHT,
      secondary: STRAIGHT,
      sides: [STRAIGHT, STRAIGHT, BOUNDARY, BOUNDARY],
      // .pde 252-259
      expected: [[
        p((2 * S) / 3, 0),
        p(S - X, 0),
        p(S - X, X),
        p(S, X),
        p(S, S / 3),
        p((2 * S) / 3, S / 3),
      ]],
    },
    {
      name: '(straight, crossed)',
      primary: STRAIGHT,
      secondary: CROSSED,
      sides: [STRAIGHT, CROSSED, BOUNDARY, BOUNDARY],
      // .pde 263-269
      expected: [[
        p((2 * S) / 3, 0),
        p(S - X, 0),
        p(S - X, S / 3 - X),
        p(S, S / 3),
        p((2 * S) / 3, S / 3),
      ]],
    },
    {
      name: '(crossed, boundary)',
      primary: CROSSED,
      secondary: BOUNDARY,
      sides: [CROSSED, BOUNDARY, BOUNDARY, BOUNDARY],
      // .pde 275-279 (corner triangle) then 282-288
      expected: [
        [p(S / 3, 0), p((2 * S) / 3, 0), p(S / 3, S / 3)],
        [
          p((2 * S) / 3 + Y2, Y2),
          p(S - X, S / 3 - X),
          p(S - X, S / 3),
          p((2 * S) / 3, S / 3),
          p(S / 2 + Y2, S / 6 + Y2),
        ],
      ],
    },
    {
      name: '(crossed, straight)',
      primary: CROSSED,
      secondary: STRAIGHT,
      sides: [CROSSED, STRAIGHT, BOUNDARY, BOUNDARY],
      // .pde 275-279 then 293-299
      expected: [
        [p(S / 3, 0), p((2 * S) / 3, 0), p(S / 3, S / 3)],
        [
          p((2 * S) / 3 + Y2, Y2),
          p((2 * S) / 3 + X, X),
          p(S, X),
          p(S, S / 3),
          p((2 * S) / 3, S / 3),
          p(S / 2 + Y2, S / 6 + Y2),
        ],
      ],
    },
    {
      name: '(crossed, crossed)',
      primary: CROSSED,
      secondary: CROSSED,
      sides: [CROSSED, CROSSED, BOUNDARY, BOUNDARY],
      // .pde 275-279 then 304-308
      expected: [
        [p(S / 3, 0), p((2 * S) / 3, 0), p(S / 3, S / 3)],
        [
          p((2 * S) / 3 + Y2, Y2),
          p(S, S / 3),
          p((2 * S) / 3, S / 3),
          p(S / 2 + Y2, S / 6 + Y2),
        ],
      ],
    },
  ];

  for (const testCase of cases) {
    it(`draws the reference vertices for ${testCase.name}`, () => {
      const paths = renderSquare(testCase.sides);
      // A standard square draws all four quarters; quarter 0 is drawn first,
      // in the untransformed frame, so its paths lead the recording.
      expect(paths.length, 'total paths for the square').toBeGreaterThanOrEqual(
        testCase.expected.length,
      );
      const quarter0 = paths.slice(0, testCase.expected.length);
      testCase.expected.forEach((vertices, i) => {
        expectPoints(quarter0[i], vertices, `${testCase.name} polygon ${i}`);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Special cases from dispOneStraight / dispFourStraight / display
// ---------------------------------------------------------------------------

describe('special square cases', () => {
  it('draws nothing for an all-boundary square (.pde 122-124)', () => {
    const paths = renderSquare([BOUNDARY, BOUNDARY, BOUNDARY, BOUNDARY]);
    expect(paths.length).toBe(0);
  });

  it('draws dispOneStraight for a single straight side (.pde 166-180)', () => {
    // .pde 169-178, in the untransformed frame (side 0 = up).
    const expected = [
      p(X, 0),
      p(S / 3, 0),
      p(S / 3, S / 3),
      p(S / 2, S / 2),
      p((2 * S) / 3, S / 3),
      p((2 * S) / 3, 0),
      p(S - X, 0),
      p(S - X, S / 2),
      p(S / 2, (5 * S) / 6),
      p(X, S / 2),
    ];
    const paths = renderSquare([STRAIGHT, BOUNDARY, BOUNDARY, BOUNDARY]);
    expect(paths.length).toBe(1);
    expectPoints(paths[0], expected, 'one straight (up)');
  });

  it('rotates the one-straight polygon per which side is straight (.pde 128-139)', () => {
    // sides[1]=1 -> translate(s,0)+PI/2; sides[2]=1 -> translate(s,s)+PI;
    // sides[3]=1 -> translate(0,s)+3PI/2. Each is an exact quarter turn, so
    // the polygon is drawn once and the frame is rotated that many times.
    for (const straightSide of [RIGHT, DOWN, LEFT] as SideIndex[]) {
      const sides: SideState[] = [BOUNDARY, BOUNDARY, BOUNDARY, BOUNDARY];
      sides[straightSide] = STRAIGHT;
      const engine = engineWithSquare(sides);
      const stub = makeStub();
      engine.render(stub.ctx, settings());

      const quarterTurns = stub.calls.filter((c) => c.name === 'translate').length - 1;
      expect(quarterTurns, `side ${straightSide} quarter turns`).toBe(straightSide);
      expect(stub.paths.length).toBe(1);
      expectPoints(stub.paths[0], [
        p(X, 0),
        p(S / 3, 0),
        p(S / 3, S / 3),
        p(S / 2, S / 2),
        p((2 * S) / 3, S / 3),
        p((2 * S) / 3, 0),
        p(S - X, 0),
        p(S - X, S / 2),
        p(S / 2, (5 * S) / 6),
        p(X, S / 2),
      ], `one straight (side ${straightSide})`);
    }
  });

  it('draws four straight quarters, two polygons each (.pde 183-198)', () => {
    const engine = engineWithSquare([STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT]);
    const stub = makeStub();
    engine.render(stub.ctx, settings());

    expect(stub.paths.length).toBe(8);
    // Quarter 0, polygon 1 (.pde 186-191) and polygon 2 (.pde 192-197).
    expectPoints(stub.paths[0], [
      p(S / 3 + Y, X),
      p(S, X),
      p(S, S / 3),
      p(S / 3 + Y, S / 3),
    ], 'four straight quarter 0, polygon 0');
    expectPoints(stub.paths[1], [
      p((2 * S) / 3, 0),
      p(S - X, 0),
      p(S - X, X - Y),
      p((2 * S) / 3, X - Y),
    ], 'four straight quarter 0, polygon 1');
  });

  it('paints with the string color and strokes with the stroke color', () => {
    const engine = engineWithSquare([CROSSED, BOUNDARY, BOUNDARY, BOUNDARY]);
    const stub = makeStub();
    engine.render(stub.ctx, settings());
    expect(stub.ctx.fillStyle).toBe(DEFAULT_SETTINGS.stringColor);
    expect(stub.ctx.strokeStyle).toBe(DEFAULT_SETTINGS.strokeColor);
    expect(stub.ctx.lineWidth).toBe(DEFAULT_SETTINGS.strokeWidth);
  });
});

// ---------------------------------------------------------------------------
// 2. bump cycles and click semantics
// ---------------------------------------------------------------------------

describe('clicking edges', () => {
  it('cycles a side 0 -> 1 -> 2 -> 0 (.pde 105-107)', () => {
    const engine = new SideStateEngine(2, 2);
    const grid = settings({ rows: 2, columns: 2, cellSize: 30 });
    // A vertical edge inside the grid: near a horizontal lattice line.
    const hit = edgeHit('v', 1, 1);

    const seen: SideState[] = [];
    for (let i = 0; i < 3; i++) {
      engine.onClick(hit, grid);
      seen.push(engine.getSide(0, 1, DOWN));
    }
    expect(seen).toEqual([STRAIGHT, CROSSED, BOUNDARY]);
  });

  it('bumps both adjacent squares on an interior edge (.pde 56-66, 72-82)', () => {
    const engine = new SideStateEngine(3, 3);
    const grid = settings({ rows: 3, columns: 3 });

    engine.onClick(edgeHit('h', 1, 2), grid);
    // Horizontal edge at lattice column 2: left square's right side, right
    // square's left side.
    expect(engine.getSide(1, 1, RIGHT)).toBe(STRAIGHT);
    expect(engine.getSide(1, 2, LEFT)).toBe(STRAIGHT);
    expect(engine.getSide(1, 1, LEFT)).toBe(BOUNDARY);
    expect(engine.getSide(0, 1, DOWN)).toBe(BOUNDARY);

    engine.onClick(edgeHit('v', 2, 0), grid);
    // Vertical edge at lattice row 2, column 0: top square's down side,
    // bottom square's up side.
    expect(engine.getSide(1, 0, DOWN)).toBe(STRAIGHT);
    expect(engine.getSide(2, 0, UP)).toBe(STRAIGHT);
  });

  it('bumps only the in-bounds square on a border edge', () => {
    const engine = new SideStateEngine(2, 2);
    const grid = settings({ rows: 2, columns: 2 });

    engine.onClick(edgeHit('h', 0, 0), grid);
    expect(engine.getSide(0, 0, LEFT)).toBe(STRAIGHT);
    // No square to the left of lattice column 0: nothing else moved.
    expect(engine.getSide(0, 1, LEFT)).toBe(BOUNDARY);
    expect(engine.getSide(1, 0, UP)).toBe(BOUNDARY);
  });

  it('ignores a hit that is not an edge hit', () => {
    const engine = new SideStateEngine(2, 2);
    const grid = settings({ rows: 2, columns: 2 });
    engine.onClick({ node: { row: 0, column: 0 } }, grid);
    expect(engine.getSides().flat().flat().every((side) => side === BOUNDARY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hitTest
// ---------------------------------------------------------------------------

describe('hitTest', () => {
  const grid = settings({ rows: 4, columns: 4, cellSize: 30 });
  const engine = new SideStateEngine(4, 4);

  it('resolves a horizontal edge when nearer a vertical lattice line', () => {
    // Nearest crossing is (i=2, j=2); 2px off the x=60 line, 5px off y=60,
    // so the click belongs to the horizontal edge at lattice column 2.
    const hit = engine.hitTest(62, 65, grid);
    expect(hit).toEqual({ node: null, kind: 'edge', orientation: 'h', row: 2, column: 2 });
  });

  it('resolves a vertical edge when nearer a horizontal lattice line', () => {
    // Mirror case: 5px off x=60, 2px off y=60 -> vertical edge at lattice
    // row 2, column floor(65/30) = 2.
    const hit = engine.hitTest(65, 62, grid);
    expect(hit).toEqual({ node: null, kind: 'edge', orientation: 'v', row: 2, column: 2 });
  });

  it('returns null outside the image', () => {
    expect(engine.hitTest(-1, 10, grid)).toBeNull();
    expect(engine.hitTest(10, 10 * 30 + 1, grid)).toBeNull();
  });

  it('treats the border lattice line as an edge', () => {
    // On the right border: lattice column 4, only the left square bumps.
    const hit = engine.hitTest(119, 45, grid);
    expect(hit).toEqual({ node: null, kind: 'edge', orientation: 'h', row: 1, column: 4 });
  });
});

// ---------------------------------------------------------------------------
// 3. randomize
// ---------------------------------------------------------------------------

describe('randomize', () => {
  it('fills every square with four sides drawn from {0, 1, 2}', () => {
    const engine = new SideStateEngine(5, 6);
    engine.randomize(42);

    const sides = engine.getSides();
    expect(sides.length).toBe(5);
    for (const line of sides) {
      expect(line.length).toBe(6);
      for (const square of line) {
        expect(square.length).toBe(4);
        for (const side of square) {
          expect([BOUNDARY, STRAIGHT, CROSSED]).toContain(side);
        }
      }
    }
    expect(sides.flat().flat().some((side) => side !== BOUNDARY)).toBe(true);
  });

  it('is reproducible for a given seed', () => {
    const first = new SideStateEngine(6, 6);
    const second = new SideStateEngine(6, 6);
    first.randomize(1234);
    second.randomize(1234);
    expect(first.serialize()).toEqual(second.serialize());
  });

  it('produces different grids for different seeds', () => {
    const first = new SideStateEngine(6, 6);
    const second = new SideStateEngine(6, 6);
    first.randomize(1);
    second.randomize(2);
    expect(first.serialize()).not.toEqual(second.serialize());
  });
});

// ---------------------------------------------------------------------------
// 4. setBorder
// ---------------------------------------------------------------------------

describe('setBorder', () => {
  it('closes the border: every border side back to 0', () => {
    const engine = new SideStateEngine(4, 4);
    engine.randomize(7);
    engine.setBorderState('closed');

    const sides = engine.getSides();
    for (let column = 0; column < 4; column++) {
      expect(sides[0][column][UP]).toBe(BOUNDARY);
      expect(sides[3][column][DOWN]).toBe(BOUNDARY);
    }
    for (let row = 0; row < 4; row++) {
      expect(sides[row][0][LEFT]).toBe(BOUNDARY);
      expect(sides[row][3][RIGHT]).toBe(BOUNDARY);
    }
  });

  it('opens the border: every border side straight', () => {
    const engine = new SideStateEngine(4, 4);
    engine.setBorderState('open');

    const sides = engine.getSides();
    for (let column = 0; column < 4; column++) {
      expect(sides[0][column][UP]).toBe(STRAIGHT);
      expect(sides[3][column][DOWN]).toBe(STRAIGHT);
    }
    for (let row = 0; row < 4; row++) {
      expect(sides[row][0][LEFT]).toBe(STRAIGHT);
      expect(sides[row][3][RIGHT]).toBe(STRAIGHT);
    }
    // Interior sides untouched.
    expect(sides[1][1][UP]).toBe(BOUNDARY);
    expect(sides[2][2][RIGHT]).toBe(BOUNDARY);
  });
});

// ---------------------------------------------------------------------------
// 5. serialize / deserialize
// ---------------------------------------------------------------------------

describe('serialize / deserialize', () => {
  it('round-trips the sides grid', () => {
    const engine = new SideStateEngine(3, 4);
    engine.randomize(99);
    const snapshot = engine.serialize();

    const restored = new SideStateEngine(3, 4);
    restored.deserialize(snapshot);
    expect(restored.serialize()).toEqual(snapshot);
    expect(restored.getSides()).toEqual(engine.getSides());
  });

  it('emits a nested-array snapshot of the sides grid', () => {
    const engine = new SideStateEngine(2, 2);
    engine.deserialize({
      rows: 2,
      columns: 2,
      sides: [
        [
          [STRAIGHT, BOUNDARY, CROSSED, BOUNDARY],
          [BOUNDARY, BOUNDARY, BOUNDARY, BOUNDARY],
        ],
        [
          [BOUNDARY, STRAIGHT, BOUNDARY, BOUNDARY],
          [CROSSED, CROSSED, CROSSED, CROSSED],
        ],
      ],
    });
    expect(engine.serialize()).toEqual({
      rows: 2,
      columns: 2,
      sides: [
        [[1, 0, 2, 0], [0, 0, 0, 0]],
        [[0, 1, 0, 0], [2, 2, 2, 2]],
      ],
    });
  });

  it('rejects malformed input by resetting to the empty grid', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'nope',
      {},
      { rows: 2, columns: 2 }, // no sides
      { rows: 2, columns: 2, sides: [] }, // wrong row count
      { rows: 1, columns: 2, sides: [[0, 0, 0, 0]] }, // row isn't nested
      { rows: 1, columns: 1, sides: [[[0, 0, 0]]] }, // square too short
      { rows: 1, columns: 1, sides: [[[0, 0, 0, 3]]] }, // state out of range
      { rows: 1, columns: 1, sides: [[['a', 0, 0, 0]]] }, // not a number
    ];

    for (const data of bad) {
      const engine = new SideStateEngine(1, 1);
      engine.deserialize({ rows: 1, columns: 1, sides: [[[CROSSED, CROSSED, CROSSED, CROSSED]]] });
      engine.deserialize(data);
      expect(engine.serialize(), `input ${JSON.stringify(data)}`).toEqual({
        rows: 1,
        columns: 1,
        sides: [[[0, 0, 0, 0]]],
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Engine surface
// ---------------------------------------------------------------------------

describe('engine surface', () => {
  it('resets to an all-boundary grid', () => {
    const engine = new SideStateEngine(3, 3);
    engine.randomize(5);
    engine.reset();
    expect(engine.getSides().flat().flat().every((side) => side === BOUNDARY)).toBe(true);
    expect(engine.serialize()).toEqual({
      rows: 3,
      columns: 3,
      sides: [
        [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      ],
    });
  });

  it('sizes the image to the grid', () => {
    const engine = new SideStateEngine();
    expect(engine.imageSize(settings({ rows: 7, columns: 5, cellSize: 30 }))).toEqual({
      width: 150,
      height: 210,
    });
  });

  it('renders one save/translate per cell, in row-major order', () => {
    const engine = new SideStateEngine(2, 3);
    // All-boundary grid: each cell draws nothing, so the only translate per
    // cell is the one placing it — which isolates the loop's coordinates.
    const stub = makeStub();
    engine.render(stub.ctx, settings({ rows: 2, columns: 3 }));

    const translates = stub.calls.filter((c) => c.name === 'translate');
    expect(translates.length).toBe(6);
    expect(translates.map((c) => c.args)).toEqual([
      [0, 0], [30, 0], [60, 0],
      [0, 30], [30, 30], [60, 30],
    ]);
    expect(stub.calls.filter((c) => c.name === 'save').length).toBe(6);
    expect(stub.calls.filter((c) => c.name === 'restore').length).toBe(6);
    expect(stub.paths.length).toBe(0);
  });

  it('draws every cell of a random pattern', () => {
    const engine = new SideStateEngine(2, 3);
    engine.randomize(3);
    const stub = makeStub();
    engine.render(stub.ctx, settings({ rows: 2, columns: 3 }));
    expect(stub.paths.length).toBeGreaterThan(0);
    expect(stub.calls.filter((c) => c.name === 'save').length).toBe(6);
  });

  it('draws the lattice overlay when the grid is shown', () => {
    const engine = new SideStateEngine(2, 3);
    const stub = makeStub();
    engine.renderOverlay(stub.ctx, settings({ rows: 2, columns: 3 }), {
      selectedNode: null,
      hoverNode: null,
    });

    const moves = stub.calls.filter((c) => c.name === 'moveTo');
    // 4 vertical + 3 horizontal lines.
    expect(moves.length).toBe(7);
    expect(stub.calls.filter((c) => c.name === 'stroke').length).toBe(1);
    expect(stub.ctx.strokeStyle).toBe(DEFAULT_SETTINGS.gridColor);
    // No control nodes in this engine: no fills in the overlay.
    expect(stub.calls.filter((c) => c.name === 'fill').length).toBe(0);
  });

  it('skips the overlay when the grid or the UI is hidden', () => {
    const engine = new SideStateEngine(2, 3);
    for (const overrides of [{ showGrid: false }, { showUi: false }]) {
      const stub = makeStub();
      engine.renderOverlay(stub.ctx, settings({ rows: 2, columns: 3, ...overrides }), {
        selectedNode: null,
        hoverNode: null,
      });
      expect(stub.calls.length).toBe(0);
    }
  });

  it('exposes the engine identity', () => {
    const engine = new SideStateEngine();
    expect(engine.id).toBe('side-state');
    expect(engine.name.length).toBeGreaterThan(0);
  });
});
