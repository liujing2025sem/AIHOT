import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("a separate Node process cold-starts the package checkpoint and queries without resubmitting", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "aihot-harness-recovery-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../scripts/demo.ts", import.meta.url));
  const first = JSON.parse(execFileSync(process.execPath, [script, "--out", directory], { encoding: "utf8" }));
  assert.equal(first.state, "running"); assert.equal(first.submit_calls, 1);
  const checkpoint = path.join(directory, "checkpoint.json");
  assert.equal(JSON.parse(readFileSync(checkpoint, "utf8"))[0].state, "running");
  const second = JSON.parse(execFileSync(process.execPath, [script, "--restore", checkpoint], { encoding: "utf8" }));
  assert.equal(second.state, "unknown"); assert.equal(second.submit_calls, 0); assert.equal(second.query_calls, 1);
  assert.equal(second.upstream_ref, first.upstream_ref); assert.equal(second.production_connected, false);
});
