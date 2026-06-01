/**
 * Output PII Sanitization — L-3
 *
 * Scans LLM response text for PII patterns and optionally redacts them.
 * This is the OUTPUT-side counterpart to the input sanitizer.
 * Configurable via environment variables:
 *
 *   PII_RESPONSE_SANITIZATION=true|false  (default: false)
 *   PII_RESPONSE_SANITIZATION_MODE=redact|warn|block  (default: redact)
 *
 * @module lib/piiSanitizer
 */

// ── Configuration ──

import { isFeatureFlagEnabled, resolveFeatureFlag } from "@/shared/utils/featureFlags";

const isEnabled = () => isFeatureFlagEnabled("PII_RESPONSE_SANITIZATION");
const VALID_MODES = ["redact", "warn", "block", "false"] as const;
type PiiMode = typeof VALID_MODES[number];

const getMode = (): PiiMode => {
  const value = resolveFeatureFlag("PII_RESPONSE_SANITIZATION_MODE");
  if (value === "") return "redact";
  if ((VALID_MODES as readonly string[]).includes(value)) return value as PiiMode;
  console.error(`[PII] Invalid PII_RESPONSE_SANITIZATION_MODE: "${value}", defaulting to "redact"`);
  return "redact";
};

// ── PII Patterns ──

interface PIIPattern {
  name: string;
  regex: RegExp;
  replacement: string;
  severity: "high" | "medium" | "low";
}

const PII_PATTERNS: PIIPattern[] = [
  {
    name: "email",
    regex: /(?<=^|[^A-Za-z0-9])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?=$|[^A-Za-z0-9])/g,
    replacement: "[EMAIL_REDACTED]",
    severity: "medium",
  },
  {
    name: "ssn",
    regex: /(?<=^|[^A-Za-z0-9])\d{3}-\d{2}-\d{4}(?=$|[^A-Za-z0-9])/g,
    replacement: "[SSN_REDACTED]",
    severity: "high",
  },
  {
    name: "credit_card",
    regex: /(?<=^|[^A-Za-z0-9])(?:\d{4}[-\s]?\d{6}[-\s]?\d{4,5}|(?:\d{4}[-\s]?){3}\d{4}|\d{4}[-\s]?\d{6}[-\s]?\d{4})(?=$|[^A-Za-z0-9])/g,
    replacement: "[CC_REDACTED]",
    severity: "high",
  },
  {
    name: "phone_us",
    regex: /(?<=^|[^A-Za-z0-9])(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?=$|[^A-Za-z0-9])/g,
    replacement: "[PHONE_REDACTED]",
    severity: "medium",
  },
  {
    name: "phone_br",
    regex: /(?<=^|[^A-Za-z0-9])(?:\+?55[-.\s]?)?\(?\d{2}\)?[-.\s]?\d{4,5}[-.\s]?\d{4}(?=$|[^A-Za-z0-9])/g,
    replacement: "[PHONE_REDACTED]",
    severity: "medium",
  },
  {
    name: "cpf",
    regex: /(?<=^|[^A-Za-z0-9])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?=$|[^A-Za-z0-9])/g,
    replacement: "[CPF_REDACTED]",
    severity: "high",
  },
  {
    name: "cnpj",
    regex: /(?<=^|[^A-Za-z0-9])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?=$|[^A-Za-z0-9])/g,
    replacement: "[CNPJ_REDACTED]",
    severity: "high",
  },
  {
    name: "ip_address",
    regex: /(?<=^|[^A-Za-z0-9])(?:\d{1,3}\.){3}\d{1,3}(?=$|[^A-Za-z0-9])/g,
    replacement: "[IP_REDACTED]",
    severity: "low",
  },
  {
    name: "ipv6_address",
    regex: /(?<=^|[^A-Za-z0-9])(?:[0-9a-fA-F]{1,4}:){1,7}(?:[0-9a-fA-F]{1,4}|:)|::(?:[0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4}(?=$|[^A-Za-z0-9])/g,
    replacement: "[IP_REDACTED]",
    severity: "low",
  },
  {
    name: "aws_key",
    regex: /(?<=^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?=$|[^A-Za-z0-9])/g,
    replacement: "[AWS_KEY_REDACTED]",
    severity: "high",
  },
  {
    name: "api_key_generic",
    regex: /(?<=^|[^A-Za-z0-9])(?:sk|pk|api|key|token)[_-][a-zA-Z0-9]{20,}(?=$|[^A-Za-z0-9])/gi,
    replacement: "[API_KEY_REDACTED]",
    severity: "high",
  },
];

// ── Public API ──

export interface SanitizeResult {
  text: string;
  detections: Array<{
    pattern: string;
    count: number;
    severity: string;
  }>;
  redacted: boolean;
  endMatchIndex?: number;
}

/**
 * Scan and optionally redact PII from LLM response text.
 */
export function sanitizePII(text: string, isStreaming = false): SanitizeResult {
  if (!isEnabled() || !text || typeof text !== "string") {
    return { text, detections: [], redacted: false };
  }

  const mode = getMode();
  const detections: SanitizeResult["detections"] = [];

  // Build a map of clean character index to original character index.
  // We strip \u200B and \uFEFF always, but we also ignore ZWJ/ZWNJ (\u200D/\u200C) during matching
  // to ensure regex patterns can be detected even when obfuscated.
  const cleanToOrig: number[] = [];
  let cleanText = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\u200B" || char === "\u200C" || char === "\u200D" || char === "\uFEFF") {
      // Obfuscator / joiner, ignore in clean text
    } else {
      cleanToOrig.push(i);
      cleanText += char;
    }
  }
  cleanToOrig.push(text.length);

  interface RedactRange {
    start: number;
    end: number;
    replacement: string;
    pattern: string;
  }
  const ranges: RedactRange[] = [];
  let endMatchIndex: number | undefined = undefined;

  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(cleanText)) !== null) {
      const cleanStart = match.index;
      const cleanEnd = cleanStart + match[0].length;
      const start = cleanToOrig[cleanStart];
      const end = cleanToOrig[cleanEnd];

      if (isStreaming && cleanEnd === cleanText.length) {
        // Prevent premature redaction of variable-length PII touching the end of the streaming buffer
        if (endMatchIndex === undefined || start < endMatchIndex) {
          endMatchIndex = start;
        }
      } else {
        ranges.push({
          start,
          end,
          replacement: pattern.replacement,
          pattern: pattern.name,
        });
      }

      if (!pattern.regex.global) {
        break;
      }
    }
  }

  const patternCounts = new Map<string, number>();
  for (const range of ranges) {
    patternCounts.set(range.pattern, (patternCounts.get(range.pattern) || 0) + 1);
  }
  for (const [name, count] of patternCounts.entries()) {
    const patternDef = PII_PATTERNS.find((p) => p.name === name);
    detections.push({
      pattern: name,
      count,
      severity: patternDef?.severity || "medium",
    });
  }

  if (detections.length > 0) {
    if (mode === "warn") {
      console.warn(
        `[PII] Detected PII in response: ${detections.map((d) => `${d.pattern}(${d.count})`).join(", ")}`
      );
    } else if (mode === "block") {
      throw new Error(`[PII] Blocked response due to PII detection: ${detections.map((d) => d.pattern).join(", ")}`);
    }
  }

  let sanitized = text;
  if (mode === "redact" && ranges.length > 0) {
    // Sort ranges from right to left to avoid shifting offsets
    ranges.sort((a, b) => b.start - a.start);

    // Merge overlapping or adjacent ranges
    const mergedRanges: typeof ranges = [];
    for (const r of ranges) {
      if (mergedRanges.length === 0) {
        mergedRanges.push(r);
      } else {
        const last = mergedRanges[mergedRanges.length - 1];
        if (r.end >= last.start) {
          last.start = Math.min(r.start, last.start);
          last.end = Math.max(r.end, last.end);
        } else {
          mergedRanges.push(r);
        }
      }
    }

    for (const range of mergedRanges) {
      sanitized = sanitized.slice(0, range.start) + range.replacement + sanitized.slice(range.end);
    }
  }

  return {
    text: mode === "redact" ? sanitized : text,
    detections,
    redacted: mode === "redact" && detections.length > 0,
    endMatchIndex,
  };
}

/**
 * Sanitize a streaming chunk (text content only).
 */
export function sanitizePIIChunk(chunk: string, isStopSignal = false): string {
  if (!isEnabled()) return chunk;
  // If it's a stop signal, we are flushing the final chunk, so we shouldn't treat it as a partial streaming buffer (force redaction)
  const { text } = sanitizePII(chunk, !isStopSignal);
  return text;
}

/**
 * Sanitize PII in a full response object (OpenAI-compatible format).
 */
export function sanitizePIIResponse(response: any): any {
  if (!isEnabled() || !response) return response;

  try {
    const visited = new WeakSet();
    // Deep sanitize the entire response object recursively
    const deepSanitize = (obj: any, depth = 0): any => {
      if (depth > 100) {
        throw new Error("Maximum sanitization depth exceeded");
      }
      if (!obj) return obj;
      if (typeof obj === "string") {
        return sanitizePII(obj).text;
      }
      if (typeof obj === "object") {
        if (visited.has(obj)) {
          return "[CIRCULAR_REFERENCE_REDACTED]";
        }
        visited.add(obj);

        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            obj[i] = deepSanitize(obj[i], depth + 1);
          }
        } else {
          for (const key of Object.keys(obj)) {
            // Skip known non-PII system metadata keys to optimize performance
            if (["id", "model", "object", "created", "finish_reason", "finishReason", "role", "type", "index", "stop_reason"].includes(key)) {
              continue;
            }
            obj[key] = deepSanitize(obj[key], depth + 1);
          }
        }
      }
      return obj;
    };

    return deepSanitize(response);
  } catch (err: any) {
    if (err?.message?.startsWith("[PII] Blocked response")) {
      throw err;
    }
    // Fail secure — try raw string sanitization instead of failing open
    try {
      const serialized = JSON.stringify(response);
      const { text: sanitized } = sanitizePII(serialized);
      return JSON.parse(sanitized);
    } catch (fallbackErr) {
      throw new Error(`[PII] Blocked response due to sanitization failure: ${err.message}`);
    }
  }
}
