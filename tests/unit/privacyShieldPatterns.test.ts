// tests/unit/privacyShieldPatterns.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PATTERNS, DEFAULT_EXCLUDES, buildPatternSet } from "../../src/lib/privacyShield/patterns";

function testPattern(category: string, shouldMatch: string[], shouldNotMatch: string[]) {
  const pattern = BUILTIN_PATTERNS.find(p => p.category === category);
  assert.ok(pattern, `pattern ${category} should exist`);

  for (const input of shouldMatch) {
    pattern.regex.lastIndex = 0;
    assert.ok(pattern.regex.test(input), `${category} should match: ${input}`);
    if (pattern.postFilter) {
      assert.ok(pattern.postFilter(input), `${category} postFilter should pass: ${input}`);
    }
  }
  for (const input of shouldNotMatch) {
    pattern.regex.lastIndex = 0;
    const matchesRegex = pattern.regex.test(input);
    const passesFilter = matchesRegex && pattern.postFilter ? pattern.postFilter(input) : true;
    assert.ok(!matchesRegex || !passesFilter, `${category} should NOT match/pass: ${input}`);
  }
}

test("EMAIL pattern", () => {
  testPattern("EMAIL",
    ["user@example.com", "name.surname+tag@domain.co.uk"],
    ["not-an-email", "@", "user@", "@domain.com"]);
});

test("API_KEY pattern — rejects false positives", () => {
  testPattern("API_KEY",
    [
      "sk-abcdefghijklmnopqrstuvwxyz1234",
      "pk_live_abcdefghijklmnopqrstuvwx",
      "sk-proj-abcdefghijklmnopqrstuvwxyz1234",
      "sk-svcacct-abcdefghijklmnopqrstuvwxyz1234"
    ],
    ["token_refresh_handler_abc123", "api_key_rotation_manager", "my_token_value"]);
});

test("SSN pattern", () => {
  testPattern("SSN",
    ["666-23-4567", "123-45-6789"],
    ["000-12-3456", "123-00-6789", "123-45-0000", "987654321"]);
});

test("CREDIT_CARD pattern", () => {
  testPattern("CREDIT_CARD",
    ["4532 7150 7824 9218", "1234-5678-1234-5670"],
    ["1234-5678-1234-5678", "abc", "1234567890"]);
});

test("PHONE_US pattern", () => {
  testPattern("PHONE_US",
    ["+1-555-555-5555", "(555) 555-5555", "5555555555"],
    ["12345", "not-a-phone"]);
});

test("PHONE_BR pattern", () => {
  testPattern("PHONE_BR",
    ["+55 (11) 99999-9999", "11 9999-9999"],
    ["1234", "not-a-phone"]);
});

test("IPV4 pattern", () => {
  testPattern("IPV4",
    ["127.0.0.1", "192.168.1.1"],
    ["999.999.999.999", "not-an-ip"]);
});

test("AWS_KEY pattern", () => {
  testPattern("AWS_KEY",
    ["AKIAIOSFODNN7EXAMPLE"],
    ["akiaiosfodnn7example", "AKIA123"]);
});

test("GITHUB_TOKEN pattern", () => {
  testPattern("GITHUB_TOKEN",
    ["ghp_1234567890abcdefghijklmnopqrstuvwxyz"],
    ["ghp_short", "not_a_github_token"]);
});

test("UUID pattern", () => {
  testPattern("UUID",
    ["123e4567-e89b-12d3-a456-426614174000"],
    ["123e4567-e89b-12d3-a456", "not-a-uuid"]);
});

test("JWT pattern", () => {
  testPattern("JWT",
    ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"],
    ["eyJhbGci.eyJzdWIi", "not-a-jwt"]);
});

test("PRIVATE_KEY pattern", () => {
  testPattern("PRIVATE_KEY",
    ["-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----"],
    ["-----BEGIN PUBLIC KEY-----", "private-key"]);
});

test("BEARER_TOKEN pattern", () => {
  testPattern("BEARER_TOKEN",
    ["Bearer abcdefghijklmnopqrstuvwxyz123456"],
    ["Bearer short", "bearer"]);
});

test("CPF pattern", () => {
  testPattern("CPF",
    ["123.456.789-01"],
    ["12345678901", "123-456-789-01"]);
});

test("CNPJ pattern", () => {
  testPattern("CNPJ",
    ["12.345.678/0001-90"],
    ["12345678000190"]);
});

test("MAC pattern", () => {
  testPattern("MAC",
    ["01:23:45:67:89:ab", "AB:CD:EF:01:23:45"],
    ["01:23:45:67:89", "not-a-mac"]);
});

test("buildPatternSet merges patterns and excludes correctly", () => {
  const custom: any[] = [{ name: "custom_rule", category: "CUSTOM", regex: /custom_pattern/ }];
  const excludes: any[] = [{ value: "exclude_val", match: "exact" }];
  
  const set = buildPatternSet(BUILTIN_PATTERNS, custom, excludes);
  assert.ok(set.patterns.some(p => p.category === "CUSTOM"));
  assert.ok(set.excludes.some(e => e.value === "exclude_val"));
});
