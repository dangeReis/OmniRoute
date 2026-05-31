export type FieldCategory = "content" | "reasoning" | "toolArgs" | "partialJson";

export function createSseTextTransform(
  processor: (text: string, field: FieldCategory) => string,
  onFlush?: (lastJson: any) => any,
  onCancel?: () => void,
): TransformStream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");
  let lineBuffer = "";
  let lastPrefix = "data: ";
  let lastJson: any = null;
  let flushed = false;
  let errored = false;

  const handleLine = (line: string, controller: TransformStreamDefaultController) => {
    const trimmed = line.trim();
    if (trimmed === "" || line.startsWith(":")) {
      // Pass comments and empty lines through unchanged
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }

    if (line.startsWith("data:")) {
      const prefix = line.startsWith("data: ") ? "data: " : "data:";
      lastPrefix = prefix;
      const segment = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      if (segment === "[DONE]") {
        if (onFlush) {
          const flushedValue = onFlush(lastJson);
          if (flushedValue) {
            const prefix = lastPrefix || "data: ";
            const payload = typeof flushedValue === "string" ? flushedValue : JSON.stringify(flushedValue);
            controller.enqueue(encoder.encode(prefix + payload + "\n"));
          }
          flushed = true;
        }
        controller.enqueue(encoder.encode(line + "\n"));
        return;
      }

      const trimmedSegment = segment.trim();
      if (trimmedSegment.startsWith("{") || trimmedSegment.startsWith("[")) {
        try {
          const json = JSON.parse(trimmedSegment);
          
          let matched = false;

          // OpenAI CC
          if (json.choices && Array.isArray(json.choices)) {
            for (const choice of json.choices) {
              if (choice?.delta) {
                const delta = choice.delta;
                if (typeof delta.content === "string") {
                  delta.content = processor(delta.content, "content");
                  matched = true;
                } else if (Array.isArray(delta.content)) {
                  for (const part of delta.content) {
                    if (part && typeof part.text === "string") {
                      part.text = processor(part.text, "content");
                      matched = true;
                    }
                  }
                }
                if (typeof delta.reasoning_content === "string") {
                  delta.reasoning_content = processor(delta.reasoning_content, "reasoning");
                  matched = true;
                }
                if (typeof delta.reasoning === "string") {
                  delta.reasoning = processor(delta.reasoning, "reasoning");
                  matched = true;
                }
                if (Array.isArray(delta.tool_calls)) {
                  for (const tool of delta.tool_calls) {
                    if (typeof tool?.function?.arguments === "string") {
                      tool.function.arguments = processor(tool.function.arguments, "toolArgs");
                      matched = true;
                    }
                  }
                }
              }
            }
          }

          // Claude
          else if (json.delta && typeof json.delta === "object") {
            const delta = json.delta;
            if (typeof delta.text === "string") {
              delta.text = processor(delta.text, "content");
              matched = true;
            }
            if (typeof delta.thinking === "string") {
              delta.thinking = processor(delta.thinking, "reasoning");
              matched = true;
            }
            if (typeof delta.partial_json === "string") {
              delta.partial_json = processor(delta.partial_json, "partialJson");
              matched = true;
            }
          }

          // Responses API
          else if (typeof json.delta === "string") {
            json.delta = processor(json.delta, "content");
            matched = true;
          }
          // The Responses API json.item.arguments was previously separate but should be part of this if-else chain.
          // Wait, is json.item.arguments mutually exclusive with json.delta?
          // Looking at the original:
          // if (typeof json.delta === "string") { ... }
          // if (typeof json.item?.arguments === "string") { ... }
          // Let's just group them into one else if check that checks either.
          // Or wait, responses API might have BOTH in one chunk? Usually not. But we can just use independent mutually-exclusive branches for different root shapes.
          // Let's make "Responses API (delta)" and "Responses API (item)" else ifs.
          else if (typeof json.item?.arguments === "string") {
            json.item.arguments = processor(json.item.arguments, "toolArgs");
            matched = true;
          }

          // Gemini
          else if (Array.isArray(json.candidates)) {
            for (const cand of json.candidates) {
              if (cand?.content && Array.isArray(cand.content.parts)) {
                for (const part of cand.content.parts) {
                  if (part && typeof part.text === "string") {
                    part.text = processor(part.text, "content");
                    matched = true;
                  }
                }
              }
            }
          }

          // Generic
          else if (typeof json.content === "string") {
            json.content = processor(json.content, "content");
            matched = true;
          }
          else if (typeof json.text === "string") {
            json.text = processor(json.text, "content");
            matched = true;
          }

          if (!matched) {
            console.warn("[SSE-TRANSFORM] Unrecognized SSE JSON format, passing through unprocessed. Keys:", Object.keys(json).slice(0, 5).join(", "));
          }

          lastJson = json;
          controller.enqueue(encoder.encode(prefix + JSON.stringify(json) + "\n"));
        } catch {
          // JSON parsing failed, treat segment as raw text delta (fail-open)
          const processed = processor(segment, "content");
          controller.enqueue(encoder.encode(prefix + processed + "\n"));
        }
      } else {
        // Starts with data: but not JSON, process as raw text
        const processed = processor(segment, "content");
        controller.enqueue(encoder.encode(prefix + processed + "\n"));
      }
    } else {
      // Non-data line, pass through (e.g. event: content_block_delta)
      controller.enqueue(encoder.encode(line + "\n"));
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      try {
        const chunkStr = decoder.decode(chunk, { stream: true });
        lineBuffer += chunkStr;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || "";

        for (const line of lines) {
          handleLine(line, controller);
        }
      } catch (err) {
        const context = typeof chunk === "string" ? chunk.slice(0, 200) : String(chunk).slice(0, 200);
        console.error("[SSE-TRANSFORM] Error in transform:", err, "chunk:", context);
        lineBuffer = "";
        errored = true;
        controller.error(err);
      }
    },
    flush(controller) {
      if (errored) return;
      try {
        const remaining = decoder.decode() + lineBuffer;
        if (remaining) {
          handleLine(remaining, controller);
        }
        if (onFlush && !flushed) {
          const flushedValue = onFlush(lastJson);
          if (flushedValue) {
            const prefix = lastPrefix || "data: ";
            const payload = typeof flushedValue === "string" ? flushedValue : JSON.stringify(flushedValue);
            controller.enqueue(encoder.encode(prefix + payload + "\n"));
          }
        }
      } catch (err) {
        console.error("[SSE-TRANSFORM] Error in flush:", err);
        controller.error(err);
      }
    },
    cancel(reason: any) {
      if (onCancel) {
        onCancel();
      }
    }
  } as any);
}
