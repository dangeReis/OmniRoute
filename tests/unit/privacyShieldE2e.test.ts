// tests/unit/privacyShieldE2e.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { PlaceholderSession } from "../../src/lib/privacyShield/session";
import { redactDeep } from "../../src/lib/privacyShield/restore";
import { createRestoringTransform } from "../../src/lib/privacyShield/streamingRestorer";
import { BUILTIN_PATTERNS } from "../../src/lib/privacyShield/patterns";

async function testTransform(transform: TransformStream, inputChunks: string[]): Promise<string> {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();

  const writePromise = (async () => {
    for (const chunk of inputChunks) {
      await writer.write(new TextEncoder().encode(chunk));
    }
    await writer.close();
  })();

  const outputChunks: string[] = [];
  let res = await reader.read();
  while (!res.done) {
    outputChunks.push(new TextDecoder().decode(res.value));
    res = await reader.read();
  }

  await writePromise;
  return outputChunks.join("");
}

test("full pipeline: redact → echo → restore", async () => {
  const session = new PlaceholderSession();
  const emailPatterns = BUILTIN_PATTERNS.filter(p => p.category === "EMAIL");
  
  const originalObj = { content: "my secret is john@example.com" };
  redactDeep(originalObj, emailPatterns, [], session);
  assert.ok(originalObj.content.includes("__PS_EMAIL_"));
  assert.ok(!originalObj.content.includes("john@example.com"));
  
  // Simulate stream echo containing the placeholder
  const transform = createRestoringTransform(session);
  const sseChunk = `data: {"choices":[{"delta":{"content":"${originalObj.content}"}}]}\n\n`;
  
  const restoredSse = await testTransform(transform, [sseChunk]);
  assert.ok(restoredSse.includes("john@example.com"));
  assert.ok(!restoredSse.includes("__PS_EMAIL_"));
});
