/**
 * Users Module — публичный вход. Реализация лежит рядом в этой папке.
 */

export {
  listAssignableUsers,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from './user-service';
export type { UpdateUserInput } from './user-service';

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
} from './user-documents';
export type { UserDocumentInput, UserDocumentContext, UserDocumentTypeInput } from './user-documents';
export { evaluateOperatorClearance } from './operator-clearance';
export type { OperatorClearance, ClearanceIssue, ClearanceDocument } from './operator-clearance';
