import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate DB state
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-test-repro-"));
process.env.DATA_DIR = tmpDir;

import { createPiiSseTransform } from "../../src/lib/streamingPiiTransform";
import { sanitizePII } from "../../src/lib/piiSanitizer";

test("PII Reproduction Tests", async (t) => {
  // Setup overrides for tests
  const originalEnv = process.env;
  process.env = { 
    ...originalEnv,
    PII_RESPONSE_SANITIZATION: "true",
    PII_RESPONSE_SANITIZATION_MODE: "redact",
    PII_TEST_BYPASS_MIN_WINDOW: "true"
  };

  await t.test("THEORY-001: Infinite Streaming Buffer Accumulation", async () => {
    const transform = createPiiSseTransform({ windowSize: 10 });
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    const encoder = new TextEncoder();

    // Write 50 alphanumeric characters starting with "sk-"
    const piiText = "sk-123456789012345678901234567890123456789012345678"; // 51 chars
    await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piiText } }] })}\n`));

    // Attempt to read with timeout. Since W=10, it should emit immediately (no hang).
    let chunkValue: any = null;
    try {
      const readPromise = reader.read();
      const result = await Promise.race([
        readPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 200))
      ]);
      chunkValue = (result as any).value;
    } catch (err) {
      // Timeout occurred
    }

    // Since W=10 and input length is 51, it must emit immediately (no infinite withhold)
    assert.ok(chunkValue !== null, "Should emit immediately because the buffer is not indefinitely withheld");

    // Close the writer to check if the data is flushed at the end
    await writer.close();
    const finalResult = await reader.read();
    
    // Check if the overall stream contains redaction
    const firstDecoded = new TextDecoder().decode(chunkValue);
    const finalDecoded = finalResult.value ? new TextDecoder().decode(finalResult.value) : "";
    const combined = firstDecoded + finalDecoded;
    assert.ok(combined.includes("[API_KEY_REDACTED]"), "Flushed output should be redacted");
  });

  await t.test("THEORY-002: Unicode Formatting Obfuscation Bypass & IPv6 Issues", async () => {
    // 1. Unicode Formatting Obfuscation Bypass (Word Joiner \\u2060 and Soft Hyphen \\u00AD)
    const keyWithWordJoiner = "sk-12345\u2060678901234567890123";
    const keyWithSoftHyphen = "sk-12345\u00AD678901234567890123";

    const resultWordJoiner = sanitizePII(keyWithWordJoiner);
    const resultSoftHyphen = sanitizePII(keyWithSoftHyphen);

    // If successfully redacted, it should contain [API_KEY_REDACTED]
    assert.ok(resultWordJoiner.text.includes("[API_KEY_REDACTED]"), "API Key with Word Joiner should be redacted");
    assert.ok(resultSoftHyphen.text.includes("[API_KEY_REDACTED]"), "API Key with Soft Hyphen should be redacted");

    // 2. IPv6 lookbehind/lookahead issues
    // abc::1 (preceded by alphabetic characters) should NOT get redacted
    const resultIpv6Lookbehind = sanitizePII("abc::1");
    assert.strictEqual(resultIpv6Lookbehind.text, "abc::1", "abc::1 should not be redacted");

    // Invalid IPv6 followed by letters should NOT get redacted
    const resultIpv6Lookahead = sanitizePII("2001:db8:3333:4444:5555:6666:7777:8888abcd");
    assert.strictEqual(resultIpv6Lookahead.text, "2001:db8:3333:4444:5555:6666:7777:8888abcd", "Invalid IPv6 with trailing characters should not be redacted");
  });

  await t.test("THEORY-003: False Positive Identifier Redaction", async () => {
    // 16-digit database ID/Snowflake ID
    const snowflakeId = "1234567890123456";
    const resultCc = sanitizePII(snowflakeId);
    assert.strictEqual(resultCc.text, snowflakeId, "16-digit numeric identifier should not be redacted as Credit Card if Luhn fails");

    // 11-digit database ID
    const dbId11 = "12345678901";
    const resultCpf = sanitizePII(dbId11);
    assert.strictEqual(resultCpf.text, dbId11, "11-digit numeric identifier should not be redacted as CPF if checksum fails");
  });

  await t.test("THEORY-004: Data Loss in Unknown Stream Fallbacks", async () => {
    // Scenario A: Raw text stream wrapped in OpenAI JSON envelope
    const transformA = createPiiSseTransform({ windowSize: 200 });
    const writerA = transformA.writable.getWriter();
    const readerA = transformA.readable.getReader();
    const encoder = new TextEncoder();

    await writerA.write(encoder.encode("data: Hello world\n"));
    await writerA.close();

    const chunksA: string[] = [];
    while (true) {
      const { value, done } = await readerA.read();
      if (done) break;
      chunksA.push(new TextDecoder().decode(value));
    }
    const outputA = chunksA.join("");
    // The raw text stream should NOT be wrapped in an OpenAI JSON envelope
    assert.ok(!outputA.includes('{"choices":'), "Raw text stream should not get wrapped in OpenAI JSON envelope upon flush");

    // Scenario B: Non-standard JSON stream ending with a stop signal containing no string fields (data loss)
    const transformB = createPiiSseTransform({ windowSize: 200 });
    const writerB = transformB.writable.getWriter();
    const readerB = transformB.readable.getReader();

    await writerB.write(encoder.encode('data: {"msg": "Hello world"}\n'));
    await writerB.write(encoder.encode('data: {"done": true}\n'));
    await writerB.close();

    const chunksB: string[] = [];
    while (true) {
      const { value, done } = await readerB.read();
      if (done) break;
      chunksB.push(new TextDecoder().decode(value));
    }
    const outputB = chunksB.join("");
    // "Hello world" should be preserved in the output
    assert.ok(outputB.includes("Hello world"), "Buffered content should be preserved on flush when the stop signal has no string fields");
  });
});

