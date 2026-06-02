// src/lib/privacyShield/streamingRestorer.ts
import type { PlaceholderSession } from "./session.ts";
import { getPlaceholderRegex } from "./session.ts";

export class StreamingRestorer {
  private session: PlaceholderSession;
  private escapeForJson: boolean;
  private buffer: string = "";
  private partialRegex: RegExp;
  private placeholderRegex: RegExp;
  private maxPartialLength: number;

  constructor(session: PlaceholderSession, options?: { escapeForJson?: boolean }) {
    this.session = session;
    this.escapeForJson = options?.escapeForJson ?? false;

    const prefix = this.session.prefix;
    const core = prefix.replace(/^_+|_+$/g, "");
    const escapedCore = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Dynamically build prefix partial parts, e.g. for "PS" -> "P|PS"
    const prefixPartParts = [];
    for (let i = 1; i <= core.length; i++) {
      prefixPartParts.push(core.slice(0, i));
    }
    const prefixPart = prefixPartParts.length > 0 
      ? `(?:${prefixPartParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`
      : "";

    this.partialRegex = new RegExp(
      `(?:` +
        `_*${prefixPart}?` +
        `|` +
        `_*${escapedCore}_[A-Z0-9_]*` +
        `|` +
        `_*${escapedCore}_[A-Z0-9_]+_[a-f0-9]{0,12}` +
        `|` +
        `_*${escapedCore}_[A-Z0-9_]+_[a-f0-9]{12}_\\d*` +
        `|` +
        `_*${escapedCore}_[A-Z0-9_]+_[a-f0-9]{12}(?:_\\d+)?_?` +
      `)$`,
      "i"
    );

    this.placeholderRegex = getPlaceholderRegex(prefix);
    this.maxPartialLength = prefix.length + 128; // dynamic safety valve limit based on placeholder contract
  }

  push(text: string): string {
    this.buffer += text;

    // First, resolve any complete placeholders in the buffer
    this.buffer = this.restoreWithJsonEscape(this.buffer);

    // Now, find if the buffer ends with a partial placeholder
    const match = this.partialRegex.exec(this.buffer);

    if (match) {
      const matchedStr = match[0];
      
      // If it's a complete, valid placeholder, we don't buffer it as a partial (since we already tried to resolve it).
      // If it is longer than the safety limit, we don't buffer it either.
      if (matchedStr.length <= this.maxPartialLength && !this.placeholderRegex.test(matchedStr)) {
        const emitText = this.buffer.slice(0, match.index);
        this.buffer = this.buffer.slice(match.index);
        return emitText;
      }
    }

    // No partial placeholder to buffer, or it was complete/too long. Emit everything.
    const emitText = this.buffer;
    this.buffer = "";
    return emitText;
  }

  flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }

  destroy(): void {
    this.buffer = "";
  }

  private restoreWithJsonEscape(text: string): string {
    if (typeof text !== "string" || !text) return text;
    
    const baseRegex = getPlaceholderRegex(this.session.prefix);
    const globalRegex = new RegExp(baseRegex.source, "g");
    
    return text.replace(globalRegex, (match) => {
      let resolved = this.session.resolve(match);
      if (resolved !== undefined) {
        if (this.escapeForJson) {
          return JSON.stringify(resolved).slice(1, -1);
        }
        return resolved;
      }
      
      if (!match.startsWith("__") && match.startsWith("PS_")) {
        resolved = this.session.resolve("__" + match);
        if (resolved !== undefined) {
          if (this.escapeForJson) {
            return JSON.stringify(resolved).slice(1, -1);
          }
          return resolved;
        }
      }
      
      return match;
    });
  }
}

export function createRestoringTransform(session: PlaceholderSession): TransformStream {
  const restorer = new StreamingRestorer(session);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      if (text) {
        const restored = restorer.push(text);
        if (restored) {
          controller.enqueue(encoder.encode(restored));
        }
      }
    },
    flush(controller) {
      const remainingText = decoder.decode();
      let flushed = "";
      if (remainingText) {
        flushed += restorer.push(remainingText);
      }
      flushed += restorer.flush();
      if (flushed) {
        controller.enqueue(encoder.encode(flushed));
      }
    }
  });
}
