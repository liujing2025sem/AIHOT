CREATE TABLE studio_import_batches (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('inquiry', 'gsc', 'semrush')),
  row_count integer NOT NULL CHECK (row_count >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
