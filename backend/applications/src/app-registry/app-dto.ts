// App wire-shape serializer. Centralizes two concerns the routes used to inline:
//   1. organizationId prefixing (TypeID wire form, unconditional since FFRNT-185);
//   2. the creator-ownership surface (fuzefront.apps.creator-ownership).
//
// Creator-ownership ("org-held, user-originated"): the owner of record is the
// organization; the creator is informational. When the flag is OFF the DTO is
// byte-identical to the pre-feature shape (`createdByUserId` is internal and is
// ALWAYS stripped). When ON the DTO gains:
//   createdBy: <usr_… | null>
//   creator:   { userId, isCurrentMember, displayName?, contactEmail? } | null
// `displayName` and `contactEmail` (contract 1.6.0) are returned ONLY while the
// creator is still an active member of the owning org — a former member is
// reduced to a "former member" signal (isCurrentMember:false, no name/contact)
// so the UI never shows a stale contact.
import { db } from '../config/database'
import { toWireId, prefixDtoIds } from '../identity/serializer'
import { log, errInfo } from './log'
import type { AppRecord } from './service'
import { SYNTHETIC_CONSUMER_USER_ID } from '../middleware/consumer-auth'

export interface CreatorInfo {
  isCurrentMember: boolean
  displayName: string | null
  /** Optional so injected test resolvers predating 1.6.0 stay valid. */
  contactEmail?: string | null
}

export interface CreatorResolver {
  resolve(userId: string, organizationId: string): Promise<CreatorInfo>
}

export const knexCreatorResolver: CreatorResolver = {
  async resolve(userId, organizationId) {
    const m = await db('organization_memberships')
      .where('user_id', userId)
      .where('organization_id', organizationId)
      .where('status', 'active')
      .first()
    if (!m) return { isCurrentMember: false, displayName: null }
    let displayName: string | null = null
    let contactEmail: string | null = null
    try {
      const u = await db('users').where('id', userId).first()
      if (u) {
        contactEmail = typeof u.email === 'string' && u.email.trim() ? u.email.trim() : null
        const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
        displayName = full || u.email || null
      }
    } catch (err) {
      log.warn('creator display-name lookup failed (continuing)', { userId, ...errInfo(err) })
    }
    return { isCurrentMember: true, displayName, contactEmail }
  },
}

let resolver: CreatorResolver = knexCreatorResolver

/** Test/DI seam. */
export function setCreatorResolver(r: CreatorResolver | null): void {
  resolver = r ?? knexCreatorResolver
}

/** The slice of the resolved caller (app-registry/caller.ts) the DTO needs. */
export interface DtoCaller {
  userId: string
  organizationIds: string[]
  isPlatformAdmin: boolean
}

export interface AppDtoOptions {
  creatorOwnership: boolean
  /**
   * The requesting principal. Gates `creator.contactEmail` ONLY (displayName /
   * isCurrentMember are unaffected). Absent/undefined => the relationship is
   * unknown => contactEmail is OMITTED (fail closed).
   */
  caller?: DtoCaller | null
}

/**
 * contactEmail is more sensitive than displayName, so it is emitted only to a
 * member of the app's OWNING org or an interactive platform admin. The
 * synthetic consumer/registration-token identity carries an `admin` role but is
 * a shared workload secret, not a person — it never gets a creator's email.
 */
export function canSeeCreatorContact(caller: DtoCaller | null | undefined, organizationId: string | null | undefined): boolean {
  if (!caller || !caller.userId || caller.userId === SYNTHETIC_CONSUMER_USER_ID) return false
  if (caller.isPlatformAdmin) return true
  if (!organizationId) return false
  return Array.isArray(caller.organizationIds) && caller.organizationIds.includes(organizationId)
}

export async function toAppDtos(apps: AppRecord[], opts: AppDtoOptions): Promise<any[]> {
  const cache = new Map<string, Promise<CreatorInfo>>()
  return Promise.all(
    apps.map(async app => {
      const { createdByUserId, ...rest } = app as AppRecord & { createdByUserId?: string | null }
      // Operator-governed fields are DB-internal and NOT part of the frozen App
      // contract (services/app-registry-service/openapi.yaml, additionalProperties:
      // false). They are managed/served via the admin /api/apps surface, so they
      // are stripped from this wire shape.
      for (const k of [
        'scopeLevel',
        'orgInstallMode',
        'personalRemovable',
        'orgRemovable',
        'systemApp',
        'defaultInstallPersonal',
        'defaultInstallOrg',
      ]) {
        delete (rest as Record<string, unknown>)[k]
      }
      const dto: any = prefixDtoIds(rest as any, { organizationId: 'organization' })
      if (!opts.creatorOwnership) return dto
      if (!createdByUserId) {
        return { ...dto, createdBy: null, creator: null }
      }
      const userWire = toWireId('user', createdByUserId)
      let info: CreatorInfo = { isCurrentMember: false, displayName: null }
      if (app.organizationId) {
        const key = `${createdByUserId}|${app.organizationId}`
        if (!cache.has(key)) {
          cache.set(
            key,
            resolver.resolve(createdByUserId, app.organizationId).catch(err => {
              log.warn('creator resolve failed (continuing)', { ...errInfo(err) })
              return { isCurrentMember: false, displayName: null }
            })
          )
        }
        info = await cache.get(key)!
      }
      const creator: Record<string, unknown> = {
        userId: userWire,
        isCurrentMember: info.isCurrentMember,
      }
      if (info.isCurrentMember && info.displayName) creator.displayName = info.displayName
      // Same former-member rule as displayName: never for a non-member.
      // ...and ONLY to the owning org's members / platform admins (see
      // canSeeCreatorContact); everyone else, incl. public/marketplace readers,
      // gets no email even for a current member.
      if (info.isCurrentMember && info.contactEmail && canSeeCreatorContact(opts.caller, app.organizationId)) {
        creator.contactEmail = info.contactEmail
      }
      return { ...dto, createdBy: userWire, creator }
    })
  )
}

export async function toAppDto(app: AppRecord, opts: AppDtoOptions): Promise<any> {
  return (await toAppDtos([app], opts))[0]
}
