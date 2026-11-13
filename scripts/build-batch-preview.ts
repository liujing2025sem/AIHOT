import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(repo, 'dist', 'batch-preview'));
const bundleDir = path.join(output, 'bundle');

await build({
  configFile: false,
  root: path.join(repo, 'apps', 'web'),
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: bundleDir,
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
    lib: {
      entry: path.join(repo, 'apps/web/preview/batch.tsx'),
      name: 'ChipshowBatchPreview',
      formats: ['iife'],
      fileName: () => 'batch-preview.js',
    },
  },
});

const files = await readdir(bundleDir);
const css = (await Promise.all(files.filter(name => name.endsWith('.css')).map(name => readFile(path.join(bundleDir, name), 'utf8')))).join('\n');
const js = await readFile(path.join(bundleDir, 'batch-preview.js'), 'utf8');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="description" content="Chipshow Studio 小批采编交互预览。所有稿件、排序和交付均为演示，不连接生产系统。">
<title>Chipshow Studio · 小批采编交互预览</title>
<style>html,body{margin:0;padding:0}body{background:#f5f7f6}${css.replaceAll('</style', '<\\/style')}</style>
</head>
<body><div id="root"></div><noscript>此交互预览需要启用JavaScript。全部操作只使用演示数据，不连接生产系统。</noscript>
<script>${js.replaceAll('</script', '<\\/script')}</script>
</body>
</html>`;
await mkdir(output, { recursive: true });
const file = path.join(output, 'AIHOT_Batch_Studio_20261110.html');
await writeFile(file, html);
console.log(JSON.stringify({ file, bytes: Buffer.byteLength(html), externalRequests: false, productionConnected: false }));
