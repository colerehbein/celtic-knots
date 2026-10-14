/**
 * Blob downloads.
 *
 * The "save this file" mechanic is the same four lines everywhere the app
 * needs it — object URL, temp anchor, click, revoke — and every caller got it
 * subtly wrong at least once (a leaked URL, an anchor left in the DOM), so it
 * lives here once instead of being re-typed per feature.
 *
 * Two details matter and are easy to lose in a copy:
 * - The anchor is appended before the click. Safari ignores `click()` on a
 *   detached anchor, so the append is load-bearing, not tidiness.
 * - The object URL is revoked right after. Nothing in the click path reads it
 *   asynchronously — the browser has already started the download — so
 *   revoking immediately is safe and keeps blobs from leaking for the life of
 *   the document.
 *
 * It is intentionally synchronous: a caller that *produces* the blob
 * asynchronously (PNG encoding, assembling a recording) awaits that part
 * itself and then calls this.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
