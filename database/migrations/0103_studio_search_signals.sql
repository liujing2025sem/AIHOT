CREATE TABLE studio_search_signals (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES studio_import_batches(id) ON DELETE CASCADE,
  record jsonb NOT NULL
);
