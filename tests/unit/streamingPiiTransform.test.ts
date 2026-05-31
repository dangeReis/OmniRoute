import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate DB state
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-test-streaming-pii-"));
process.env.DATA_DIR = tmpDir;

// Enable the feature flag for tests
const originalEnv = process.env.PII_RESPONSE_SANITIZATION;
process.env.PII_RESPONSE_SANITIZATION = "true";

import { createPiiSseTransform } from "../../src/lib/streamingPiiTransform.ts";

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

test("createPiiSseTransform returns a TransformStream", () => {
  const transform = createPiiSseTransform();
  assert.ok(transform instanceof TransformStream);
});

test("createPiiSseTransform redacts email in delta.content", async () => {
  const transform = createPiiSseTransform();

  const input = `data: {"choices":[{"delta":{"content":"email is john@example.com ok"}}]}\n\n`;
  const output = await testTransform(transform, [input]);

  // Should NOT contain the raw email
  assert.ok(!output.includes("john@example.com"),
    "raw email should be redacted from output");
  // Should contain some form of redaction marker
  assert.ok(output.includes("REDACTED") || output.includes("[EMAIL"),
    "output should contain redaction marker");
});

test("createPiiSseTransform passes non-PII content through unchanged", async () => {
  const transform = createPiiSseTransform();

  const input = `data: {"choices":[{"delta":{"content":"hello world no secrets here"}}]}\n\n`;
  const output = await testTransform(transform, [input]);

  assert.ok(output.includes("hello world no secrets here"),
    "non-PII content should pass through unchanged");
});

test("createPiiSseTransform redacts PII split across chunk boundaries", async () => {
  const transform = createPiiSseTransform();

  const chunk1 = `data: {"choices":[{"delta":{"content":"email is john@"}}]}\n\n`;
  const chunk2 = `data: {"choices":[{"delta":{"content":"example.com"}}]}\n\n`;

  const output = await testTransform(transform, [chunk1, chunk2]);

  assert.ok(!output.includes("john@example.com"),
    "email split across chunks should be redacted");
  assert.ok(output.includes("REDACTED") || output.includes("[EMAIL"),
    "redaction marker should be present in final stream");
});

test("createPiiSseTransform flushes final redacted content before [DONE] sentinel", async () => {
  const transform = createPiiSseTransform();

  const chunk1 = `data: {"choices":[{"delta":{"content":"my email is john@"}}]}\n\n`;
  const chunk2 = `data: {"choices":[{"delta":{"content":"example.com"}}]}\n\n`;
  const chunk3 = `data: [DONE]\n\n`;

  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();

  const writePromise = (async () => {
    await writer.write(new TextEncoder().encode(chunk1));
    await writer.write(new TextEncoder().encode(chunk2));
    await writer.write(new TextEncoder().encode(chunk3));
    await writer.close();
  })();

  const outputChunks: string[] = [];
  let res = await reader.read();
  while (!res.done) {
    outputChunks.push(new TextDecoder().decode(res.value));
    res = await reader.read();
  }
  await writePromise;

  const fullOutput = outputChunks.join("");
  const lines = fullOutput.split("\n").map(l => l.trim()).filter(Boolean);

  const doneIndex = lines.findIndex(l => l === "data: [DONE]");
  assert.ok(doneIndex !== -1, "[DONE] sentinel should be in the stream");
  
  assert.equal(doneIndex, lines.length - 1, "nothing should be enqueued after the [DONE] sentinel");

  const redactedLine = lines.find((l, idx) => idx < doneIndex && (l.includes("REDACTED") || l.includes("[EMAIL")));
  assert.ok(redactedLine, "redacted content chunk should be enqueued before the [DONE] sentinel");
});

test.after(async () => {
  if (originalEnv !== undefined) {
    process.env.PII_RESPONSE_SANITIZATION = originalEnv;
  } else {
    delete process.env.PII_RESPONSE_SANITIZATION;
  }

  const coreDb = await import("../../src/lib/db/core.ts");
  coreDb.resetDbInstance();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
