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

test("reject decryption with wrong key", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const keyA = randomBytes(32);
  const keyB = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, keyA);
    await wal.appendMapping("default", "__PS_EMAIL_a1b2c3d4e5f6__", "secret@email.com", "EMAIL", Date.now());
    
    const readerWal = new PrivacyShieldWAL(filePath, keyB);
    const manager = new SessionManager();
    await assert.rejects(async () => {
      await readerWal.restore(manager);
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
