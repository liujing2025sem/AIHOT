CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS studio_questions_question_identity ON studio_questions ((document->>'question'));
