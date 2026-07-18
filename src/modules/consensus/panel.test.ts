import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { canRunConsensus, resolvePanelModels } from "./panel";

describe("resolvePanelModels", () => {
  const original = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  };

  afterEach(() => {
    if (original.openai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original.openai;
    if (original.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original.anthropic;
    if (original.google === undefined)
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = original.google;
  });

  it("uses three OpenAI models when only OpenAI is configured", () => {
    process.env.OPENAI_API_KEY = "test";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    assert.equal(canRunConsensus(), true);
    assert.deepEqual(
      resolvePanelModels().map((model) => model.id),
      ["openai:gpt-4o-mini", "openai:gpt-4o", "openai:gpt-4.1-mini"]
    );
  });
});

