import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_FILENAME,
  downloadRecording,
  isRecordingSupported,
  recorderTransition,
  type RecorderEvent,
  type RecorderStatus,
} from './recorder';

// ---- recorderTransition -------------------------------------------------
//
// The happy path is a three-step cycle; the value is in what the *other*
// nine combinations do. An invalid event is a no-op, which is what makes the
// button safe to click twice in quick succession.

describe('recorderTransition', () => {
  it('walks idle -> recording -> stopping -> idle', () => {
    const recording = recorderTransition('idle', 'start');
    expect(recording).toBe('recording');

    const stopping = recorderTransition(recording, 'stop');
    expect(stopping).toBe('stopping');

    expect(recorderTransition(stopping, 'done')).toBe('idle');
  });

  it('is a no-op for every invalid transition', () => {
    const invalid: readonly [RecorderStatus, RecorderEvent][] = [
      // start while already recording: the double-click guard.
      ['recording', 'start'],
      // stop while idle, and done while idle or recording: no recording in flight.
      ['idle', 'stop'],
      ['idle', 'done'],
      ['recording', 'done'],
      // anything but `done` while the recorder is flushing its final chunks.
      ['stopping', 'start'],
      ['stopping', 'stop'],
    ];

    for (const [status, event] of invalid) {
      expect(recorderTransition(status, event)).toBe(status);
    }
  });

  it('ignores a second stop while the first is still flushing', () => {
    const stopping = recorderTransition('recording', 'stop');
    expect(recorderTransition(stopping, 'stop')).toBe('stopping');
  });
});

// ---- isRecordingSupported ----------------------------------------------

describe('isRecordingSupported', () => {
  it('is false in node, where MediaRecorder does not exist', () => {
    // Documents the feature-detection contract the UI relies on: the button
    // disables itself here instead of throwing on click.
    expect(typeof MediaRecorder).toBe('undefined');
    expect(isRecordingSupported()).toBe(false);
  });

  it('is true when a MediaRecorder global is present', () => {
    vi.stubGlobal('MediaRecorder', class {});
    try {
      expect(isRecordingSupported()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(isRecordingSupported()).toBe(false);
  });
});

// ---- downloadRecording --------------------------------------------------

describe('downloadRecording', () => {
  let anchor: {
    href: string;
    download: string;
    click: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDownloadGlobals(): {
    createObjectURL: ReturnType<typeof vi.fn>;
    revokeObjectURL: ReturnType<typeof vi.fn>;
    appendChild: ReturnType<typeof vi.fn>;
  } {
    anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const createObjectURL = vi.fn(() => 'blob:demo');
    const revokeObjectURL = vi.fn();
    const appendChild = vi.fn();

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild } });

    return { createObjectURL, revokeObjectURL, appendChild };
  }

  it('drives the temp-anchor download with the default webm filename', async () => {
    const urls = stubDownloadGlobals();
    const blob = new Blob(['webm-bytes'], { type: 'video/webm' });

    await downloadRecording(blob);

    expect(urls.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:demo');
    expect(anchor.download).toBe(DEMO_FILENAME);
    expect(anchor.download.endsWith('.webm')).toBe(true);
    // Appended before the click (Safari ignores clicks on detached anchors),
    // removed after, and the object URL released so the blob cannot leak.
    expect(urls.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:demo');
  });

  it('honours an explicit filename', async () => {
    stubDownloadGlobals();

    await downloadRecording(new Blob(['x']), 'my-demo.webm');

    expect(anchor.download).toBe('my-demo.webm');
  });

  it('names a .webm file, never a gif', async () => {
    stubDownloadGlobals();

    await downloadRecording(new Blob(['x']));

    // MediaRecorder emits WebM. Nothing here encodes a GIF, so the artifact
    // must not claim to be one.
    expect(DEMO_FILENAME).not.toMatch(/\.gif$/i);
    expect(DEMO_FILENAME).toMatch(/\.webm$/);
  });
});
