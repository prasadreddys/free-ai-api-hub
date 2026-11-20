// FREE AI API HUB — cryptography (WebCrypto only, no dependencies).
// Provider keys are encrypted with AES-256-GCM; unified keys are stored as
// SHA-256 hashes; admin passwords use PBKDF2; admin sessions are HMAC tokens.
// Original code for this project.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex digest (used for unified-key lookup). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison (avoids early-exit timing leaks). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyB64);
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 random bytes, base64-encoded");
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64 (16 bytes, split off the WebCrypto output)
}

/** AES-256-GCM encrypt. Returns ciphertext, IV, and auth tag separately. */
export async function encryptSecret(
  plaintext: string,
  keyB64: string,
): Promise<EncryptedValue> {
  const key = await importAesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    textEncoder.encode(plaintext),
  );
  const bytes = new Uint8Array(sealed);
  // WebCrypto appends the 16-byte auth tag to the ciphertext.
  const tag = bytes.slice(bytes.length - 16);
  const ciphertext = bytes.slice(0, bytes.length - 16);
  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    tag: toBase64(tag),
  };
}

/** AES-256-GCM decrypt. Throws on tampering or a wrong key. */
export async function decryptSecret(
  value: EncryptedValue,
  keyB64: string,
): Promise<string> {
  const key = await importAesKey(keyB64);
  const ciphertext = fromBase64(value.ciphertext);
  const tag = fromBase64(value.tag);
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(value.iv) as BufferSource },
    key,
    sealed as BufferSource,
  );
  return textDecoder.decode(plain);
}

/** Generate a new unified gateway key: `fai_live_` + 32 random chars. */
export function generateUnifiedKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `fai_live_${toBase64Url(bytes)}`;
}

/** Mask a key for display: first 4 + last 4, the rest hidden. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Admin passwords (PBKDF2-SHA256; scrypt is not available in WebCrypto)
// Stored format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  const salt = fromBase64(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return timingSafeEqual(toBase64(new Uint8Array(bits)), expected);
}

// ---------------------------------------------------------------------------
// Admin session tokens (stateless HMAC, 24 h expiry)
// Format: base64url(userId + "." + expiryEpoch + "." + hmacHex)
// ---------------------------------------------------------------------------

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds = 86_400,
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${expiry}`;
  const sig = await hmacHex(secret, payload);
  return toBase64Url(textEncoder.encode(`${payload}.${sig}`));
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<{ userId: string } | null> {
  try {
    const decoded = textDecoder.decode(
      Uint8Array.from(atob(token.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      ),
    );
    const [userId, expiryStr, sig] = decoded.split(".");
    if (!userId || !expiryStr || !sig) return null;
    const expiry = Number.parseInt(expiryStr, 10);
    if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
    const expected = await hmacHex(secret, `${userId}.${expiry}`);
    return timingSafeEqual(sig, expected) ? { userId } : null;
  } catch {
    return null;
  }
}

/** Generate a random base64 secret (for ENCRYPTION_KEY / SESSION_SECRET). */
export function generateSecretBase64(bytes = 32): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes)));
}
