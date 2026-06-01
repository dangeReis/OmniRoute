// tests/unit/privacyShieldRestore.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { restoreText, restoreDeep, redactDeep } from "../../src/lib/privacyShield/restore";
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
