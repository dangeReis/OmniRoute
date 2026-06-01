// tests/unit/privacyShieldWal.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { PrivacyShieldWAL } from "../../src/lib/privacyShield/wal";
import { SessionManager } from "../../src/lib/privacyShield/session";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("write + read round-trip", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const key = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, key);
    const now = Date.now();
    wal.appendMapping("__PS_EMAIL_a1b2c3d4e5f6__", "secret@email.com", "EMAIL", now);
    
    const manager = new SessionManager();
    const readerWal = new PrivacyShieldWAL(filePath, key);
    readerWal.restore(manager);
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

test("reject decryption with wrong key", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "omniroute-wal-test-"));
  const filePath = join(tmpDir, "test.wal");
  const keyA = randomBytes(32);
  const keyB = randomBytes(32);
  
  try {
    const wal = new PrivacyShieldWAL(filePath, keyA);
    wal.appendMapping("__PS_EMAIL_a1b2c3d4e5f6__", "secret@email.com", "EMAIL", Date.now());
    
    const readerWal = new PrivacyShieldWAL(filePath, keyB);
    const manager = new SessionManager();
    assert.throws(() => {
      readerWal.restore(manager);
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
