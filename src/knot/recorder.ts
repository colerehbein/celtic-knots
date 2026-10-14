import { downloadBlob } from './download';

/**
 * Demo recording: capture the live canvas as a WebM clip.
 *
 * `MediaRecorder` is the whole mechanism — there is no frame-grabbing loop
 * here, no gif assembly. That has two consequences worth stating up front:
 *
 * - The output is **WebM** (`video/webm`), not a GIF. No browser encodes GIF
 *   from a canvas stream, so anything that produced a `.gif` would have to
 *   ship an encoder and re-time every frame by hand. The button, the tooltip
 *   and the filename all say `webm` so the label matches the artifact.
 * - Recording is a browser-only feature. Everything in this module that a
 *   browser cannot do is either feature-detected (`isRecordingSupported`) or
 *   left to `main.ts`, which owns the DOM wiring. The state machine and the
 *   download are pure and testable in node.
 *
 * The state machine exists because `MediaRecorder.stop()` is asynchronous:
 * between `stop()` and the `onstop` handler the recorder has neither started
 * nor finished. A single boolean ("are we recording?") cannot express that
 * window, and a second click in it would either double-stop a recorder or
 * restart capture while the first one is still flushing.
 */

export type RecorderStatus = 'idle' | 'recording' | 'stopping';

export type RecorderEvent = 'start' | 'stop' | 'done';

/**
 * The only legal moves, as an explicit table rather than a chain of guards:
 *
 * ```
 *   idle --start--> recording --stop--> stopping --done--> idle
 * ```
 *
 * Everything else — including every event fired in the `stopping` window
 * except `done` — is a no-op that returns the current status. That is the
 * point: an out-of-order click must not be able to restart capture or lose
 * the in-flight recording, and the caller can tell "handled" from "ignored"
 * by comparing the result against the status it passed in.
 */
const TRANSITIONS: Readonly<Record<RecorderStatus, Partial<Record<RecorderEvent, RecorderStatus>>>> = {
  idle: { start: 'recording' },
  recording: { stop: 'stopping' },
  stopping: { done: 'idle' },
};

/**
 * Advance the recorder one event. Invalid transitions return `status`
 * unchanged, so a stray double-click is inert rather than corrupting.
 */
export function recorderTransition(status: RecorderStatus, event: RecorderEvent): RecorderStatus {
  return TRANSITIONS[status][event] ?? status;
}

/**
 * Whether this environment can record at all. False in node (vitest runs
 * there) and in older browsers, which is exactly what the UI needs to know:
 * the record button stays disabled with an explanation instead of throwing
 * `MediaRecorder is not defined` on click.
 */
export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

/**
 * Frames per second handed to `canvas.captureStream`. The knot only changes
 * when the user edits it, so 10fps captures every redraw-driven change while
 * keeping the recorded bitrate (and file size) far below what 30fps of a
 * mostly-static canvas would cost.
 */
export const CAPTURE_FRAME_RATE = 10;

/** MIME type of the recording. WebM is what MediaRecorder actually emits. */
export const RECORDING_MIME_TYPE = 'video/webm';

/**
 * Saved recording filename. The extension is part of the honesty: a user who
 * ends up with `celtic-knot-demo.gif` would reasonably expect a GIF, and
 * nothing here can produce one.
 */
export const DEMO_FILENAME = 'celtic-knot-demo.webm';

/**
 * Save a finished recording. Async only to match the other download paths in
 * the app (`downloadPNG`), so `main.ts` can await it uniformly; the work
 * itself is synchronous.
 */
export async function downloadRecording(blob: Blob, filename = DEMO_FILENAME): Promise<void> {
  downloadBlob(blob, filename);
}
