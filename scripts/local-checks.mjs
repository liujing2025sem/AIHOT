// Run the repository checks with test-only credentials and scratch files.
// External service implementations in the test suite are loopback fixtures.
import { readFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const local = parseEnv(readFileSync(path.join(root, '.env'), 'utf8'));
if (!/_(test|ci)$/.test(new URL(local.DATABASE_URL).pathname)) throw new Error('Use a separate *_test or *_ci database');
const scratch = path.resolve(process.env.AIHOT_TEST_TMP || path.join(root, '.data', 'test-tmp'));
mkdirSync(scratch, { recursive: true });
const suite = new URL(local.DATABASE_URL);
suite.pathname = suite.pathname.replace(/_(test|ci)$/, '_suite_test');
const env = { ...process.env, DATABASE_URL: suite.toString(), TEMP: scratch, TMP: scratch, TMPDIR: scratch,
  MODEL_CALLS_ENABLED: 'true', COLLECT_ENABLED: 'true', FEISHU_CONTENT_PUSH_ENABLED: 'false', FEISHU_INTERNAL_ENABLED: 'false', INDEXNOW_SUBMIT_ENABLED: 'false' };
const args = ['--test-global-setup=tests/databases.ts','--import','./tests/databases.ts','--test','--test-concurrency=4','--test-timeout=120000', ...(process.argv.length > 2 ? process.argv.slice(2) : ['tests/*.test.ts','modules/*/tests/*.test.ts'])];
const result = spawnSync(process.execPath,args,{ cwd:root, env, stdio:'inherit' });
process.exit(result.status ?? 1);
