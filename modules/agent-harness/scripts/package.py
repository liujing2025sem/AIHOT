#!/usr/bin/env python3
"""Package only the new, synthetic, dependency-free core. Never includes environment files or private checkpoints."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
module = Path(__file__).resolve().parents[1]
repo = module.parents[1]
out = args.out.resolve()
if out == module or module in out.parents:
    raise SystemExit('package outside the source module')
if out.exists() and any(out.iterdir()):
    raise SystemExit('use a new empty output directory')
out.mkdir(parents=True, exist_ok=True)
selected = ['backend/core.ts', 'backend/mock.ts', 'backend/loopback.ts', 'backend/opencode.ts',
            'scripts/demo.ts', 'tests/harness.standalone.test.ts', 'tests/recovery.standalone.test.ts']
contents = {name: (module / name).read_bytes() for name in selected}
contents['README.md'] = (module / 'README.md').read_bytes()
base = '6ec842fb2834fd9096cba532ce3be678b0688fdd'
contents['host-integration/changes.patch'] = subprocess.check_output(['git', 'diff', '--binary', base, 'HEAD', '--', 'modules/agent-harness', 'packages/backend/src/providers/llm.ts', 'package-lock.json'], cwd=repo)
contents['LICENSE'] = (repo / 'LICENSE').read_bytes()
contents['package.json'] = (json.dumps({'name': '@aihot/agent-harness-portable-core', 'private': True, 'type': 'module',
                                      'license': 'MIT', 'engines': {'node': '>=24.11'},
                                      'exports': {'.': './backend/core.ts', './mock': './backend/mock.ts'}}, indent=2) + '\n').encode()
contents['START_HERE.txt'] = b'''Synthetic selectable-api/0.1 candidate; no real services or credentials.
Run: node --test tests/*.standalone.test.ts
Demo: node scripts/demo.ts --out /tmp/aihot-harness-demo
Recovery: node scripts/demo.ts --restore /tmp/aihot-harness-demo/checkpoint.json
Verify MANIFEST.json member hashes before executing in a receiving environment.
No CSM wire/golden, production DB, API/OpenCode, CI or cross-OS compatibility claim.
No automatic publishing; all outputs remain review candidates.
For original AIHOT at base 6ec842f, review host-integration/changes.patch and run git apply --check first.
The patch includes the real profile -> chatJson -> paidRequest -> HTTP path and its local-server regression.
'''
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', str(module), 'packages/backend/src/providers/llm.ts', 'package-lock.json'], cwd=repo, text=True)
manifest = {'schema': 'aihot.harness.source-package.v1', 'source_revision': revision, 'source_dirty': bool(dirty), 'host_base_revision': base,
            'mode': 'source-candidate', 'live_service_validation': False, 'contains_host_transport_patch': True, 'private_archive_received': False,
            'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data in sorted(contents.items())]}
contents['MANIFEST.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
for name, data in contents.items():
    target = out / 'source' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
stream = io.BytesIO()
with tarfile.open(fileobj=stream, mode='w') as archive:
    for name, data in sorted(contents.items()):
        entry = tarfile.TarInfo(name)
        entry.size = len(data)
        entry.mode = 0o644
        entry.mtime = 0
        archive.addfile(entry, io.BytesIO(data))
payload = gzip.compress(stream.getvalue(), mtime=0)
target = out / 'aihot-harness-v0-source.tar.gz'
target.write_bytes(payload)
print(json.dumps({'file': str(target), 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload),
                  'source_revision': revision, 'source_dirty': bool(dirty), 'consumer_receipt': False}))
