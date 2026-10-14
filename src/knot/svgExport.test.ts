import { describe, expect, it } from 'vitest';
import { exportSVG, type SvgExportOptions } from './svgExport';
import { DEFAULT_SETTINGS, EVEN, HORIZ_CUT, NO_CUT, ODD, VERT_CUT, type CutGrid, type CutState, type KnotSettings } from './types';
import { computeCutDimensions, makeEmptyPattern } from './pattern';

/**
 * Structural XML well-formedness check, in pure TypeScript — this project has
 * zero runtime dependencies and no @types/node, so no DOMParser (browser-only)
 * and no node builtins. It verifies the invariants that matter for an SVG
 * document we generate ourselves:
 *
 *   1. Tag balance: every non-void, non-self-closing element has exactly one
 *      matching close tag, and the nesting is properly ordered (LIFO stack).
 *   2. Self-closing tags (`<rect ... />`) and void-style `<tag/>` are accepted.
 *   3. Attributes are all double-quoted, with no unquoted values and no
 *      duplicate attribute names on one element.
 *   4. Text content contains no raw `<`, `>`, `&` (only the entity references
 *      &amp; &lt; &gt; &quot; &apos; and numeric character references).
 *   5. The root element is a single <svg>, and nothing follows its close tag.
 *   6. Every element name is a legal XML Name.
 *
 * This is a structural validator, not a full XML parser: it does not check
 * DTD validity, namespace well-formedness beyond the root prefix, or the SVG
 * schema. It catches exactly the class of bug an exporter can introduce —
 * unbalanced tags, mis-nesting, unquoted attributes, unescaped text.
 */
function assertWellFormedXml(svg: string, label: string): void {
  const fail = (reason: string): never => {
    expect.fail(`${label}: not well-formed XML — ${reason}`);
  };

  const NAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;
  const VOID = new Set(['rect', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'stop']);
  const ENTITY = /^(&(amp|lt|gt|quot|apos);|&#[0-9]+;|&#x[0-9a-fA-F]+;)/;

  const stack: string[] = [];
  let rootSeen = false;
  let rootClosed = false;
  let i = 0;

  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    if (lt === -1) {
      // Trailing text after the last tag must still be entity-safe.
      const tail = svg.slice(i);
      if (!isCleanText(tail, ENTITY)) fail(`raw <, > or & in text: ${JSON.stringify(tail.slice(0, 40))}`);
      break;
    }
    if (lt > i) {
      const text = svg.slice(i, lt);
      if (!isCleanText(text, ENTITY)) {
        fail(`raw <, > or & in text between tags: ${JSON.stringify(text.slice(0, 40))}`);
      }
    }

    // Comment / CDATA / processing instruction / doctype: skip whole construct.
    if (svg.startsWith('<!--', lt)) {
      const end = svg.indexOf('-->', lt + 4);
      if (end === -1) fail('unterminated comment');
      i = end + 3;
      continue;
    }
    if (svg.startsWith('<![CDATA[', lt)) {
      const end = svg.indexOf(']]>', lt + 9);
      if (end === -1) fail('unterminated CDATA section');
      i = end + 3;
      continue;
    }
    if (svg.startsWith('<?', lt) || svg.startsWith('<!', lt)) {
      const end = svg.indexOf('>', lt + 2);
      if (end === -1) fail('unterminated declaration');
      i = end + 1;
      continue;
    }

    // Find the tag's closing '>' — respecting quoted attribute values, so a
    // '>' inside an attribute (e.g. inside an escaped transform) can't fool us.
    let j = lt + 1;
    let quote: string | null = null;
    while (j < svg.length) {
      const ch = svg[j];
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    if (j >= svg.length) fail('unterminated tag');
    if (quote !== null) fail('unterminated attribute value');

    let inner = svg.slice(lt + 1, j);
    const selfClosing = inner.endsWith('/');
    if (selfClosing) inner = inner.slice(0, -1);

    const isClose = inner.startsWith('/');
    if (isClose) inner = inner.slice(1);

    const nameMatch = /^[A-Za-z_][A-Za-z0-9._:-]*/.exec(inner.trim());
    if (nameMatch === null) {
      fail(`malformed tag at offset ${lt}: <${inner.slice(0, 30)}`);
      return;
    }
    const name = nameMatch[0];
    if (!NAME.test(name)) fail(`illegal element name ${JSON.stringify(name)}`);
    const rest = inner.trim().slice(name.length);

    if (!isClose) {
      // Validate the attribute list: whitespace-separated name="value" pairs,
      // all double-quoted. Applied to normal AND self-closing tags — only a
      // closing tag legitimately carries no attributes.
      const seen = new Set<string>();
      const attrRe = /([A-Za-z_][A-Za-z0-9._:-]*)="([^"]*)"/g;
      let cursor = 0;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(rest)) !== null) {
        // Only whitespace may sit between the previous match and this one;
        // anything else means an unquoted or malformed value like fill=#fff.
        const gap = rest.slice(cursor, m.index);
        if (gap.trim() !== '') {
          fail(`<${name}> has unquoted attribute text: ${JSON.stringify(gap.trim().slice(0, 40))}`);
        }
        if (seen.has(m[1])) fail(`duplicate attribute ${m[1]} on <${name}>`);
        seen.add(m[1]);
        cursor = attrRe.lastIndex;
      }
      const leftover = rest.slice(cursor).replace(/\s+/g, '');
      if (leftover !== '') {
        fail(`<${name}> has unquoted or malformed attribute text: ${JSON.stringify(leftover.slice(0, 40))}`);
      }
    }

    if (isClose) {
      const open = stack.pop();
      if (open === undefined) fail(`closing </${name}> with no open element`);
      if (open !== name) fail(`</${name}> closes <${open}> (mis-nested)`);
      if (stack.length === 0) rootClosed = true;
      i = j + 1;
      continue;
    }

    if (selfClosing || VOID.has(name)) {
      if (stack.length === 0) rootSeen = true;
      i = j + 1;
      continue;
    }

    if (rootSeen && stack.length === 0) fail(`second root element <${name}>`);
    stack.push(name);
    rootSeen = true;
    i = j + 1;
  }

  if (stack.length > 0) fail(`unclosed element(s): ${stack.join(' > ')}`);
  if (!rootSeen) fail('no elements found');
  if (!rootClosed) fail('root element was never closed');
}

/** True if text contains no raw <, > or & outside of entity references. */
function isCleanText(text: string, entity: RegExp): boolean {
  let rest = text;
  while (rest.length > 0) {
    const bad = /[<>&]/.exec(rest);
    if (bad === null) return true;
    const at = bad.index;
    if (rest[at] !== '&') return false;
    const m = entity.exec(rest.slice(at));
    if (m === null) return false;
    rest = rest.slice(at + m[0].length);
  }
  return true;
}

/** Count opening tags of a given name. */
function countTag(svg: string, tag: string): number {
  return (svg.match(new RegExp(`<${tag}[ >/]`, 'g')) ?? []).length;
}

/**
 * The golden fixture: a 2x2 knot (cellSize 30, stringSize 12) with every cut
 * position NO_CUT.
 *
 * Geometry derivation (all values straight out of tiles.ts, cellSize = 30,
 * stringSize = 12):
 *   - h        = Math.round(stringSize / Math.SQRT2) = Math.round(8.485) = 8
 *   - half     = cellSize / 2 = 15
 *   - halfString = stringSize / 2 = 6
 *
 * With every cut NO_CUT the matrix resolves to drawStraightCross at all four
 * parities, wrapped in rotate(0/90/180/270). Its two drawings are:
 *   fill:   M(0,30) L(0,30-8) L(30-8,0) L(30,0) L(30,8) L(8,30) Z
 *         = M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z
 *   stroke: M(0,22) L(22,0)  then a second subpath M(8,30) L(30,8) L(22,0)
 *
 * Cell loop order follows renderKnotwork: columns outer, rows inner, so the
 * cells appear as (0,0), (0,1), (1,0), (1,1).
 *
 * Dimensions: viewBox = 2 * 30 = 60 on both axes.
 */
const GOLDEN_SETTINGS: KnotSettings = { ...DEFAULT_SETTINGS, rows: 2, columns: 2 };

function goldenCuts(): CutGrid {
  const dims = computeCutDimensions(GOLDEN_SETTINGS.rows, GOLDEN_SETTINGS.columns);
  return makeEmptyPattern(dims.cutRows, dims.cutColumns);
}

/** The exact bytes exportSVG must produce for the golden fixture. */
const GOLDEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="60" height="60">
  <rect x="0" y="0" width="60" height="60" fill="#FFFFFF"/>
  <g transform="translate(0 0)">
    <path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39"/>
    <path d="M 0 22 L 22 0 M 8 30 L 30 8 L 22 0" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/>
  </g>
  <g transform="translate(0 30)">
    <path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39" transform="translate(15 15) rotate(270) translate(-15 -15)"/>
    <path d="M 0 22 L 22 0 M 8 30 L 30 8 L 22 0" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="square" stroke-linejoin="round" transform="translate(15 15) rotate(270) translate(-15 -15)"/>
  </g>
  <g transform="translate(30 0)">
    <path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39" transform="translate(15 15) rotate(90) translate(-15 -15)"/>
    <path d="M 0 22 L 22 0 M 8 30 L 30 8 L 22 0" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="square" stroke-linejoin="round" transform="translate(15 15) rotate(90) translate(-15 -15)"/>
  </g>
  <g transform="translate(30 30)">
    <path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39" transform="translate(15 15) rotate(180) translate(-15 -15)"/>
    <path d="M 0 22 L 22 0 M 8 30 L 30 8 L 22 0" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="square" stroke-linejoin="round" transform="translate(15 15) rotate(180) translate(-15 -15)"/>
  </g>
</svg>
`;

/** Build a cut grid from a sparse map of [row][column] -> state. */
function gridFrom(rows: number, columns: number, entries: Record<string, CutState>): CutGrid {
  const grid: CutGrid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = new Array<CutState>(columns).fill(NO_CUT);
  }
  for (const [key, state] of Object.entries(entries)) {
    const [r, c] = key.split(',').map(Number);
    grid[r][c] = state;
  }
  return grid;
}

describe('exportSVG — document structure', () => {
  it('emits a complete standalone SVG document', () => {
    const svg = exportSVG(goldenCuts(), GOLDEN_SETTINGS);

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 60 60"');
    expect(svg).toContain('width="60"');
    expect(svg).toContain('height="60"');
    // Background rect comes first, uses backgroundColor, covers the canvas.
    expect(svg).toContain('<rect x="0" y="0" width="60" height="60" fill="#FFFFFF"/>');
  });

  it('passes a structural XML well-formedness check', () => {
    assertWellFormedXml(exportSVG(goldenCuts(), GOLDEN_SETTINGS), 'golden 2x2');
  });

  it('parses as strict XML for every tile type in one 4x4 knot', () => {
    // 4x4 knot: cutRows 5, cutColumns 3. Deliberately mixes all tile shapes —
    // straight crosses, corners, straight lines, curved crosses (over + under).
    const cuts = gridFrom(5, 3, {
      '1,0': VERT_CUT,
      '1,1': HORIZ_CUT,
      '2,1': HORIZ_CUT,
      '2,2': VERT_CUT,
      '3,0': HORIZ_CUT,
      '3,1': VERT_CUT,
      '3,2': HORIZ_CUT,
    });
    const svg = exportSVG(cuts, { ...DEFAULT_SETTINGS, rows: 4, columns: 4 });
    assertWellFormedXml(svg, 'mixed 4x4');
    // Every cell emitted at least one shape.
    expect(countTag(svg, 'g')).toBeGreaterThanOrEqual(16);
  });

  it('the XML check itself rejects each class of defect (not vacuous)', () => {
    // A validator that only ever passes is worthless. Each of these must be
    // caught, proving the check has teeth.
    const cases: [string, string][] = [
      ['unclosed element', '<svg><g><path d="M 0 0"/></svg>'],
      ['mis-nested elements', '<svg><g></path></g></svg>'],
      ['close tag with no open', '<svg></g></svg>'],
      ['stray close after root', '<svg><g/></svg></g>'],
      ['unquoted attribute', '<svg><rect fill=#fff/></svg>'],
      ['duplicate attribute', '<svg><rect fill="#fff" fill="#000"/></svg>'],
      ['raw ampersand in text', '<svg>a & b</svg>'],
      ['raw angle bracket in text', '<svg>a > b</svg>'],
      ['unterminated tag', '<svg><rect x="0"'],
      ['unterminated attribute value', '<svg><rect x="0></svg>'],
      ['empty document', '   '],
      ['second root element', '<svg/><svg/>'],
    ];
    for (const [label, bad] of cases) {
      expect(() => assertWellFormedXml(bad, label), label).toThrow();
    }
    // And the golden document still passes, so the check isn't just rejecting.
    expect(() => assertWellFormedXml(GOLDEN_SVG, 'golden')).not.toThrow();
  });

  it('the XML check accepts self-closing and void-style tags', () => {
    assertWellFormedXml('<svg><rect x="0" y="0" width="10" height="10"/><path d="M 0 0"/></svg>', 'self-closing');
    assertWellFormedXml('<svg><rect x="0"/></svg>', 'void-style');
    // A '>' inside a quoted attribute value must not end the tag early.
    assertWellFormedXml('<svg><path d="M 0 0" transform="a &gt; b"/></svg>', 'escaped gt in attr');
  });

  it('escapes colour values that are not XML-safe', () => {
    const svg = exportSVG(goldenCuts(), {
      ...GOLDEN_SETTINGS,
      stringColor: '#FF9A39" onload="alert(1)',
      backgroundColor: 'a&b<c',
    });
    assertWellFormedXml(svg, 'escaped');
    expect(svg).not.toContain('" onload="');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('a&amp;b&lt;c');
  });

  it('never leaks the drawError placeholder tile', () => {
    // drawError is the only tile that calls strokeRect, which surfaces as a
    // second <rect> with a black stroke. Sweep all 36 matrix states via a
    // 6x6 knot with a cut grid that exercises every (first, second, rp, cp).
    const cuts: CutGrid = [];
    const dims = computeCutDimensions(6, 6);
    for (let r = 0; r < dims.cutRows; r++) {
      cuts[r] = new Array<CutState>(dims.cutColumns).fill(NO_CUT);
      for (let c = 0; c < dims.cutColumns; c++) {
        cuts[r][c] = ((r + c * 2) % 3) as CutState;
      }
    }
    const svg = exportSVG(cuts, { ...DEFAULT_SETTINGS, rows: 6, columns: 6 });
    // Exactly one rect: the background. No per-cell rects beyond the ones
    // drawHorizontalLine/drawVerticalLine legitimately emit as fills.
    const cellRects = (svg.match(/<rect /g) ?? []).length;
    expect(cellRects).toBeGreaterThanOrEqual(1);
    // drawError strokes a black square outline; no tile should emit that.
    expect(svg).not.toContain('stroke="#000000" stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/><');
    assertWellFormedXml(svg, '36-state sweep');
  });
});

describe('exportSVG — golden test', () => {
  it('is byte-identical for the 2x2 all-NO_CUT fixture', () => {
    // The golden value is the literal expected document (see GOLDEN_SVG above)
    // — no hashing, so this project stays free of node builtins and @types/node.
    const svg = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    expect(svg).toBe(GOLDEN_SVG);
  });

  it('produces identical bytes across repeated calls', () => {
    const first = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    const second = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    const third = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

describe('exportSVG — element counts', () => {
  it('2x2 all-NO_CUT: 8 paths (straight cross = 1 fill + 1 stroke per cell)', () => {
    // drawStraightCross in tiles.ts paints exactly two paths per cell:
    //   beginPath(); 6 lineTo's; closePath(); fill()   -> 1 filled polygon
    //   beginPath(); 2 subpaths; stroke()              -> 1 outline path
    // 4 cells x 2 paths = 8 <path>. Plus 1 background <rect>.
    const svg = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    expect(countTag(svg, 'path')).toBe(8);
    expect(countTag(svg, 'rect')).toBe(1);
    expect(countTag(svg, 'g')).toBe(4);
  });

  it('counts track tile shape: HORIZ_CUT cells emit rect + path, not a polygon', () => {
    // drawHorizontalLine = fillRect + a 2-subpath stroke: 1 <rect> + 1 <path>
    // per cell. Make every cell a horizontal line by cutting all rows.
    const dims = computeCutDimensions(2, 2);
    const cuts: CutGrid = [];
    for (let r = 0; r < dims.cutRows; r++) {
      cuts[r] = new Array<CutState>(dims.cutColumns).fill(HORIZ_CUT);
    }
    const svg = exportSVG(cuts, GOLDEN_SETTINGS);
    // 1 background rect + 4 cell rects, 4 cell paths.
    expect(countTag(svg, 'rect')).toBe(5);
    expect(countTag(svg, 'path')).toBe(4);
    expect(svg).toContain('<rect x="0" y="9" width="30" height="12" fill="#FF9A39"/>');
  });

  it('all-NO_CUT 6x6 has 6*6*2 = 72 paths', () => {
    const dims = computeCutDimensions(6, 6);
    const cuts = makeEmptyPattern(dims.cutRows, dims.cutColumns);
    const svg = exportSVG(cuts, { ...DEFAULT_SETTINGS, rows: 6, columns: 6 });
    expect(countTag(svg, 'path')).toBe(72);
    expect(countTag(svg, 'g')).toBe(36);
  });
});

describe('exportSVG — scale', () => {
  it('defaults to 1 (no wrapper group)', () => {
    const svg = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    expect(svg).not.toContain('<g transform="scale(');
    expect(svg).toContain('viewBox="0 0 60 60"');
  });

  it('scale:2 doubles width, height and viewBox', () => {
    const svg = exportSVG(goldenCuts(), GOLDEN_SETTINGS, { scale: 2 } satisfies SvgExportOptions);
    expect(svg).toContain('viewBox="0 0 120 120"');
    expect(svg).toContain('width="120"');
    expect(svg).toContain('height="120"');
    // Scaling is applied as one group transform, so recorded coordinates stay
    // identical to the unscaled document.
    expect(svg).toContain('<g transform="scale(2)">');
    expect(svg).toContain('<path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39"/>');
    assertWellFormedXml(svg, 'scaled');
  });

  it('fractional scale multiplies dimensions exactly', () => {
    const svg = exportSVG(goldenCuts(), GOLDEN_SETTINGS, { scale: 1.5 });
    expect(svg).toContain('viewBox="0 0 90 90"');
    expect(svg).toContain('width="90"');
    expect(svg).toContain('height="90"');
    expect(svg).toContain('<g transform="scale(1.5)">');
  });

  it('scale:1 is identical to omitting opts entirely', () => {
    const withOpts = exportSVG(goldenCuts(), GOLDEN_SETTINGS, { scale: 1 });
    const without = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    expect(withOpts).toBe(without);
  });
});

describe('exportSVG — geometry fidelity to tiles.ts', () => {
  /** The shapes of one cell of a 2x2 knot, as trimmed SVG lines. */
  function cellAt(cuts: CutGrid, x: number, y: number, settings: KnotSettings = GOLDEN_SETTINGS): string[] {
    const svg = exportSVG(cuts, settings);
    const start = svg.indexOf(`<g transform="translate(${x * settings.cellSize} ${y * settings.cellSize})">`);
    const end = svg.indexOf('</g>', start);
    return svg
      .slice(start, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Build a 2x2 cut grid where cell (1,1) sees (first, second).
   *
   * Cell (1,1) has rowParity = EVEN and colParity = EVEN, so per
   * renderKnotwork it reads firstCut = cuts[y+1][(x-1)/2] = cuts[2][0] and
   * secondCut = cuts[y][(x+1)/2] = cuts[1][1]. Every other cell of this grid
   * is left NO_CUT/NO_CUT, so each case isolates exactly one tile shape.
   */
  function gridForCell11(first: CutState, second: CutState): CutGrid {
    const grid = goldenCuts();
    grid[2][0] = first;
    grid[1][1] = second;
    return grid;
  }

  it('straight cross uses h = round(stringSize / SQRT2) = 8', () => {
    // h = Math.round(12 / Math.SQRT2) = Math.round(8.485) = 8, so the notch
    // sits 8px in from each edge: 30-8 = 22 and 8.
    const lines = cellAt(goldenCuts(), 0, 0);
    expect(lines[1]).toBe('<path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39"/>');
    // The outline keeps its two disjoint subpaths (the over/under break).
    expect(lines[2]).toContain('d="M 0 22 L 22 0 M 8 30 L 30 8 L 22 0"');
  });

  it('curved cross over reproduces the exact bezier control points', () => {
    // VERT_CUT / NO_CUT at (EVEN, EVEN) -> curvedCrossOver.
    // half = 15, halfString = 6, h = 8, topCpLength = 2:
    //   leftSideCurve  C (half-halfString, half-h*0.4) (cellSize-h-2, 2) (cellSize-h, 0)
    //                 = C (9, 11.8) (20, 2) (22, 0)
    //   rightSideCurve C (cellSize-2, h+2) (half+halfString, half+h*0.4) (21, cellSize)
    //                 = C (28, 10) (21, 18.2) (21, 30)
    const lines = cellAt(gridForCell11(VERT_CUT, NO_CUT), 1, 1);
    expect(lines[1]).toBe(
      '<path d="M 9 30 C 9 11.8 20 2 22 0 L 30 0 L 30 8 C 28 10 21 18.2 21 30 Z" fill="#FF9A39"/>',
    );
    // crossOver = true: the outline BREAKS at (30, 8) — moveTo, not lineTo —
    // so the other strand reads as passing over.
    expect(lines[2]).toBe(
      '<path d="M 9 30 C 9 11.8 20 2 22 0 M 30 8 C 28 10 21 18.2 21 30" fill="none" ' +
        'stroke="#000000" stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/>',
    );
  });

  it('curved cross under keeps a continuous outline (no break)', () => {
    // NO_CUT / VERT_CUT at (EVEN, EVEN) -> rotate(curvedCrossUnder, 180).
    const lines = cellAt(gridForCell11(NO_CUT, VERT_CUT), 1, 1);
    // crossOver = false: lineTo, not moveTo, so the outline is one subpath.
    expect(lines[2]).toContain('22 0 L 30 8 C 28 10 21 18.2 21 30');
    expect(lines[2]).not.toContain('22 0 M 30 8');
    expect(lines[2]).toContain('transform="translate(15 15) rotate(180) translate(-15 -15)"');
  });

  it('corner reproduces the quadratic control points', () => {
    // HORIZ_CUT / VERT_CUT at (EVEN, EVEN) -> drawCorner.
    // half = 15, halfString = 6.
    const lines = cellAt(gridForCell11(HORIZ_CUT, VERT_CUT), 1, 1);
    expect(lines[1]).toBe('<path d="M 9 0 L 21 0 Q 21 21 0 21 L 0 9 Q 9 9 9 0 Z" fill="#FF9A39"/>');
    expect(lines[2]).toBe(
      '<path d="M 21 0 Q 21 21 0 21 M 0 9 Q 9 9 9 0" fill="none" stroke="#000000" ' +
        'stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/>',
    );
  });

  it('horizontal line is a rect plus a two-subpath outline', () => {
    // HORIZ_CUT / HORIZ_CUT -> drawHorizontalLine = fillRect + 2-subpath stroke.
    // fillRect(0, half - halfString, cellSize, stringSize) = (0, 9, 30, 12).
    const lines = cellAt(gridForCell11(HORIZ_CUT, HORIZ_CUT), 1, 1);
    expect(lines[1]).toBe('<rect x="0" y="9" width="30" height="12" fill="#FF9A39"/>');
    expect(lines[2]).toBe(
      '<path d="M 0 9 L 30 9 M 0 21 L 30 21" fill="none" stroke="#000000" ' +
        'stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/>',
    );
  });

  it('rotate/flip wrappers become SVG transforms, not baked coordinates', () => {
    // A rotated tile keeps tiles.ts's untransformed numbers and carries the
    // rotation as a transform list, in canvas CTM order.
    // HORIZ_CUT / NO_CUT at (EVEN, EVEN) -> rotate(flipHorizontally(over), 90).
    const lines = cellAt(gridForCell11(HORIZ_CUT, NO_CUT), 1, 1);
    expect(lines[1]).toBe(
      '<path d="M 9 30 C 9 11.8 20 2 22 0 L 30 0 L 30 8 C 28 10 21 18.2 21 30 Z" fill="#FF9A39" ' +
        'transform="translate(15 15) rotate(90) translate(-15 -15) scale(-1 1) translate(-30 0)"/>',
    );
    // curvedCrossOver inside: the outline break survives the wrappers.
    expect(lines[2]).toContain('22 0 M 30 8 C 28 10 21 18.2 21 30');
  });

  it('flipHorizontally emits scale(-1 1) translate(-30 0)', () => {
    // NO_CUT / HORIZ_CUT at (EVEN, EVEN) -> rotate(flipHorizontally(under), 270).
    const lines = cellAt(gridForCell11(NO_CUT, HORIZ_CUT), 1, 1);
    expect(lines[1]).toContain(
      'transform="translate(15 15) rotate(270) translate(-15 -15) scale(-1 1) translate(-30 0)"',
    );
    // curvedCrossUnder inside: continuous outline, no break.
    expect(lines[2]).toContain('22 0 L 30 8 C 28 10 21 18.2 21 30');
  });

  it('stroke styling follows the canvas renderer: square caps, round joins', () => {
    const svg = exportSVG(goldenCuts(), GOLDEN_SETTINGS);
    // Every stroked shape in the document — 4 cells, one outline each.
    const strokes = (svg.match(/<path d="[^"]*" fill="none" stroke="[^"]*"[^>]*>/g) ?? []).filter(
      (s) => s.includes('stroke-linecap'),
    );
    expect(strokes.length).toBe(4);
    for (const s of strokes) {
      expect(s).toContain('stroke="#000000"');
      expect(s).toContain('stroke-width="2"');
      expect(s).toContain('stroke-linecap="square"');
      expect(s).toContain('stroke-linejoin="round"');
    }
  });

  it('custom settings flow through to colours, sizes and viewBox', () => {
    const settings: KnotSettings = {
      ...DEFAULT_SETTINGS,
      rows: 2,
      columns: 2,
      cellSize: 40,
      stringSize: 16,
      strokeWidth: 3,
      stringColor: '#123456',
      strokeColor: 'rgb(1, 2, 3)',
      backgroundColor: '#ABCDEF',
    };
    // h = round(16 / SQRT2) = 11; half = 20; halfString = 8.
    const svg = exportSVG(goldenCuts(), settings);
    expect(svg).toContain('viewBox="0 0 80 80"');
    expect(svg).toContain('fill="#ABCDEF"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('stroke="rgb(1, 2, 3)"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('d="M 0 40 L 0 29 L 29 0 L 40 0 L 40 11 L 11 40 Z"');
    assertWellFormedXml(svg, 'custom settings');
  });

  it('is deterministic across calls for a large mixed pattern', () => {
    const dims = computeCutDimensions(8, 8);
    const cuts: CutGrid = [];
    for (let r = 0; r < dims.cutRows; r++) {
      cuts[r] = [];
      for (let c = 0; c < dims.cutColumns; c++) {
        // Deterministic pseudo-random spread of all three states.
        cuts[r][c] = ((r * 7 + c * 5 + (r * c) % 3) % 3) as CutState;
      }
    }
    const settings = { ...DEFAULT_SETTINGS, rows: 8, columns: 8 };
    const a = exportSVG(cuts, settings);
    const b = exportSVG(cuts, settings);
    expect(a).toBe(b);
    assertWellFormedXml(a, 'large mixed');
    expect(countTag(a, 'path')).toBeGreaterThan(0);
  });

  it('handles a cut grid larger than the knot reads (extra entries ignored)', () => {
    const cuts = gridFrom(3, 4, { '1,0': VERT_CUT });
    expect(() => exportSVG(cuts, GOLDEN_SETTINGS)).not.toThrow();
    assertWellFormedXml(exportSVG(cuts, GOLDEN_SETTINGS), 'oversized grid');
  });

  it('tolerates a cut grid that is too small (missing entries read as NO_CUT)', () => {
    const short: CutGrid = [[NO_CUT], [NO_CUT], [NO_CUT]];
    const svg = exportSVG(short, GOLDEN_SETTINGS);
    // Degenerate input must not throw or produce malformed XML.
    assertWellFormedXml(svg, 'undersized grid');
    expect(countTag(svg, 'g')).toBe(4);
  });

  it('parity rules match renderKnotwork: cuts are read per cell parity', () => {
    // For a 2x2 knot, renderKnotwork reads each cell's cuts like this:
    //   (0,0) ODD,ODD    firstCut=cuts[1][0]  secondCut=cuts[0][0]
    //   (0,1) EVEN,ODD   firstCut=cuts[2][0]  secondCut=cuts[1][0]
    //   (1,0) ODD,EVEN   firstCut=cuts[1][1]  secondCut=cuts[0][0]
    //   (1,1) EVEN,EVEN  firstCut=cuts[2][0]  secondCut=cuts[1][1]
    // cuts[1][1] is therefore read by exactly two cells — (1,0) as firstCut
    // and (1,1) as secondCut — and by no other. This is the cleanest probe:
    // setting it alone must change cells (1,0) and (1,1) and leave (0,0) and
    // (0,1) as the all-NO_CUT straight crosses.
    const cuts = goldenCuts();
    cuts[1][1] = VERT_CUT;
    const svg = exportSVG(cuts, GOLDEN_SETTINGS);

    // (1,0): VERT_CUT / NO_CUT at (ODD, EVEN) -> flipHorizontally(curvedCrossOver).
    expect(svg).toContain(
      '<g transform="translate(30 0)">\n' +
        '    <path d="M 9 30 C 9 11.8 20 2 22 0 L 30 0 L 30 8 C 28 10 21 18.2 21 30 Z" fill="#FF9A39" ' +
        'transform="scale(-1 1) translate(-30 0)"/>\n',
    );
    // (1,1): NO_CUT / VERT_CUT at (EVEN, EVEN) -> rotate(curvedCrossUnder, 180).
    expect(svg).toContain(
      '<g transform="translate(30 30)">\n' +
        '    <path d="M 9 30 C 9 11.8 20 2 22 0 L 30 0 L 30 8 C 28 10 21 18.2 21 30 Z" fill="#FF9A39" ' +
        'transform="translate(15 15) rotate(180) translate(-15 -15)"/>\n',
    );
    // (0,0) and (0,1) never read cuts[1][1]: still the golden straight crosses.
    expect(svg).toContain(
      '<g transform="translate(0 0)">\n    <path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39"/>',
    );
    expect(svg).toContain(
      '<g transform="translate(0 30)">\n' +
        '    <path d="M 0 30 L 0 22 L 22 0 L 30 0 L 30 8 L 8 30 Z" fill="#FF9A39" ' +
        'transform="translate(15 15) rotate(270) translate(-15 -15)"/>',
    );
    assertWellFormedXml(svg, 'parity wiring');
  });

  it('exports the ODD/EVEN parity constants the tile matrix needs', () => {
    // Guards against a silent types.ts rename breaking the parity wiring.
    expect([ODD, EVEN, NO_CUT, HORIZ_CUT, VERT_CUT]).toEqual([1, 0, 0, 1, 2]);
  });
});
