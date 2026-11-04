CREATE TABLE studio_recommendations (
  id text PRIMARY KEY,
  input_key text NOT NULL UNIQUE,
  question_id text REFERENCES studio_questions(id),
  article_id text REFERENCES articles(id) ON DELETE SET NULL,
  article_revision integer,
  document jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','adopted','rejected','later')),
  rejection_reason text,
  task_id text REFERENCES studio_tasks(id),
  baseline_found boolean,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
