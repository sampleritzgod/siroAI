import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  branchOwnedIdsAfter,
  truncateTimelineThrough,
} from "./message-truncate";

describe("branchOwnedIdsAfter", () => {
  const timeline = [
    { id: "m1", branchId: "main" },
    { id: "m2", branchId: "main" },
    { id: "m3", branchId: "child" },
    { id: "m4", branchId: "child" },
  ];

  it("returns only branch-owned ids after the keep point", () => {
    assert.deepEqual(branchOwnedIdsAfter(timeline, "m2", "child"), [
      "m3",
      "m4",
    ]);
    assert.deepEqual(branchOwnedIdsAfter(timeline, "m3", "child"), ["m4"]);
  });

  it("never returns ancestor-owned ids", () => {
    assert.deepEqual(branchOwnedIdsAfter(timeline, "m1", "child"), [
      "m3",
      "m4",
    ]);
    assert.deepEqual(branchOwnedIdsAfter(timeline, "m1", "main"), ["m2"]);
  });

  it("returns empty when keep id is missing", () => {
    assert.deepEqual(branchOwnedIdsAfter(timeline, "missing", "child"), []);
  });
});

describe("truncateTimelineThrough", () => {
  it("keeps inclusive prefix", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepEqual(truncateTimelineThrough(rows, "b"), [
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("returns empty when id missing", () => {
    assert.deepEqual(truncateTimelineThrough([{ id: "a" }], "x"), []);
  });
});
