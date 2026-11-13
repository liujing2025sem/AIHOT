import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Synthetic methods only. Tests never read a configured production/private writing package. */
export function testWritingPolicyRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'aihot-writing-policy-test-'));
  const files: { path: string; bytes: number; sha256: string; role: string; confidential: boolean }[] = [];
  const write = (name: string, text: string) => {
    const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text);
  };
  try {
    for (const profile of ['chipshow-three-site-writing', 'unishine-independent-writing']) {
      for (const suffix of ['SKILL.md', 'references/rules.md', 'references/path-map.md']) {
        const name = `skills/${profile}/${suffix}`;
        const text = `Synthetic test method fixture: ${profile}/${suffix}. No production facts, traffic, credentials or operating values. Preserve the supplied task evidence.\n`;
        write(name, text);
        files.push({ path: name, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'),
          role: 'synthetic_method_fixture', confidential: true });
      }
      write(`runtime/${profile}.md`, `Synthetic test runtime methods for ${profile}. Use the requested format and retain task evidence. No production values.\n`);
    }
    write('MANIFEST.json', JSON.stringify({ package: 'chipshow-writing-rules', version: 'synthetic-test-only', files }));
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  process.once('exit', () => rmSync(root, { recursive: true, force: true }));
  return root;
}
