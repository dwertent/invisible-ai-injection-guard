// SPDX-License-Identifier: MIT
// Bundles the action into a single ES module at dist/index.js.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: 'dist/index.js',
  // Some bundled dependencies still call require(); provide it in ESM output.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  },
  legalComments: 'eof',
  logLevel: 'info'
})
