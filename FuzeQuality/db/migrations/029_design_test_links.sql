-- FuzeX owns UX design decisions; FuzeQuality owns test artifacts.  This
-- projection records only a tenant-scoped relationship and never mirrors a
-- design document or grants access to it.
CREATE TABLE IF NOT EXISTS fuzequality.design_test_links (
  tenant_id text NOT NULL,
  trace_link_id text NOT NULL,
  fuzex_project_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('flow-step','frame','component')),
  target_ref text NOT NULL,
  test_case_id text NOT NULL REFERENCES fuzequality.test_cases(id),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, trace_link_id)
);

CREATE INDEX IF NOT EXISTS design_test_links_tenant_target_idx
  ON fuzequality.design_test_links (tenant_id, fuzex_project_id, target_kind, target_ref)
  WHERE active=true;

CREATE INDEX IF NOT EXISTS design_test_links_tenant_test_idx
  ON fuzequality.design_test_links (tenant_id, test_case_id)
  WHERE active=true;

-- Defense in depth: an organization/principal deletion is authoritative even
-- if a later membership-removal event is delayed or never delivered.
CREATE OR REPLACE FUNCTION fuzequality.revoke_deleted_identity_memberships()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'tenants' AND NEW.active = false AND OLD.active = true THEN
    UPDATE fuzequality.organization_memberships SET active=false, updated_at=now()
      WHERE tenant_id=NEW.id AND active=true;
  ELSIF TG_TABLE_NAME = 'principals' AND NEW.active = false AND OLD.active = true THEN
    UPDATE fuzequality.organization_memberships SET active=false, updated_at=now()
      WHERE principal_id=NEW.id AND active=true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS revoke_tenant_memberships_on_delete ON fuzequality.tenants;
CREATE TRIGGER revoke_tenant_memberships_on_delete AFTER UPDATE OF active ON fuzequality.tenants
  FOR EACH ROW EXECUTE FUNCTION fuzequality.revoke_deleted_identity_memberships();
DROP TRIGGER IF EXISTS revoke_principal_memberships_on_delete ON fuzequality.principals;
CREATE TRIGGER revoke_principal_memberships_on_delete AFTER UPDATE OF active ON fuzequality.principals
  FOR EACH ROW EXECUTE FUNCTION fuzequality.revoke_deleted_identity_memberships();
