import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateCostUsd } from "@/modules/usage/cost";

describe("estimateCostUsd", () => {
  it("estimates known model cost", () => {
    const cost = estimateCostUsd({
      model: "openai:gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(cost, 0.75);
  });

  it("returns null for unknown models", () => {
    assert.equal(
      estimateCostUsd({
        model: "unknown:model",
        inputTokens: 100,
        outputTokens: 100,
      }),
      null
    );
  });
});
