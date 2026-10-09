import { z } from 'zod'
import { apiRequest, runConsumer } from './runtime'

const organizationSchema = z.object({
  organizationId: z.string().uuid(), slug: z.string().min(1), name: z.string().min(1),
  type: z.enum(['platform', 'organization', 'personal']), ownerId: z.string().uuid().nullable(), isActive: z.boolean(),
})
const userCreatedSchema = z.object({
  userId: z.string().uuid(), email: z.string().email(), firstName: z.string().optional(), lastName: z.string().optional(),
})
const userUpdatedSchema = userCreatedSchema.extend({ firstName: z.string().optional(), lastName: z.string().optional() })
const deletedSchema = z.object({ userId: z.string().uuid() })
const organizationDeletedSchema = z.object({ organizationId: z.string().uuid() })
const membershipSchema = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid(), role: z.string().min(1) })

/**
 * Projects the FuzeFront identity event-carried snapshots into FuzeQuality.
 * Each write is idempotent; the API publishes a FuzeQuality lifecycle event
 * only when the local projection actually changes.
 */
await runConsumer(
  'fuzequality-identity-lifecycle-v1',
  [
    'identity.org.created', 'identity.org.updated', 'identity.org.deleted',
    'identity.user.created', 'identity.user.updated', 'identity.user.deleted',
    'identity.membership.added', 'identity.membership.removed',
  ],
  async (topic, payload) => {
    if (topic === 'identity.org.created' || topic === 'identity.org.updated') {
      const event = organizationSchema.parse(payload)
      await apiRequest('/api/v1/internal/identity-lifecycle', { method: 'POST', body: JSON.stringify({
        type: 'organization.upsert', organizationId: event.organizationId, slug: event.slug, name: event.name,
        organizationType: event.type, ownerId: event.ownerId, isActive: event.isActive,
      }) })
      return
    }
    if (topic === 'identity.org.deleted') {
      await apiRequest('/api/v1/internal/identity-lifecycle', { method: 'POST', body: JSON.stringify({ type: 'organization.deleted', organizationId: organizationDeletedSchema.parse(payload).organizationId }) })
      return
    }
    if (topic === 'identity.user.created' || topic === 'identity.user.updated') {
      const event = (topic === 'identity.user.created' ? userCreatedSchema : userUpdatedSchema).parse(payload)
      await apiRequest('/api/v1/internal/identity-lifecycle', { method: 'POST', body: JSON.stringify({ type: 'user.upsert', ...event }) })
      return
    }
    if (topic === 'identity.user.deleted') {
      await apiRequest('/api/v1/internal/identity-lifecycle', { method: 'POST', body: JSON.stringify({ type: 'user.deleted', userId: deletedSchema.parse(payload).userId }) })
      return
    }
    const event = membershipSchema.parse(payload)
    await apiRequest('/api/v1/internal/identity-lifecycle', { method: 'POST', body: JSON.stringify({
      type: 'membership.changed', organizationId: event.organizationId, userId: event.userId, role: event.role,
      active: topic === 'identity.membership.added',
    }) })
  },
)
