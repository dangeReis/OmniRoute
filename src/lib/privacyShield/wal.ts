// src/lib/privacyShield/wal.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { SessionManager } from "./session.ts";

export class PrivacyShieldWAL {
  private filePath: string;
  private encryptionKey: Buffer;
  private queue: Promise<any> = Promise.resolve();

  constructor(filePath: string, encryptionKey: Buffer) {
    if (!encryptionKey || !Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
      throw new Error("Encryption key must be a 32-byte Buffer");
    }
    this.filePath = filePath;
    this.encryptionKey = encryptionKey;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.then(() => {}, () => {});
    return next;
  }

  static async validateConfig(filePath?: string): Promise<void> {
    if (filePath) {
      const dir = path.dirname(filePath);
      try {
        await fs.access(dir, fs.constants.W_OK);
      } catch {
        throw new Error(`Directory ${dir} is not writable`);
      }
    }
  }

  async appendMapping(
    sessionId: string,
    placeholder: string,
    original: string,
    category: string,
    createdAt: number,
  ): Promise<void> {
    return this.enqueue(async () => {
      const record = JSON.stringify({ sessionId, placeholder, original, category, createdAt });
      const encrypted = this.encrypt(record);
      await fs.appendFile(this.filePath, encrypted + "\n", "utf8");
    });
  }

  async restore(manager: SessionManager): Promise<void> {
    return this.enqueue(async () => {
      let content: string;
      try {
        content = await fs.readFile(this.filePath, "utf8");
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return;
        }
        throw err;
      }

      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      for (const line of lines) {
        try {
          const decrypted = this.decrypt(line);
          const { sessionId, placeholder, original, category, createdAt } = JSON.parse(decrypted);
          // Expiry defaults to 1 hour after creation if not specified
          const expiresAt = createdAt + 3600 * 1000;
          if (expiresAt < Date.now()) {
            continue;
          }
          const targetSessionId = sessionId || "default";
          const session = manager.getOrCreate(targetSessionId);
          session.addMapping(placeholder, original, category, expiresAt);
        } catch (err: any) {
          console.warn("[PrivacyShieldWAL] Skipping unreadable WAL line:", err.message);
        }
      }
    });
  }

  async compact(): Promise<void> {
    return this.enqueue(async () => {
      let content: string;
      try {
        content = await fs.readFile(this.filePath, "utf8");
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return;
        }
        throw err;
      }

      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const uniqueMappings = new Map<string, { sessionId: string; placeholder: string; original: string; category: string; createdAt: number }>();
      const now = Date.now();

      for (const line of lines) {
        try {
          const decrypted = this.decrypt(line);
          const record = JSON.parse(decrypted);
          // Only retain records that have not expired (TTL of 1 hour)
          if (record.createdAt + 3600 * 1000 >= now) {
            uniqueMappings.set(record.placeholder, record);
          }
        } catch (err: any) {
          console.warn("[PrivacyShieldWAL] Skipping unreadable WAL line during compaction:", err.message);
        }
      }

      const newContent = Array.from(uniqueMappings.values())
        .map((record) => this.encrypt(JSON.stringify(record)))
        .join("\n") + "\n";
      
      const tmpPath = this.filePath + ".tmp";
      await fs.writeFile(tmpPath, newContent, "utf8");
      await fs.rename(tmpPath, this.filePath);
    });
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12); // Standard 12-byte IV for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + encrypted + ":" + authTag.toString("hex");
  }

  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(":");
    if (parts.length < 3) {
      throw new Error("Invalid encrypted format: missing authentication tag");
    }
    const ivHex = parts[0];
    const encrypted = parts[1];
    const tagHex = parts[2];
    
    if (!/^[a-f0-9]+$/i.test(ivHex) || !/^[a-f0-9]+$/i.test(encrypted) || !/^[a-f0-9]+$/i.test(tagHex)) {
      throw new Error("Invalid encrypted format: non-hex characters");
    }
    
    const iv = Buffer.from(ivHex, "hex");
    if (iv.length !== 12) {
      throw new Error("Invalid encrypted format: incorrect IV length for GCM");
    }

    const tag = Buffer.from(tagHex, "hex");
    if (tag.length !== 16) {
      throw new Error("Invalid encrypted format: incorrect auth tag length");
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}
