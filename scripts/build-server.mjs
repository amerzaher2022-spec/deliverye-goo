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

// Pre-compress the larger web files (Brotli and gzip) so the server sends them compressed
// (@fastify/static `preCompressed`): the building data, scripts and models shrink several times over.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const COMPRESS = /\.(json|js|mjs|css|html|svg|glb|hdr|txt|webmanifest)$/;
let saved = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (COMPRESS.test(name) && st.size > 2048) {
      const buf = readFileSync(p);
      const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 10, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      writeFileSync(`${p}.br`, br);
      writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
      saved += buf.length - br.length;
    }
  }
};
walk('dist/web');
console.log(`pre-compressed web files: ${(saved / 1048576).toFixed(1)} MB less to download (Brotli)`);
