import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { unzipSync } from 'fflate';

const scratch = mkdtempSync(path.join(tmpdir(), 'react-workbench-package-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const script = fileURLToPath(new URL('../scripts/package-react-workbench.mjs', import.meta.url));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let index = 0;

function fixture() {
  const root = path.join(scratch, `case-${index++}`);
  const repo = path.join(root, 'repo');
  const out = path.join(root, 'package');
  mkdirSync(repo, { recursive: true });
  const write = (name: string, contents: string) => {
    const target = path.join(repo, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  write('.gitignore', 'apps/web/build/\n.env\n.data/\nnode_modules/\nruntime/\n');
  write('package-lock.json', '{"lockfileVersion":3}\n');
  write('package.json', '{"name":"package-fixture","private":true}\n');
  write('src/app.ts', 'export const label = "tracked source";\n');
  write('.env.example', 'API_KEY=\n');
  write('docs/releases/react-workbench-20261109/README.zh-CN.md', '# 更新包\n不包含 Windows 运行时。\n');
  write('docs/releases/react-workbench-20261109/DEPLOYMENT.md', '# 部署\n保留现有数据库和私有配置。\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  write('apps/web/build/client/assets/app.js', 'console.log("built client");');
  write('apps/web/build/server/index.js', 'export default {};');
  write('.env', 'API_KEY=do-not-export');
  write('.data/business.json', '{"private":true}');
  write('node_modules/private.txt', 'not portable');
  write('runtime/studio.env', 'ADMIN_PASSWORD=do-not-export');
  const run = (...args: string[]) => spawnSync(process.execPath, [script, '--repo', repo, '--out', out, ...args], { encoding: 'utf8', timeout: 30_000 });
  return { root, repo, out, write, git, run };
}

test('bundles committed source, compiled SSR assets and release documents with verifiable hashes', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const zipPath = path.join(f.out, 'AIHOT-react-workbench.zip');
  const zipBytes = readFileSync(zipPath);
  const files = unzipSync(zipBytes);
  const release = JSON.parse(Buffer.from(files['RELEASE.json']).toString());
  assert.equal(release.commit, f.git('rev-parse', 'HEAD'));
  assert.equal(release.tree, f.git('rev-parse', 'HEAD^{tree}'));
  assert.equal(release.packageType, 'source-and-web-build-update');
  assert.equal(release.windowsRuntimeIncluded, false);
  assert.equal(release.verification.status, 'not-run-by-packager');
  assert.equal(release.verification.report, 'verification.json');
  assert.equal(release.packageLockSha256, sha256(files['source/package-lock.json']));
  assert.equal(Buffer.from(files['source/src/app.ts']).toString(), 'export const label = "tracked source";\n');
  for (const name of ['README.zh-CN.md', 'DEPLOYMENT.md', 'source/apps/web/build/client/assets/app.js', 'source/apps/web/build/server/index.js', 'source/.env.example']) assert.ok(files[name], name);
  for (const name of Object.keys(files)) assert.doesNotMatch(name, /(^|\/)(\.git|node_modules|\.data|runtime|\.env)(\/|$)/);
  for (const file of release.files) {
    assert.equal(sha256(files[file.path]), file.sha256, file.path);
    assert.equal(files[file.path].length, file.bytes, file.path);
  }
  assert.equal(Object.keys(files).length, release.files.length + 1);
  assert.equal(readFileSync(path.join(f.out, 'RELEASE.json'), 'utf8'), Buffer.from(files['RELEASE.json']).toString());
  assert.match(readFileSync(path.join(f.out, 'SHA256SUMS'), 'utf8'), new RegExp(`${sha256(zipBytes)}  AIHOT-react-workbench.zip`));
  assert.equal(f.git('status', '--porcelain'), '');
});

test('refuses an existing output directory without modifying it', () => {
  const f = fixture();
  mkdirSync(f.out);
  writeFileSync(path.join(f.out, 'keep.txt'), 'keep');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/);
  assert.equal(readFileSync(path.join(f.out, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(existsSync(path.join(f.out, 'AIHOT-react-workbench.zip')), false);
});

test('refuses modified tracked files and untracked files before creating output', () => {
  for (const name of ['src/app.ts', 'untracked.txt']) {
    const f = fixture();
    f.write(name, 'not committed');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Worktree must be clean/);
    assert.equal(existsSync(f.out), false);
  }
});

test('refuses a selected commit whose tree does not match the checkout', () => {
  const f = fixture();
  const old = f.git('rev-parse', 'HEAD');
  f.write('src/app.ts', 'export const label = "next";');
  f.git('add', '.');
  f.git('commit', '-qm', 'next');
  const result = f.run('--ref', old);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checked-out tree/);
  assert.equal(existsSync(f.out), false);
});

test('requires a lockfile and both nonempty client and server build artifacts', () => {
  for (const missing of ['package-lock.json', 'apps/web/build/client', 'apps/web/build/server/index.js']) {
    const f = fixture();
    rmSync(path.join(f.repo, missing), { recursive: true, force: true });
    if (missing === 'package-lock.json') { f.git('add', '-u'); f.git('commit', '-qm', 'remove lock'); }
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package-lock.json|Web build is missing/);
    assert.equal(existsSync(f.out), false);
  }
});

test('release documents must come from the committed tree', () => {
  const f = fixture();
  f.git('rm', 'docs/releases/react-workbench-20261109/DEPLOYMENT.md');
  f.git('commit', '-qm', 'remove release doc');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release document must be tracked/);
  assert.equal(existsSync(f.out), false);
});

test('excludes mistakenly tracked private paths while retaining the safe environment example', () => {
  const f = fixture();
  f.write('secrets/token.json', '{"token":"never-export"}');
  f.git('add', '-f', '.env', 'runtime/studio.env', 'secrets/token.json');
  f.git('commit', '-qm', 'tracked private paths fixture');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const files = unzipSync(readFileSync(path.join(f.out, 'AIHOT-react-workbench.zip')));
  assert.ok(files['source/.env.example']);
  assert.equal(files['source/.env'], undefined);
  assert.equal(files['source/runtime/studio.env'], undefined);
  assert.equal(files['source/secrets/token.json'], undefined);
  const release = JSON.parse(Buffer.from(files['RELEASE.json']).toString());
  assert.deepEqual(release.excludedTrackedPaths, ['.env', 'runtime/studio.env', 'secrets/token.json']);
});

test('rejects private files and symlinks in the compiled build', () => {
  const privateBuild = fixture();
  privateBuild.write('apps/web/build/client/.env', 'private');
  const privateResult = privateBuild.run();
  assert.notEqual(privateResult.status, 0);
  assert.match(privateResult.stderr, /Private file in web build/);
  assert.equal(existsSync(privateBuild.out), false);

  const symlinkBuild = fixture();
  symlinkSync(path.join(symlinkBuild.repo, '.env'), path.join(symlinkBuild.repo, 'apps/web/build/client/linked.txt'));
  const symlinkResult = symlinkBuild.run();
  assert.notEqual(symlinkResult.status, 0);
  assert.match(symlinkResult.stderr, /Build symlinks are not allowed/);
  assert.equal(existsSync(symlinkBuild.out), false);
});
