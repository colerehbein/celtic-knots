# Celtic Knot Generator — Roadmap

Living document. Ideas are ranked by impact; the sequencing section is the
recommended build order. Effort estimates are agent-sessions, roughly.

## Where we are

- Single-engine app: the cut/parity model (staggered lattice, 36-state tile
  matrix, strands through cell centers, smooth curves). Lineage: Janis
  Elsts' knotmaker.
- 20 tests, strict TS, zero runtime deps, single-file build, live at
  celtic-knots.cole.press (pending DNS) via GitHub Pages auto-deploy.

---

## Tier 1 — v2 core (build these first)

### 1. Per-strand coloring ★
The cut grid defines real closed loops: walk the tile graph from any strand
entry point and you recover every loop as a sequence of cells. Color each
loop a distinct hue and the knot goes from "orange plait" to actual art.
The single biggest visual upgrade available, and the loop-walking machinery
also powers feature 12. Effort: 1 session (tracing + palette assignment +
render integration).

### 2. Seeded RNG + shareable URLs ★
`makeBetterRandomPattern` uses `Math.random`, so patterns are
unreproducible. Inject a seeded PRNG (mulberry32 is 4 lines) and put
`#seed=<n>` in the URL: every knot becomes shareable, and "knot of the
day" (seed = date hash) falls out for free. Effort: small.

### 3. Undo/redo ★
The cuts grid is the only mutable editor state (plus selection). A
snapshot stack of grid copies, capped at ~50 entries, is twenty lines and
makes misclicks non-destructive. Keyboard: Cmd+Z / Cmd+Shift+Z. Effort:
small.

### 4. SVG export ★
Every tile is fill + stroke path operations with direct SVG equivalents
(rect, path with quadratic/cubic segments). A parallel emitter produces
vector output: infinite scale, tiny files, editable in
Illustrator/Figma/Inkscape. Effort: 1 session.

### 5. High-DPI PNG export ★
`renderExportCanvas` currently renders at 1x. Add a scale parameter (1x /
2x / 4x) so exports are print-quality. One line in the editor plus a UI
control. Effort: trivial.

### 6. Pattern save/load
The cuts grid is ~91 bytes of JSON. Export/import pattern files so a good
knot survives a stray Randomize click. Effort: small.

### 7. PWA / offline install
The app is already a single file; add a manifest and service worker and it
becomes an installable, launchable app. Effort: small.

### 8. Curated color palettes
One click from "default orange" to a designed look. Ship 6-8 palettes
(curated, not random): monochrome, duotone, earth, neon, parchment, etc.
Effort: trivial.

### 9. Drag-to-draw cuts
Current editing is two clicks (select node, click target). Pointer-drag
between nodes is the natural gesture: press a node, drag, release on a
valid target. Effort: half session.

### 10. Pointer Events migration
The editor binds `mousemove`/`click` only, so it is dead on touch devices.
Pointer Events unify mouse, touch, and pen. Effort: half session.

## Tier 2 — strong adds

### 11. GIF recorder
The README demo was assembled from nine manual screenshots. `canvas.captureStream()`
plus MediaRecorder records randomize cycles natively in-browser: press
record, randomize a few times, download the GIF. Effort: half session.

### 12. Live knot stats
Loop count and crossing count fall out of the same loop-tracing as feature
1. Educational readout ("7 loops, 84 crossings") and free once tracing
exists. Effort: trivial after 1.

### 13. Symmetry-locked editing
The randomizer already mirrors cuts across quadrants; apply the same
mirroring to manual edits so hand-drawn patterns stay symmetric. Effort:
half session.

### 14. Preset gallery
Three or four hand-designed knots as starting points. Currently the only
entry states are "empty weave" and "pure random". Effort: small (design +
embed).

### 15. Glow/neon mode
`shadowBlur` strands on a dark background. One render flag, screensaver
energy. Effort: trivial.

### 16. Self-drawing animation
Strands draw in sequence on Randomize via staggered per-cell redraws with
requestAnimationFrame. Makes the tool feel alive. Effort: half session.

### 17. Size presets
Codifies the exact workflow used for the README banner: icon (512x512),
banner (1400x300), print (A-series at 300dpi). Thin wrappers over
`setKnotworkSize`. Effort: trivial.

### 18. Keyboard shortcuts
R = randomize, Esc = deselect, arrows = nudge selection, G = toggle grid,
U = toggle overlay. Power users notice immediately. Effort: trivial.

### 19. Publish the engine
The core is pure and 20-test covered. An npm package or a
`<celtic-knot>` web component lets people embed generation headless in
their own pages. Effort: packaging session.

### 20. Accessibility pass
Honest flag: least fun, most principled. The canvas is mouse-only and
invisible to screen readers. Fix: keyboard node navigation, ARIA live
region announcing cuts, focusable controls, `prefers-reduced-motion`
respect. Effort: 1 session.

## Tier 3 — someday

21. Rectangle/multi-cell cuts for power editing
22. Auto dark mode via `prefers-color-scheme`
23. Mood-board batch render (grid of nine variations to one PNG)
24. Animated hue shimmer for ambient display

---

## The dual-engine proposal (Engine B)

### The idea

Cole's instinct, thought through: add a second drawing engine behind a mode
toggle. The candidate is **"Celtic Knot Drawing Tool" by John Mueller**
(OpenProcessing sketch 124012, CC BY-SA 3.0 / GPL, source archived at
`docs/reference/celtic-knot-drawing-tool-john-mueller.pde`). It was built
for laying out **chip-carving patterns**, and its model is genuinely
different from ours:

| | Engine A (current) | Engine B (Mueller) |
|---|---|---|
| State | cuts at staggered lattice nodes | 4 side-states per square (0=boundary, 1=straight, 2=crossed) |
| Lattice | staggered, odd rows offset | uniform w x h grid |
| Strands | through cell centers, smooth curves | along cell edges, angular with diagonal breaks |
| Render | 36-entry 4D tile matrix (cut1, cut2, rowParity, colParity) | per-square, 4 quarters from a (primary, secondary) 3x3 table |
| Edit | click node, click node = cut between | click lattice edge = toggle both adjacent squares |
| Border | explicit open/close border pass | native: state 0 IS the boundary |
| Look | smooth Celtic knotwork | angular chip-carving guilloche |

### Can they coexist? Yes — and Engine B is simpler than Engine A

- The models are **not isomorphic** (different lattices, different
  conventions). A translation layer would cost more than a second engine,
  so: two engine modules behind one shell, not one unified model.
- Engine B's core is ~300-400 lines: the 9 quarter polygons
  (`x = s/3*(1-1/sqrt(2))`, `y = s/15`), the special cases (blank,
  one-straight, four-straight), and the click-to-bump gesture. No parity,
  no staggered coordinates, no 4D matrix.
- Shared shell: canvas, sizing, colors, palettes, PNG/SVG export, seeded
  randomize, undo — all engine-agnostic behind a small `KnotEngine`
  interface (state, render, randomize, serialize, hit-test).
- Engine B's native strengths: boundary is a first-class state (open/close
  is free), click-to-toggle is more direct than two-click cuts, and the
  crossed connection gives diagonal breaks that produce a visibly
  different texture — this is a second knot tradition, not a reskin.

### Honest costs

- Test surface doubles for the generation core (Engine B needs its own
  quarter-table coverage tests — cheap, the table is finite).
- Two randomizers with different semantics ("randomize" must mean the
  right thing per engine; Engine B randomizes side states with optional
  symmetry).
- UI must gate controls per engine (border toggle is Engine A only;
  Engine B's boundary is its default state).
- Scope: Engine B core ~1 session, shell integration ~half a session.

### Licensing note

Mueller's sketch is CC BY-SA 3.0 / GPL dual-licensed — **not** public
domain. Copying the code directly obliges attribution plus share-alike
(or GPL for the combined work), which fights this repo's MIT license.
The clean path: reimplement the **algorithm** in our own code (algorithms
are not copyrightable expression) under MIT, with attribution "engine
design after John Mueller's Celtic Knot Drawing Tool (CC BY-SA 3.0 / GPL)"
in the README and source headers. The archived `.pde` stays in
`docs/reference/` as verification material so the geometry is checked
against the original, not guessed.

### Recommendation

Build it. Structure: `src/knot/engines/` with engine A extracted behind
the interface first (refactor, tests stay green), then engine B added
behind a mode toggle. The two engines produce two distinct aesthetics —
smooth Celtic vs angular chip-carving — which is a real feature with a
real use case (Cole carves), not a gimmick.

---

## Recommended sequencing

1. **v2** = features 1-6 plus 3 (undo). The coherent "real tool" release.
2. **v2.5** = 7-10 plus 18. The polish release.
3. **Engine B** = the dual-mode release. Refactor engine A behind the
   interface first; add engine B; mode toggle in the UI.
4. **v3** = tier 2 remainder and tier 3 as inspiration strikes.
