import { Knex } from 'knex'

// The platform root organization has a fixed, cross-service identity. It is
// created by security-service migrations, but applications-service may start
// after the historical identity.org.created event has already passed. Seed the
// local L1 projection so strict reference enforcement does not reject
// first-party app self-registration while Kafka catches up.
const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `INSERT INTO app_ref_index
       (entity_type, entity_id, tenant_id, status, observed_at, updated_at)
     VALUES ('organization', ?, NULL, 'active', now(), now())
     ON CONFLICT (entity_type, entity_id, COALESCE(tenant_id, ''))
     DO UPDATE SET status = 'active', updated_at = now()`,
    [ROOT_ORG_ID],
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex('app_ref_index')
    .where({ entity_type: 'organization', entity_id: ROOT_ORG_ID })
    .whereNull('tenant_id')
    .delete()
}
