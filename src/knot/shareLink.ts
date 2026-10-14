/**
 * Share links: a pattern carried in the URL fragment.
 *
 * The format is `#e=<engineId>&p=<base64url(JSON.stringify(pattern))>`. The
 * pattern itself is pure data — numbers and arrays — so it survives JSON with
 * no lossy encoding step, and base64url keeps the fragment free of the `+`,
 * `/` and `=` that base64 would otherwise need and that URLs mangle.
 *
 * Two deliberate constraints keep this module honest:
 *
 * - It is *pure*. It never touches `location`, the clipboard or an engine
 *   registry, so both sides (compose and parse) are testable without a DOM and
 *   a link stays a plain string.
 * - `parseShareLink` *never throws*. A malformed hash is a normal, expected
 *   input (someone hand-edited it, a mail client rewrote it), so it answers
 *   `null` and the caller falls back to its fresh-startup behaviour. Encoding
 *   a hostile string must not be able to break page load.
 *
 * The fragment is never written back on load: parsing is opt-in and read-only,
 * so a shared link loads what it says and the user's own edits stay theirs.
 */

/** Engine ids are small, URL-safe tokens. Anything else is not a share link. */
const ENGINE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Standard base64 with the two URL-hostile characters folded away and the
 * padding dropped, so the fragment needs no percent-encoding.
 */
function encodeBase64Url(text: string): string {
  // Encode as UTF-8 bytes first: `btoa` throws on anything above Latin-1, and
  // a pattern is data we do not get to police for character set.
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inverse of `encodeBase64Url`. Throws on input that is not valid base64. */
function decodeBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Split a fragment body (`e=x&p=y`) into params without decoding values. */
function splitParams(body: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const segment of body.split('&')) {
    if (segment === '') {
      continue;
    }
    const separator = segment.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = segment.slice(0, separator);
    if (!params.has(key)) {
      params.set(key, segment.slice(separator + 1));
    }
  }
  return params;
}

/**
 * Build a share URL for `pattern` on `engineId`.
 *
 * `baseUrl` may carry a query string or a stale fragment; any existing hash is
 * dropped so the new one is the only one on the link.
 */
export function composeShareLink(baseUrl: string, engineId: string, pattern: unknown): string {
  const base = baseUrl.split('#')[0];
  const payload = encodeBase64Url(JSON.stringify(pattern));
  return `${base}#e=${encodeURIComponent(engineId)}&p=${payload}`;
}

/**
 * Read a share URL's fragment back into a pattern.
 *
 * Accepts a full share URL, or the fragment on its own with or without its
 * leading `#`. Returns `null` for anything that is not a well-formed share
 * link — a missing half, base64 that is not base64, JSON that is not JSON, or
 * a pattern that is not a JSON object (a bare number or string round-trips but
 * is not a pattern). Callers treat `null` as "no share link present".
 */
export function parseShareLink(hash: string): { engineId: string; pattern: unknown } | null {
  if (typeof hash !== 'string') {
    return null;
  }

  try {
    // Everything before the first '#' is a URL we do not care about; with no
    // '#' at all the whole string is already the fragment body.
    const fragmentStart = hash.indexOf('#');
    const body = fragmentStart === -1 ? hash : hash.slice(fragmentStart + 1);
    if (body === '') {
      return null;
    }

    const params = splitParams(body);
    const rawEngineId = params.get('e');
    const payload = params.get('p');
    if (rawEngineId === undefined || payload === undefined || payload === '') {
      return null;
    }

    const engineId = decodeURIComponent(rawEngineId);
    if (!ENGINE_ID_PATTERN.test(engineId)) {
      return null;
    }

    const pattern: unknown = JSON.parse(decodeBase64Url(payload));
    if (typeof pattern !== 'object' || pattern === null || Array.isArray(pattern)) {
      return null;
    }

    return { engineId, pattern };
  } catch {
    // Bad base64, bad JSON, a malformed percent-escape — all just "not a
    // share link". Never propagate: page load must survive a bad hash.
    return null;
  }
}
