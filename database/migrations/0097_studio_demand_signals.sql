CREATE TABLE studio_demand_signals (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES studio_import_batches(id) ON DELETE CASCADE,
  record jsonb NOT NULL
);
