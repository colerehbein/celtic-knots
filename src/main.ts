import { KnotEditor, type EngineId, type ExportScale } from './knot/editor';

const editor = new KnotEditor(document.getElementById('knot-canvas') as HTMLCanvasElement);

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

// Start with a random knot so the canvas isn't empty on load.
editor.randomizePattern();
syncControls();
syncEngineSelect();
