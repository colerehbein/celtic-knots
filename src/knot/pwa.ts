/**
 * Gate for service-worker registration.
 *
 * A service worker can only be installed on a secure context, and a file://
 * page is not one: registering there either throws or silently does nothing
 * depending on the browser, and the single-file build is designed to be
 * double-clicked open from disk. So the check lives here, in one testable
 * place, and main.ts asks before it registers.
 */

/** True only for http: and https:; false for file:, data:, about:, chrome:, etc. */
export function shouldRegisterServiceWorker(loc: { protocol: string }): boolean {
  return loc.protocol === 'http:' || loc.protocol === 'https:';
}
