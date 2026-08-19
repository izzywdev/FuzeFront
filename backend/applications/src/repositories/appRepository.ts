/**
 * Typed repository for `app` entities.
 *
 * Functions accept EntityId<'app'> (branded string) so a raw string off
 * req.body fails to compile — the enforcement described in
 * governance/identifier-standard.md §9. Call sites obtain a branded id via
 * assertRef('app', req.params.id) before passing it here.
 *
 * toUuid() converts the TypeID wire form to the native UUID stored in the
 * column. During the dual-accept window (step 5) both bare UUIDs and TypeID
 * ids are accepted at the request boundary via assertRef + legacyUuidTypes.
 */

import type { Knex } from 'knex'
import { EntityId, toUuid } from '@izzywdev/fuzefront-identity'
import { db as defaultDb } from '../config/database'

export interface AppRow {
  id: string
  name: string
  url: string
  icon_url: string | null
  is_active: boolean
  integration_type: 'iframe' | 'module-federation' | 'web-component' | 'spa'
  remote_url: string | null
  scope: string | null
  module: string | null
  description: string | null
  scope_level: 'personal' | 'organization' | 'both'
  created_at: Date
  updated_at: Date
}

/** Find an app by its branded EntityId. Returns undefined when not found. */
export async function findAppById(
  appId: EntityId<'app'>,
  db: Knex = defaultDb
): Promise<AppRow | undefined> {
  return db('apps').where({ id: toUuid(appId) }).first()
}

/** Find an active app by its branded EntityId. Returns undefined when not found or inactive. */
export async function findActiveAppById(
  appId: EntityId<'app'>,
  db: Knex = defaultDb
): Promise<AppRow | undefined> {
  return db('apps').where({ id: toUuid(appId), is_active: true }).first()
}

/** Update an app's active status. */
export async function setAppActive(
  appId: EntityId<'app'>,
  isActive: boolean,
  db: Knex = defaultDb
): Promise<void> {
  await db('apps')
    .where({ id: toUuid(appId) })
    .update({ is_active: isActive, updated_at: db.fn.now() })
}

/** Delete an app by its branded EntityId. */
export async function deleteApp(
  appId: EntityId<'app'>,
  db: Knex = defaultDb
): Promise<void> {
  await db('apps').where({ id: toUuid(appId) }).del()
}
