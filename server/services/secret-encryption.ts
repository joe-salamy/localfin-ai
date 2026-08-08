import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { ENV_KEYS } from "../config/app.js";
import { getDb } from "../db/index.js";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

const CIPHER_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const MIN_SECRET_LENGTH = 32;
const SALT_KEY = "provider_secret_salt";

function getOrCreateSalt(db: ReturnType<typeof getDb>): Buffer {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(SALT_KEY) as { value: string } | undefined;
  if (row) return Buffer.from(row.value, "base64");

  const salt = randomBytes(16);
  db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)").run(
    SALT_KEY,
    salt.toString("base64"),
  );
  return salt;
}

function requireSecret(): string {
  const secret = process.env[ENV_KEYS.localfinProviderSecret];
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      "LOCALFIN_PROVIDER_SECRET not configured. Set it in .env before linking provider accounts.",
    );
  }
  return secret;
}

/**
 * Key derivation with a work factor (scrypt) and a per-install random salt
 * persisted in the database, so a leaked database cannot be brute-forced
 * offline with a fast hash.
 */
function getEncryptionKey(): Buffer {
  return scryptSync(requireSecret(), getOrCreateSalt(getDb()), 32);
}

/**
 * Legacy key derivation (plain SHA-256, no salt) used only to decrypt
 * credentials written before the scrypt migration.
 */
function getLegacyEncryptionKey(): Buffer {
  return createHash("sha256").update(requireSecret()).digest();
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function decryptWithKey(
  key: Buffer,
  secret: EncryptedSecret,
): string | null {
  try {
    const decipher = createDecipheriv(
      CIPHER_ALGORITHM,
      key,
      Buffer.from(secret.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Decrypts with the current KDF, falling back to the legacy SHA-256 KDF for
 * credentials stored before the migration. `migrated` tells the caller the
 * plaintext should be re-encrypted with the current KDF.
 */
export function decryptSecretWithMigration(
  secret: EncryptedSecret,
): { plaintext: string; migrated: boolean } {
  const current = decryptWithKey(getEncryptionKey(), secret);
  if (current !== null) return { plaintext: current, migrated: false };

  const legacy = decryptWithKey(getLegacyEncryptionKey(), secret);
  if (legacy !== null) return { plaintext: legacy, migrated: true };

  throw new Error(
    "Provider credentials could not be decrypted; restore the original LOCALFIN_PROVIDER_SECRET or reconnect the account.",
  );
}
