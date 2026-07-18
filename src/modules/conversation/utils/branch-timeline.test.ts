import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBranchAncestry,
  resolveTimelineFromSegments,
  type BranchNode,
  type TimelineMessage,
} from "./branch-timeline";

function branch(
  partial: Pick<BranchNode, "id" | "parentBranchId" | "forkFromMessageId"> &
    Partial<BranchNode>
): BranchNode {
  return {
    conversationId: "conv_1",
    title: partial.title ?? "Branch",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...partial,
  };
}

function message(
  partial: Pick<TimelineMessage, "id" | "branchId"> & Partial<TimelineMessage>
): TimelineMessage {
  return {
    conversationId: "conv_1",
    role: "USER",
    status: "COMPLETE",
    content: partial.content ?? partial.id,
    parts: null,
    metadata: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...partial,
  };
}

describe("buildBranchAncestry", () => {
  it("returns root-to-leaf order", () => {
    const main = branch({
      id: "b_main",
      parentBranchId: null,
      forkFromMessageId: null,
    });
    const child = branch({
      id: "b_child",
      parentBranchId: "b_main",
      forkFromMessageId: "m2",
    });
    const map = new Map([
      [main.id, main],
      [child.id, child],
    ]);

    const ancestry = buildBranchAncestry("b_child", map);
    assert.deepEqual(
      ancestry.map((item) => item.id),
      ["b_main", "b_child"]
    );
  });
});

describe("resolveTimelineFromSegments", () => {
  it("returns owned messages for a root branch", () => {
    const main = branch({
      id: "b_main",
      parentBranchId: null,
      forkFromMessageId: null,
    });
    const messages = new Map([
      [
        "b_main",
        [
          message({ id: "m1", branchId: "b_main" }),
          message({ id: "m2", branchId: "b_main" }),
        ],
      ],
    ]);

    const timeline = resolveTimelineFromSegments([main], messages);
    assert.deepEqual(
      timeline.map((item) => item.id),
      ["m1", "m2"]
    );
  });

  it("shares prefix up to fork and appends child-owned messages", () => {
    const main = branch({
      id: "b_main",
      parentBranchId: null,
      forkFromMessageId: null,
    });
    const child = branch({
      id: "b_child",
      parentBranchId: "b_main",
      forkFromMessageId: "m2",
    });
    const messages = new Map([
      [
        "b_main",
        [
          message({ id: "m1", branchId: "b_main" }),
          message({ id: "m2", branchId: "b_main" }),
          message({ id: "m3", branchId: "b_main" }),
        ],
      ],
      [
        "b_child",
        [
          message({ id: "m4", branchId: "b_child" }),
          message({ id: "m5", branchId: "b_child" }),
        ],
      ],
    ]);

    const timeline = resolveTimelineFromSegments([main, child], messages);
    assert.deepEqual(
      timeline.map((item) => item.id),
      ["m1", "m2", "m4", "m5"]
    );
  });

  it("shares nothing when child fork is null (edit-from-start)", () => {
    const main = branch({
      id: "b_main",
      parentBranchId: null,
      forkFromMessageId: null,
    });
    const child = branch({
      id: "b_child",
      parentBranchId: "b_main",
      forkFromMessageId: null,
    });
    const messages = new Map([
      [
        "b_main",
        [
          message({ id: "m1", branchId: "b_main" }),
          message({ id: "m2", branchId: "b_main" }),
        ],
      ],
      [
        "b_child",
        [message({ id: "m3", branchId: "b_child" })],
      ],
    ]);

    const timeline = resolveTimelineFromSegments([main, child], messages);
    assert.deepEqual(
      timeline.map((item) => item.id),
      ["m3"]
    );
  });

  it("throws on invalid fork point", () => {
    const main = branch({
      id: "b_main",
      parentBranchId: null,
      forkFromMessageId: null,
    });
    const child = branch({
      id: "b_child",
      parentBranchId: "b_main",
      forkFromMessageId: "missing",
    });
    const messages = new Map([
      ["b_main", [message({ id: "m1", branchId: "b_main" })]],
      ["b_child", []],
    ]);

    assert.throws(
      () => resolveTimelineFromSegments([main, child], messages),
      /Invalid branch fork point/
    );
  });
});
