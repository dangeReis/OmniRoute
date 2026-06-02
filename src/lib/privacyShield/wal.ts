// src/lib/privacyShield/wal.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SessionManager } from "./session.ts";

export class PrivacyShieldWAL {
  private filePath: string;
  private encryptionKey: Buffer;

  constructor(filePath: string, encryptionKey: Buffer) {
    if (!encryptionKey || !Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
      throw new Error("Encryption key must be a 32-byte Buffer");
    }
    this.filePath = filePath;
    this.encryptionKey = encryptionKey;
  }

  static validateConfig(filePath?: string): void {
    if (filePath) {
      const dir = path.dirname(filePath);
      try {
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        throw new Error(`Directory ${dir} is not writable`);
      }
    }
  }

  appendMapping(placeholder: string, original: string, category: string, createdAt: number): void {
    const record = JSON.stringify({ placeholder, original, category, createdAt });
    const encrypted = this.encrypt(record);
    fs.appendFileSync(this.filePath, encrypted + "\n", "utf8");
  }

  restore(manager: SessionManager): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    const content = fs.readFileSync(this.filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const defaultSession = manager.getOrCreate("default");

    for (const line of lines) {
      try {
        const decrypted = this.decrypt(line);
        const { placeholder, original, category, createdAt } = JSON.parse(decrypted);
        // Expiry defaults to 1 hour after creation if not specified
        const expiresAt = createdAt + 3600 * 1000;
        defaultSession.addMapping(placeholder, original, category, expiresAt);
      } catch (err) {
        throw err;
      }
    }
  }

  compact(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    const content = fs.readFileSync(this.filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const uniqueMappings = new Map<string, { placeholder: string; original: string; category: string; createdAt: number }>();
    const now = Date.now();

    for (const line of lines) {
      try {
        const decrypted = this.decrypt(line);
        const record = JSON.parse(decrypted);
        // Only retain records that have not expired (TTL of 1 hour)
        if (record.createdAt + 3600 * 1000 >= now) {
          uniqueMappings.set(record.placeholder, record);
        }
      } catch (err) {
        throw err;
      }
    }

    const newContent = Array.from(uniqueMappings.values())
      .map((record) => this.encrypt(JSON.stringify(record)))
      .join("\n") + "\n";
    
    fs.writeFileSync(this.filePath, newContent, "utf8");
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", this.encryptionKey, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  }

  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(":");
    if (parts.length < 2) {
      throw new Error("Invalid encrypted format");
    }
    const ivHex = parts.shift()!;
    const encrypted = parts.join(":");
    
    if (!/^[a-f0-9]+$/i.test(ivHex) || !/^[a-f0-9]+$/i.test(encrypted)) {
      throw new Error("Invalid encrypted format: non-hex characters");
    }
    
    const iv = Buffer.from(ivHex, "hex");
    if (iv.length !== 16) {
      throw new Error("Invalid encrypted format: incorrect IV length");
    }

    const decipher = crypto.createDecipheriv("aes-256-cbc", this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}
