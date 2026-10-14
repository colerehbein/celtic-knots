import { describe, expect, it } from 'vitest';
import { shouldRegisterServiceWorker } from './pwa';
// `?raw` pulls the files in as strings — vite/vitest resolve the suffix, and
// vite/client types the module for tsc. No node:fs import, so no @types/node
// dependency and no read from a working directory that might have moved.
import manifest from '../../public/manifest.webmanifest?raw';
import swSource from '../../public/sw.js?raw';
import iconSource from '../../public/icon.svg?raw';

describe('shouldRegisterServiceWorker', () => {
  it('allows http and https', () => {
    expect(shouldRegisterServiceWorker({ protocol: 'http:' })).toBe(true);
    expect(shouldRegisterServiceWorker({ protocol: 'https:' })).toBe(true);
  });

  it('refuses file:// so the double-clicked build keeps working unchanged', () => {
    expect(shouldRegisterServiceWorker({ protocol: 'file:' })).toBe(false);
  });

  it('refuses every other scheme', () => {
    expect(shouldRegisterServiceWorker({ protocol: 'data:' })).toBe(false);
    expect(shouldRegisterServiceWorker({ protocol: 'about:' })).toBe(false);
    expect(shouldRegisterServiceWorker({ protocol: 'blob:' })).toBe(false);
    expect(shouldRegisterServiceWorker({ protocol: 'chrome-extension:' })).toBe(false);
    expect(shouldRegisterServiceWorker({ protocol: '' })).toBe(false);
  });
});

describe('web app manifest', () => {
  const parsed = JSON.parse(manifest) as Record<string, unknown>;

  it('parses as JSON', () => {
    expect(typeof manifest).toBe('string');
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  });

  it('carries the required keys', () => {
    expect(parsed.name).toBe('Celtic Knot Generator');
    expect(parsed.short_name).toBe('Celtic Knots');
    expect(parsed.start_url).toBe('.');
    expect(parsed.display).toBe('standalone');
    expect(parsed.background_color).toBe('#ffffff');
    expect(parsed.theme_color).toBe('#ff9a39');
  });

  it('points at the deployed icon relatively', () => {
    const icons = parsed.icons as { src: string; sizes: string; purpose: string; type: string }[];
    expect(icons).toHaveLength(1);
    expect(icons[0]?.src).toBe('./icon.svg');
    expect(icons[0]?.type).toBe('image/svg+xml');
    expect(icons[0]?.sizes).toBe('any');
    expect(icons[0]?.purpose).toBe('any maskable');
  });
});

describe('service worker', () => {
  it('is a non-empty script', () => {
    expect(swSource.length).toBeGreaterThan(0);
    expect(swSource).toContain("addEventListener('install'");
    expect(swSource).toContain("addEventListener('fetch'");
    expect(swSource).toContain('caches.match');
  });

  it('precaches the shell, the manifest and the icon with relative URLs', () => {
    expect(swSource).toContain("'./'");
    expect(swSource).toContain("'./manifest.webmanifest'");
    expect(swSource).toContain("'./icon.svg'");
  });
});

describe('app icon', () => {
  it('is a non-empty SVG with the right viewBox and brand color', () => {
    expect(iconSource.length).toBeGreaterThan(0);
    expect(iconSource).toContain('<svg');
    expect(iconSource).toContain('viewBox="0 0 512 512"');
    expect(iconSource).toContain('#ff9a39');
  });
});
