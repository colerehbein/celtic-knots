import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // Relative asset paths + single-file inlining: the built dist/index.html
  // is fully self-contained — it double-clicks open from disk (file://) in
  // any browser, including WebKit ones like Orion, and serves from any
  // static host or subpath.
  base: './',
  plugins: [viteSingleFile()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
