/**
 * Deterministic seeded PRNG, shared by every engine's `randomize(seed)`.
 *
 * Mulberry32: a small, fast, well-distributed 32-bit generator. It used to be
 * inlined separately in both engines; the two copies were byte-identical, so
 * they collapse to this one implementation. Keeping a single copy means a
 * seeded pattern from one engine stays reproducible even if the other engine's
 * copy drifts.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
