import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AppError,
  ErrorCodes,
  conflict,
  isAppError,
  notFound,
  toErrorResponse,
  unauthorized,
  validation,
} from "@/lib/errors";

describe("AppError / toErrorResponse", () => {
  it("maps codes to HTTP status", () => {
    assert.equal(unauthorized().status, 401);
    assert.equal(notFound().status, 404);
    assert.equal(validation("bad").status, 400);
    assert.equal(conflict("dup").status, 409);
  });

  it("serializes structured JSON", async () => {
    const res = toErrorResponse(notFound("Notebook not found"));
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, ErrorCodes.NOT_FOUND);
    assert.equal(body.error, "Notebook not found");
  });

  it("never leaks unknown internals", async () => {
    const res = toErrorResponse(new Error("ECONNREFUSED 10.0.0.1:5432"));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, ErrorCodes.INTERNAL);
    assert.equal(body.error, "Something went wrong. Please try again.");
  });

  it("detects AppError instances", () => {
    assert.equal(isAppError(new AppError(ErrorCodes.FORBIDDEN, "no")), true);
    assert.equal(isAppError(new Error("x")), false);
  });
});
