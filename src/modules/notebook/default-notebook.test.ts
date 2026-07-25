import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_NOTEBOOK_TITLE } from "@/modules/notebook/constants";
import {
  getOrCreateDefaultNotebookForUser,
  needsDefaultNotebookForLegacyUser,
} from "@/modules/notebook/default-notebook";
import type { NotebookRecord } from "@/modules/notebook/service";

describe("needsDefaultNotebookForLegacyUser", () => {
  it("creates a default notebook only for users with conversations and no default", () => {
    assert.equal(
      needsDefaultNotebookForLegacyUser({
        conversationCount: 2,
        hasDefaultNotebook: false,
      }),
      true
    );
    assert.equal(
      needsDefaultNotebookForLegacyUser({
        conversationCount: 0,
        hasDefaultNotebook: false,
      }),
      false
    );
    assert.equal(
      needsDefaultNotebookForLegacyUser({
        conversationCount: 3,
        hasDefaultNotebook: true,
      }),
      false
    );
  });
});

describe("getOrCreateDefaultNotebookForUser", () => {
  it("returns the existing default notebook without creating another", async () => {
    const existing: NotebookRecord = {
      id: "nb_existing",
      userId: "user_1",
      title: DEFAULT_NOTEBOOK_TITLE,
      description: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    };

    let createCalls = 0;
    const notebook = await getOrCreateDefaultNotebookForUser("user_1", {
      findFirst: async () => existing,
      create: async () => {
        createCalls += 1;
        throw new Error("should not create");
      },
    });

    assert.equal(notebook.id, "nb_existing");
    assert.equal(createCalls, 0);
  });

  it("creates the default notebook when missing", async () => {
    const created: NotebookRecord = {
      id: "nb_new",
      userId: "user_2",
      title: DEFAULT_NOTEBOOK_TITLE,
      description: null,
      createdAt: new Date("2026-01-02"),
      updatedAt: new Date("2026-01-02"),
    };

    let finds = 0;
    const notebook = await getOrCreateDefaultNotebookForUser("user_2", {
      findFirst: async () => {
        finds += 1;
        return null;
      },
      create: async (args) => {
        assert.equal(args.data.userId, "user_2");
        assert.equal(args.data.title, DEFAULT_NOTEBOOK_TITLE);
        return created;
      },
    });

    assert.equal(notebook.id, "nb_new");
    assert.equal(finds, 1);
  });

  it("recovers when a concurrent create wins the race", async () => {
    const raced: NotebookRecord = {
      id: "nb_raced",
      userId: "user_3",
      title: DEFAULT_NOTEBOOK_TITLE,
      description: null,
      createdAt: new Date("2026-01-03"),
      updatedAt: new Date("2026-01-03"),
    };

    let finds = 0;
    const notebook = await getOrCreateDefaultNotebookForUser("user_3", {
      findFirst: async () => {
        finds += 1;
        return finds === 1 ? null : raced;
      },
      create: async () => {
        throw new Error("unique constraint");
      },
    });

    assert.equal(notebook.id, "nb_raced");
    assert.equal(finds, 2);
  });
});
