/**
 * Users Module — DDD Bounded Context
 *
 * Re-exports from services layer during migration.
 * Future: Move to full DDD structure (domain/application/infrastructure).
 */

export {
  listAssignableUsers,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from '@/services/users/user-service';
