/**
 * Pattern files: a pattern carried in a `.json` file.
 *
 * The format is `{ "engine": "<engineId>", "pattern": <opaque engine state> }`
 * — the same two halves a share link carries, minus the base64. A pattern is
 * pure data (numbers and arrays), so JSON loses nothing, and a saved pattern
 * stays diffable and editable by hand, which a base64 blob is not.
 *
 * Two deliberate constraints keep this module honest, mirroring shareLink:
 *
 * - It is *pure*. It never touches `FileReader`, `URL.createObjectURL` or an
 *   engine registry, so both sides (serialize and parse) are testable without
 *   a DOM and a file stays a plain string.
 * - `parseFile` *never throws*. A malformed file is a normal, expected input
 *   (someone hand-edited it, it was truncated mid-download), so it answers
 *   `null` and the caller ignores it. Parsing hostile text must not be able to
 *   break the page.
 *
 * Engine-id validation deliberately does NOT happen here: a file may have been
 * saved by a build that knows an engine this one does not, and `parseFile` has
 * no engine registry to check against. It returns whatever id the file named
 * and the *caller* decides — the editor's `loadPattern` already treats an
 * unknown id as a no-op, which is exactly the right degradation.
 */

/** A parsed pattern file. `pattern` is opaque engine state. */
export interface KnotFile {
  engine: string;
  pattern: unknown;
}

/**
 * Render `pattern` as the JSON text of a pattern file.
 *
 * Pretty-printed so a saved file is readable and diffable in a text editor —
 * these are a few kilobytes, and the user is meant to be able to open one.
 */
export function serializeToFile(engineId: string, pattern: unknown): string {
  return JSON.stringify({ engine: engineId, pattern }, null, 2);
}

/**
 * Read pattern-file text back into an engine id and a pattern.
 *
 * Returns `null` for anything that is not a well-formed pattern file: text
 * that is not JSON, a non-object top level, a missing or non-string `engine`,
 * or no `pattern` key. The `engine` id is returned verbatim — checking whether
 * it names a real engine is the caller's job (see the module comment).
 */
export function parseFile(text: string): KnotFile | null {
  if (typeof text !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Truncated, hand-edited, or not JSON at all — all just "not a pattern
    // file". Never propagate: a bad download must not break the page.
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const { engine, pattern } = parsed as Record<string, unknown>;
  if (typeof engine !== 'string') {
    return null;
  }
  // `undefined` covers a missing key (and an explicit `"pattern": undefined`
  // is not JSON, so it cannot reach here). `null` is a real value an engine
  // could legitimately serialize, so it is kept.
  if (pattern === undefined) {
    return null;
  }

  return { engine, pattern };
}
