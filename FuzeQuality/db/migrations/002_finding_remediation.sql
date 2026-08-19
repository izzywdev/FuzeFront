ALTER TABLE fuzequality.findings
  ADD COLUMN IF NOT EXISTS remediation text,
  ADD COLUMN IF NOT EXISTS source_revision text;
