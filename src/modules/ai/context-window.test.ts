import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  estimateMessageTokens,
  trimMessagesForContext,
} from "@/modules/ai/context-window";

function textMessage(
  id: string,
  role: UIMessage["role"],
  text: string
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  };
}

describe("trimMessagesForContext", () => {
  it("returns messages unchanged when under budget", () => {
    const messages = [
      textMessage("1", "user", "hi"),
      textMessage("2", "assistant", "hello"),
    ];

    const result = trimMessagesForContext(messages, {
      contextWindow: 128_000,
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.id, "1");
  });

  it("drops oldest messages when over budget", () => {
    const pad = "x".repeat(400); // ~100 tokens each
    const messages = [
      textMessage("1", "user", pad),
      textMessage("2", "assistant", pad),
      textMessage("3", "user", pad),
      textMessage("4", "assistant", pad),
      textMessage("5", "user", "latest"),
    ];

    const result = trimMessagesForContext(messages, {
      contextWindow: 500,
      reservedTokens: 100,
      maxInputTokens: 250,
    });

    assert.ok(result.length < messages.length);
    assert.equal(result.at(-1)?.id, "5");
    assert.ok(result.some((m) => m.id === "5"));
  });

  it("always keeps at least the newest message", () => {
    const huge = "y".repeat(40_000);
    const messages = [textMessage("only", "user", huge)];

    const result = trimMessagesForContext(messages, {
      contextWindow: 1_000,
      reservedTokens: 100,
      maxInputTokens: 50,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "only");
  });
});

describe("estimateMessageTokens", () => {
  it("estimates from text length", () => {
    const message = textMessage("1", "user", "abcd");
    assert.equal(estimateMessageTokens(message), 1);
  });
});
