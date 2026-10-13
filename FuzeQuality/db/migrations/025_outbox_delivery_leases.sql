-- Durable relay leases let any API replica recover unpublished identity
-- projection events without two replicas publishing the same row concurrently.
ALTER TABLE fuzequality.outbox_events
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS idx_outbox_delivery_ready
  ON fuzequality.outbox_events (created_at)
  WHERE published_at IS NULL;
