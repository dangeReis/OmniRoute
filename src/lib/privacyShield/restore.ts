// src/lib/privacyShield/restore.ts
import type { PlaceholderSession } from "./session.ts";
import type { PatternRule, ExcludeRule } from "./patterns.ts";
import { getPlaceholderRegex } from "./session.ts";
import { redactText } from "./engine.ts";

export function restoreText(text: string, session: PlaceholderSession): string {
  if (typeof text !== "string" || !text) return text;
  
  const baseRegex = getPlaceholderRegex();
  const globalRegex = new RegExp(baseRegex.source, "g");
  
  return text.replace(globalRegex, (match) => {
    let resolved = session.resolve(match);
    if (resolved !== undefined) {
      return resolved;
    }
    
    // Support bare-prefix fallback (e.g. PS_EMAIL_... -> __PS_EMAIL_...)
    if (!match.startsWith("__") && match.startsWith("PS_")) {
      resolved = session.resolve("__" + match);
      if (resolved !== undefined) {
        return resolved;
      }
    }
    
    return match;
  });
}

export function restoreDeep(obj: unknown, session: PlaceholderSession): void {
  const visited = new Set<any>();

  function recurse(current: any) {
    if (!current || typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        const val = current[i];
        if (typeof val === "string") {
          current[i] = restoreText(val, session);
        } else if (val && typeof val === "object") {
          recurse(val);
        }
      }
    } else {
      for (const key of Object.keys(current)) {
        const val = current[key];
        if (typeof val === "string") {
          current[key] = restoreText(val, session);
        } else if (val && typeof val === "object") {
          recurse(val);
        }
      }
    }
  }

  recurse(obj);
}

export function redactDeep(
  obj: unknown,
  patterns: PatternRule[],
  excludes: ExcludeRule[],
  session: PlaceholderSession,
): void {
  const visited = new Set<any>();

  function recurse(current: any) {
    if (!current || typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        const val = current[i];
        if (typeof val === "string") {
          current[i] = redactText(val, patterns, excludes, session).text;
        } else if (val && typeof val === "object") {
          recurse(val);
        }
      }
    } else {
      for (const key of Object.keys(current)) {
        const val = current[key];
        if (typeof val === "string") {
          current[key] = redactText(val, patterns, excludes, session).text;
        } else if (val && typeof val === "object") {
          recurse(val);
        }
      }
    }
  }

  recurse(obj);
}
