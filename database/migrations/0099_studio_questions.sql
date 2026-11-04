CREATE TABLE studio_questions (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
