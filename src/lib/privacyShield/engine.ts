// src/lib/privacyShield/engine.ts

import type { PatternRule, ExcludeRule } from "./patterns.ts";
import type { PlaceholderSession } from "./session.ts";

export interface RedactMatch {
  start: number;
  end: number;
  original: string;
  category: string;
  placeholder: string;
}

export interface RedactResult {
  text: string;
  matches: RedactMatch[];
}

function isExcluded(text: string, excludes: ExcludeRule[]): boolean {
  for (const ex of excludes) {
    if (ex.match === "exact" && text === ex.value) return true;
    if (ex.match === "prefix" && text.startsWith(ex.value)) return true;
    if (ex.match === "contains" && text.includes(ex.value)) return true;
  }
  return false;
}

export function redactText(
  text: string,
  patterns: PatternRule[],
  excludes: ExcludeRule[],
  session: PlaceholderSession,
): RedactResult {
  if (!text) {
    return { text: "", matches: [] };
  }

  const candidates: Array<{ start: number; end: number; original: string; category: string }> = [];

  // Gather all candidate matches
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    
    // Create a copy of regex with global flag to avoid infinite loops and ensure all occurrences match
    const flags = pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g";
    const regexCopy = new RegExp(pattern.regex.source, flags);
    
    while ((match = regexCopy.exec(text)) !== null) {
      const matchText = match[0];
      const start = match.index;
      const end = regexCopy.lastIndex;

      // Avoid infinite loop on zero-width match
      if (start === end) {
        regexCopy.lastIndex++;
        continue;
      }

      if (pattern.postFilter && !pattern.postFilter(matchText)) {
        continue;
      }

      if (isExcluded(matchText, excludes)) {
        continue;
      }

      candidates.push({
        start,
        end,
        original: matchText,
        category: pattern.category,
      });
    }
  }

  // Resolve overlaps by sorting: earlier start first, longer match first
  candidates.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return (b.end - b.start) - (a.end - a.start);
  });

  const selected: typeof candidates = [];
  for (const cand of candidates) {
    const hasOverlap = selected.some((sel) => cand.start < sel.end && cand.end > sel.start);
    if (!hasOverlap) {
      selected.push(cand);
    }
  }

  // Sort selected matches ascending by start position for reconstruction
  selected.sort((a, b) => a.start - b.start);

  let redactedText = "";
  let currentOriginalPos = 0;
  const finalMatches: RedactMatch[] = [];

  for (const match of selected) {
    redactedText += text.slice(currentOriginalPos, match.start);
    
    const placeholder = session.getOrCreatePlaceholder(match.original, match.category);
    const newStart = redactedText.length;
    redactedText += placeholder;
    const newEnd = redactedText.length;

    finalMatches.push({
      start: newStart,
      end: newEnd,
      original: match.original,
      category: match.category,
      placeholder,
    });

    currentOriginalPos = match.end;
  }

  redactedText += text.slice(currentOriginalPos);

  return {
    text: redactedText,
    matches: finalMatches,
  };
}
