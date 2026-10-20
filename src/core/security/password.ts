import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(value: string): Promise<string> {
  return bcryptHash(value, BCRYPT_ROUNDS);
}

export async function verifyPassword(value: string, hash: string): Promise<boolean> {
  return bcryptCompare(value, hash);
}
