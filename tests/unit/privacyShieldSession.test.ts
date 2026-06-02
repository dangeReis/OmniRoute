// tests/unit/privacyShieldSession.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { PlaceholderSession, SessionManager, getPlaceholderRegex } from "../../src/lib/privacyShield/session";

test("same original produces same placeholder within a session", () => {
  const session = new PlaceholderSession();
  const p1 = session.getOrCreatePlaceholder("test@email.com", "EMAIL");
  const p2 = session.getOrCreatePlaceholder("test@email.com", "EMAIL");
  assert.equal(p1, p2);
});

test("different originals produce different placeholders", () => {
  const session = new PlaceholderSession();
  const p1 = session.getOrCreatePlaceholder("test1@email.com", "EMAIL");
  const p2 = session.getOrCreatePlaceholder("test2@email.com", "EMAIL");
  assert.notEqual(p1, p2);
});

test("placeholder matches expected format", () => {
  const session = new PlaceholderSession();
  const p = session.getOrCreatePlaceholder("test@email.com", "EMAIL");
  const regex = /__PS_EMAIL_[a-f0-9]{12}(?:_\d+)?__/;
  assert.ok(regex.test(p), `placeholder '${p}' did not match format`);
});

test("resolve returns original for known placeholder", () => {
  const session = new PlaceholderSession();
  const original = "test@email.com";
  const p = session.getOrCreatePlaceholder(original, "EMAIL");
  assert.equal(session.resolve(p), original);
});

test("resolve returns undefined for unknown placeholder", () => {
  const session = new PlaceholderSession();
  assert.equal(session.resolve("__PS_EMAIL_deadbeef1234__"), undefined);
});

test("touch-on-access resets TTL", async () => {
  const session = new PlaceholderSession({ ttlMs: 100 });
  const p = session.getOrCreatePlaceholder("secret", "EMAIL");
  
  await new Promise(r => setTimeout(r, 60));
  assert.equal(session.resolve(p), "secret");
  
  await new Promise(r => setTimeout(r, 60));
  assert.equal(session.resolve(p), "secret");
  
  await new Promise(r => setTimeout(r, 120));
  assert.equal(session.resolve(p), undefined);
});

test("LRU eviction at maxMappings", () => {
  const session = new PlaceholderSession({ maxMappings: 2 });
  const p1 = session.getOrCreatePlaceholder("first", "EMAIL");
  const p2 = session.getOrCreatePlaceholder("second", "EMAIL");
  
  session.resolve(p1);
  
  const p3 = session.getOrCreatePlaceholder("third", "EMAIL");
  
  assert.equal(session.resolve(p1), "first");
  assert.equal(session.resolve(p3), "third");
  assert.equal(session.resolve(p2), undefined);
});

test("SessionManager.getOrCreate returns same session for same ID", () => {
  const manager = new SessionManager();
  const s1 = manager.getOrCreate("session-1");
  const s2 = manager.getOrCreate("session-1");
  assert.equal(s1, s2);
});

test("SessionManager.getOrCreate returns different session for different ID", () => {
  const manager = new SessionManager();
  const s1 = manager.getOrCreate("session-1");
  const s2 = manager.getOrCreate("session-2");
  assert.notEqual(s1, s2);
});

test("SessionManager LRU eviction at maxSessions", () => {
  const manager = new SessionManager({ maxSessions: 2 });
  const s1 = manager.getOrCreate("session-1");
  const s2 = manager.getOrCreate("session-2");
  
  manager.getOrCreate("session-1");
  manager.getOrCreate("session-3");
  
  const newS2 = manager.getOrCreate("session-2");
  assert.notEqual(newS2, s2);
});

test("getPlaceholderRegex matches canonical placeholder", () => {
  const regex = getPlaceholderRegex("__PS_");
  assert.ok(regex.test("__PS_EMAIL_a1b2c3d4e5f6__"));
  assert.ok(regex.test("__PS_EMAIL_a1b2c3d4e5f6_1__"));
});

test("getPlaceholderRegex matches bare-prefix placeholder", () => {
  const regex = getPlaceholderRegex("__PS_");
  assert.ok(regex.test("PS_EMAIL_a1b2c3d4e5f6__"));
  assert.ok(regex.test("PS_EMAIL_a1b2c3d4e5f6_2__"));
});

test("getPlaceholderRegex does not match random text", () => {
  const regex = getPlaceholderRegex("__PS_");
  assert.ok(!regex.test("hello world"));
  assert.ok(!regex.test("__PS_EMAIL__"));
});

test("different categories produce different placeholders for same original", () => {
  const session = new PlaceholderSession();
  const p1 = session.getOrCreatePlaceholder("shared-secret", "EMAIL");
  const p2 = session.getOrCreatePlaceholder("shared-secret", "PHONE");
  assert.notEqual(p1, p2, "Same original value with different categories should produce unique placeholders");
  
  assert.equal(session.resolve(p1), "shared-secret");
  assert.equal(session.resolve(p2), "shared-secret");
});

test("custom prefix with regex special characters matches literally", () => {
  const session = new PlaceholderSession({ prefix: "__PS+__" });
  const p = session.getOrCreatePlaceholder("secret", "EMAIL");
  assert.ok(p.startsWith("__PS+__EMAIL_"));

  const regex = getPlaceholderRegex(session.prefix);
  assert.ok(regex.test(p), "Regex should match the custom prefix placeholder");
  assert.ok(!regex.test("__PS_EMAIL_a1b2c3d4e5f6__"), "Regex should not match default prefix when configured with custom prefix");
});
