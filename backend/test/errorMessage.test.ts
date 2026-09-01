import { describe, it, expect } from "vitest";
import { errorMessage } from "../src/lib/errorMessage";

describe("errorMessage", () => {
  it("extracts message from a real Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("extracts message from a Supabase-style error-like object that is not instanceof Error", () => {
    const postgrestErrorLike = { message: "relation does not exist", code: "42P01", details: null, hint: null };
    expect(errorMessage(postgrestErrorLike)).toBe("relation does not exist");
  });

  it("falls back to String() for a value with no message property", () => {
    expect(errorMessage("just a string")).toBe("just a string");
    expect(errorMessage(42)).toBe("42");
  });

  it("does not produce the useless '[object Object]' for a plain error-like object", () => {
    const result = errorMessage({ message: "actual reason" });
    expect(result).not.toBe("[object Object]");
    expect(result).toBe("actual reason");
  });
});
