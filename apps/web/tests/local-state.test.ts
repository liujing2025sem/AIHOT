import assert from "node:assert/strict";
import { after, test } from "node:test";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import type { AdminSource, Timestamp } from "@aihot/contracts/admin";
import { draftOf, patchPreview, rebaseSourceDraft } from "../app/routes/admin/source-draft.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

const editableSource: AdminSource = {
  id: "draft-source", name: "Original source", kind: "rss", config: { url: "https://example.test/feed" },
  tags: ["LED"], first_party: true, owner_entity_id: null, tier: "primary", participation_mode: "editorial",
  signal_group_id: null, interval_minutes: 60, site_fulltext: false, syndicate_fulltext: false,
  enabled: true, health: "ok", fail_count: 0, last_fetch_at: null, last_ok_at: null, last_error: null,
  cursor: null, next_fetch_at: null, created_at: "2026-11-20T08:00:00Z" as Timestamp, updated_at: "2026-11-20T08:00:00Z" as Timestamp,
};

test("source pause and repeated refresh keep local edits without including enabled in the save draft", () => {
  const draft = { ...draftOf(editableSource), name: "My unsaved name", config: '{"url":"https://example.test/new-feed"}' };
  const paused = { ...editableSource, enabled: false, health: "paused", updated_at: "2026-11-20T08:01:00Z" as Timestamp };
  const kept = rebaseSourceDraft(draft, editableSource, paused);
  assert.equal(kept.name, draft.name);
  assert.equal(kept.config, draft.config);
  assert.equal("enabled" in kept, false);
  assert.deepEqual(Object.keys(patchPreview(kept, paused)).sort(), ["config", "name"]);
  assert.deepEqual(rebaseSourceDraft(kept, paused, { ...paused, updated_at: "2026-11-20T08:02:00Z" as Timestamp }), kept);
});

test("source refresh updates untouched fields and clean forms, retaining local or invalid JSON edits", () => {
  const next = { ...editableSource, name: "Remote name", interval_minutes: 120, tags: ["LED", "DOOH"], updated_at: "2026-11-20T08:01:00Z" as Timestamp };
  assert.deepEqual(rebaseSourceDraft(draftOf(editableSource), editableSource, next), draftOf(next));
  const draft = { ...draftOf(editableSource), name: "Local name", config: "{unfinished" };
  const kept = rebaseSourceDraft(draft, editableSource, next);
  assert.equal(kept.name, "Local name");
  assert.equal(kept.config, "{unfinished");
  assert.equal(kept.interval_minutes, 120);
  assert.equal(kept.tags, "LED, DOOH");
});

test("saving clears source dirty fields, and another source starts from its own saved values", () => {
  const draft = { ...draftOf(editableSource), name: "Saved name", tags: " LED， DOOH " };
  const saved = { ...editableSource, name: draft.name, tags: ["LED", "DOOH"], updated_at: "2026-11-20T08:01:00Z" as Timestamp };
  assert.deepEqual(patchPreview(rebaseSourceDraft(draft, editableSource, saved), saved), {});
  const other = { ...saved, id: "other-source", name: "Other source" };
  assert.deepEqual(rebaseSourceDraft(draft, editableSource, other), draftOf(other));
  assert.deepEqual(patchPreview(draftOf(saved), saved), {}, "explicit restore returns to the saved state");
});

test("an edited collector kind keeps its matching config when unrelated source fields refresh", () => {
  const draft = { ...draftOf(editableSource), kind: "web-list" };
  const next = { ...editableSource, config: { url: "https://example.test/remote-feed" }, updated_at: "2026-11-20T08:01:00Z" as Timestamp };
  const kept = rebaseSourceDraft(draft, editableSource, next);
  assert.equal(kept.kind, draft.kind);
  assert.equal(kept.config, draft.config);
  const configEdit = { ...draftOf(editableSource), config: '{"url":"https://example.test/local-feed"}' };
  const changedKind = { ...next, kind: "web-list" };
  const keptPair = rebaseSourceDraft(configEdit, editableSource, changedKind);
  assert.equal(keptPair.kind, editableSource.kind);
  assert.equal(keptPair.config, configEdit.config);
});
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

let instance = 0;
async function reader(starred: unknown[] = []) {
  const values = new Map([["aihot-starred-items", JSON.stringify(starred)]]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } },
  });
  // Reopening the page starts with an empty snapshot cache.
  const state: typeof import("../app/lib/local-state.ts") = await import(`../app/lib/local-state.ts?test=${instance++}`);
  return { state, values };
}

const displayDate = (value: string) => `${beijingDate(value)} ${beijingTime(value)}`;

test("import keeps bookmarks with invalid dates and persists displayable replacements", async () => {
  const invalid = ["broken", "", "999999-01-01", "+275760-09-13T00:00:00.000Z", null, 42, {}];
  const { state, values } = await reader();
  const before = Date.now();
  const report = state.importBundle(JSON.stringify({ version: 1, starred: invalid.map((date, i) => ({
    id: `import-${i}`, title: `Bookmark ${i}`, savedAt: date, publishedAt: date,
  })) }));
  assert.equal(report.starredAdded, invalid.length);
  const saved = JSON.parse(values.get(state.KEYS.starred)!);
  assert.equal(saved.length, invalid.length);
  for (const item of saved) {
    assert.equal(item.publishedAt, null);
    assert.ok(Date.parse(item.savedAt) >= before && Date.parse(item.savedAt) <= Date.now());
    assert.doesNotThrow(() => displayDate(item.savedAt));
  }
});

test("stored bookmarks with damaged dates remain readable, exportable and removable", async () => {
  const { state } = await reader([{ id: "stored", title: "Keep me", savedAt: "broken", publishedAt: "broken" }]);
  const starred = state.getStarred();
  assert.equal(starred.length, 1);
  assert.equal(starred[0]!.title, "Keep me");
  assert.equal(starred[0]!.publishedAt, null);
  assert.doesNotThrow(() => displayDate(starred[0]!.savedAt));
  assert.strictEqual(state.getStarred(), starred, "React snapshots must stay stable between changes");
  assert.deepEqual(state.exportBundle().starred, starred);
  state.removeStar("stored");
  assert.deepEqual(state.getStarred(), []);
});

test("valid dates are preserved and an import cannot replace an existing bookmark", async () => {
  const existing = { id: "valid", title: "Original", savedAt: "2026-09-29T08:30:00+08:00", publishedAt: "2026-09-28T23:00:00Z" };
  const { state } = await reader([existing]);
  const report = state.importBundle(JSON.stringify({ version: 1, starred: [{ ...existing, title: "Replacement", savedAt: "broken" }] }));
  assert.equal(report.starredAdded, 0);
  const [saved] = state.getStarred();
  assert.equal(saved!.title, existing.title);
  assert.equal(saved!.savedAt, existing.savedAt);
  assert.equal(saved!.publishedAt, existing.publishedAt);
});

// Failure cases before changing storage: another tab's writes must survive a cached-tab edit;
// unreadable bookmarks must not be overwritten and failed writes must not report success.
test("a cached tab merges newer saved bookmarks and read marks before writing", async () => {
  const { state, values } = await reader([{ id: "old", title: "Old" }]);
  state.getStarred();
  state.getReadIds();
  values.set(state.KEYS.starred, JSON.stringify([{ id: "other-tab", title: "Other tab" }, { id: "old", title: "Old" }]));
  values.set(state.KEYS.read, JSON.stringify(["other-tab"]));
  state.toggleStar({ id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false });
  state.markRead("new");
  assert.deepEqual(state.getStarred().map((s) => s.id), ["new", "other-tab", "old"]);
  assert.deepEqual(state.getReadIds(), ["new", "other-tab"]);
});

test("failed bookmark writes and damaged existing data do not report a successful toggle", async () => {
  const { state, values } = await reader();
  const item = { id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false };
  values.set(state.KEYS.starred, "damaged original data");
  assert.equal(state.toggleStar(item), false);
  assert.equal(values.get(state.KEYS.starred), "damaged original data");
  window.localStorage.setItem = () => { throw new Error("quota"); };
  assert.equal(state.toggleStar(item), false);
});

// Readers' browsers already keep their stars, read marks and settings under these names; a renamed key
// is an empty one for every existing reader. New keys may be added.
test("the storage keys readers already have data under keep their names", async () => {
  const { state } = await reader();
  const kept = {
    starred: "aihot-starred-items", read: "aihot-read-items", theme: "aihot-theme", font: "aihot-font",
    changelogSeen: "aihot-changelog-seen-version", feedbackDraft: "aihot-feedback-draft-v1", recentSearches: "aihot-recent-searches",
  } as const;
  for (const [role, key] of Object.entries(kept)) {
    assert.equal(state.KEYS[role as keyof typeof kept], key, `readers' ${role} data is stored under ${key}; renaming the key loses it`);
  }
});
