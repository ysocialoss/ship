import { type Algorithm, hash, parseOptions, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet: Argon2id, m=19 MiB, t=2, p=1 (minimum).
const OPTIONS = {
  algorithm: 2 as Algorithm, // Argon2id (a const enum, inlined so Node's type stripping can run it)
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** NIST SP 800-63B: normalize Unicode so the same password typed on different devices matches. */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export function hashPassword(password: string): Promise<string> {
  return hash(normalizePassword(password), OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, normalizePassword(password));
  } catch {
    return false;
  }
}

export function needsRehash(passwordHash: string): boolean {
  try {
    const p = parseOptions(passwordHash);
    return (
      p.algorithm !== OPTIONS.algorithm ||
      p.memoryCost < OPTIONS.memoryCost ||
      p.timeCost < OPTIONS.timeCost ||
      p.parallelism !== OPTIONS.parallelism
    );
  } catch {
    return true;
  }
}

// Verified against when the username does not exist, so response time does not
// reveal whether an account exists.
const dummyHash = hashPassword('dummy-password-for-timing-equalization');

export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(await dummyHash, password);
}
