import { createSseTextTransform, FieldCategory } from "./sseTextTransform";
import { sanitizePIIChunk } from "./piiSanitizer";

export function createPiiSseTransform(): TransformStream {
  const buffers: Record<FieldCategory, string> = {
    content: "",
    reasoning: "",
    toolArgs: "",
    partialJson: ""
  };
  const W = 100;

  const processor = (text: string, field: FieldCategory): string => {
    buffers[field] += text;
    const sanitized = sanitizePIIChunk(buffers[field]);
    const emitLength = Math.max(0, sanitized.length - W);
    const toEmit = sanitized.slice(0, emitLength);
    buffers[field] = sanitized.slice(emitLength);
    return toEmit;
  };

  const onFlush = (lastJson: any): any => {
    let hasRemaining = false;
    for (const key of Object.keys(buffers)) {
      if (buffers[key as FieldCategory].length > 0) {
        hasRemaining = true;
      }
    }
    if (!hasRemaining) {
      return null;
    }

    if (!lastJson) {
      return null;
    }

    const finalJson = JSON.parse(JSON.stringify(lastJson));

    const populateRemaining = (obj: any) => {
      if (!obj || typeof obj !== "object") return;

      // OpenAI CC
      if (obj.choices && Array.isArray(obj.choices)) {
        for (const choice of obj.choices) {
          if (choice?.delta) {
            const delta = choice.delta;
            if (typeof delta.content === "string") {
              delta.content = buffers.content;
              buffers.content = "";
            } else if (Array.isArray(delta.content)) {
              for (const part of delta.content) {
                if (part && typeof part.text === "string") {
                  part.text = buffers.content;
                  buffers.content = "";
                }
              }
            }
            if (typeof delta.reasoning_content === "string") {
              delta.reasoning_content = buffers.reasoning;
              buffers.reasoning = "";
            }
            if (typeof delta.reasoning === "string") {
              delta.reasoning = buffers.reasoning;
              buffers.reasoning = "";
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const tool of delta.tool_calls) {
                if (typeof tool?.function?.arguments === "string") {
                  tool.function.arguments = buffers.toolArgs;
                  buffers.toolArgs = "";
                }
              }
            }
          }
        }
      }

      // Claude
      if (obj.delta && typeof obj.delta === "object") {
        const delta = obj.delta;
        if (typeof delta.text === "string") {
          delta.text = buffers.content;
          buffers.content = "";
        }
        if (typeof delta.thinking === "string") {
          delta.thinking = buffers.reasoning;
          buffers.reasoning = "";
        }
        if (typeof delta.partial_json === "string") {
          delta.partial_json = buffers.partialJson;
          buffers.partialJson = "";
        }
      }

      // Responses API
      if (typeof obj.delta === "string") {
        obj.delta = buffers.content;
        buffers.content = "";
      }
      if (typeof obj.item?.arguments === "string") {
        obj.item.arguments = buffers.toolArgs;
        buffers.toolArgs = "";
      }

      // Gemini
      if (Array.isArray(obj.candidates)) {
        for (const cand of obj.candidates) {
          if (cand?.content && Array.isArray(cand.content.parts)) {
            for (const part of cand.content.parts) {
              if (part && typeof part.text === "string") {
                part.text = buffers.content;
                buffers.content = "";
              }
            }
          }
        }
      }

      // Generic
      if (typeof obj.content === "string") {
        obj.content = buffers.content;
        buffers.content = "";
      }
      if (typeof obj.text === "string") {
        obj.text = buffers.content;
        buffers.content = "";
      }
    };

    populateRemaining(finalJson);
    return finalJson;
  };

  return createSseTextTransform(processor, onFlush);
}
