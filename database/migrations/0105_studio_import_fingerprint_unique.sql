CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS studio_import_content_unique ON studio_import_batches(kind,content_fingerprint) WHERE content_fingerprint IS NOT NULL;
