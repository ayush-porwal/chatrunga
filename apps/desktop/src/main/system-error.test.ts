import { describe, expect, it } from "vitest";
import { errorCode } from "./system-error";

describe("errorCode", () => {
  it("reads a Node system error's code", () => {
    expect(errorCode(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe("ENOENT");
  });

  it("is undefined for errors without a string code, and for non-errors", () => {
    expect(errorCode(new Error("plain"))).toBeUndefined();
    expect(errorCode(Object.assign(new Error("numeric"), { code: 5 }))).toBeUndefined();
    expect(errorCode({ code: "ENOENT" })).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
});
