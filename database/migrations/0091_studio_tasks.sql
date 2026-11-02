CREATE TABLE studio_tasks (
  id text PRIMARY KEY,
  request jsonb NOT NULL,
  response jsonb,
  response_hash text,
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','received')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz
);
