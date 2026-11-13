// Source update bundle only. Never installs, migrates, seeds, deploys or contacts a service.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { unzipSync, zipSync } from 'fflate';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const asText = bytes => Buffer.from(bytes).toString('utf8');
const maxBuffer = 256 * 1024 * 1024;
const defaultDocs = 'docs/releases/react-workbench-20261109';

function safePath(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /[\x00-\x1f:]/.test(name)
    || name.split('/').some(part => part === '..' || part === '.' || !part)) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
}

function excluded(name) {
  const parts = name.toLowerCase().split('/');
  const file = parts.at(-1);
  return parts.some(part => ['.git', 'node_modules', '.data', 'secrets', 'credentials', '.ssh', 'runtime'].includes(part))
    || (file !== '.env.example' && (file === '.env' || file.startsWith('.env.') || file.endsWith('.env')))
    || /\.(pem|key|p12|pfx|dump|sqlite|sqlite3|db)$/.test(file)
    || ['first-run-credentials.txt', 'company-facts.json'].includes(file);
}

function digestFiles(files) {
  return sha256(files.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''));
}

function buildFiles(directory, relative = '') {
  if (!lstatSync(directory).isDirectory()) throw new Error('Build directory must be a real directory, not a symlink');
  const files = [];
  for (const entry of readdirSync(directory).sort()) {
    const name = relative ? `${relative}/${entry}` : entry;
    safePath(name);
    if (excluded(name)) throw new Error(`Private file in web build: ${name}`);
    const target = path.join(directory, entry);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`Build symlinks are not allowed: ${name}`);
    if (stat.isDirectory()) files.push(...buildFiles(target, name));
    else if (stat.isFile()) files.push({ name, bytes: readFileSync(target) });
    else throw new Error(`Unsupported build entry: ${name}`);
  }
  return files;
}

function packageWorkbench(options) {
  const repo = path.resolve(options.repo || path.join(import.meta.dirname, '..'));
  const out = path.resolve(options.out);
  const build = path.resolve(options.build || path.join(repo, 'apps/web/build'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer });
  const gitText = (...args) => asText(git(...args)).trim();
  const clean = () => {
    if (gitText('status', '--porcelain', '--untracked-files=normal')) {
      throw new Error('Worktree must be clean, including untracked files. Commit the release first.');
    }
  };

  if (existsSync(out)) throw new Error('Output directory already exists; choose a new directory. Nothing overwritten.');
  const relativeOut = path.relative(repo, out);
  if (!relativeOut.startsWith(`..${path.sep}`) && relativeOut !== '..' && !path.isAbsolute(relativeOut)) {
    throw new Error('Output directory must be outside the source repository.');
  }
  clean();
  const commit = gitText('rev-parse', '--verify', '--end-of-options', `${options.ref || 'HEAD'}^{commit}`);
  const tree = gitText('rev-parse', `${commit}^{tree}`);
  const checkoutCommit = gitText('rev-parse', 'HEAD');
  if (tree !== gitText('rev-parse', 'HEAD^{tree}')) {
    throw new Error('Selected commit differs from the checked-out tree. Check it out and rebuild first.');
  }

  const tracked = new Map(asText(git('ls-tree', '-rz', commit)).split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, type] = line.slice(0, tab).split(' ');
    return [line.slice(tab + 1), { mode, type }];
  }));
  const archive = git('archive', '--format=zip', commit);
  const source = unzipSync(archive);
  const zipEntries = Object.create(null);
  const inventory = [];
  const skipped = [];
  const add = (name, bytes, mode = '100644') => {
    safePath(name);
    if (zipEntries[name]) throw new Error(`Duplicate archive entry: ${name}`);
    zipEntries[name] = [bytes, { os: 3, attrs: parseInt(mode, 8) << 16 }];
    inventory.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  };

  for (const [name, metadata] of tracked) {
    safePath(name);
    if (excluded(name) || name.startsWith('apps/web/build/')) { skipped.push(name); continue; }
    if (metadata.type !== 'blob' || !['100644', '100755'].includes(metadata.mode)) {
      throw new Error(`Source symlinks and submodules are not supported: ${name}`);
    }
    if (!source[name]) throw new Error(`Tracked file absent from git archive (check export-ignore): ${name}`);
    add(`source/${name}`, source[name], metadata.mode);
  }
  if (!zipEntries['source/package-lock.json']) throw new Error('The selected commit must contain package-lock.json.');

  const docs = (options['release-docs'] || defaultDocs).replace(/\/$/, '');
  safePath(docs);
  for (const name of ['README.zh-CN.md', 'DEPLOYMENT.md']) {
    const from = `${docs}/${name}`;
    if (!zipEntries[`source/${from}`]) throw new Error(`Release document must be tracked in the selected commit: ${from}`);
    add(name, source[from]);
  }

  if (!existsSync(path.join(build, 'client')) || !lstatSync(path.join(build, 'client')).isDirectory()
    || !existsSync(path.join(build, 'server/index.js')) || !lstatSync(path.join(build, 'server/index.js')).isFile()) {
    throw new Error('Web build is missing build/client or build/server/index.js. Run the web build first.');
  }
  const built = buildFiles(build);
  if (!built.some(file => file.name.startsWith('client/'))) throw new Error('Web build/client must contain built files.');
  for (const file of built) add(`source/apps/web/build/${file.name}`, file.bytes);
  inventory.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const buildInventory = inventory.filter(file => file.path.startsWith('source/apps/web/build/'));
  const manifest = {
    format: 'aihot.react-workbench.update.v1',
    createdAt: new Date().toISOString(),
    packageType: 'source-and-web-build-update',
    commit,
    tree,
    checkoutCommit,
    sourceArchiveSha256: sha256(archive),
    packageLockSha256: sha256(source['package-lock.json']),
    payloadSha256: digestFiles(inventory),
    sourceFiles: inventory.filter(file => file.path.startsWith('source/') && !file.path.startsWith('source/apps/web/build/')).length,
    build: { path: 'source/apps/web/build', files: buildInventory.length, sha256: digestFiles(buildInventory), provenance: 'prebuilt files; packager hashes but does not rebuild or execute them' },
    windowsRuntimeIncluded: false,
    nodeModulesIncluded: false,
    privateDataIncluded: false,
    runtimeRequirements: ['Node.js >=24.22.1', 'PostgreSQL 16 or 17', 'OS-matching dependencies from package-lock.json', 'API and SSR web server; worker for generation jobs'],
    verification: { status: 'not-run-by-packager', report: 'verification.json', note: 'Independent verification.json is attached at delivery time; this manifest does not assert browser, CI or deployment success.' },
    excludedTrackedPaths: skipped.sort(),
    files: inventory,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  zipEntries['RELEASE.json'] = manifestBytes;
  const zip = zipSync(zipEntries, { level: 6 });
  clean();
  if (gitText('rev-parse', 'HEAD') !== checkoutCommit) throw new Error('HEAD changed while packaging; run again from a stable checkout.');

  // mkdir (without recursive) is the final no-overwrite guard, including concurrent attempts.
  mkdirSync(path.dirname(out), { recursive: true });
  mkdirSync(out);
  const zipName = 'AIHOT-react-workbench.zip';
  const outputs = [[zipName, zip], ['RELEASE.json', manifestBytes], ['README.zh-CN.md', source[`${docs}/README.zh-CN.md`]], ['DEPLOYMENT.md', source[`${docs}/DEPLOYMENT.md`]]];
  for (const [name, bytes] of outputs) writeFileSync(path.join(out, name), bytes, { flag: 'wx' });
  writeFileSync(path.join(out, 'SHA256SUMS'), `${outputs.map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join('\n')}\n`, { flag: 'wx' });
  return { directory: out, zip: path.join(out, zipName), commit, tree, zipSha256: sha256(zip), files: inventory.length + 1, windowsRuntimeIncluded: false };
}

try {
  const { values } = parseArgs({ options: { out: { type: 'string' }, repo: { type: 'string' }, ref: { type: 'string' }, build: { type: 'string' }, 'release-docs': { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) {
    console.log('Usage: node scripts/package-react-workbench.mjs --out <new-directory-outside-repo> [--ref HEAD] [--build <web-build-directory>] [--release-docs docs/releases/react-workbench-20261109]\nCreates a source update ZIP; no Windows runtime, private data, install, migration or deployment.');
  } else {
    if (!values.out) throw new Error('--out is required.');
    console.log(JSON.stringify(packageWorkbench(values), null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
