// A pull request cannot change deployed history or hide an unsafe migration by naming it as history.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { checkMigrations } from "../scripts/check-migrations.ts";

const root = mkdtempSync(path.join(tmpdir(), "migration-git-"));
after(() => rmSync(root, { recursive: true, force: true }));
const write = (file: string, text: string) => {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
};
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "test@example.invalid");
git("config", "user.name", "Test");
git("config", "core.quotePath", "true");
write("database/migrations/0001_history.sql", "UPDATE old_table SET done = true;");
git("add", ".");
git("commit", "-qm", "history");

test("unchanged history is accepted, but edits and deletions fail", () => {
  assert.deepEqual(checkMigrations(root, "HEAD"), []);
  write("database/migrations/0001_history.sql", "SELECT 1;");
  assert.match(checkMigrations(root, "HEAD").join("\n"), /immutable/);
  rmSync(path.join(root, "database/migrations/0001_history.sql"));
  assert.match(checkMigrations(root, "HEAD").join("\n"), /immutable/);
  git("restore", ".");
});

test("new module migrations are checked even when untracked or named below the cutoff", () => {
  const file = "modules/example/migrations/0002_hidden.sql";
  write(file, "CREATE TABLE example (id int);");
  assert.match(checkMigrations(root, "HEAD").join("\n"), /0055/);
  rmSync(path.join(root, file));
  write("modules/example/migrations/0055_unsafe.sql", "UPDATE old_table SET done = false;");
  assert.match(checkMigrations(root, "HEAD").join("\n"), /0055_unsafe/);
  rmSync(path.join(root, "modules/example/migrations/0055_unsafe.sql"));
  write("modules/example/migrations/0055_safe.sql", "CREATE INDEX CONCURRENTLY IF NOT EXISTS example_idx ON example (id);");
  assert.deepEqual(checkMigrations(root, "HEAD"), []);
});

test("Git-quoted paths cannot hide unsafe new migrations or invalid file names", () => {
  for (const [file, sql, problem] of [
    ["modules/示例/migrations/0055_unsafe.sql", "UPDATE old_table SET done = false;", /not safe for an online migration/],
    ["database/migrations/0055_bad\nname.sql", "CREATE TABLE example (id int);", /new migrations start at 0055/],
  ] as const) {
    write(file, sql);
    try {
      assert.match(checkMigrations(root, "HEAD").join("\n"), problem, file);
    } finally {
      rmSync(path.join(root, file));
    }
  }
});

test("deployed migrations with Git-quoted paths remain immutable", () => {
  const file = "database/migrations/0002_旧迁移.sql";
  write(file, "UPDATE old_table SET done = true;");
  git("add", file);
  git("commit", "-qm", "quoted migration history");
  assert.deepEqual(checkMigrations(root, "HEAD"), []);
  write(file, "SELECT 1;");
  try {
    assert.match(checkMigrations(root, "HEAD").join("\n"), /immutable/);
    rmSync(path.join(root, file));
    assert.match(checkMigrations(root, "HEAD").join("\n"), /immutable/);
  } finally {
    git("restore", file);
  }
});
