import { describe, expect, it } from 'vitest';
import { CutParityEngine } from './engines/cutParity';
import { SideStateEngine } from './engines/sideState';
import { composeShareLink, parseShareLink } from './shareLink';

/** A representative engine snapshot: nested numbers and arrays, no strings. */
const SAMPLE_PATTERN = {
  cutRows: 5,
  cutColumns: 5,
  cuts: [
    [0, 1, 2, 1, 0],
    [1, 0, 0, 0, 2],
    [2, 0, 1, 0, 1],
    [1, 0, 0, 0, 0],
    [0, 2, 1, 2, 0],
  ],
};

describe('composeShareLink / parseShareLink', () => {
  it('round-trips the engine id and pattern', () => {
    const link = composeShareLink('https://example.com/knots/', 'cut-parity', SAMPLE_PATTERN);
    const parsed = parseShareLink(link);

    expect(parsed).not.toBeNull();
    expect(parsed?.engineId).toBe('cut-parity');
    expect(parsed?.pattern).toEqual(SAMPLE_PATTERN);
  });

  it('formats the fragment as #e=<engineId>&p=<base64url JSON>', () => {
    const link = composeShareLink('https://example.com/knots/', 'side-state', SAMPLE_PATTERN);
    expect(link.startsWith('https://example.com/knots/#e=side-state&p=')).toBe(true);
    // The payload must be URL-safe: no +, / or = in the base64 itself.
    const payload = link.slice(link.indexOf('&p=') + 3);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it('drops any existing hash from the base url', () => {
    const link = composeShareLink('https://example.com/knots/#e=old&p=stale', 'cut-parity', SAMPLE_PATTERN);
    expect(link).not.toContain('stale');
    expect(parseShareLink(link)?.engineId).toBe('cut-parity');
  });

  it('keeps the query string of the base url', () => {
    const link = composeShareLink('https://example.com/knots/?v=2', 'cut-parity', SAMPLE_PATTERN);
    expect(link.startsWith('https://example.com/knots/?v=2#')).toBe(true);
    expect(parseShareLink(link)?.pattern).toEqual(SAMPLE_PATTERN);
  });

  it('parses the hash with or without the leading #', () => {
    const link = composeShareLink('https://example.com/knots/', 'cut-parity', SAMPLE_PATTERN);
    const hash = link.slice(link.indexOf('#'));

    expect(parseShareLink(hash)?.engineId).toBe('cut-parity');
    expect(parseShareLink(hash.slice(1))?.engineId).toBe('cut-parity');
  });

  it('round-trips through a real cut-parity engine', () => {
    const source = new CutParityEngine();
    source.resize(6, 8);
    source.randomize(42);
    const pattern = source.serialize();

    const parsed = parseShareLink(composeShareLink('https://example.com/', 'cut-parity', pattern));
    expect(parsed?.engineId).toBe('cut-parity');

    const restored = new CutParityEngine();
    restored.resize(6, 8);
    restored.deserialize(parsed?.pattern);

    expect(restored.serialize()).toEqual(source.serialize());
  });

  it('round-trips through a real side-state engine', () => {
    const source = new SideStateEngine(5, 6);
    source.randomize(1234);
    const pattern = source.serialize();

    const parsed = parseShareLink(composeShareLink('https://example.com/', 'side-state', pattern));
    expect(parsed?.engineId).toBe('side-state');

    const restored = new SideStateEngine(5, 6);
    restored.deserialize(parsed?.pattern);

    expect(restored.serialize()).toEqual(source.serialize());
  });

  it('ignores extra params it does not know', () => {
    const link = composeShareLink('https://example.com/', 'cut-parity', SAMPLE_PATTERN);
    const parsed = parseShareLink(`${link}&theme=dark`);
    expect(parsed?.pattern).toEqual(SAMPLE_PATTERN);
  });
});

describe('parseShareLink rejects malformed input', () => {
  const malformed: readonly [string, string][] = [
    ['empty string', ''],
    ['bare hash', '#'],
    ['missing payload', '#e=cut-parity'],
    ['missing engine id', '#p=eyJhIjoxfQ'],
    ['engine id only', '#e=x'],
    ['payload only', '#p=y'],
    ['empty payload', '#e=cut-parity&p='],
    ['not base64', '#e=cut-parity&p=!!!'],
    ['base64 of non-JSON', '#e=cut-parity&p=bm90LWpzb24'],
    ['JSON that is not an object', '#e=cut-parity&p=NQ'],
    ['JSON null', '#e=cut-parity&p=bnVsbA'],
    ['JSON array', '#e=cut-parity&p=WzEsMl0'],
    ['illegal engine id characters', '#e=../x&p=eyJhIjoxfQ'],
    ['missing = separator', '#ecut-parity'],
    ['bad percent-escape in engine id', '#e=%zz&p=eyJhIjoxfQ'],
  ];

  for (const [label, hash] of malformed) {
    it(`returns null for ${label}`, () => {
      expect(parseShareLink(hash)).toBeNull();
    });
  }

  it('never throws, whatever it is handed', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      '#e=&p=',
      '#e=cut-parity&p=' + 'A'.repeat(5000),
      '#p=eyJhIjoxfQ&e=cut-parity',
    ];
    for (const input of inputs) {
      expect(() => parseShareLink(input as string)).not.toThrow();
    }
  });
});
