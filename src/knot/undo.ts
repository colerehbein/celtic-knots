/**
 * A generic undo/redo stack over opaque states.
 *
 * The stack never interprets `T`; the caller snapshots state before a
 * mutation with `record()` and hands the live state to `undo()`/`redo()`
 * when shuttling between versions.
 *
 * Flow for one mutation:
 *
 *   stack.record(stateBefore);      // pre-mutation snapshot
 *   mutate();
 *   const prev = stack.undo(stateAfter);  // → stateBefore (stateAfter lands on the redo stack)
 *   const next = stack.redo(stateBefore); // → stateAfter
 */

const DEFAULT_CAPACITY = 50;

export class UndoStack<T> {
  private readonly capacity: number;
  private readonly undoStack: T[] = [];
  private readonly redoStack: T[] = [];

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /**
   * Push the pre-mutation state and invalidate the redo stack.
   * Call this immediately BEFORE the mutation it precedes.
   */
  record(state: T): void {
    this.undoStack.push(state);
    if (this.undoStack.length > this.capacity) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  /**
   * Step back one version. `currentState` (the live, post-mutation state)
   * is parked on the redo stack. Returns null when there is nothing to undo.
   */
  undo(currentState: T): T | null {
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      return null;
    }
    this.redoStack.push(currentState);
    return previous;
  }

  /**
   * Step forward one version. `currentState` is parked back on the undo
   * stack. Returns null when there is nothing to redo.
   */
  redo(currentState: T): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) {
      return null;
    }
    this.undoStack.push(currentState);
    return next;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
