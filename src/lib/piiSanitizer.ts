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

  // Strip zero-width spaces and other invisible characters to prevent regex obfuscation bypasses
  let sanitized = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
  const cleanText = sanitized;
  let endMatchIndex: number | undefined = undefined;

  for (const pattern of PII_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.regex.lastIndex = 0;
    const matches = cleanText.match(pattern.regex);
    if (matches && matches.length > 0) {
      detections.push({
        pattern: pattern.name,
        count: matches.length,
        severity: pattern.severity,
      });

      if (mode === "redact") {
        pattern.regex.lastIndex = 0;
        const currentLength = sanitized.length;
        sanitized = sanitized.replace(pattern.regex, (match, offset) => {
          if (isStreaming && offset + match.length === currentLength) {
            // Prevent premature redaction of variable-length PII touching the end of the streaming buffer
            if (endMatchIndex === undefined || offset < endMatchIndex) {
              endMatchIndex = offset;
            }
            return match;
          }
          return pattern.replacement;
        });
      }
    }
  }

  if (detections.length > 0) {
    if (mode === "warn") {
      console.warn(
        `[PII] Detected PII in response: ${detections.map((d) => `${d.pattern}(${d.count})`).join(", ")}`
      );
    } else if (mode === "block") {
      throw new Error(`[PII] Blocked response due to PII detection: ${detections.map(d => d.pattern).join(", ")}`);
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
    // Deep sanitize the entire response object recursively
    const deepSanitize = (obj: any): any => {
      if (!obj) return obj;
      if (typeof obj === "string") {
        return sanitizePII(obj).text;
      }
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          obj[i] = deepSanitize(obj[i]);
        }
      } else if (typeof obj === "object") {
        for (const key of Object.keys(obj)) {
          // Skip known non-PII system metadata keys to optimize performance
          if (["id", "model", "object", "created", "finish_reason", "finishReason", "role", "type", "index", "stop_reason"].includes(key)) {
            continue;
          }
          obj[key] = deepSanitize(obj[key]);
        }
      }
      return obj;
    };

    return deepSanitize(response);
  } catch (err: any) {
    if (err?.message?.startsWith("[PII] Blocked response")) {
      throw err;
    }
    // Fail open — don't break the response for structural parsing errors
  }

  return response;
}
