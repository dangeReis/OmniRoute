// src/lib/privacyShield/session.ts
import crypto from "crypto";

export interface Mapping {
  original: string;
  placeholder: string;
  category: string;
  lastTouched: number; // logical sequence number
  expiresAt: number;   // physical expiration timestamp
}

export class PlaceholderSession {
  activeRequests: number = 0;
  private maxMappings: number;
  private ttlMs: number;
  readonly prefix: string;
  private salt: string;
  private mappings = new Map<string, Mapping>(); // placeholder -> Mapping
  private originalToPlaceholder = new Map<string, string>(); // category\0original -> placeholder
  private sequence = 0;
  private lastCleaned = 0;

  constructor(options?: { maxMappings?: number; ttlMs?: number; prefix?: string }) {
    this.maxMappings = options?.maxMappings ?? 10000;
    this.ttlMs = options?.ttlMs ?? 3600 * 1000; // default 1 hour
    this.prefix = options?.prefix ?? "__PS_";
    this.salt = crypto.randomBytes(16).toString("hex");
  }

  private mappingKey(original: string, category: string): string {
    return `${category}\x00${original}`;
  }

  private isExpired(mapping: Mapping): boolean {
    return Date.now() > mapping.expiresAt;
  }

  private cleanExpired() {
    const now = Date.now();
    if (now - this.lastCleaned < 5000) {
      return;
    }
    this.lastCleaned = now;

    for (const [placeholder, mapping] of this.mappings.entries()) {
      if (this.isExpired(mapping)) {
        this.mappings.delete(placeholder);
        this.originalToPlaceholder.delete(this.mappingKey(mapping.original, mapping.category));
      }
    }
  }

  getOrCreatePlaceholder(original: string, category: string): string {
    this.cleanExpired();

    const key = this.mappingKey(original, category);
    const existingPlaceholder = this.originalToPlaceholder.get(key);
    if (existingPlaceholder) {
      const mapping = this.mappings.get(existingPlaceholder);
      if (mapping) {
        mapping.lastTouched = ++this.sequence;
        mapping.expiresAt = Date.now() + this.ttlMs;
        this.mappings.delete(existingPlaceholder);
        this.mappings.set(existingPlaceholder, mapping);
        return existingPlaceholder;
      }
    }

    if (this.mappings.size >= this.maxMappings) {
      const oldestPlaceholder = this.mappings.keys().next().value;
      if (oldestPlaceholder) {
        const oldestMapping = this.mappings.get(oldestPlaceholder);
        if (oldestMapping) {
          this.mappings.delete(oldestPlaceholder);
          this.originalToPlaceholder.delete(this.mappingKey(oldestMapping.original, oldestMapping.category));
        }
      }
    }

    const normalizedCategory = category.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    const hash = crypto.createHmac("sha256", this.salt).update(original).digest("hex").slice(0, 16);
    let placeholder = `${this.prefix}${normalizedCategory}_${hash}__`;
    let suffix = 0;
    while (this.mappings.has(placeholder) && this.mappings.get(placeholder)!.original !== original) {
      suffix++;
      placeholder = `${this.prefix}${normalizedCategory}_${hash}_${suffix}__`;
    }

    const mapping: Mapping = {
      original,
      placeholder,
      category,
      lastTouched: ++this.sequence,
      expiresAt: Date.now() + this.ttlMs,
    };

    this.mappings.set(placeholder, mapping);
    this.originalToPlaceholder.set(key, placeholder);

    return placeholder;
  }

  resolve(placeholder: string): string | undefined {
    const mapping = this.mappings.get(placeholder);
    if (!mapping) return undefined;

    if (this.isExpired(mapping)) {
      this.mappings.delete(placeholder);
      this.originalToPlaceholder.delete(this.mappingKey(mapping.original, mapping.category));
      return undefined;
    }

    mapping.lastTouched = ++this.sequence;
    mapping.expiresAt = Date.now() + this.ttlMs;
    this.mappings.delete(placeholder);
    this.mappings.set(placeholder, mapping);
    return mapping.original;
  }

  addMapping(placeholder: string, original: string, category: string, expiresAt: number): void {
    const mapping: Mapping = {
      original,
      placeholder,
      category,
      lastTouched: ++this.sequence,
      expiresAt,
    };
    this.mappings.set(placeholder, mapping);
    this.originalToPlaceholder.set(this.mappingKey(original, category), placeholder);
  }

  get size(): number {
    this.cleanExpired();
    return this.mappings.size;
  }
}

export class SessionManager {
  private maxSessions: number;
  private sessions = new Map<string, PlaceholderSession>();
  private order: string[] = [];

  constructor(options?: { maxSessions?: number }) {
    this.maxSessions = options?.maxSessions ?? 1000;
  }

  getOrCreate(sessionId: string): PlaceholderSession {
    this.order = this.order.filter((id) => id !== sessionId);

    let session = this.sessions.get(sessionId);
    if (!session) {
      if (this.sessions.size >= this.maxSessions) {
        const oldestId = this.order.shift();
        if (oldestId) {
          this.sessions.delete(oldestId);
        }
      }
      session = new PlaceholderSession();
      this.sessions.set(sessionId, session);
    }

    this.order.push(sessionId);
    return session;
  }
}

export function getPlaceholderRegex(prefix: string = "__PS_"): RegExp {
  const core = prefix.replace(/^_+/, "");
  const escapedCore = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`_*${escapedCore}[A-Z0-9_]+?_[a-f0-9]{12,16}(?:_\\d+)?__`);
}
