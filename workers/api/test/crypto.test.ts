// FREE AI API HUB — crypto helper tests.

import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateUnifiedKey,
  maskKey,
  sha256Hex,
} from "../src/lib/crypto";
import { TEST_ENCRYPTION_KEY } from "./setup";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a provider key", async () => {
    const encrypted = await encryptSecret("sk-test-PLACEHOLDER-1234", TEST_ENCRYPTION_KEY);
    expect(encrypted.ciphertext).not.toContain("sk-test-PLACEHOLDER-1234");
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    const decrypted = await decryptSecret(encrypted, TEST_ENCRYPTION_KEY);
    expect(decrypted).toBe("sk-test-PLACEHOLDER-1234");
  });

  it("produces different ciphertext for the same plaintext (random IV)", async () => {
    const a = await encryptSecret("same-key", TEST_ENCRYPTION_KEY);
    const b = await encryptSecret("same-key", TEST_ENCRYPTION_KEY);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt with the wrong key", async () => {
    const encrypted = await encryptSecret("sk-test-PLACEHOLDER", TEST_ENCRYPTION_KEY);
    // A different valid 32-byte base64 key (different bytes).
    const otherKey = Buffer.from("another-test-key-0123456789abcdef", "utf8").toString("base64");
    await expect(decryptSecret(encrypted, otherKey)).rejects.toThrow();
  });

  it("rejects a malformed encryption key (not 32 bytes)", async () => {
    // Valid base64, but only 19 bytes — not the required 32.
    const shortKey = Buffer.from("short-key-19-bytes!", "utf8").toString("base64");
    await expect(encryptSecret("x", shortKey)).rejects.toThrow(/32 random bytes/);
  });
});

describe("maskKey", () => {
  it("shows the first 4 and last 4 characters", () => {
    expect(maskKey("sk-abcdef123456")).toBe("sk-a…3456");
    expect(maskKey("gemini-test-PLACEHOLDER-1234")).toBe("gemi…1234");
  });

  it("hides short keys entirely", () => {
    expect(maskKey("short")).toBe("****");
    expect(maskKey("")).toBe("****");
  });
});

describe("sha256Hex", () => {
  it("is deterministic and 64 hex chars", async () => {
    const a = await sha256Hex("hello");
    const b = await sha256Hex("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const c = await sha256Hex("hellp");
    expect(c).not.toBe(a);
  });
});

describe("generateUnifiedKey", () => {
  it("produces fai_live_ keys of the expected shape", () => {
    const key = generateUnifiedKey();
    expect(key).toMatch(/^fai_live_[A-Za-z0-9_-]{32}$/);
    expect(generateUnifiedKey()).not.toBe(key);
  });
});
