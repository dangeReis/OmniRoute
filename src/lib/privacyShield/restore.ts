// src/lib/privacyShield/restore.ts
import type { PlaceholderSession } from "./session.ts";
import type { PatternRule, ExcludeRule } from "./patterns.ts";
import { getPlaceholderRegex } from "./session.ts";
import { redactText } from "./engine.ts";

const regexCache = new Map<string, RegExp>();

function getGlobalPlaceholderRegex(prefix: string = "__PS_"): RegExp {
  let cached = regexCache.get(prefix);
  if (!cached) {
    cached = new RegExp(getPlaceholderRegex(prefix).source, "g");
    regexCache.set(prefix, cached);
  }
  return cached;
}

export function restoreText(text: string, session: PlaceholderSession): string {
  if (typeof text !== "string" || !text) return text;
  
  const globalRegex = getGlobalPlaceholderRegex(session.prefix);
  
  return text.replace(globalRegex, (match) => {
    let resolved = session.resolve(match);
    if (resolved !== undefined) {
      return resolved;
    }
    
    // Support bare-prefix fallback (e.g. PS_EMAIL_... -> __PS_EMAIL_...)
    const leadingUnderscores = session.prefix.match(/^_+/)?.[0] || "";
    if (leadingUnderscores && !match.startsWith(leadingUnderscores)) {
      const canonical = leadingUnderscores + match.replace(/^_+/, "");
      resolved = session.resolve(canonical);
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
    } else if (current instanceof Map) {
      const keys = Array.from(current.keys());
      for (const key of keys) {
        const val = current.get(key);
        let finalKey = key;
        if (typeof key === "string") {
          finalKey = restoreText(key, session);
        }
        let finalVal = val;
        if (typeof val === "string") {
          finalVal = restoreText(val, session);
        } else if (val && typeof val === "object") {
          recurse(val);
        }
        if (finalKey !== key) {
          if (current.has(finalKey)) {
            throw new Error(`Map key collision during restore: key "${String(key)}" restored to "${String(finalKey)}", which already exists`);
          }
          current.delete(key);
          current.set(finalKey, finalVal);
        } else if (finalVal !== val) {
          current.set(key, finalVal);
        }
      }
    } else if (current instanceof Set) {
      const arr = Array.from(current);
      current.clear();
      for (const val of arr) {
        if (typeof val === "string") {
          current.add(restoreText(val, session));
        } else if (val && typeof val === "object") {
          recurse(val);
          current.add(val);
        } else {
          current.add(val);
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
    } else if (current instanceof Map) {
      const keys = Array.from(current.keys());
      for (const key of keys) {
        const val = current.get(key);
        let finalKey = key;
        if (typeof key === "string") {
          finalKey = redactText(key, patterns, excludes, session).text;
        }
        let finalVal = val;
        if (typeof val === "string") {
          finalVal = redactText(val, patterns, excludes, session).text;
        } else if (val && typeof val === "object") {
          recurse(val);
        }
        if (finalKey !== key) {
          if (current.has(finalKey)) {
            throw new Error(`Map key collision during redact: key "${String(key)}" redacted to "${String(finalKey)}", which already exists`);
          }
          current.delete(key);
          current.set(finalKey, finalVal);
        } else if (finalVal !== val) {
          current.set(key, finalVal);
        }
      }
    } else if (current instanceof Set) {
      const arr = Array.from(current);
      current.clear();
      for (const val of arr) {
        if (typeof val === "string") {
          current.add(redactText(val, patterns, excludes, session).text);
        } else if (val && typeof val === "object") {
          recurse(val);
          current.add(val);
        } else {
          current.add(val);
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
