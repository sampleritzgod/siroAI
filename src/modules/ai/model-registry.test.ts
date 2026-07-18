import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_MODEL_ID,
  hasProviderApiKey,
  listConfiguredModels,
  resolveConfiguredModelId,
  resolveModelId,
} from "./model-registry";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

function stashEnv() {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("model-registry", () => {
  stashEnv();

  afterEach(() => {
    restoreEnv();
  });

  it("resolveModelId falls back to default for unknown ids", () => {
    assert.equal(resolveModelId("nope"), DEFAULT_MODEL_ID);
    assert.equal(resolveModelId("openai:gpt-4o"), "openai:gpt-4o");
  });

  it("hasProviderApiKey reflects env", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(hasProviderApiKey("openai"), false);
    assert.equal(hasProviderApiKey("anthropic"), false);

    process.env.OPENAI_API_KEY = "sk-test";
    assert.equal(hasProviderApiKey("openai"), true);
  });

  it("listConfiguredModels only includes keyed providers", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    const configured = listConfiguredModels();
    assert.ok(configured.every((model) => model.provider === "openai"));
    assert.ok(configured.some((model) => model.id === "openai:gpt-4o-mini"));
  });

  it("resolveConfiguredModelId falls back when provider key missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    assert.equal(
      resolveConfiguredModelId("anthropic:claude-sonnet-4"),
      "openai:gpt-4o-mini"
    );
    assert.equal(
      resolveConfiguredModelId("openai:gpt-4o"),
      "openai:gpt-4o"
    );
  });
});
