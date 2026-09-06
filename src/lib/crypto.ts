import crypto from 'node:crypto';
import { env } from '../config/env.js';

function getKey(): Buffer {
  if (!env.CONNECTION_ENCRYPTION_KEY) {
    throw new Error('CONNECTION_ENCRYPTION_KEY is required for storing provider credentials.');
  }
  const key = Buffer.from(env.CONNECTION_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('CONNECTION_ENCRYPTION_KEY must decode to 32 bytes.');
  return key;
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

export function decryptJson<T>(payload: string): T {
  const [ivB64, tagB64, cipherB64] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(cipherB64, 'base64url')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
