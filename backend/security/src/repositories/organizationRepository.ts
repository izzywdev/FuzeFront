/**
 * Typed repository for organization, membership, and invitation entities.
 *
 * All lookup functions accept EntityId<T> (branded string) so a raw string
 * off req.body fails to compile — the enforcement that matters, per
 * governance/identifier-standard.md §9. Call sites obtain a branded id by
 * calling assertRef('organization', req.params.id) (the L0 prefix check)
 * before passing it here.
 *
 * toUuid() converts the TypeID wire form to the native UUID stored in the
 * column. Entities minted with toUuid(mintId('organization')) are stored as
 * UUIDs; during the dual-accept window (step 5) both bare UUIDs and TypeID
 * wire ids are accepted at the request boundary via assertRef + legacyUuidTypes.
 *
 * Singleton-pattern: each function accepts an optional db override so tests
 * can inject a fake knex without touching module-level state.
 */

import type { Knex } from 'knex'
import {
  EntityId,
  toUuid,
} from '@izzywdev/fuzefront-identity'
import { db as defaultDb } from '../config/database'

// ── Organization ──────────────────────────────────────────────────────────────

export interface OrganizationRow {
  id: string
  name: string
  slug: string
  parent_id: string | null
  owner_id: string
  type: string
  settings: unknown
  metadata: unknown
  is_active: boolean
  provisioning_state?: string
  created_at: Date
  updated_at: Date
}

/** Find an organization by its branded EntityId. Returns undefined when not found. */
export async function findOrgById(
  orgId: EntityId<'organization'>,
  db: Knex = defaultDb
): Promise<OrganizationRow | undefined> {
  return db('organizations').where({ id: toUuid(orgId) }).first()
}

/** Find an organization by slug (slug is not an entity id — no assertRef needed). */
export async function findOrgBySlug(
  slug: string,
  db: Knex = defaultDb
): Promise<OrganizationRow | undefined> {
  return db('organizations').where({ slug }).first()
}

// ── Membership ────────────────────────────────────────────────────────────────

export interface MembershipRow {
  id: string
  user_id: string
  organization_id: string
  role: string
  status: string
  joined_at: Date
  permissions: unknown
  metadata: unknown
  created_at?: Date
  updated_at?: Date
}

/** Find a membership by its branded EntityId. */
export async function findMembershipById(
  membershipId: EntityId<'membership'>,
  db: Knex = defaultDb
): Promise<MembershipRow | undefined> {
  return db('organization_memberships').where({ id: toUuid(membershipId) }).first()
}

/** Find a membership by (userId, orgId). Uses raw UUIDs from their respective
 *  entity ids — both are already toUuid()-converted by the caller or retrieved
 *  from trusted sources (req.user.id, row.organization_id). */
export async function findMembershipByUserAndOrg(
  userId: EntityId<'user'>,
  orgId: EntityId<'organization'>,
  db: Knex = defaultDb
): Promise<MembershipRow | undefined> {
  return db('organization_memberships')
    .where({ user_id: toUuid(userId), organization_id: toUuid(orgId) })
    .first()
}

/** List all active memberships for an organization. */
export async function listOrgMemberships(
  orgId: EntityId<'organization'>,
  db: Knex = defaultDb
): Promise<MembershipRow[]> {
  return db('organization_memberships')
    .where({ organization_id: toUuid(orgId), status: 'active' })
    .orderBy('joined_at', 'asc')
}

// ── Invitation ────────────────────────────────────────────────────────────────

export interface InvitationRow {
  id: string
  organization_id: string
  email: string
  role: string
  token: string
  status: string
  expires_at: Date
  invited_by: string | null
  created_at?: Date
  updated_at?: Date
}

/** Find an invitation by its branded EntityId. */
export async function findInvitationById(
  invitationId: EntityId<'invitation'>,
  db: Knex = defaultDb
): Promise<InvitationRow | undefined> {
  return db('organization_invitations').where({ id: toUuid(invitationId) }).first()
}

/** Find all pending invitations for an organization. */
export async function listOrgInvitations(
  orgId: EntityId<'organization'>,
  db: Knex = defaultDb
): Promise<InvitationRow[]> {
  return db('organization_invitations')
    .where({ organization_id: toUuid(orgId), status: 'pending' })
    .orderBy('created_at', 'desc')
}
