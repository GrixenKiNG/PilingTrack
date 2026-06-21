/**
 * Users Module — DDD Bounded Context
 *
 * Re-exports from services layer during migration.
 * Future: Move to full DDD structure (domain/application/infrastructure).
 */

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  listAssignableUsers,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from '@/services/users/user-service';
export type { UpdateUserInput } from '@/services/users/user-service';
