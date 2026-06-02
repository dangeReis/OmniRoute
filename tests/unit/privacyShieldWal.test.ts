// tests/unit/privacyShieldWal.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { PrivacyShieldWAL } from "../../src/lib/privacyShield/wal";
import { SessionManager } from "../../src/lib/privacyShield/session";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("write + read round-trip", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const key = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, key);
    const now = Date.now();
    await wal.appendMapping("default", "__PS_EMAIL_a1b2c3d4e5f6__", "secret@email.com", "EMAIL", now);
    await wal.appendMapping("session-custom", "__PS_EMAIL_f6e5d4c3b2a1__", "custom@email.com", "EMAIL", now);
    
    const manager = new SessionManager();
    const readerWal = new PrivacyShieldWAL(filePath, key);
    await readerWal.restore(manager);

    // Assert the restored mapping, not just the absence of an exception
    const defaultSession = manager.getOrCreate("default");
    const restoredDefault = defaultSession.resolve("__PS_EMAIL_a1b2c3d4e5f6__");
    assert.equal(restoredDefault, "secret@email.com", "Default session mapping should be restored");

    const customSession = manager.getOrCreate("session-custom");
    const restoredCustom = customSession.resolve("__PS_EMAIL_f6e5d4c3b2a1__");
    assert.equal(restoredCustom, "custom@email.com", "Custom session mapping should be restored to correct sessionId");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fail-closed: refuses to init without encryption key", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  
  try {
    assert.throws(() => {
      new PrivacyShieldWAL(filePath, undefined as any);
    }, /encryption key/i);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skips decryption failures with wrong key and imports nothing", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const keyA = randomBytes(32);
  const keyB = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, keyA);
    await wal.appendMapping("default", "__PS_EMAIL_a1b2c3d4e5f6__", "secret@email.com", "EMAIL", Date.now());
    
    const readerWal = new PrivacyShieldWAL(filePath, keyB);
    const manager = new SessionManager();
    // Should complete successfully by skipping the line rather than throwing
    await readerWal.restore(manager);
    const defaultSession = manager.getOrCreate("default");
    assert.equal(defaultSession.resolve("__PS_EMAIL_a1b2c3d4e5f6__"), undefined);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skips corrupted lines and restores valid ones", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const key = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, key);
    const now = Date.now();
    await wal.appendMapping("default", "__PS_EMAIL_a1b2c3d4e5f6__", "valid@email.com", "EMAIL", now);
    
    // Manually append a corrupt non-decryptable line
    const { appendFileSync } = await import("node:fs");
    appendFileSync(filePath, "corrupted-line-that-cannot-be-decrypted\n");
    
    await wal.appendMapping("default", "__PS_EMAIL_f6e5d4c3b2a1__", "another@email.com", "EMAIL", now);
    
    const manager = new SessionManager();
    await wal.restore(manager);
    
    const session = manager.getOrCreate("default");
    assert.equal(session.resolve("__PS_EMAIL_a1b2c3d4e5f6__"), "valid@email.com");
    assert.equal(session.resolve("__PS_EMAIL_f6e5d4c3b2a1__"), "another@email.com");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("concurrent WAL operations are serialized", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const key = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, key);
    const now = Date.now();
    
    // Launch multiple appendMapping operations concurrently
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(wal.appendMapping("default", `__PS_EMAIL_${i.toString().padStart(12, "0")}__`, `user${i}@email.com`, "EMAIL", now));
    }
    
    // Also launch a compaction concurrently
    promises.push(wal.compact());
    
    await Promise.all(promises);
    
    const manager = new SessionManager();
    await wal.restore(manager);
    
    const session = manager.getOrCreate("default");
    // Verify that all mappings were safely written and loaded (no data loss)
    for (let i = 0; i < 20; i++) {
      assert.equal(session.resolve(`__PS_EMAIL_${i.toString().padStart(12, "0")}__`), `user${i}@email.com`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skips expired mappings on WAL restore", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const key = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, key);
    
    // Add one expired mapping (created more than 1 hour ago)
    const expiredTime = Date.now() - 3600 * 1000 - 5000;
    await wal.appendMapping("default", "__PS_EMAIL_expired1b2c3d4__", "expired@email.com", "EMAIL", expiredTime);
    
    // Add one valid mapping
    const now = Date.now();
    await wal.appendMapping("default", "__PS_EMAIL_valid1b2c3d4__", "valid@email.com", "EMAIL", now);
    
    const manager = new SessionManager();
    await wal.restore(manager);
    
    const session = manager.getOrCreate("default");
    assert.equal(session.resolve("__PS_EMAIL_expired1b2c3d4__"), undefined, "Expired mapping should be skipped");
    assert.equal(session.resolve("__PS_EMAIL_valid1b2c3d4__"), "valid@email.com", "Valid mapping should be loaded");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skips invalid createdAt mappings on WAL restore and compaction", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const key = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, key);
    
    // Add one invalid mapping (NaN createdAt)
    await wal.appendMapping("default", "__PS_EMAIL_invalid1b2c3d4__", "invalid@email.com", "EMAIL", NaN);
    
    // Add one valid mapping
    const now = Date.now();
    await wal.appendMapping("default", "__PS_EMAIL_valid1b2c3d4__", "valid@email.com", "EMAIL", now);
    
    // Verify restore skips invalid
    const manager = new SessionManager();
    await wal.restore(manager);
    
    const session = manager.getOrCreate("default");
    assert.equal(session.resolve("__PS_EMAIL_invalid1b2c3d4__"), undefined, "Invalid createdAt mapping should be skipped on restore");
    assert.equal(session.resolve("__PS_EMAIL_valid1b2c3d4__"), "valid@email.com", "Valid mapping should be loaded");
    
    // Verify compaction skips invalid
    await wal.compact();
    
    const manager2 = new SessionManager();
    const wal2 = new PrivacyShieldWAL(filePath, key);
    await wal2.restore(manager2);
    
    const session2 = manager2.getOrCreate("default");
    assert.equal(session2.resolve("__PS_EMAIL_invalid1b2c3d4__"), undefined, "Invalid createdAt mapping should be skipped after compaction");
    assert.equal(session2.resolve("__PS_EMAIL_valid1b2c3d4__"), "valid@email.com", "Valid mapping should still be loaded after compaction");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("preserves custom expiresAt / TTL mappings on WAL restore and compaction", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const key = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, key);
    
    // Add one mapping with explicit expiresAt in the future (longer than default 1h)
    const longExpiresAt = Date.now() + 12 * 3600 * 1000;
    await wal.appendMapping("default", "__PS_EMAIL_long1b2c3d4__", "long@email.com", "EMAIL", Date.now(), longExpiresAt);
    
    // Add one mapping with explicit expiresAt in the past (already expired)
    const shortExpiresAt = Date.now() - 5000;
    await wal.appendMapping("default", "__PS_EMAIL_short1b2c3d4__", "short@email.com", "EMAIL", Date.now() - 10000, shortExpiresAt);
    
    // Verify restore respects custom expiresAt
    const manager = new SessionManager();
    await wal.restore(manager);
    
    const session = manager.getOrCreate("default");
    assert.equal(session.resolve("__PS_EMAIL_long1b2c3d4__"), "long@email.com", "Custom long TTL mapping should be loaded");
    assert.equal(session.resolve("__PS_EMAIL_short1b2c3d4__"), undefined, "Custom short/expired TTL mapping should be skipped");
    
    // Verify compaction preserves custom expiresAt
    await wal.compact();
    
    const manager2 = new SessionManager();
    const wal2 = new PrivacyShieldWAL(filePath, key);
    await wal2.restore(manager2);
    
    const session2 = manager2.getOrCreate("default");
    assert.equal(session2.resolve("__PS_EMAIL_long1b2c3d4__"), "long@email.com", "Custom long TTL mapping should survive compaction");
    assert.equal(session2.resolve("__PS_EMAIL_short1b2c3d4__"), undefined, "Custom short/expired TTL mapping should not exist after compaction");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
