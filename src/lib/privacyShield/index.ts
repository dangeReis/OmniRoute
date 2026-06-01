// src/lib/privacyShield/index.ts

export { redactText, type RedactResult, type RedactMatch } from "./engine.ts";
export { PlaceholderSession, SessionManager, getPlaceholderRegex } from "./session.ts";
export { restoreText, restoreDeep, redactDeep } from "./restore.ts";
export { StreamingRestorer, createRestoringTransform } from "./streamingRestorer.ts";
export { BUILTIN_PATTERNS, DEFAULT_EXCLUDES, buildPatternSet, type PatternRule, type ExcludeRule } from "./patterns.ts";
export { PrivacyShieldWAL } from "./wal.ts";
