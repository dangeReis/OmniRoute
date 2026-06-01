// src/lib/privacyShield/restore.ts

import type { PlaceholderSession } from "./session.ts";
import type { PatternRule, ExcludeRule } from "./patterns.ts";

export function restoreText(text: string, session: PlaceholderSession): string {
  throw new Error("not implemented");
}

export function restoreDeep(obj: unknown, session: PlaceholderSession): void {
  throw new Error("not implemented");
}

export function redactDeep(
  obj: unknown,
  patterns: PatternRule[],
  excludes: ExcludeRule[],
  session: PlaceholderSession,
): void {
  throw new Error("not implemented");
}
