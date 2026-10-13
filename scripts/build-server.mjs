// Bundles the server (and the shared modules it imports) into dist/server/main.mjs.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/main.ts'],
  outfile: 'dist/server/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
