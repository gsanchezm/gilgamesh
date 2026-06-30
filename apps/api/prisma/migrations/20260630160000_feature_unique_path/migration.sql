-- Slice-6 review fix: a feature file path is unique per project, so concurrent/double-submit repo
-- imports can't create duplicate Feature rows (the losing transaction rolls back on this constraint).
CREATE UNIQUE INDEX "features_project_id_path_key" ON "features"("project_id", "path");
