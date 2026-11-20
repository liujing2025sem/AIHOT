import type { AdminSource } from "@aihot/contracts/admin";

export type Draft = Pick<AdminSource, "name" | "kind" | "interval_minutes" | "tier" | "participation_mode" | "signal_group_id" | "first_party" | "owner_entity_id" | "site_fulltext" | "syndicate_fulltext"> & { tags: string; config: string };

export function draftOf(s: AdminSource): Draft {
  return {
    name: s.name,
    kind: s.kind,
    interval_minutes: s.interval_minutes,
    tier: s.tier,
    participation_mode: s.participation_mode,
    signal_group_id: s.signal_group_id,
    first_party: s.first_party,
    owner_entity_id: s.owner_entity_id,
    site_fulltext: s.site_fulltext,
    syndicate_fulltext: s.syndicate_fulltext,
    tags: s.tags.join(", "),
    config: JSON.stringify(s.config, null, 2),
  };
}

/** Field names that differ from the saved source (also used for confirmation text). */
export function patchPreview(draft: Draft, s: AdminSource): Partial<Record<keyof Draft, true>> {
  const out: Partial<Record<keyof Draft, true>> = {};
  const saved = draftOf(s);
  for (const k of Object.keys(draft) as Array<keyof Draft>) {
    if (k === "config") {
      try {
        if (JSON.stringify(JSON.parse(draft.config)) !== JSON.stringify(s.config)) out.config = true;
      } catch {
        out.config = true;
      }
    } else if (k === "tags") {
      const tags = draft.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
      if (JSON.stringify(tags) !== JSON.stringify(s.tags)) out.tags = true;
    } else if (String(draft[k] ?? "") !== String(saved[k] ?? "")) out[k] = true;
  }
  return out;
}

/** A refreshed status must keep local edits, while untouched fields follow the saved source. */
export function rebaseSourceDraft(draft: Draft, previous: AdminSource, next: AdminSource): Draft {
  if (previous.id !== next.id) return draftOf(next);
  const edited = patchPreview(draft, previous);
  if (edited.kind || edited.config) { edited.kind = true; edited.config = true; }
  return {
    ...draftOf(next),
    ...Object.fromEntries((Object.keys(edited) as Array<keyof Draft>).map((key) => [key, draft[key]])),
  };
}
