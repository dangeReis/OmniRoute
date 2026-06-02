// tests/unit/privacyShieldStreamingRestorer.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { StreamingRestorer } from "../../src/lib/privacyShield/streamingRestorer";
import { PlaceholderSession } from "../../src/lib/privacyShield/session";

test("restores complete placeholder in single push", () => {
  const session = new PlaceholderSession();
  const placeholder = session.getOrCreatePlaceholder("secret@email.com", "EMAIL");
  const restorer = new StreamingRestorer(session);

  const output = restorer.push(`hello ${placeholder} world`);
  const flushed = restorer.flush();

  const combined = output + flushed;
  assert.ok(combined.includes("secret@email.com"), "should restore original");
  assert.ok(!combined.includes("__PS_"), "should not contain placeholder prefix");
});

test("restores placeholder split across character-by-character pushes", () => {
  const session = new PlaceholderSession();
  const placeholder = session.getOrCreatePlaceholder("secret@email.com", "EMAIL");
  const restorer = new StreamingRestorer(session);

  let accumulated = "";
  for (const char of `text ${placeholder} end`) {
    accumulated += restorer.push(char);
  }
  accumulated += restorer.flush();

  assert.ok(accumulated.includes("secret@email.com"));
  assert.ok(accumulated.includes("text "));
  assert.ok(accumulated.includes(" end"));
  assert.ok(!accumulated.includes("__PS_"));
});

test("emits safe prefix immediately", () => {
  const session = new PlaceholderSession();
  const restorer = new StreamingRestorer(session);

  const output1 = restorer.push("hello world ");
  assert.equal(output1, "hello world ", "safe text should emit immediately");
});

test("safety valve: stray __PS_ in prose doesn't hold buffer forever", () => {
  const session = new PlaceholderSession();
  const restorer = new StreamingRestorer(session);

  let output = "";
  const fakePrefix = "__PS_this_is_not_a_valid_placeholder_and_is_way_too_long_to_be_one";
  for (const char of fakePrefix) {
    output += restorer.push(char);
  }
  output += restorer.flush();

  assert.equal(output, fakePrefix, "stray prefix should be released after safety valve");
});

test("bare-prefix placeholder is restored", () => {
  const session = new PlaceholderSession();
  const placeholder = session.getOrCreatePlaceholder("secret@email.com", "EMAIL");
  const restorer = new StreamingRestorer(session);

  const barePrefix = placeholder.replace(/^__/, "");
  const output = restorer.push(`check ${barePrefix} ok`);
  const flushed = restorer.flush();

  const combined = output + flushed;
  assert.ok(combined.includes("secret@email.com"), "should restore from bare prefix");
});

test("unknown placeholder passes through unchanged", () => {
  const session = new PlaceholderSession();
  const restorer = new StreamingRestorer(session);

  const unknown = "__PS_EMAIL_000000000000__";
  const output = restorer.push(`text ${unknown} end`);
  const flushed = restorer.flush();

  const combined = output + flushed;
  assert.ok(combined.includes(unknown), "unknown placeholder should pass through");
});

test("partialRegex does not match empty string at the end of safe text", () => {
  const session = new PlaceholderSession();
  const restorer = new StreamingRestorer(session);
  
  const partialRegex = (restorer as any).partialRegex;
  const match = partialRegex.exec("hello world this is safe text");
  assert.equal(match, null, "should not match empty string at the end of safe text");
});

test("createRestoringTransform forwards options to StreamingRestorer", async () => {
  const { createRestoringTransform } = await import("../../src/lib/privacyShield/streamingRestorer");
  const session = new PlaceholderSession();
  
  // Email contains a raw newline (multi-line secret)
  const email = "john\nsecret@example.com";
  const p = session.getOrCreatePlaceholder(email, "EMAIL");
  
  // Set escapeForJson: true
  const transform = createRestoringTransform(session, { escapeForJson: true });
  
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  
  const writePromise = (async () => {
    await writer.write(new TextEncoder().encode(`{"email":"${p}"}`));
    await writer.close();
  })();
  
  const chunks: string[] = [];
  let res = await reader.read();
  while (!res.done) {
    chunks.push(new TextDecoder().decode(res.value));
    res = await reader.read();
  }
  
  await writePromise;
  
  const output = chunks.join("");
  // Newline should be escaped as \n
  assert.ok(output.includes("john\\nsecret@example.com"), "newline should be JSON-escaped in the output");
});
