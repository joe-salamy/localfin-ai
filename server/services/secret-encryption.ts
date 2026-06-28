import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ENV_KEYS } from '../config/app.js';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const MIN_SECRET_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const secret = process.env[ENV_KEYS.localfinProviderSecret];
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('LOCALFIN_PROVIDER_SECRET not configured. Set it in .env before linking provider accounts.');
  }

  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
