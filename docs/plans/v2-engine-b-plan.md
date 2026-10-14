# v2 + Engine B — Implementation Plan

Executed via subagent-driven-development: fresh subagent per task, two-stage
review (spec compliance FIRST, then code quality), full task text in
subagent context (never "read the plan"), TDD in every implementer prompt.

## Orchestration rules (parent session)

- **No subagent commits.** Subagents implement and run tests; the parent
  verifies on disk (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`)
  and commits per wave. Concurrent `.git` writes race.
- **Verify, don't trust.** Self-reports are structural only. Parent runs
  the gates after each wave; fix small tails in the parent session
  (1-3 patches), never re-dispatch a whole task.
- **File ownership = sequencing.** Tasks touching the same file never run
  in parallel.
- Model: children inherit stepfun/step-5-preview:free (low effort) —
  reviewer prompts must demand concrete verdicts, and the parent verifies.

## Reversibility principle (standing rule)

**Default behavior is 1.0. Every new capability is opt-in.** Three shapes:

- **Toggles, default OFF** — anything that changes rendering:
  rainbow strands (T8), glow (T15), shimmer (T22), self-draw (T16),
  dark mode (T20).
- **Selects, default = Engine A** — modes. Engine B is opt-in, never
  the default (T10).
- **Buttons** — additive tools that don't alter editing: SVG export,
  GIF recorder (T12), save/load (T13), size presets (T14), mood board
  (T21).

Never toggled (baseline improvements, not features): accessibility
(T18), pointer-events/touch support (part of T6), undo/redo (T4).

URL sharing (T11): a "Copy share link" button, NOT live hash rewriting —
rewriting the address bar on every edit changes 1.0 behavior.

T23 — Simple/Classic mode: one master switch that disables every
opt-in toggle and hides the advanced UI (fieldsets for new features),
restoring pure 1.0. Depends on T8/T15/T16/T20 existing.

## Existing code map (for subagent context)

- `src/knot/types.ts` — KnotSettings, CutState (NO_CUT=0, HORIZ_CUT=1,
  VERT_CUT=2), ODD/EVEN, CutGrid, DEFAULT_SETTINGS, OUTPUT_OFFSET,
  MIN_CANVAS_*
- `src/knot/tiles.ts` — 36-state tile matrix, TileFn, rotate/flipHorizontally
- `src/knot/pattern.ts` — pure: makeEmptyPattern, makeBetterRandomPattern,
  setBorderState, canCut, applyCut, computeCutDimensions, isSameNode
- `src/knot/render.ts` — pure canvas fns: renderKnotwork, renderGrid,
  renderCuts, renderControlNodes, getClosestNode, getVisualNodeCenter
- `src/knot/editor.ts` — KnotEditor class: canvas, mouse, public API, export
- `src/main.ts` + `index.html` — UI wiring (controls: reset, randomize,
  close/open border, grid W/H apply, show-grid, show-overlay, cell/string/
  stroke sliders, 3 color inputs, download PNG)
- Tests: `src/knot/pattern.test.ts`, `src/knot/tiles.test.ts` (vitest,
  canvas-stub pattern for tiles)
- Build: `pnpm build` = tsc --noEmit && vite build && cp dist/index.html
  celtic-knots.html (single-file, self-contained)
- Reference for Engine B: `docs/reference/celtic-knot-drawing-tool-john-mueller.pde`
  (John Mueller, CC BY-SA 3.0 / GPL — algorithm only, reimplement under MIT)

---

## Phase 0 — Engine interface foundation (SEQUENTIAL, solo)

### T0 — Extract KnotEngine interface, Engine A behind it

**Files:** NEW `src/knot/engines/types.ts`, `src/knot/engines/cutParity.ts`
(move + wrap existing logic), MODIFY `src/knot/editor.ts` (delegate),
`src/knot/types.ts` (keep), tests unchanged.

**Spec:**

```ts
// src/knot/engines/types.ts
export interface EngineImageSize { width: number; height: number }

export interface KnotEngine {
  readonly id: 'cut-parity' | 'side-state';
  readonly name: string;
  /** Full re-render onto ctx (knot only, no editor overlay). */
  render(ctx: CanvasRenderingContext2D, settings: KnotSettings): void;
  /** New random pattern (seeded). */
  randomize(seed?: number): void;
  /** Clear to the engine's empty pattern. */
  reset(): void;
  /** Serialize/deserialize the pattern (JSON-safe). */
  serialize(): unknown;
  deserialize(data: unknown): void;
  /** Knot pixel dimensions for the given settings. */
  imageSize(settings: KnotSettings): EngineImageSize;
  /** Overlay render (editor chrome: nodes/cuts/preview) — engine-specific. */
  renderOverlay(ctx: CanvasRenderingContext2D, settings: KnotSettings, ui: EditorUiState): void;
  /** Hit-test an editor pointer position (canvas coords, offset applied). */
  hitTest(x: number, y: number, settings: KnotSettings): EditorHit | null;
  /** Apply an editor hit/click. */
  onClick(hit: EditorHit, settings: KnotSettings): void;
}
```

- `cutParity.ts` wraps the current cuts-grid + tiles + render + control-node
  logic behind this interface. The existing 20 tests must keep passing
  unchanged (move tests to `engines/cutParity.test.ts` if needed, or keep
  testing through the engine).
- `editor.ts` becomes engine-agnostic: holds `engine: KnotEngine` +
  `EditorUiState` (selectedNode/hoverNode or engine B equivalents),
  delegates render/randomize/hitTest/onClick. Public API unchanged.
- **Gate:** `pnpm test` 20/20 green, `pnpm exec tsc --noEmit` clean,
  `pnpm build` succeeds, browser smoke: knot renders (verify via a quick
  node + playwright webkit check is parent's job — implementer just runs
  the local gates).

**Commit:** none (parent commits per wave).

---

## Phase 1 — Parallel new-file work (after T0; T2/T3 are T0-INDEPENDENT
## and may run in the same wave as T0)

STATUS (2026-10-14): T0 ✓ committed (63800bb) · T1 ✓ committed (22288fc) ·
T3 ✓ committed (d5b8cc2) · **T2 DEFERRED** — two subagent attempts died on
it (first: concurrent-refactor confusion; second: response truncation after
36 min of exploration of the curved-cross tile semantics, no files written).
The port-connection model for the curved-cross tiles is genuinely subtle
and needs empirical verification against rendered output. T2 is only on
the critical path for T8 (per-strand coloring) — defer it to fresh
context rather than burn a third attempt. Do NOT re-dispatch until the
implementer has a tight, fully-derived spec (see strands.ts TODO below)
or the parent writes it directly.

### T1 — Engine B: side-state model (Mueller algorithm, our code)

**Files:** NEW `src/knot/engines/sideState.ts` + `src/knot/engines/sideState.test.ts`.

**Spec (from the reference .pde — reimplement, do not copy):**
- Grid of `cols x rows` squares; each square has 4 side states:
  `0=boundary, 1=straight, 2=crossed` (order: up, right, down, left).
- `randomize(seed)`: per-side random 0/1/2 with optional symmetry
  (mirror left-right and/or four-quadrant, like Engine A's randomizer;
  default weights 50/50), border sides default 0 unless opening.
- `setBorder('open'|'closed')`: closed = border sides 0 (native!), open =
  border sides 1.
- Render: per square, translate to (col*s, row*s), draw the four quarters.
  Quarter geometry from the reference:
  `x = s/3*(1-1/sqrt(2))`, `y = s/15`, `y2 = s/(15*sqrt(2))`.
  Each quarter = union of up to 2 polygons chosen by
  (primary side state, secondary = clockwise side state) — the 3x3 table.
  Special cases: all-zero = nothing; sum==1 = one-straight polygon
  (rotate by which side); all-four-straight = four-straight quarters.
  All polygons are `fill` (string color) with the outer stroke drawn the
  same way Engine A strokes (stroke color, strokeWidth).
  IMPORTANT: verify the 9 quarter polygon vertex lists against the
  reference .pde coordinate-for-coordinate (it is in the repo). Write a
  test that renders each of the 9 quarter cases with the canvas stub and
  asserts the drawn vertex sequences match the reference values.
- `hitTest(x, y, settings)`: nearest lattice line
  (`abs(x - i*s) < abs(y - j*s)` → horizontal edge between squares i-1/i
  at row j, else vertical). Returns the edge position.
- `onClick(hit)`: bump the corresponding sides of both adjacent squares
  (side state cycles 0→1→2→0), out-of-bounds guarded.
- `serialize/deserialize`: the sides grid as nested arrays.
- `imageSize`: `{ cols*s, rows*s }`.

**Tests (vitest, canvas stub like tiles.test.ts):**
1. Each of the 9 quarter (primary, secondary) cases draws the exact
   reference polygon vertices (read them off the .pde).
2. bump cycles 0→1→2→0; onClick bumps both adjacent squares' sides.
3. randomize: shape correct, values in {0,1,2}, seeded = reproducible
   (two calls same seed = identical grids).
4. setBorder closed → all border sides 0; open → border sides 1.
5. serialize/deserialize round-trip.

### T2 — Strand tracer (loop extraction from cut grid)

**Files:** NEW `src/knot/strands.ts` + `strands.test.ts`. Pure, no canvas.

**Spec:**
- Input: CutGrid + rows/columns. Output: list of closed loops; each loop
  is an ordered array of lattice points (the corners the strand passes
  through) in Engine A geometry.
- Algorithm: Engine A strands run diagonally corner-to-corner through
  cells; a NO_CUT cell connects its two diagonals; cuts interrupt.
  Model the strand graph: at each cell, the straight-cross tile connects
  BL↔TR and TL↔BR. Walks continue through shared corners unless a cut at
  that corner interrupts (HORIZ_CUT/VERT_CUT at the cut position covering
  that corner). Follow the same cut-coverage rules render.ts uses
  (firstCut/secondCut selection by parity).
- Cut semantics: where a cut covers a corner, the strand is interrupted —
  represent as the walk ending there (open strand end) rather than
  connecting. (Strands may terminate at cuts and at the canvas border.)
- Output type: `{ loops: StrandLoop[]; openEnds: ... }` where StrandLoop =
  `{ points: {x,y}[] }` in cut-grid/cell coordinates.
- **Tests:** all-NO_CUT grid on 12x12 → expected number of infinite
  diagonal lines represented as open strands terminating at border; a
  fully-closed-border grid → strands form closed loops; assert loop
  counts are deterministic; assert every traced point sequence is
  contiguous (each consecutive pair differs by exactly one diagonal step);
  assert a cut splits a strand (loop/point count changes).

### T3 — SVG exporter

**Files:** NEW `src/knot/svgExport.ts` + `svgExport.test.ts`. Pure.

**Spec:**
- `exportSVG(cuts: CutGrid, settings: KnotSettings, opts?: {scale?: number}): string`
- Emits an SVG string: background rect (backgroundColor), then per-cell
  tile geometry as `<path>` elements (fill stringColor, stroke strokeColor,
  stroke-width). The tile shapes must match tiles.ts geometry:
  - horizontal line: rect + two lines
  - straight cross: the two diagonal band polygons (outline paths)
  - corner: two quadratic curves (outer + inner), filled
  - curved cross: the bezier paths (over/under outline break)
  - rotations/mirrors of the above
- Reuse the same transform helpers (rotate/flip) but in SVG
  (`transform="translate(cx cy) rotate(deg) translate(-cx -cy)"`,
  `scale(-1 1) translate(-s 0)`).
- viewBox = full knot pixel size; width/height in px.
- **Tests:** output is well-formed XML (parse with a strict parser —
  python xml.etree or a tiny DOM check); element counts per tile type;
  a known cuts grid produces a deterministic byte-identical string
  (golden test with a small 2x2 grid, values read off tiles.ts).

---

## Phase 2 — editor.ts chain (SEQUENTIAL, one task at a time)

Each task: implementer (TDD) → spec reviewer → quality reviewer → parent
verifies+commits.

### T4 — Undo/redo
- Snapshot stack of engine.serialize() (cap 50), Cmd+Z / Cmd+Shift+Z
  wired in main.ts, `canUndo/canRedo` getters, undo/redo public API on
  KnotEditor. Tests: stack behavior on editor via a minimal DOM stub or
  through engine serialize calls (prefer pure engine-level tests +
  one integration test with a stubbed canvas like tiles.test.ts).

### T5 — High-DPI PNG export
- `toPNG(scale: 1|2|4)`: renderExportCanvas takes scale; downloadPNG
  accepts scale; UI: scale select next to Download. Tests: exported blob
  dimensions = knot size * scale (integration with stub canvas toBlob).

### T6 — Drag-to-draw cuts + Pointer Events migration
- Replace mousemove/click with pointerdown/pointermove/pointerup.
  pointerdown near node → begin drag; pointermove → hover preview;
  pointerup on valid target → applyCut. Plain click still works
  (down+up same node = select). Touch/pen work via Pointer Events.
  Tests: simulate pointer event sequences on a stub canvas; assert
  selection state machine transitions (select → drag → cut; select →
  click same → deselect; invalid target → deselect).

### T7 — Keyboard shortcuts
- R randomize, Esc deselect, G grid, U overlay, Cmd+Z undo,
  Cmd+Shift+Z redo, arrows nudge selection. main.ts keydown handler.
  Tests: keydown dispatch on stub document → editor state changes.

### T8 — Per-strand coloring + loop stats
- Uses T2's tracer: assign each loop a hue from a palette (or golden-angle
  distribution), render knot per-loop colors (stringColor per loop; the
  stroke stays strokeColor). "Rainbow strands" checkbox, DEFAULT OFF
  (reversibility principle — 1.0 keeps the single stringColor until
  opted in).
- Stats readout: loop count + crossing count in the UI (informational,
  always visible once computed — it's a readout, not a mode).
- Tests: tracer integration (already tested in T2), palette assignment
  determinism (seeded), stats numbers on a known grid, and the toggle
  default being false.

### T9 — Palettes
- 6-8 curated palettes (string/stroke/bg triples): monochrome, duotone,
  earth, neon, parchment, ocean, ember, forest. UI: palette dropdown
  applying all three colors. Tests: each palette has valid hex values,
  distinct string colors within a palette.

---

## Phase 3 — main.ts / index.html chain (SEQUENTIAL)

### T10 — Engine mode toggle
- UI: engine select (Celtic (cut/parity) / Chip-carving (side-state)).
  Switching engines swaps pattern (each engine owns its pattern; no
  cross-conversion — documented). Controls gate: border buttons hidden
  for Engine B (native state 0), cell/string/stroke/colors/grid shared.
  Randomize/reset/export delegate to active engine.
- Tests: engine switching state machine (active engine id, per-engine
  pattern preservation across switches).

### T11 — Seeded RNG + share link button
- `src/knot/rng.ts`: mulberry32 seeded PRNG (new file, pure, tests:
  determinism, distribution sanity).
- pattern.ts + sideState randomize take optional seed.
- Share link: a "Copy share link" button (NOT live URL-hash rewriting —
  reversibility principle). The button composes
  `<url>#e=<engine>&p=<base64 pattern>` (or `#s=<seed>` for
  seed-shareable randomize) and copies to clipboard. Parsed on load if
  present. Tests: link composition round-trip (parse what the button
  generates → same engine + pattern), malformed hash ignored gracefully.

### T12 — GIF recorder
- MediaRecorder on canvas.captureStream(); record toggle button; records
  randomize cycles; downloads .gif... NOTE: MediaRecorder produces
  webm, not gif. Either record webm (simpler, honest) or capture frames
  and assemble (heavy). Spec: webm recorder with frame timing, button
  label "Record demo (webm)". Tests: hard to test MediaRecorder in
  node — test the frame-cadence logic (which redraws to capture) as a
  pure scheduler; integration check is parent's browser job.

### T13 — Pattern save/load
- Download pattern as .json (engine serialize), load via file input.
  Tests: serialize → download filename/format; load parses + validates
  (reject wrong shape).

### T14 — Size presets
- Buttons: Icon 512 (12x12 @ 42... compute to ~512), Banner 1400x300,
  A4 @300dpi. Thin wrappers over setKnotworkSize + setCellSize.
  Tests: preset produces the target image dimensions via imageSize().

### T15 — Glow/neon mode
- Checkbox: shadowBlur on strands (ctx.shadowColor = stringColor,
  shadowBlur = stringSize/2). Engine A render flag; Engine B same if
  trivial. Tests: render flag present in settings; smoke via stub ctx
  (shadowBlur set before draws).

### T16 — Self-drawing animation
- On randomize (when enabled): staggered per-cell reveal via
  requestAnimationFrame (cell i revealed at i * 8ms). Respect
  prefers-reduced-motion (skip animation). Tests: reveal schedule pure
  function (given cell count + frame time → reveal order); reduced-motion
  check.

### T17 — PWA
- manifest.webmanifest + service worker caching the single file; "install"
  possible. Files: manifest + sw.js registered in main.ts (guarded:
  only when served over http(s), skip on file://). Tests: manifest JSON
  validity; sw registration guard logic (pure fn: shouldRegister(location)).

### T18 — Accessibility pass
- Keyboard node navigation (arrows move selection between valid nodes,
  Enter selects/cuts, per engine hit model), ARIA live region announcing
  cut changes, focusable canvas, prefers-reduced-motion respected (T16).
  Tests: navigation state machine pure tests.

---

## Phase 4 — Tier 3 (as desired)

T19 rectangle/multi-cell cuts · T20 auto dark mode (toggle, default OFF —
never changes 1.0's fixed palette unless the user opts in;
prefers-color-scheme drives bg/stroke only) · T21 mood-board batch render
(grid of 9 variations → one PNG via offscreen canvas) · T22 hue shimmer
(slow hue rotation animation toggle, default OFF).

---

## Wave execution order

1. **Wave A:** T0 (solo refactor) — gate: 20 tests + tsc + build green
2. **Wave B:** T1, T2, T3 (parallel — all new files) — gate: full suite
3. **Wave C:** T4 → T5 → T6 → T7 (sequential editor.ts chain)
4. **Wave D:** T8 → T9 (T8 needs T2; editor.ts again, sequential)
5. **Wave E:** T10 → T11 → T12 → T13 → T14 (main.ts chain)
6. **Wave F:** T15 → T16 → T17 → T18
7. **Wave G:** T19-T22 as desired

Each wave: parent verifies gates, commits with a descriptive message,
updates this file's checkboxes. If a subagent leaves a broken tail
(1-3 compile errors), parent patches directly; if more, dispatch a fix
subagent with the exact errors — never re-dispatch the whole task.
