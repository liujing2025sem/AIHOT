ALTER TABLE studio_tasks ADD CONSTRAINT studio_tasks_editorial_state_check CHECK (state IN ('waiting','received','blocked')) NOT VALID;
