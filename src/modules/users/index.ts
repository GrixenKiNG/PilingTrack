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
// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade during the services-to-modules migration
export type { UpdateUserInput } from '@/services/users/user-service';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  listUserDocuments,
  listUserDocumentTypes,
  listUserDocumentTypesForAdmin,
  listDocumentsNeedingAttention,
  getOperatorClearance,
  createUserDocument,
  updateUserDocument,
  deleteUserDocument,
  createUserDocumentType,
  updateUserDocumentType,
  deleteUserDocumentType,
} from '@/services/users/user-documents';
// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade during the services-to-modules migration
export type { UserDocumentInput, UserDocumentContext, UserDocumentTypeInput } from '@/services/users/user-documents';
// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade during the services-to-modules migration
export { evaluateOperatorClearance } from '@/services/users/operator-clearance';
// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade during the services-to-modules migration
export type { OperatorClearance, ClearanceIssue, ClearanceDocument } from '@/services/users/operator-clearance';
