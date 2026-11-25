import { randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { env } from '../env.ts';
import { decrypt, encrypt, sha256 } from './crypto.ts';

const PERIOD = 30;
const aad = (userId: string) => `totp:${userId}`;

function build(secretBase32: string, username = '') {
  return new OTPAuth.TOTP({
    issuer: env.TOTP_ISSUER,
    label: username,
    algorithm: 'SHA1', // What virtually every authenticator app supports.
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** Creates a new 160-bit secret (RFC 4226 recommendation), encrypted for storage. */
export function createTotpSecret(userId: string, username: string) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return {
    secret,
    encrypted: encrypt(secret, aad(userId)),
    uri: build(secret, username).toString(),
  };
}

/**
 * Returns the matched time step, or null if the code is invalid. Accepts ±1 step for
 * clock drift and rejects any step at or before `lastUsedStep`, so each code works once.
 */
export function verifyTotp(
  encryptedSecret: string,
  userId: string,
  code: string,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const totp = build(decrypt(encryptedSecret, aad(userId)));
  const now = Date.now();
  const delta = totp.validate({ token: code, timestamp: now, window: 1, afterCounter: lastUsedStep });
  if (delta === null) return null;
  return Math.floor(now / 1000 / PERIOD) + delta;
}

// Alphabet without ambiguous characters (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;

/** 10 codes of 10 characters (~49 bits each), formatted XXXXX-XXXXX. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/** Recovery codes are high-entropy random strings, so a fast hash is sufficient. */
export function hashRecoveryCode(code: string): string {
  return sha256(normalizeRecoveryCode(code));
}
