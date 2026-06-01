import { createSseTextTransform, FieldCategory } from "./sseTextTransform";
import { sanitizePII } from "./piiSanitizer";

export interface PiiTransformOptions {
  windowSize?: number;
}

export function createPiiSseTransform(options?: PiiTransformOptions): TransformStream {
  const choiceBuffers = new Map<number, Record<FieldCategory, string>>();

  const getBuffers = (index: number): Record<FieldCategory, string> => {
    let buf = choiceBuffers.get(index);
    if (!buf) {
      buf = {
        content: "",
        reasoning: "",
        toolArgs: "",
        partialJson: ""
      };
      choiceBuffers.set(index, buf);
    }
    return buf;
  };

  const W = options?.windowSize ?? Math.max(80, parseInt(process.env.PII_WINDOW_SIZE || "", 10) || 100);

  const processor = (text: string, field: FieldCategory, isStopSignal = false, index = 0): string => {
    const buffers = getBuffers(index);
    buffers[field] += text;
    const { text: sanitized, endMatchIndex } = sanitizePII(buffers[field], !isStopSignal);
    let emitLength = isStopSignal ? sanitized.length : Math.max(0, sanitized.length - W);
    
    // Cap emitLength at the start of any PII that touched the end of the buffer
    if (!isStopSignal && endMatchIndex !== undefined && emitLength > endMatchIndex) {
      emitLength = endMatchIndex;
    }
    
    // Prevent slicing in the middle of a UTF-16 surrogate pair (e.g. emojis)
    if (emitLength > 0 && emitLength < sanitized.length) {
      const charCode = sanitized.charCodeAt(emitLength - 1);
      // High surrogate range is 0xD800 - 0xDBFF
      if (charCode >= 0xd800 && charCode <= 0xdbff) {
        emitLength -= 1;
      }
    }
    
    const toEmit = sanitized.slice(0, emitLength);
    buffers[field] = sanitized.slice(emitLength);
    return toEmit;
  };

  const onFlush = (lastJson: any): any => {
    // Force final redaction on all buffers
    for (const [index, buffers] of choiceBuffers.entries()) {
      for (const key of Object.keys(buffers)) {
        const field = key as FieldCategory;
        if (buffers[field]) {
          buffers[field] = sanitizePII(buffers[field]).text;
        }
      }
    }

    let hasRemaining = false;
    for (const buffers of choiceBuffers.values()) {
      for (const key of Object.keys(buffers)) {
        if (buffers[key as FieldCategory].length > 0) {
          hasRemaining = true;
        }
      }
    }
    if (!hasRemaining) {
      return null;
    }

    if (!lastJson) {
      const buffers = getBuffers(0);
      if (buffers.content) {
        const remaining = buffers.content;
        buffers.content = "";
        
        // Wrap in a safe default OpenAI format to prevent client-side SDK crashes
        return {
          choices: [
            {
              delta: {
                content: remaining
              }
            }
          ]
        };
      }
      return null;
    }

    const finalJson = JSON.parse(JSON.stringify(lastJson));

    const clearDeltas = (obj: any) => {
      if (!obj || typeof obj !== "object") return;
      for (const key of Object.keys(obj)) {
        if (["id", "model", "object", "created", "finish_reason", "finishReason", "role", "type", "index", "stop_reason"].includes(key)) {
          continue;
        }
        if (typeof obj[key] === "string") {
          obj[key] = "";
        } else if (typeof obj[key] === "object") {
          clearDeltas(obj[key]);
        }
      }
    };
    clearDeltas(finalJson);

    const populateRemaining = (obj: any, currentIndex = 0) => {
      if (!obj || typeof obj !== "object") return;
      
      let idx = currentIndex;
      if (typeof obj.index === "number") {
        idx = obj.index;
      }

      const buffers = getBuffers(idx);

      // OpenAI CC
      if (obj.choices && Array.isArray(obj.choices)) {
        const presentIndexes = new Set(obj.choices.map((c: any) => c.index).filter((idx: any) => typeof idx === "number"));
        for (const [choiceIdx, choiceBuf] of choiceBuffers.entries()) {
          if (!presentIndexes.has(choiceIdx) && (choiceBuf.content || choiceBuf.reasoning || choiceBuf.toolArgs)) {
            obj.choices.push({ index: choiceIdx, delta: {} });
          }
        }

        for (const choice of obj.choices) {
          const choiceIdx = typeof choice.index === "number" ? choice.index : idx;
          const choiceBuf = getBuffers(choiceIdx);
          if (!choice.delta) choice.delta = {};
          const delta = choice.delta;
          
          if (choiceBuf.content) {
            delta.content = (delta.content || "") + choiceBuf.content;
            choiceBuf.content = "";
          }
          if (choiceBuf.reasoning) {
            delta.reasoning_content = (delta.reasoning_content || "") + choiceBuf.reasoning;
            choiceBuf.reasoning = "";
          }
          if (choiceBuf.toolArgs) {
            if (!Array.isArray(delta.tool_calls)) {
              delta.tool_calls = [];
            }
            if (delta.tool_calls.length === 0) {
              delta.tool_calls.push({ function: {} });
            }
            if (!delta.tool_calls[0].function) {
              delta.tool_calls[0].function = {};
            }
            delta.tool_calls[0].function.arguments = (delta.tool_calls[0].function.arguments || "") + choiceBuf.toolArgs;
            choiceBuf.toolArgs = "";
          }
        }
      }

      // Claude
      else if (obj.delta && typeof obj.delta === "object") {
        const delta = obj.delta;
        if (buffers.content) {
          delta.text = (delta.text || "") + buffers.content;
          buffers.content = "";
        }
        if (buffers.reasoning) {
          delta.thinking = (delta.thinking || "") + buffers.reasoning;
          buffers.reasoning = "";
        }
        if (buffers.partialJson) {
          delta.partial_json = (delta.partial_json || "") + buffers.partialJson;
          buffers.partialJson = "";
        }
      }

      // Responses API
      else if (typeof obj.delta === "string" || typeof obj.item?.arguments === "string") {
        if (buffers.content) {
          obj.delta = (obj.delta || "") + buffers.content;
          buffers.content = "";
        }
        if (buffers.toolArgs) {
          if (!obj.item) obj.item = {};
          obj.item.arguments = (obj.item.arguments || "") + buffers.toolArgs;
          buffers.toolArgs = "";
        }
      }

      // Gemini
      else if (Array.isArray(obj.candidates)) {
        for (const cand of obj.candidates) {
          if (!cand.content) cand.content = {};
          if (!Array.isArray(cand.content.parts)) cand.content.parts = [];
          if (cand.content.parts.length === 0) cand.content.parts.push({});
          
          if (buffers.content) {
            cand.content.parts[0].text = (cand.content.parts[0].text || "") + buffers.content;
            buffers.content = "";
          }
        }
      }

      // Generic
      else {
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === "string") {
            let field: FieldCategory = "content";
            if (key === "reasoning" || key === "thinking" || key === "reasoning_content") {
              field = "reasoning";
            } else if (key === "arguments") {
              field = "toolArgs";
            } else if (key === "partial_json") {
              field = "partialJson";
            }
            const choiceBuf = getBuffers(idx);
            if (choiceBuf[field]) {
              obj[key] = (obj[key] || "") + choiceBuf[field];
              choiceBuf[field] = "";
            }
          } else if (typeof obj[key] === "object") {
            populateRemaining(obj[key], idx);
          }
        }
      }
    };

    populateRemaining(finalJson);
    
    // Clear all buffers
    for (const buffers of choiceBuffers.values()) {
      buffers.content = "";
      buffers.reasoning = "";
      buffers.toolArgs = "";
      buffers.partialJson = "";
    }

    return finalJson;
  };

  return createSseTextTransform(processor, onFlush);
}
