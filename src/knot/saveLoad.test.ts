import { describe, expect, it } from 'vitest';
import { CutParityEngine } from './engines/cutParity';
import { SideStateEngine } from './engines/sideState';
import { parseFile, serializeToFile } from './saveLoad';

describe('serializeToFile / parseFile', () => {
  it('round-trips the engine id and pattern', () => {
    const pattern = { cutRows: 5, cutColumns: 5, cuts: [[0, 1], [2, 1]] };
    const parsed = parseFile(serializeToFile('cut-parity', pattern));

    expect(parsed).not.toBeNull();
    expect(parsed?.engine).toBe('cut-parity');
    expect(parsed?.pattern).toEqual(pattern);
  });

  it('writes the {engine, pattern} shape as JSON', () => {
    const text = serializeToFile('side-state', { sides: [1, 2] });
    expect(JSON.parse(text)).toEqual({ engine: 'side-state', pattern: { sides: [1, 2] } });
    expect(text).toContain('"engine"');
    expect(text).toContain('"pattern"');
  });

  it('round-trips through a real cut-parity engine', () => {
    const source = new CutParityEngine();
    source.resize(6, 8);
    source.randomize(42);

    const text = serializeToFile(source.id, source.serialize());
    const parsed = parseFile(text);
    expect(parsed?.engine).toBe('cut-parity');

    const restored = new CutParityEngine();
    restored.resize(6, 8);
    restored.deserialize(parsed?.pattern);
    expect(restored.serialize()).toEqual(source.serialize());
  });

  it('round-trips through a real side-state engine', () => {
    const source = new SideStateEngine(5, 6);
    source.randomize(1234);

    const text = serializeToFile(source.id, source.serialize());
    const parsed = parseFile(text);
    expect(parsed?.engine).toBe('side-state');

    const restored = new SideStateEngine(5, 6);
    restored.deserialize(parsed?.pattern);
    expect(restored.serialize()).toEqual(source.serialize());
  });

  it('returns the engine id verbatim, even an unknown one', () => {
    // Whether that id names a real engine is the caller's problem, not
    // parseFile's: this module has no engine registry to check against.
    const parsed = parseFile(serializeToFile('quantum-knot', { a: 1 }));
    expect(parsed?.engine).toBe('quantum-knot');
    expect(parsed?.pattern).toEqual({ a: 1 });
  });
});

describe('parseFile rejects malformed input', () => {
  const malformed: readonly [string, string][] = [
    ['empty string', ''],
    ['whitespace only', '   \n  '],
    ['not JSON', 'not json'],
    ['empty object', '{}'],
    ['non-string engine', '{"engine":1,"pattern":{"a":1}}'],
    ['null engine', '{"engine":null,"pattern":{"a":1}}'],
    ['missing engine', '{"pattern":{"a":1}}'],
    ['missing pattern', '{"engine":"cut-parity"}'],
    ['engine only', '{"engine":"cut-parity"}'],
    ['top-level array', '[1,2]'],
    ['top-level number', '5'],
    ['top-level string', '"cut-parity"'],
    ['top-level null', 'null'],
  ];

  for (const [label, text] of malformed) {
    it(`returns null for ${label}`, () => {
      expect(parseFile(text)).toBeNull();
    });
  }

  it('never throws, whatever it is handed', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      '{"engine":"cut-parity","pattern":' + '['.repeat(500),
    ];
    for (const input of inputs) {
      expect(() => parseFile(input as string)).not.toThrow();
    }
  });
});
