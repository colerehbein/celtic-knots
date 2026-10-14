import { KnotEditor } from './knot/editor';

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

$('reset-pattern').addEventListener('click', () => editor.resetPattern());
$('randomize-pattern').addEventListener('click', () => editor.randomizePattern());
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

$('download-image').addEventListener('click', () => {
  void editor.downloadPNG();
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
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
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
