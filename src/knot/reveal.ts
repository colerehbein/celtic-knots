/**
 * Self-drawing animation logic, kept pure so the schedule is testable
 * without a browser.
 *
 * The animation is one visual effect on `randomizePattern`: the editor
 * randomizes the pattern immediately (so undo, serialize and the pointer
 * handlers see the final state from frame zero), then reveals it cell by
 * cell. The schedule here is the only timing knowledge — the editor owns
 * the requestAnimationFrame loop.
 */

/**
 * Milliseconds each cell of the reveal costs. Chosen so a 12x12 knot
 * (144 cells) draws itself in a bit over a second: long enough to read as
 * an animation, short enough that nobody waits for it twice.
 */
export const REVEAL_PER_CELL_MS = 8;

/**
 * How many cells should be visible at `elapsedMs` into a reveal of
 * `totalCells`, with one cell appearing every `perCellMs`.
 *
 * The `+ 1` makes the very first frame show one cell rather than an empty
 * canvas, and the clamp stops the count past the last cell.
 */
export function revealSchedule(totalCells: number, perCellMs: number, elapsedMs: number): number {
  if (totalCells <= 0) {
    return 0;
  }
  return Math.min(totalCells, Math.floor(elapsedMs / perCellMs) + 1);
}

/**
 * True when the user has asked the OS for reduced motion.
 *
 * Contract: this is a browser-only question. In Node (no `window`, no
 * `matchMedia`) it returns false — the safe default for tests and SSR,
 * where there is no animation to suppress anyway. Every access is guarded
 * by a `typeof` check so importing this module outside a browser is inert.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
