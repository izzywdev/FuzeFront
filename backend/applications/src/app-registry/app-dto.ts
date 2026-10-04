// App wire-shape serializer. Centralizes two concerns the routes used to inline:
//   1. organizationId prefixing (fuzefront.identity.prefixed-ids, unchanged);
//   2. the creator-ownership surface (fuzefront.apps.creator-ownership).
//
// Creator-ownership ("org-held, user-originated"): the owner of record is the
// organization; the creator is informational. When the flag is OFF the DTO is
// byte-identical to the pre-feature shape (`createdByUserId` is internal and is
// ALWAYS stripped). When ON the DTO gains:
//   createdBy: <usr_… | null>
//   creator:   { userId, isCurrentMember, displayName? } | null
// `displayName` is returned ONLY while the creator is still an active member of
// the owning org — a former member is reduced to a "former member" signal
// (isCurrentMember:false, no name/contact) so the UI never shows a stale contact.
import { db } from '../config/database'
import { toWireId, prefixDtoIds } from '../identity/serializer'
import { log, errInfo } from './log'
import type { AppRecord } from './service'

export interface CreatorInfo {
  isCurrentMember: boolean
  displayName: string | null
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
    try {
      const u = await db('users').where('id', userId).first()
      if (u) {
        const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
        displayName = full || u.email || null
      }
    } catch (err) {
      log.warn('creator display-name lookup failed (continuing)', { userId, ...errInfo(err) })
    }
    return { isCurrentMember: true, displayName }
  },
}

let resolver: CreatorResolver = knexCreatorResolver

/** Test/DI seam. */
export function setCreatorResolver(r: CreatorResolver | null): void {
  resolver = r ?? knexCreatorResolver
}

export interface AppDtoOptions {
  prefixed: boolean
  creatorOwnership: boolean
}

export async function toAppDtos(apps: AppRecord[], opts: AppDtoOptions): Promise<any[]> {
  const cache = new Map<string, Promise<CreatorInfo>>()
  return Promise.all(
    apps.map(async app => {
      const { createdByUserId, ...rest } = app as AppRecord & { createdByUserId?: string | null }
      const dto: any = prefixDtoIds(rest as any, opts.prefixed, { organizationId: 'organization' })
      if (!opts.creatorOwnership) return dto
      if (!createdByUserId) {
        return { ...dto, createdBy: null, creator: null }
      }
      const userWire = toWireId('user', createdByUserId, true)
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
      return { ...dto, createdBy: userWire, creator }
    })
  )
}

export async function toAppDto(app: AppRecord, opts: AppDtoOptions): Promise<any> {
  return (await toAppDtos([app], opts))[0]
}
