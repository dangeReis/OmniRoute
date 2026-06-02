// tests/unit/privacyShieldRestore.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { restoreText, restoreDeep, redactDeep } from "../../src/lib/privacyShield/restore";
import { redactText } from "../../src/lib/privacyShield/engine";
import { PlaceholderSession } from "../../src/lib/privacyShield/session";
import { BUILTIN_PATTERNS } from "../../src/lib/privacyShield/patterns";

test("restoreText round-trips with redactText", () => {
  const session = new PlaceholderSession();
  const email = "john@example.com";
  const p = session.getOrCreatePlaceholder(email, "EMAIL");
  
  const text = `hello ${p} world`;
  const restored = restoreText(text, session);
  assert.equal(restored, "hello john@example.com world");
});

test("restoreDeep handles nested objects", () => {
  const session = new PlaceholderSession();
  const email = "john@example.com";
  const p = session.getOrCreatePlaceholder(email, "EMAIL");
  
  const obj = {
    user: {
      details: {
        contact: `email: ${p}`
      }
    }
  };
  
  restoreDeep(obj, session);
  assert.equal(obj.user.details.contact, "email: john@example.com");
});

test("restoreDeep handles arrays", () => {
  const session = new PlaceholderSession();
  const email = "john@example.com";
  const p = session.getOrCreatePlaceholder(email, "EMAIL");
  
  const arr = [`hello ${p}`, { item: p }];
  restoreDeep(arr, session);
  assert.equal(arr[0], "hello john@example.com");
  assert.equal((arr[1] as any).item, "john@example.com");
});

test("restoreDeep handles circular references without infinite loop", () => {
  const session = new PlaceholderSession();
  const email = "john@example.com";
  const p = session.getOrCreatePlaceholder(email, "EMAIL");
  
  const obj: any = { contact: p };
  obj.self = obj;
  
  restoreDeep(obj, session);
  assert.equal(obj.contact, "john@example.com");
});

test("redactDeep masks all string values", () => {
  const session = new PlaceholderSession();
  const emailPatterns = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");
  
  const obj = {
    messages: [
      { role: "user", content: "hi john@example.com" },
      { role: "assistant", content: "ok contact at john@example.com" }
    ]
  };
  
  redactDeep(obj, emailPatterns, [], session);
  assert.ok(obj.messages[0].content.includes("__PS_EMAIL_"));
  assert.ok(!obj.messages[0].content.includes("john@example.com"));
  assert.ok(obj.messages[1].content.includes("__PS_EMAIL_"));
  assert.ok(!obj.messages[1].content.includes("john@example.com"));
});

test("unknown placeholder left as-is", () => {
  const session = new PlaceholderSession();
  const unknown = "__PS_EMAIL_000000000000__";
  const input = `hello ${unknown} world`;
  const restored = restoreText(input, session);
  assert.equal(restored, input);
});

test("restoreText handles custom session prefix", () => {
  const session = new PlaceholderSession({ prefix: "__TENANT_" });
  const email = "custom@tenant.com";
  const p = session.getOrCreatePlaceholder(email, "EMAIL");
  
  assert.match(p, /^__TENANT_EMAIL_/);
  const text = `send to ${p}`;
  const restored = restoreText(text, session);
  assert.equal(restored, "send to custom@tenant.com");
});

test("redactText handles custom patterns without global flag", () => {
  const session = new PlaceholderSession();
  const patterns = [{ name: "SECRET", category: "SECRET", regex: /secret/ }];
  const input = "secret one and secret two";
  const result = redactText(input, patterns, [], session);
  
  // Verify that all occurrences are redacted and we did not hang/infinite-loop
  const occurrences = result.text.match(/__PS_SECRET_[a-f0-9]{16}__/g);
  assert.ok(occurrences);
  assert.equal(occurrences.length, 2);
});

test("restoreDeep and redactDeep support Maps (including keys) and Sets", () => {
  const session = new PlaceholderSession();
  const emailPatterns = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");

  const map = new Map<any, any>([
    ["user@example.com", "contact user@example.com"],
    ["regular-key", "some-value"]
  ]);
  const set = new Set<any>(["user@example.com", "other-val"]);

  const wrapper = { map, set };

  redactDeep(wrapper, emailPatterns, [], session);

  // Verify redaction in Map keys and values
  const redactedKeys = Array.from(map.keys());
  const emailKey = redactedKeys.find(k => k.includes("__PS_EMAIL_"));
  assert.ok(emailKey, "should find redacted email key");
  assert.ok(map.get(emailKey).includes("__PS_EMAIL_"), "value should also be redacted");

  // Verify redaction in Set
  const redactedSet = Array.from(set);
  const emailSetItem = redactedSet.find(item => item.includes("__PS_EMAIL_"));
  assert.ok(emailSetItem, "Set should contain redacted email");

  restoreDeep(wrapper, session);

  // Verify restoration in Map keys and values
  assert.ok(map.has("user@example.com"));
  assert.equal(map.get("user@example.com"), "contact user@example.com");

  // Verify restoration in Set
  assert.ok(set.has("user@example.com"));
});

test("redactDeep throws on Map key collision", () => {
  const session = new PlaceholderSession();
  const emailPatterns = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");

  // We set up a map where two different email keys would redact to different placeholders,
  // but if one of them is already the target placeholder, a collision will occur.
  const email1 = "user1@example.com";
  const placeholder1 = session.getOrCreatePlaceholder(email1, "EMAIL");

  const map = new Map<any, any>([
    [email1, "val1"],
    [placeholder1, "val2"] // Already exists as the placeholder
  ]);

  assert.throws(() => {
    redactDeep(map, emailPatterns, [], session);
  }, /Map key collision during redact/);
});

test("restoreDeep throws on Map key collision", () => {
  const session = new PlaceholderSession();
  const email = "user@example.com";
  const placeholder = session.getOrCreatePlaceholder(email, "EMAIL");

  const map = new Map<any, any>([
    [placeholder, "val1"],
    [email, "val2"] // Target key already exists in the map
  ]);

  assert.throws(() => {
    restoreDeep(map, session);
  }, /Map key collision during restore/);
});

test("redactDeep and restoreDeep skip Buffer and TypedArray instances", () => {
  const session = new PlaceholderSession();
  const emailPatterns = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");

  const buffer = Buffer.from("this is a test email: user@example.com");
  const typedArray = new Uint8Array([71, 101, 109, 105, 110, 105]); // "Gemini"

  const obj = {
    buffer,
    typedArray,
    email: "user@example.com"
  };

  // redactDeep should ignore the buffer and typed array contents (so they are not converted to placeholders)
  redactDeep(obj, emailPatterns, [], session);
  assert.equal(obj.buffer, buffer);
  assert.equal(obj.typedArray, typedArray);
  assert.ok(obj.email.includes("__PS_EMAIL_"));

  // restoreDeep should also skip them
  restoreDeep(obj, session);
  assert.equal(obj.buffer, buffer);
  assert.equal(obj.typedArray, typedArray);
  assert.equal(obj.email, "user@example.com");
});


