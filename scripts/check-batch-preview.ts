import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preview = path.resolve(process.argv[2] ?? path.join(repo, 'dist/batch-preview/AIHOT_Batch_Studio_20261110.html'));
const html = await readFile(preview, 'utf8');
assert.ok(html.includes("connect-src 'none'"), 'The preview blocks external requests.');
assert.equal(/<(?:script|link)\b[^>]*(?:src|href)\s*=/i.test(html), false, 'The preview loads without external scripts or styles.');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(script, 'The preview includes a runnable script.');
new Script(script);

const outDir = path.join(repo, 'dist/batch-preview-ssr');
await build({
  configFile: false,
  root: path.join(repo, 'apps/web'),
  logLevel: 'warn',
  build: {
    ssr: true,
    outDir,
    emptyOutDir: false,
    lib: {
      entry: path.join(repo, 'apps/web/app/features/admin/batch-preview.tsx'),
      formats: ['es'],
      fileName: () => 'batch-preview.mjs',
    },
  },
});
const { default: Preview } = await import(pathToFileURL(path.join(outDir, 'batch-preview.js')).href);
const markup = renderToStaticMarkup(createElement(Preview));
assert.ok(markup.includes('未连接生产'), 'The first screen identifies the demo boundary.');
assert.ok(markup.includes('尺寸'), 'The first screen includes the initial buyer problem.');
assert.ok(markup.includes('15') && markup.includes('30'), 'The first screen presents the selected time budget.');
assert.equal(/<textarea\b[^>]*\brequired\b/i.test(markup), false, 'Normal progress has no required note field.');
console.log(JSON.stringify({
  html: preview,
  bundledScriptSyntax: 'PASS',
  noExternalDependencies: 'PASS',
  firstScreenServerRender: 'PASS',
  browserInteraction: 'NOT_RUN_PRIOR_PERMISSION_DENIAL',
  productionConnected: false,
}));
