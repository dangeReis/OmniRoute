// src/lib/privacyShield/patterns.ts

export interface PatternRule {
  name: string;
  category: string;
  regex: RegExp;
  postFilter?: (match: string) => boolean;
}

export interface ExcludeRule {
  value: string;
  match: "exact" | "prefix" | "contains";
}

function luhnCheck(digitsStr: string): boolean {
  const digits = digitsStr.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let val = digits.charCodeAt(i) - 48;
    if (shouldDouble) {
      val *= 2;
      if (val > 9) val -= 9;
    }
    sum += val;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export const BUILTIN_PATTERNS: PatternRule[] = [
  {
    name: "EMAIL",
    category: "EMAIL",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    name: "API_KEY",
    category: "API_KEY",
    regex: /\b(?:sk|pk)[_-][a-zA-Z0-9_-]{20,}\b/g,
  },
  {
    name: "SSN",
    category: "SSN",
    regex: /\b(?!000)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    name: "CREDIT_CARD",
    category: "CREDIT_CARD",
    regex: /\b(?:\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}|\d{4}[-\s]?\d{6}[-\s]?\d{5}|\d{12,19})\b/g,
    postFilter: luhnCheck,
  },
  {
    name: "PHONE_US",
    category: "PHONE_US",
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    name: "PHONE_BR",
    category: "PHONE_BR",
    regex: /\b(?:\+?55[-.\s]?)?\(?\d{2}\)?[-.\s]?\d{4,5}[-.\s]?\d{4}\b/g,
  },
  {
    name: "IPV4",
    category: "IPV4",
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  },
  {
    name: "AWS_KEY",
    category: "AWS_KEY",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "GITHUB_TOKEN",
    category: "GITHUB_TOKEN",
    regex: /\bgh[oprs]_[a-zA-Z0-9]{36,251}\b/g,
  },
  {
    name: "UUID",
    category: "UUID",
    regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  },
  {
    name: "JWT",
    category: "JWT",
    regex: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  },
  {
    name: "PRIVATE_KEY",
    category: "PRIVATE_KEY",
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[a-zA-Z0-9/+\s\n\r=]+?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  {
    name: "BEARER_TOKEN",
    category: "BEARER_TOKEN",
    regex: /\bBearer\s+[a-zA-Z0-9_-]{20,}\b/g,
  },
  {
    name: "CPF",
    category: "CPF",
    regex: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  },
  {
    name: "CNPJ",
    category: "CNPJ",
    regex: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
  },
  {
    name: "MAC",
    category: "MAC",
    regex: /\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b/g,
  },
];

export const DEFAULT_EXCLUDES: ExcludeRule[] = [];

export function buildPatternSet(
  builtins: PatternRule[],
  custom: PatternRule[],
  excludes: ExcludeRule[]
): { patterns: PatternRule[]; excludes: ExcludeRule[] } {
  return {
    patterns: [...builtins, ...custom],
    excludes: [...excludes],
  };
}
