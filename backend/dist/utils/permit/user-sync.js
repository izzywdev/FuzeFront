'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.syncUserToPermit = syncUserToPermit
exports.deleteUserFromPermit = deleteUserFromPermit
exports.getUserFromPermit = getUserFromPermit
exports.updateUserInPermit = updateUserInPermit
const permit_1 = __importDefault(require('../../config/permit'))
/**
 * Syncs a user to Permit.io
 */
async function syncUserToPermit(user) {
  var _a, _b
  try {
    const permitUser = {
      key: user.id,
      email: user.email,
      first_name:
        user.firstName ||
        ((_a = user.username) === null || _a === void 0
          ? void 0
          : _a.split(' ')[0]) ||
        user.email.split('@')[0],
      last_name:
        user.lastName ||
        ((_b = user.username) === null || _b === void 0
          ? void 0
          : _b.split(' ').slice(1).join(' ')) ||
        '',
      attributes: {
        created_at: user.created_at,
        updated_at: user.updated_at,
        roles: user.roles,
      },
    }
    await permit_1.default.api.users.sync(permitUser)
    console.log(`User ${user.id} synced to Permit.io successfully`)
    return true
  } catch (error) {
    console.error(`Error syncing user ${user.id} to Permit.io:`, error)
    return false
  }
}
/**
 * Deletes a user from Permit.io
 */
async function deleteUserFromPermit(userId) {
  try {
    await permit_1.default.api.users.delete(userId)
    console.log(`User ${userId} deleted from Permit.io successfully`)
    return true
  } catch (error) {
    console.error(`Error deleting user ${userId} from Permit.io:`, error)
    return false
  }
}
/**
 * Gets user data from Permit.io
 */
async function getUserFromPermit(userId) {
  try {
    const user = await permit_1.default.api.users.get(userId)
    return user
  } catch (error) {
    console.error(`Error getting user ${userId} from Permit.io:`, error)
    return null
  }
}
/**
 * Updates user attributes in Permit.io
 */
async function updateUserInPermit(userId, updates) {
  try {
    await permit_1.default.api.users.update(userId, updates)
    console.log(`User ${userId} updated in Permit.io successfully`)
    return true
  } catch (error) {
    console.error(`Error updating user ${userId} in Permit.io:`, error)
    return false
  }
}
//# sourceMappingURL=user-sync.js.map
