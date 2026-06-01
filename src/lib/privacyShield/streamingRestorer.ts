// src/lib/privacyShield/streamingRestorer.ts

import type { PlaceholderSession } from "./session.ts";

export class StreamingRestorer {
  constructor(session: PlaceholderSession, options?: { escapeForJson?: boolean }) {
    throw new Error("not implemented");
  }
  push(text: string): string {
    throw new Error("not implemented");
  }
  flush(): string {
    throw new Error("not implemented");
  }
  destroy(): void {}
}

export function createRestoringTransform(session: PlaceholderSession): TransformStream {
  throw new Error("not implemented");
}
