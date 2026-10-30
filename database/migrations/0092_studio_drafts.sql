CREATE TABLE studio_drafts (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES studio_tasks(id),
  article_id text NOT NULL REFERENCES articles(id),
  document jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved')),
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id,article_id)
);
