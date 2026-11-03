CREATE TABLE studio_social_drafts (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES studio_drafts(id) ON DELETE CASCADE,
  parent_version integer NOT NULL CHECK (parent_version > 0),
  document jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
