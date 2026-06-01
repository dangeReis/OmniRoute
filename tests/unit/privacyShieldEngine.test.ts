// tests/unit/privacyShieldEngine.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { redactText } from "../../src/lib/privacyShield/engine";
import { BUILTIN_PATTERNS } from "../../src/lib/privacyShield/patterns";
import { PlaceholderSession } from "../../src/lib/privacyShield/session";

test("redacts email in plain text", () => {
  const session = new PlaceholderSession();
  const emailPattern = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");
  const input = "send mail to john@example.com now";
  
  const result = redactText(input, emailPattern, [], session);
  assert.ok(result.text.includes("__PS_EMAIL_"), "should contain placeholder");
  assert.ok(!result.text.includes("john@example.com"), "should mask email");
});

test("returns match metadata", () => {
  const session = new PlaceholderSession();
  const emailPattern = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");
  const input = "send mail to john@example.com now";
  
  const result = redactText(input, emailPattern, [], session);
  assert.equal(result.matches.length, 1);
  const m = result.matches[0];
  assert.equal(m.original, "john@example.com");
  assert.equal(m.category, "EMAIL");
  assert.ok(result.text.includes(m.placeholder));
});

test("overlapping patterns: email inside URL", () => {
  const session = new PlaceholderSession();
  const patterns = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL" || p.category === "IPV4");
  const input = "check http://127.0.0.1/email?addr=john@example.com";
  
  const result = redactText(input, patterns, [], session);
  assert.ok(result.text.includes("__PS_IPV4_"), "should redact IP");
  assert.ok(result.text.includes("__PS_EMAIL_"), "should redact email");
});

test("right-to-left replacement preserves indices", () => {
  const session = new PlaceholderSession();
  const emailPattern = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");
  const input = "email a@b.com and c@d.com";
  
  const result = redactText(input, emailPattern, [], session);
  assert.ok(!result.text.includes("a@b.com"));
  assert.ok(!result.text.includes("c@d.com"));
});

test("excludes default entries", () => {
  const session = new PlaceholderSession();
  const patterns = BUILTIN_PATTERNS.filter(p => p.category === "IPV4");
  const input = "connect to 127.0.0.1 local";
  const excludes = [{ value: "127.0.0.1", match: "exact" as const }];
  
  const result = redactText(input, patterns, excludes, session);
  assert.equal(result.text, input, "excluded IP should not be redacted");
});

test("empty input returns empty", () => {
  const session = new PlaceholderSession();
  const result = redactText("", BUILTIN_PATTERNS, [], session);
  assert.equal(result.text, "");
  assert.equal(result.matches.length, 0);
});

test("no matches returns original", () => {
  const session = new PlaceholderSession();
  const result = redactText("hello world", BUILTIN_PATTERNS, [], session);
  assert.equal(result.text, "hello world");
  assert.equal(result.matches.length, 0);
});

test("same original gets same placeholder", () => {
  const session = new PlaceholderSession();
  const emailPattern = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");
  const input = "my email is john@example.com, and again: john@example.com";
  
  const result = redactText(input, emailPattern, [], session);
  const occurrences = result.text.match(/__PS_EMAIL_[a-f0-9]{12}__/g);
  assert.ok(occurrences);
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0], occurrences[1], "both placeholders should be identical");
});
