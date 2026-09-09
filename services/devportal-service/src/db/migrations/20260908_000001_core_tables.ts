// docs/planning/developers-portal.md §4.2/§6 — the spec registry and the
// playground call log (`DevPortalPlayground:view_history`).

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('devportal_specs', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Family/product grouping (§7 catalog: product -> service -> spec).
    // 'fuzefront' for every spec harvested from this repo today; a future
    // cross-repo push (Phase 5) sets it to the pushing repo's own name.
    table.string('repo').notNullable().defaultTo('fuzefront');
    table.string('service').notNullable();
    table.string('spec_path').notNullable();
    table.string('version').notNullable().defaultTo('unknown');
    table.jsonb('raw_spec').notNullable();
    table.timestamp('fetched_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);

    table.unique(['repo', 'service']);
    table.index(['repo']);
  });

  await knex.schema.createTable('devportal_playground_calls', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable();
    table.uuid('spec_id').notNullable().references('id').inTable('devportal_specs').onDelete('CASCADE');
    table.string('operation_id').notNullable();
    table.string('method').notNullable();
    table.string('path').notNullable();
    table.integer('response_status').notNullable();
    // Never the real request/response bodies of a sandboxed call by default —
    // §6 quota history is for the developer to see WHAT they exercised, not a
    // verbatim replay log. Kept minimal (method/path/status) until a concrete
    // need for body capture is scoped.
    table.timestamp('called_at').notNullable().defaultTo(knex.fn.now());

    table.index(['user_id', 'called_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('devportal_playground_calls');
  await knex.schema.dropTableIfExists('devportal_specs');
}
