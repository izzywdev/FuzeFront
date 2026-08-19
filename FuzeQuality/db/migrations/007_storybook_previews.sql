ALTER TABLE fuzequality.frontend_surfaces
  ADD COLUMN IF NOT EXISTS stories jsonb NOT NULL DEFAULT '[]'::jsonb;
