import { KnotEditor, SIZE_PRESETS, type EngineId, type ExportScale } from './knot/editor';
import { composeShareLink, parseShareLink } from './knot/shareLink';
import { parseFile, serializeToFile } from './knot/saveLoad';
import {
  CAPTURE_FRAME_RATE,
  RECORDING_MIME_TYPE,
  downloadRecording,
  isRecordingSupported,
  recorderTransition,
  type RecorderStatus,
} from './knot/recorder';

const canvas = document.getElementById('knot-canvas') as HTMLCanvasElement;
const editor = new KnotEditor(canvas);

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function syncControls(): void {
  $<HTMLInputElement>('grid-width').value = String(editor.getGridWidth());
  $<HTMLInputElement>('grid-height').value = String(editor.getGridHeight());

  const cell = $<HTMLInputElement>('cell-size');
  const string = $<HTMLInputElement>('string-size');
  const stroke = $<HTMLInputElement>('stroke-width');
  cell.value = String(editor.getCellSize());
  string.value = String(editor.getStringSize());
  stroke.value = String(editor.getStrokeWidth());
  $('cell-size-num').textContent = String(editor.getCellSize());
  $('string-size-num').textContent = String(editor.getStringSize());
  $('stroke-width-num').textContent = String(editor.getStrokeWidth());

  $<HTMLInputElement>('string-color').value = editor.getStringColor();
  $<HTMLInputElement>('stroke-color').value = editor.getStrokeColor();
  $<HTMLInputElement>('background-color').value = editor.getBackgroundColor();
}

/** Push the editor's active engine back into the select. */
function syncEngineSelect(): void {
  $<HTMLSelectElement>('engine-select').value = editor.getEngineId();
}

/** Read the select as an engine id; anything unknown falls back to the default. */
function readEngineId(): EngineId {
  const value = $<HTMLSelectElement>('engine-select').value;
  return value === 'side-state' ? 'side-state' : 'cut-parity';
}

$('reset-pattern').addEventListener('click', () => editor.resetPattern());
$('randomize-pattern').addEventListener('click', () => editor.randomizePattern());

// The engine select swaps the live engine. Each engine keeps its own pattern,
// so switching back restores what was there; the undo stack is engine-specific
// and is cleared by the editor.
$<HTMLSelectElement>('engine-select').addEventListener('change', () => {
  editor.setEngine(readEngineId());
  syncEngineSelect();
});
$('close-border').addEventListener('click', () => editor.closeBorder());
$('open-border').addEventListener('click', () => editor.openBorder());

$('set-grid-size').addEventListener('click', () => {
  const width = parseInt($<HTMLInputElement>('grid-width').value, 10);
  const height = parseInt($<HTMLInputElement>('grid-height').value, 10);
  if (Number.isFinite(width) && Number.isFinite(height) && width >= 2 && height >= 2) {
    editor.setKnotworkSize(height, width);
    syncControls();
  }
});

// ---- size presets ----
//
// Each button maps to one entry of SIZE_PRESETS and is wired by its derived
// id (`preset-<id>`) rather than a querySelectorAll sweep, so every preset
// in the list gets a button by construction and the click handler is the
// same three lines for all of them.

for (const preset of SIZE_PRESETS) {
  $(`preset-${preset.id}`).addEventListener('click', () => {
    // An unknown id is impossible here (the ids come from the list itself),
    // but the boolean is respected rather than assumed: a preset that didn't
    // apply must not resync the controls and make the UI lie.
    if (editor.applySizePreset(preset.id)) {
      syncControls();
    }
  });
}

$<HTMLInputElement>('show-grid').addEventListener('change', (event) => {
  editor.showGrid((event.target as HTMLInputElement).checked);
});

$<HTMLInputElement>('show-overlay').addEventListener('change', (event) => {
  editor.showUi((event.target as HTMLInputElement).checked);
});

$('cell-size').addEventListener('input', (event) => {
  editor.setCellSize(parseInt((event.target as HTMLInputElement).value, 10));
  syncControls();
});

$('string-size').addEventListener('input', (event) => {
  editor.setStringSize(parseInt((event.target as HTMLInputElement).value, 10));
  syncControls();
});

$('stroke-width').addEventListener('input', (event) => {
  editor.setStrokeWidth(parseInt((event.target as HTMLInputElement).value, 10));
  syncControls();
});

$('string-color').addEventListener('input', (event) => {
  editor.setStringColor((event.target as HTMLInputElement).value);
});

$('stroke-color').addEventListener('input', (event) => {
  editor.setStrokeColor((event.target as HTMLInputElement).value);
});

$('background-color').addEventListener('input', (event) => {
  editor.setBackgroundColor((event.target as HTMLInputElement).value);
});

/** Export scales the UI offers; anything else falls back to 1x. */
function readExportScale(): ExportScale {
  const parsed = Number($<HTMLSelectElement>('export-scale').value);
  return parsed === 2 || parsed === 4 ? parsed : 1;
}

$('download-image').addEventListener('click', () => {
  void editor.downloadPNG('celtic-knot.png', readExportScale());
});

// ---- demo recording ----
//
// Records the live canvas to a WebM file via canvas.captureStream +
// MediaRecorder. Two things are deliberate:
//
// - The output is WebM, not a GIF. No browser encodes GIF from a canvas
//   stream, so the button, the tooltip and the filename all say `webm`
//   rather than promise something the code cannot produce.
// - Every click is checked against the current status before it does
//   anything, and the status only ever moves through `recorderTransition`.
//   `stop()` is asynchronous, so between the click and the `onstop` handler
//   the recorder is `stopping`: a second click in that window must not
//   restart capture or flush a half-built file.
//
// Unsupported browsers (anything without MediaRecorder) get the button
// disabled up front — an explanation beats a dead click.

const recordButton = $<HTMLButtonElement>('record-demo');
let recorderStatus: RecorderStatus = 'idle';
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

if (!isRecordingSupported()) {
  recordButton.disabled = true;
  recordButton.title = 'Recording needs a browser with MediaRecorder support (saves a .webm file)';
}

function setRecorderStatus(next: RecorderStatus): void {
  recorderStatus = next;
  recordButton.textContent = next === 'idle' ? 'Record demo' : 'Stop recording';
}

/**
 * Start a fresh recording. Handlers are bound before `start()` so nothing
 * can be missed, and the status transitions to `recording` before `start()`
 * returns — otherwise a click landing inside that synchronous call would
 * start a second recorder.
 */
function startRecording(): void {
  const stream = canvas.captureStream(CAPTURE_FRAME_RATE);
  const active = new MediaRecorder(stream, { mimeType: RECORDING_MIME_TYPE });
  recorder = active;
  chunks = [];

  active.addEventListener('dataavailable', (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  active.addEventListener('stop', () => {
    // Fired only after MediaRecorder has flushed its final chunks, so this
    // Blob is the whole recording.
    const blob = new Blob(chunks, { type: RECORDING_MIME_TYPE });
    chunks = [];
    recorder = null;
    setRecorderStatus(recorderTransition(recorderStatus, 'done'));
    void downloadRecording(blob);
  });

  setRecorderStatus(recorderTransition(recorderStatus, 'start'));
  active.start();
}

recordButton.addEventListener('click', () => {
  // The status is checked before anything is created, and it is the only
  // thing that decides which branch runs — so a rapid double-click can
  // never start two recorders. The second click lands either on `recording`
  // (harmless second stop, ignored by the transition) or on `stopping`
  // (nothing to do: the download is already in flight).
  if (recorderStatus === 'idle') {
    startRecording();
    return;
  }
  if (recorderStatus === 'recording' && recorder !== null) {
    // `stop()` returns immediately but `stop` fires later, so move to
    // `stopping` here — that window is what keeps the next click inert.
    setRecorderStatus(recorderTransition(recorderStatus, 'stop'));
    recorder.stop();
  }
});

// ---- share links ----

/**
 * Copy a link that restores this exact pattern into the clipboard.
 *
 * The link is built from `location.href` with any existing fragment stripped
 * (see `composeShareLink`), so pressing the button twice never stacks hashes.
 * The clipboard API is unavailable over plain http and in some embedded
 * webviews, so a missing or failing `navigator.clipboard` degrades to a
 * silent no-op — the pattern is on screen either way, and an unhandled
 * rejection in a click handler is a worse outcome than a copy that didn't
 * happen.
 */
$('share-link').addEventListener('click', () => {
  const link = composeShareLink(location.href, editor.getEngineId(), editor.getPattern());
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return;
  }
  void clipboard.writeText(link).catch(() => {
    // Clipboard write refused (permissions, insecure context): nothing to do.
  });
});

// ---- pattern files ----

/** Trigger a browser download of `text` as a named file. */
function downloadTextFile(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Save the live pattern to a `.json` file the user can keep, diff or share.
 *
 * The file carries the same two halves a share link does — engine id plus the
 * engine's opaque pattern — so loading one restores the pattern exactly, grid
 * size included (`loadPattern` follows the pattern's own dimensions).
 */
$('save-pattern').addEventListener('click', () => {
  downloadTextFile(
    serializeToFile(editor.getEngineId(), editor.getPattern()),
    'celtic-knot-pattern.json',
    'application/json',
  );
});

/**
 * Load a `.json` pattern file the user picked.
 *
 * Reversible by construction: the button only opens the file chooser, so
 * nothing changes until a file is actually chosen and parses. A file that is
 * malformed — or names an engine this build does not know — is ignored
 * outright, leaving the current pattern on screen; an alert would break a
 * button the user just pressed on purpose, and an unhandled rejection in a
 * click handler is worse than a load that silently didn't happen.
 */
function loadPatternFile(file: File): void {
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const parsed = parseFile(String(reader.result));
    if (parsed === null || (parsed.engine !== 'cut-parity' && parsed.engine !== 'side-state')) {
      console.warn('Ignoring malformed pattern file');
      return;
    }
    editor.loadPattern(parsed.engine, parsed.pattern);
    syncControls();
    syncEngineSelect();
  });
  reader.addEventListener('error', () => {
    // Unreadable file (permissions, it vanished mid-read): nothing to do.
  });
  reader.readAsText(file);
}

$('load-pattern').addEventListener('click', () => {
  $<HTMLInputElement>('load-pattern-file').click();
});

$<HTMLInputElement>('load-pattern-file').addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset first so picking the same file twice in a row still fires `change`.
  input.value = '';
  if (file !== undefined) {
    loadPatternFile(file);
  }
});

// ---- keyboard shortcuts ----

/**
 * True when the event landed in a field the user is typing into. Typing 'r'
 * in the grid-width box must randomize nothing, so every bare-key shortcut
 * bows out here. Modifier combos are handled separately by the undo/redo
 * listener below, which reuses this same guard.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

/** Reflect an editor visibility flag back into its checkbox. */
function syncCheckbox(id: string, checked: boolean): void {
  const box = $<HTMLInputElement>(id);
  box.checked = checked;
}

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (isTypingTarget(event.target)) {
    return;
  }

  switch (event.key) {
    case 'r':
      editor.randomizePattern();
      break;
    case 'Escape':
      editor.deselect();
      break;
    case 'g':
      editor.showGrid(!editor.isGridVisible());
      syncCheckbox('show-grid', editor.isGridVisible());
      break;
    case 'u':
      editor.showUi(!editor.isOverlayVisible());
      syncCheckbox('show-overlay', editor.isOverlayVisible());
      break;
    default:
      break;
  }
});

// ---- undo/redo keyboard shortcuts ----

document.addEventListener('keydown', (event) => {
  if (!event.metaKey && !event.ctrlKey) {
    return;
  }
  if (event.altKey) {
    return;
  }

  // Don't hijack typing in text fields (grid width/height, etc.).
  if (isTypingTarget(event.target)) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') {
    return;
  }

  event.preventDefault();
  if (key === 'y' || (key === 'z' && event.shiftKey)) {
    editor.redo();
  } else {
    editor.undo();
  }
});

// ---- share-link load ----

/**
 * Restore the pattern the URL asks for, if it carries a valid share link.
 *
 * Returns true when a pattern was loaded. Opt-in by construction: with no
 * hash — or a malformed one — this does nothing at all and the caller runs
 * the ordinary fresh-startup randomize, so a broken link degrades to 1.0
 * behaviour instead of an empty or half-loaded canvas.
 */
function loadSharedPattern(): boolean {
  if (typeof location === 'undefined') {
    return false;
  }
  const shared = parseShareLink(location.hash);
  if (shared === null) {
    return false;
  }
  editor.loadPattern(shared.engineId, shared.pattern);
  return true;
}

if (!loadSharedPattern()) {
  // Start with a random knot so the canvas isn't empty on load.
  editor.randomizePattern();
}
syncControls();
syncEngineSelect();
