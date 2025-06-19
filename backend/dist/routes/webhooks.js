'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const express_1 = __importDefault(require('express'))
const uuid_1 = require('uuid')
const bcryptjs_1 = __importDefault(require('bcryptjs'))
const database_1 = require('../config/database')
const permit_sync_1 = require('../services/permit-sync')
const router = express_1.default.Router()
/**
 * @swagger
 * /api/webhooks/authentik/user-created:
 *   post:
 *     summary: Authentik user creation webhook
 *     description: Called by Authentik when a new user is created to sync with internal systems
 *     tags: [Webhooks]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: Authentik user ID
 *                   email:
 *                     type: string
 *                   first_name:
 *                     type: string
 *                   last_name:
 *                     type: string
 *                   username:
 *                     type: string
 *                   is_active:
 *                     type: boolean
 *               event:
 *                 type: string
 *                 enum: [user.created, user.updated, user.deleted]
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Invalid webhook payload
 *       500:
 *         description: Internal server error
 */
router.post('/authentik/user-created', async (req, res) => {
  var _a, _b
  const requestId = (0, uuid_1.v4)().substring(0, 8)
  console.log(`🔗 [${requestId}] Authentik webhook received:`, {
    timestamp: new Date().toISOString(),
    event: req.body.event,
    userId: (_a = req.body.user) === null || _a === void 0 ? void 0 : _a.id,
    userEmail:
      (_b = req.body.user) === null || _b === void 0 ? void 0 : _b.email,
    payload: req.body,
  })
  try {
    const { user, event } = req.body
    if (!user || !user.email) {
      console.log(
        `❌ [${requestId}] Invalid webhook payload: missing user or email`
      )
      return res
        .status(400)
        .json({ error: 'Invalid webhook payload: user and email required' })
    }
    // Generate a UUID for our internal user ID if not provided
    const userId = user.id || (0, uuid_1.v4)()
    switch (event) {
      case 'user.created':
        await handleUserCreated(requestId, userId, user)
        break
      case 'user.updated':
        await handleUserUpdated(requestId, userId, user)
        break
      case 'user.deleted':
        await handleUserDeleted(requestId, userId, user)
        break
      default:
        console.log(`⚠️  [${requestId}] Unknown event type: ${event}`)
    }
    console.log(`✅ [${requestId}] Webhook processed successfully`)
    res.json({ status: 'success', message: 'Webhook processed successfully' })
  } catch (error) {
    console.error(`❌ [${requestId}] Webhook processing error:`, error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
/**
 * Handle user created event from Authentik
 */
async function handleUserCreated(requestId, userId, user) {
  console.log(`👤 [${requestId}] Processing user creation for: ${user.email}`)
  try {
    // Check if user already exists in our database
    const existingUser = await (0, database_1.db)('users')
      .where('email', user.email)
      .first()
    if (existingUser) {
      console.log(
        `⚠️  [${requestId}] User already exists in database: ${user.email}`
      )
      // Update existing user with Authentik ID if needed
      if (!existingUser.authentik_id && user.id) {
        await (0, database_1.db)('users').where('id', existingUser.id).update({
          authentik_id: user.id,
          updated_at: new Date(),
        })
        console.log(`✅ [${requestId}] Updated existing user with Authentik ID`)
      }
      // Sync to Permit.io anyway in case it wasn't synced before
      await permit_sync_1.PermitSyncService.syncNewUser(existingUser.id, {
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        attributes: { authentik_id: user.id },
      })
      return
    }
    // Create new user in our database
    const newUser = {
      id: userId,
      email: user.email,
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      username: user.username || user.email,
      authentik_id: user.id || null,
      password_hash: await bcryptjs_1.default.hash((0, uuid_1.v4)(), 10), // Random password since auth is handled by Authentik
      roles: JSON.stringify(['user']), // Default role
      is_active: user.is_active !== false,
      default_app_id: null,
      attributes: JSON.stringify({
        source: 'authentik',
        created_via_webhook: true,
        authentik_id: user.id,
      }),
      created_at: new Date(),
      updated_at: new Date(),
    }
    await (0, database_1.db)('users').insert(newUser)
    console.log(`✅ [${requestId}] User created in database: ${userId}`)
    // Sync to Permit.io with default user template
    await permit_sync_1.PermitSyncService.syncNewUser(userId, {
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      attributes: {
        authentik_id: user.id,
        source: 'authentik',
      },
    })
    console.log(`🎉 [${requestId}] User creation completed: ${user.email}`)
  } catch (error) {
    console.error(`❌ [${requestId}] Error creating user:`, error)
    throw error
  }
}
/**
 * Handle user updated event from Authentik
 */
async function handleUserUpdated(requestId, userId, user) {
  console.log(`🔄 [${requestId}] Processing user update for: ${user.email}`)
  try {
    // Find user by email or authentik_id
    const existingUser = await (0, database_1.db)('users')
      .where('email', user.email)
      .orWhere('authentik_id', user.id)
      .first()
    if (!existingUser) {
      console.log(
        `⚠️  [${requestId}] User not found for update, creating new user`
      )
      await handleUserCreated(requestId, userId, user)
      return
    }
    // Update user information
    await (0, database_1.db)('users')
      .where('id', existingUser.id)
      .update({
        email: user.email,
        first_name: user.first_name || existingUser.first_name,
        last_name: user.last_name || existingUser.last_name,
        username: user.username || existingUser.username,
        is_active: user.is_active !== false,
        updated_at: new Date(),
      })
    console.log(
      `✅ [${requestId}] User updated in database: ${existingUser.id}`
    )
    // Sync updated information to Permit.io
    await permit_sync_1.PermitSyncService.syncNewUser(existingUser.id, {
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      attributes: {
        authentik_id: user.id,
        source: 'authentik',
      },
    })
  } catch (error) {
    console.error(`❌ [${requestId}] Error updating user:`, error)
    throw error
  }
}
/**
 * Handle user deleted event from Authentik
 */
async function handleUserDeleted(requestId, userId, user) {
  console.log(`🗑️  [${requestId}] Processing user deletion for: ${user.email}`)
  try {
    // Find user by email or authentik_id
    const existingUser = await (0, database_1.db)('users')
      .where('email', user.email)
      .orWhere('authentik_id', user.id)
      .first()
    if (!existingUser) {
      console.log(`⚠️  [${requestId}] User not found for deletion`)
      return
    }
    // Soft delete: mark as inactive rather than actually deleting
    await (0, database_1.db)('users').where('id', existingUser.id).update({
      is_active: false,
      updated_at: new Date(),
    })
    console.log(`✅ [${requestId}] User marked as inactive: ${existingUser.id}`)
    // Note: We don't delete from Permit.io here - that should be done manually
    // to avoid accidental permission deletions
  } catch (error) {
    console.error(`❌ [${requestId}] Error deleting user:`, error)
    throw error
  }
}
/**
 * @swagger
 * /api/webhooks/test/user-creation:
 *   post:
 *     summary: Test user creation webhook
 *     description: Test endpoint to simulate Authentik user creation for development
 *     tags: [Webhooks, Testing]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "test@example.com"
 *               first_name:
 *                 type: string
 *                 example: "Test"
 *               last_name:
 *                 type: string
 *                 example: "User"
 *               username:
 *                 type: string
 *                 example: "testuser"
 *     responses:
 *       200:
 *         description: Test user created successfully
 */
router.post('/test/user-creation', async (req, res) => {
  const requestId = (0, uuid_1.v4)().substring(0, 8)
  console.log(
    `🧪 [${requestId}] Test user creation webhook received:`,
    req.body
  )
  try {
    const { email, first_name, last_name, username } = req.body
    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }
    // Simulate Authentik webhook payload
    const mockUser = {
      id: (0, uuid_1.v4)(),
      email,
      first_name: first_name || 'Test',
      last_name: last_name || 'User',
      username: username || email,
      is_active: true,
    }
    const mockWebhook = {
      user: mockUser,
      event: 'user.created',
    }
    // Process as if it came from Authentik
    await handleUserCreated(requestId, mockUser.id, mockUser)
    res.json({
      status: 'success',
      message: 'Test user created successfully',
      user_id: mockUser.id,
      user: mockUser,
    })
  } catch (error) {
    console.error(`❌ [${requestId}] Test user creation error:`, error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
exports.default = router
//# sourceMappingURL=webhooks.js.map
